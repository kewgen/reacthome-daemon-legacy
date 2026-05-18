const { existsSync, unlinkSync, readdirSync } = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ASSETS, DB, BACKUPS_GC } = require("./assets/constants");
const { PROJECT, DEVICE, IMAGE, SCRIPT, SITE, DAEMON, POOL } = require("./constants");
const db = require("./db");
const { asset } = require("./fs");

// Safety: лимит на удаление за один запуск. Защита от лавины при регрессии
// build()/mark — если cleanup вдруг решит выкосить много объектов, лучше
// аварийно остановиться и потребовать ручной запуск с --force.
const MAX_DELETE_PER_RUN = 50;

// Safety: никогда не удалять физические устройства и каналы.
// MAC-формат (xx:xx:xx:xx:xx:xx[:xx:xx]) — это адреса физических устройств,
// 1-Wire slaves могут быть оторваны от mark-структуры (привязаны через
// device-specific массивы master.temperature_ext[] и т.п., которые build()
// не обходит). UUID-подканалы (UUID/path/N, например 51cb6aba/modbus/1
// для IntesisBox) — это подканалы устройств, тоже не сироты.
// Их физическое присутствие/отсутствие должно решаться отдельно (см. INC-050,
// orphan-sweep.js whitelist).
const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}/i;
function isPhysicalId(id) {
  return MAC_RE.test(id) || id.includes('/');
}

// Опциональный event-log для audit-trail удалений
let eventLog = null;
try {
  const m = require("./logging/event-log");
  if (m && typeof m.add === "function") eventLog = m;
} catch (e) { /* модуль не подключён — это норма */ }

function isNumber(str) {
  return /^[0-9]+$/.test(str);
}

// Бэкап LevelDB в var/backups/gc/db-<ts>.tar.gz перед удалением.
// Возвращает путь к бэкапу или null при ошибке.
function backupDb() {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = path.join(BACKUPS_GC, `db-${ts}.tar.gz`);
    // tar czf <backup> -C <var> db
    execSync(`tar czf ${backupPath} -C ${path.dirname(DB)} ${path.basename(DB)}`);
    console.log(`[gc] backup: ${backupPath}`);
    return backupPath;
  } catch (e) {
    console.error(`[gc] backup FAILED: ${e.message}`);
    return null;
  }
}

// Mark-фаза: помечает в state[] все объекты, достижимые из корня (id).
// Pure-read: не модифицирует pool и не пишет в БД (см. INC-049 баг 3).
// Чистка числовых ключей вынесена в cleanup() как отдельная фаза после mark.
const build = (id, pool, state, assets) => {
  if (state[id]) return;
  const subject = pool[id];
  if (!subject) return;
  state[id] = subject;
  for (const [k, v] of Object.entries(subject)) {
    if (isNumber(k)) {
      // Числовые ключи помечаются как «требуют чистки», но не удаляются здесь.
      // См. cleanup() — там после полного mark проходит вторая фаза.
      continue;
    }
    if (!v) continue;
    if (typeof v === 'string') {
      switch (k) {
        case PROJECT: {
          build(v, pool, state, assets);
          break;
        }
        case IMAGE: {
          if (!assets.includes(v)) {
            assets.push(v);
          }
          break;
        }
      }
    } else if (Array.isArray(v)) {
      switch (k) {
        case SITE:
        case SCRIPT: {
          for (const i of v) {
            build(i, pool, state, assets);
          }
          break;
        }
        case DEVICE: {
          // INC-049 баг 1: было `for (const i of d)` где d — строка-MAC,
          // что итерировало по символам. Правильно — искать в pool все ключи
          // вида `<MAC>/<channel>/<N>` (физические подканалы устройства).
          // + рекурсивный build(d) чтобы у устройства обошлись массивы
          // script[] / onShortClick[] / display и т.п. (баг 4).
          for (const d of v) {
            build(d, pool, state, assets);
            for (const key of Object.keys(pool)) {
              if (key.startsWith(`${d}/`)) state[key] = pool[key];
            }
          }
          break;
        }
        default: {
          // INC-049 баг 4: добавлен case DEVICE — у smart-панелей S4 (type=37)
          // могут быть массивы со ссылками на script (display/onShortClick[]),
          // их тоже нужно обходить.
          switch (subject.type) {
            case DAEMON:
            case PROJECT:
            case SITE:
            case SCRIPT:
            case DEVICE: {
              for (const i of v) {
                build(i, pool, state, assets);
              }
              break;
            }
          }
          break;
        }
      }
    }
  }
};

// cleanup(pool, options) — mark-and-sweep garbage collector.
// options:
//   force=true → пропустить лимит MAX_DELETE_PER_RUN
module.exports.cleanup = (pool, options = {}) => {
  const state = {};
  const assets = [];
  build(pool.mac, pool, state, assets);

  // INC-049 баг 2: shell вызывается по СТРОКЕ-команде через
  // ACTION_SHELL_START.payload.command, не по UUID. Mark по UUID-ссылкам
  // не доходит до shell-объектов. Дополнительный проход помечает все
  // shell, у которых command совпадает с command какого-либо достижимого
  // ACTION_SHELL_START.
  const shellCommandsInUse = new Set();
  for (const id of Object.keys(state)) {
    const a = state[id];
    if (a && a.type === 'ACTION_SHELL_START' && a.payload && a.payload.command) {
      shellCommandsInUse.add(a.payload.command);
    }
  }
  for (const [shellId, shell] of Object.entries(pool)) {
    if (state[shellId]) continue;
    if (shell && shell.type === 'shell' && shellCommandsInUse.has(shell.command)) {
      state[shellId] = shell;
    }
  }

  // Фаза чистки числовых ключей — отдельно после mark (INC-049 баг 3).
  // Раньше это делалось внутри build() с db.put, что нарушало pure-read mark.
  for (const id of Object.keys(state)) {
    const subject = state[id];
    if (!subject || typeof subject !== 'object') continue;
    let dirty = false;
    for (const k of Object.keys(subject)) {
      if (isNumber(k)) { delete subject[k]; dirty = true; }
    }
    if (dirty) db.put(id, JSON.stringify(subject));
  }

  // Сбор orphan-объектов (исключая физические id, подканалы, keep-флаг)
  const toDelete = [];
  for (const k of Object.keys(pool)) {
    if (k === 'mac') continue;
    if (k === POOL) continue;
    if (isPhysicalId(k)) continue;  // не трогаем MAC и UUID/path/N
    if (state[k] !== undefined) continue;
    // Whitelist через payload-флаг keep: true.
    // Позволяет «закрепить» объект — например, заготовку под будущую миграцию
    // (см. INC-051 shell «Уведомление» 16e63ebb). Устанавливается через
    // обычный ACTION_SET payload={keep: true}.
    if (pool[k] && pool[k].keep === true) continue;
    toDelete.push(k);
  }

  if (toDelete.length === 0) {
    console.log(`[gc] no orphans, nothing to do`);
    return { deleted: 0 };
  }

  // Safety: лимит на количество удалений
  if (toDelete.length > MAX_DELETE_PER_RUN && !options.force) {
    console.error(`[gc] ABORT: would delete ${toDelete.length} objects (> ${MAX_DELETE_PER_RUN} limit). Run with {force:true} to override.`);
    return { deleted: 0, wouldDelete: toDelete.length, aborted: true };
  }

  // Бэкап перед любым удалением
  const backupPath = backupDb();
  if (!backupPath) {
    console.error(`[gc] ABORT: backup failed, refuse to delete without backup`);
    return { deleted: 0, wouldDelete: toDelete.length, aborted: true };
  }

  // Удаление + audit-trail
  for (const k of toDelete) {
    const oldState = pool[k];
    delete pool[k];
    db.del(k);
    if (eventLog) {
      try {
        eventLog.add(k, oldState, null, { source: "gc" }, { type: "GC_CLEANUP" });
      } catch (e) { /* не ломать gc из-за event-log */ }
    }
  }
  console.log(`[gc] deleted ${toDelete.length} orphan objects (backup: ${backupPath})`);
  return { deleted: toDelete.length, backupPath };

  // Чистка orphan-ассетов
  for (const i of readdirSync(ASSETS)) {
    if (!assets.includes(i)) {
      const a = asset(i);
      if (existsSync(a)) {
        unlinkSync(a);
      }
    }
  }
};
