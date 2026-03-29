#!/usr/bin/env node

/**
 * Скрипт для получения списка shell-объектов через WebSocket
 *
 * Использование:
 *   node scripts/list-shells-websocket.js
 *   REACTHOME_WS_URI="wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316" \
 *   node scripts/list-shells-websocket.js
 *
 * Зачем: Получает все shell-объекты (project.shell[]) через WebSocket с поддержкой gateway
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

// Зачем: Определяем gateway для subprotocol 'listen'
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');

async function listShells() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ СПИСОК SHELL-ОБЪЕКТОВ                                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`WebSocket: ${WS_URI}`);
  if (isGateway) {
    console.log(`Тип: Gateway (subprotocol 'listen')\n`);
  } else {
    console.log(`Тип: Локальное подключение\n`);
  }

  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  const allIds = [];
  const objects = new Map(); // id -> { id, payload }

  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    console.log(`Получено: ${allIds.length} ID, ${objects.size} объектов`);
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
        console.log('[WARNING] Объекты не найдены в LIST ответе');
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
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  function processResults() {
    // Зачем: Собираем shell ID из project.shell[]
    const shellIds = new Set();
    const projectToShells = new Map(); // projectId -> [shellId]

    for (const [objId, obj] of objects) {
      const p = obj.payload || {};
      const type = (p.type || '').toString().toLowerCase();
      if (type === 'project') {
        const shell = p.shell;
        if (Array.isArray(shell)) {
          projectToShells.set(objId, shell);
          shell.forEach(sid => shellIds.add(sid));
        }
      }
    }

    const shells = [];
    for (const sid of shellIds) {
      const obj = objects.get(sid);
      const payload = obj?.payload || {};
      const projectRefs = [];
      for (const [pid, shellArr] of projectToShells) {
        if (shellArr.includes(sid)) {
          const proj = objects.get(pid);
          const projTitle = proj?.payload?.title || proj?.payload?.code || pid;
          projectRefs.push(projTitle);
        }
      }
      shells.push({
        id: sid,
        title: payload.title,
        code: payload.code,
        command: payload.command,
        payload,
        projects: projectRefs
      });
    }

    shells.sort((a, b) => {
      const na = (a.title || a.code || a.id || '').toLowerCase();
      const nb = (b.title || b.code || b.id || '').toLowerCase();
      return na.localeCompare(nb);
    });

    console.log('\n═══════════════════════════════════════════════════════════\n');
    console.log(`📊 НАЙДЕНО SHELL-ОБЪЕКТОВ: ${shells.length}\n`);

    if (shells.length === 0) {
      console.log('⚠️  Shell-объекты не найдены (project.shell[] пусты)\n');
    } else {
      shells.forEach((sh, i) => {
        const name = sh.title || sh.code || sh.id;
        console.log(`${i + 1}. ${name}`);
        console.log(`   ID: ${sh.id}`);
        if (sh.code && sh.code !== name) console.log(`   Code: ${sh.code}`);
        if (sh.command) {
          const cmd = sh.command.length > 80 ? sh.command.slice(0, 77) + '...' : sh.command;
          console.log(`   Command: ${cmd}`);
        }
        if (sh.projects.length) {
          console.log(`   Projects: ${sh.projects.join(', ')}`);
        }
        console.log('');
      });

      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('📋 ID ВСЕХ SHELL-ОБЪЕКТОВ:\n');
      shells.forEach(sh => console.log(`  ${sh.id}`));
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');
  }
}

listShells().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
