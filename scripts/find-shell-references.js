#!/usr/bin/env node

/**
 * Поиск всех объектов, ссылающихся на указанные shell-объекты
 *
 * Использование:
 *   node scripts/find-shell-references.js f8dab91d-62b2-4748-bdf2-9a6e8f73eb5b 76e014b4-...
 *   node scripts/find-shell-references.js "Спальная музыка 1" "Спальная музыка"
 *
 * Зачем: Находит все проекты и скрипты, которые ссылаются на указанные shell-объекты
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
try {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        const [k, ...v] = t.split('=');
        if (k) process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    });
  }
} catch (e) {}

const PI_HOST = process.env.REACTHOME_PI_HOST || '192.168.88.4';
const PI_WS_PORT = process.env.REACTHOME_PI_WS_PORT || '3000';
const WS_URI = process.env.REACTHOME_WS_URI || `ws://${PI_HOST}:${PI_WS_PORT}`;
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');

// Зачем: Аргументы — UUID или названия shell-объектов
const shell1Arg = process.argv[2];
const shell2Arg = process.argv[3];

if (!shell1Arg || !shell2Arg) {
  console.error('Использование: node scripts/find-shell-references.js <shell1_uuid_or_name> <shell2_uuid_or_name>');
  process.exit(1);
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => uuidRegex.test(String(s).trim());

async function findShellReferences() {
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  const allIds = [];
  const objects = new Map(); // id -> { id, payload }

  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 30000);

  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    console.log('[STEP] Запрашиваем список всех объектов...');
    ws.send(JSON.stringify({ type: 'list' }));

    setTimeout(() => {
      const ids = allIds.filter(id => !id.includes('/'));
      if (ids.length === 0) {
        console.log('[WARNING] Объекты не найдены');
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }

      console.log(`[STEP] Запрашиваем данные ${ids.length} объектов...`);
      const BATCH_SIZE = 100;
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'get', state: batch }));
        }, (i / BATCH_SIZE) * 500);
      }

      setTimeout(() => {
        clearTimeout(timeout);
        processResults();
        ws.close();
        process.exit(0);
      }, 5000 + Math.ceil(ids.length / BATCH_SIZE) * 1000);
    }, 2000);
  });

  ws.on('message', (data) => {
    try {
      let dataStr = data.toString();
      if (isGateway && dataStr.length >= 36) {
        const prefix = dataStr.substring(0, 36);
        if (uuidRegex.test(prefix)) {
          dataStr = dataStr.substring(36);
        }
      }

      const message = JSON.parse(dataStr);

      if (message.type === 'list' && message.state) {
        message.state.forEach(([id]) => allIds.push(id));
      }

      if (message.type === 'ACTION_SET' && message.id && message.payload) {
        const prev = objects.get(message.id) || { id: message.id, payload: {} };
        prev.payload = Object.assign(prev.payload, message.payload);
        objects.set(message.id, prev);
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });

  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });

  // Зачем: Функция для поиска shell по UUID или названию
  function findShell(arg) {
    if (isUuid(arg)) {
      const obj = objects.get(arg.trim());
      if (obj) {
        const p = obj.payload || {};
        if ((p.type || '').toString().toLowerCase() === 'shell') {
          return { id: obj.id, ...p };
        }
      }
      return null;
    }
    const name = String(arg).toLowerCase();
    for (const [objId, obj] of objects) {
      const p = obj.payload || {};
      const type = (p.type || '').toString().toLowerCase();
      if (type === 'shell') {
        const title = (p.title || p.code || '').toString().toLowerCase();
        if (title.includes(name)) {
          return { id: objId, ...p };
        }
      }
    }
    return null;
  }

  // Зачем: Поиск ссылок на shell в проектах (project.shell[])
  function findProjectReferences(shellId) {
    const refs = [];
    for (const [objId, obj] of objects) {
      const p = obj.payload || {};
      const type = (p.type || '').toString().toLowerCase();
      if (type === 'project') {
        const shell = p.shell;
        if (Array.isArray(shell) && shell.includes(shellId)) {
          refs.push({
            projectId: objId,
            projectTitle: p.title || p.code || objId,
            projectCode: p.code,
            shell: shell
          });
        }
      }
    }
    return refs;
  }

  // Зачем: Поиск ссылок на shell в скриптах (script.action[] -> ACTION_SHELL_START/STOP)
  function findScriptReferences(shellId) {
    const refs = [];
    for (const [objId, obj] of objects) {
      const p = obj.payload || {};
      const type = (p.type || '').toString().toLowerCase();
      if (type === 'script') {
        const actions = p.action || [];
        for (const actId of actions) {
          const act = objects.get(actId)?.payload;
          if (!act) continue;
          const actType = (act.type || '').toString();
          if (actType === 'ACTION_SHELL_START' || actType === 'ACTION_SHELL_STOP') {
            const shellRefId = act.payload?.id ?? act.id;
            if (shellRefId === shellId) {
              refs.push({
                scriptId: objId,
                scriptTitle: p.title || p.code || objId,
                scriptCode: p.code,
                actionId: actId,
                actionType: actType,
                disabled: p.disabled || false
              });
            }
          }
        }
      }
    }
    return refs;
  }

  function processResults() {
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║ ПОИСК ССЫЛОК НА SHELL-ОБЪЕКТЫ                                   ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    const shell1 = findShell(shell1Arg);
    const shell2 = findShell(shell2Arg);

    if (!shell1) {
      console.log(`❌ Shell 1 не найден: "${shell1Arg}"`);
      return;
    }
    if (!shell2) {
      console.log(`❌ Shell 2 не найден: "${shell2Arg}"`);
      return;
    }

    console.log(`Shell 1: ${shell1.id}`);
    console.log(`  Название: ${shell1.title || shell1.code || '(без названия)'}`);
    console.log(`  Command: ${shell1.command ? (shell1.command.length > 80 ? shell1.command.slice(0, 77) + '...' : shell1.command) : '(нет)'}\n`);

    console.log(`Shell 2: ${shell2.id}`);
    console.log(`  Название: ${shell2.title || shell2.code || '(без названия)'}`);
    console.log(`  Command: ${shell2.command ? (shell2.command.length > 80 ? shell2.command.slice(0, 77) + '...' : shell2.command) : '(нет)'}\n`);

    // Зачем: Ищем ссылки в проектах
    const projRefs1 = findProjectReferences(shell1.id);
    const projRefs2 = findProjectReferences(shell2.id);

    // Зачем: Ищем ссылки в скриптах
    const scriptRefs1 = findScriptReferences(shell1.id);
    const scriptRefs2 = findScriptReferences(shell2.id);

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('ССЫЛКИ В ПРОЕКТАХ (project.shell[])');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log(`Shell 1 (${shell1.id}): ${projRefs1.length} ссылок в проектах`);
    if (projRefs1.length > 0) {
      projRefs1.forEach((ref, i) => {
        console.log(`  ${i + 1}. Проект: ${ref.projectTitle}`);
        console.log(`     ID: ${ref.projectId}`);
        if (ref.projectCode) console.log(`     Code: ${ref.projectCode}`);
        console.log(`     Всего shell в проекте: ${ref.shell.length}`);
      });
    } else {
      console.log('  (не используется в проектах)');
    }
    console.log('');

    console.log(`Shell 2 (${shell2.id}): ${projRefs2.length} ссылок в проектах`);
    if (projRefs2.length > 0) {
      projRefs2.forEach((ref, i) => {
        console.log(`  ${i + 1}. Проект: ${ref.projectTitle}`);
        console.log(`     ID: ${ref.projectId}`);
        if (ref.projectCode) console.log(`     Code: ${ref.projectCode}`);
        console.log(`     Всего shell в проекте: ${ref.shell.length}`);
      });
    } else {
      console.log('  (не используется в проектах)');
    }
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('ССЫЛКИ В СКРИПТАХ (script.action[] -> ACTION_SHELL_START/STOP)');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log(`Shell 1 (${shell1.id}): ${scriptRefs1.length} ссылок в скриптах`);
    if (scriptRefs1.length > 0) {
      scriptRefs1.forEach((ref, i) => {
        console.log(`  ${i + 1}. Скрипт: ${ref.scriptTitle}`);
        console.log(`     Script ID: ${ref.scriptId}`);
        if (ref.scriptCode) console.log(`     Code: ${ref.scriptCode}`);
        console.log(`     Action ID: ${ref.actionId}`);
        console.log(`     Action Type: ${ref.actionType}`);
        console.log(`     Отключён: ${ref.disabled ? 'да' : 'нет'}`);
      });
    } else {
      console.log('  (не используется в скриптах)');
    }
    console.log('');

    console.log(`Shell 2 (${shell2.id}): ${scriptRefs2.length} ссылок в скриптах`);
    if (scriptRefs2.length > 0) {
      scriptRefs2.forEach((ref, i) => {
        console.log(`  ${i + 1}. Скрипт: ${ref.scriptTitle}`);
        console.log(`     Script ID: ${ref.scriptId}`);
        if (ref.scriptCode) console.log(`     Code: ${ref.scriptCode}`);
        console.log(`     Action ID: ${ref.actionId}`);
        console.log(`     Action Type: ${ref.actionType}`);
        console.log(`     Отключён: ${ref.disabled ? 'да' : 'нет'}`);
      });
    } else {
      console.log('  (не используется в скриптах)');
    }
    console.log('');

    // Зачем: Сводная таблица
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('СВОДНАЯ ТАБЛИЦА');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log(`Shell 1 (${shell1.id}):`);
    console.log(`  Проекты: ${projRefs1.length}`);
    console.log(`  Скрипты: ${scriptRefs1.length}`);
    console.log(`  Всего ссылок: ${projRefs1.length + scriptRefs1.length}\n`);
    console.log(`Shell 2 (${shell2.id}):`);
    console.log(`  Проекты: ${projRefs2.length}`);
    console.log(`  Скрипты: ${scriptRefs2.length}`);
    console.log(`  Всего ссылок: ${projRefs2.length + scriptRefs2.length}\n`);
  }
}

findShellReferences().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
