#!/usr/bin/env node

/**
 * Добавление/удаление shell в project.shell[] через WebSocket.
 *
 * Использование:
 *   node scripts/add-shell-to-project.js <shell_uuid> <project_uuid>
 *   node scripts/add-shell-to-project.js --remove <shell_uuid> <project_uuid>
 *
 * remove — удаляет zombie-ссылку (id в project.shell без объекта). Не проверяет существование shell.
 *
 * Зачем: Добавляет или удаляет shell-объект в массив project.shell[] через ACTION_SET
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

const isRemove = process.argv[2] === '--remove';
const shellId = isRemove ? process.argv[3] : process.argv[2];
const projectId = isRemove ? process.argv[4] : process.argv[3];

if (!shellId || !projectId) {
  console.error('Использование: node scripts/add-shell-to-project.js [--remove] <shell_uuid> <project_uuid>');
  process.exit(1);
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!uuidRegex.test(shellId)) {
  console.error(`❌ Некорректный UUID shell: ${shellId}`);
  process.exit(1);
}

if (!uuidRegex.test(projectId)) {
  console.error(`❌ Некорректный UUID проекта: ${projectId}`);
  process.exit(1);
}

async function addShellToProject() {
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  let projectData = null;
  let shellData = null;

  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);

  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    if (isRemove) {
      console.log(`[STEP] Запрашиваем данные проекта (режим remove)...`);
      ws.send(JSON.stringify({ type: 'get', state: [projectId] }));
    } else {
      console.log(`[STEP] Запрашиваем данные проекта и shell...`);
      ws.send(JSON.stringify({ type: 'get', state: [projectId, shellId] }));
    }
  });

  let performed = false; // Зачем: Флаг для предотвращения повторного выполнения

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

      if (message.type === 'ACTION_SET' && message.id && message.payload) {
        const id = message.id;
        const payload = message.payload;

        if (id === projectId && !projectData) {
          projectData = { id, ...payload };
          console.log(`[INFO] Получены данные проекта: ${projectData.title || projectData.code || projectId}`);
        }

        if (id === shellId && !shellData) {
          shellData = { id, ...payload };
          console.log(`[INFO] Получены данные shell: ${shellData.title || shellData.code || shellId}`);
        }

        // Зачем: remove — только проект; add — проект и shell. Когда данные готовы, выполняем
        const ready = isRemove ? projectData : (projectData && shellData);
        if (ready && !performed) {
          performed = true;
          clearTimeout(timeout);
          performAdd();
        }
      }
    } catch (e) {
      console.error('[ERROR] Ошибка парсинга сообщения:', e.message);
    }
  });

  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });

  function performAdd() {
    const projectType = (projectData.type || '').toString().toLowerCase();
    if (projectType !== 'project') {
      console.error(`❌ Объект ${projectId} не является проектом (type: ${projectType})`);
      ws.close();
      process.exit(1);
    }

    let updatedShells;
    if (isRemove) {
      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('УДАЛЕНИЕ ZOMBIE-ССЫЛКИ ИЗ PROJECT.SHELL');
      console.log('═══════════════════════════════════════════════════════════════════\n');
      const currentShells = Array.isArray(projectData.shell) ? [...projectData.shell] : [];
      if (!currentShells.includes(shellId)) {
        console.log(`⚠️  Shell ${shellId} не найден в project.shell (уже удалён?)`);
        ws.close();
        process.exit(0);
      }
      updatedShells = currentShells.filter((id) => id !== shellId);
      console.log(`Проект: ${projectData.title || projectData.code || projectId}`);
      console.log(`Удаляем zombie-ссылку: ${shellId}`);
      console.log(`Было shell: ${currentShells.length} → стало: ${updatedShells.length}\n`);
    } else {
      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('ДОБАВЛЕНИЕ SHELL В ПРОЕКТ');
      console.log('═══════════════════════════════════════════════════════════════════\n');
      const shellType = (shellData.type || '').toString().toLowerCase();
      if (shellType !== 'shell') {
        console.error(`❌ Объект ${shellId} не является shell (type: ${shellType})`);
        ws.close();
        process.exit(1);
      }
      const currentShells = Array.isArray(projectData.shell) ? [...projectData.shell] : [];
      if (currentShells.includes(shellId)) {
        console.log(`⚠️  Shell ${shellId} уже присутствует в проекте`);
        ws.close();
        process.exit(0);
      }
      updatedShells = [...currentShells, shellId];
      console.log(`Проект: ${projectData.title || projectData.code || projectId}`);
      console.log(`Shell: ${shellData.title || shellData.code || shellId}`);
      console.log(`Текущее количество shell: ${currentShells.length}`);
      console.log(`Новое количество shell: ${updatedShells.length}\n`);
    }

    const updatePayload = { shell: updatedShells };
    console.log('[STEP] Отправляем ACTION_SET для обновления проекта...');
    console.log(`Payload: ${JSON.stringify(updatePayload, null, 2)}\n`);

    ws.send(JSON.stringify({
      type: 'ACTION_SET',
      id: projectId,
      payload: updatePayload
    }));

    setTimeout(() => {
      console.log('✅ Команда отправлена');
      console.log('\nПроверьте результат через:');
      console.log(`  node scripts/list-shells-websocket.js`);
      if (!isRemove) {
        console.log(`  node scripts/find-shell-references.js ${shellId} ${projectId}`);
      }
      ws.close();
      process.exit(0);
    }, 2000);
  }
}

addShellToProject().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
