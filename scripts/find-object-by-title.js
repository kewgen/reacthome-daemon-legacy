#!/usr/bin/env node

/**
 * Поиск объектов по названию (title) через WebSocket
 *
 * Использование:
 *   node scripts/find-object-by-title.js "DELDEL"
 *   node scripts/find-object-by-title.js "название"
 *
 * Зачем: Находит все объекты (скрипты, устройства, shell и т.д.) по названию через WebSocket
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
const PI_WS_PORT = process.env.REACTHOME_WS_PORT || '3000';
const WS_URI = process.env.REACTHOME_WS_URI || `ws://${PI_HOST}:${PI_WS_PORT}`;
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');

const SEARCH_TERM = process.argv[2];

if (!SEARCH_TERM) {
  console.error('Использование: node scripts/find-object-by-title.js "название"');
  process.exit(1);
}

async function findObjectByTitle() {
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  const allIds = [];
  const objects = new Map(); // id -> { id, payload }

  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    console.log(`Получено: ${allIds.length} ID, ${objects.size} объектов`);
    ws.close();
    processResults();
    process.exit(1);
  }, 30000);

  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    console.log(`[INFO] Поиск объектов с названием: "${SEARCH_TERM}"\n`);
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
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('РЕЗУЛЬТАТЫ ПОИСКА');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const searchLower = SEARCH_TERM.toLowerCase().trim();
    const matches = [];

    // Зачем: Ищем объекты по названию (title, code, name)
    for (const [objId, obj] of objects) {
      const p = obj.payload || {};
      const title = (p.title || '').toString().toLowerCase();
      const code = (p.code || '').toString().toLowerCase();
      const name = (p.name || '').toString().toLowerCase();

      if (title.includes(searchLower) || code.includes(searchLower) || name.includes(searchLower)) {
        matches.push({
          id: objId,
          type: p.type || '(не указан)',
          title: p.title,
          code: p.code,
          name: p.name,
          payload: p
        });
      }
    }

    console.log(`Найдено объектов: ${matches.length}\n`);

    if (matches.length === 0) {
      console.log(`❌ Объекты с названием, содержащим "${SEARCH_TERM}", не найдены\n`);
    } else {
      matches.forEach((match, idx) => {
        console.log(`${idx + 1}. ${match.title || match.code || match.name || '(без названия)'}`);
        console.log(`   UUID: ${match.id}`);
        console.log(`   Тип: ${match.type}`);
        if (match.code && match.code !== match.title) {
          console.log(`   Code: ${match.code}`);
        }
        if (match.name && match.name !== match.title && match.name !== match.code) {
          console.log(`   Name: ${match.name}`);
        }
        console.log('');
      });

      console.log('═══════════════════════════════════════════════════════════════════');
      console.log('ПОЛНОЕ СОДЕРЖИМОЕ НАЙДЕННЫХ ОБЪЕКТОВ');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      matches.forEach((match, idx) => {
        console.log(`\n${idx + 1}. ${match.title || match.code || match.name || '(без названия)'} (${match.id})`);
        console.log(JSON.stringify({ id: match.id, ...match.payload }, null, 2));
        console.log('');
      });
    }
  }
}

findObjectByTitle().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
