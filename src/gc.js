const { existsSync, unlinkSync, readdirSync } = require("fs");
const { ASSETS } = require("./assets/constants");
const { PROJECT, DEVICE, IMAGE, SCRIPT, SITE, DAEMON, POOL } = require("./constants");
const db = require("./db");
const { asset } = require("./fs");

function isNumber(str) {
  return /^[0-9]+$/.test(str);
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

module.exports.cleanup = (pool) => {
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

  // Сбор orphan-объектов
  const toDelete = [];
  for (const k of Object.keys(pool)) {
    if (k === 'mac') continue;
    if (k === POOL) continue;
    if (state[k] === undefined) toDelete.push(k);
  }

  for (const k of toDelete) {
    delete pool[k];
    db.del(k);
  }
  if (toDelete.length > 0) console.log(`[gc] deleted ${toDelete.length} orphan objects`);

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
