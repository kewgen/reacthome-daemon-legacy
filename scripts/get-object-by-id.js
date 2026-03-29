#!/usr/bin/env node

/**
 * Получение содержимого объекта по UUID через WebSocket
 *
 * Использование:
 *   node scripts/get-object-by-id.js <uuid>
 *   node scripts/get-object-by-id.js f445ac1d-7c3f-4294-986f-26e1140a77d8
 *
 * Зачем: Получает полное содержимое объекта по его UUID через WebSocket API
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

const objectId = process.argv[2];

if (!objectId) {
  console.error('Использование: node scripts/get-object-by-id.js <uuid>');
  process.exit(1);
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!uuidRegex.test(objectId)) {
  console.error(`❌ Некорректный UUID: ${objectId}`);
  process.exit(1);
}

async function getObjectById() {
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  let objectData = null;

  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    console.log('Объект не найден или не отвечает');
    ws.close();
    process.exit(1);
  }, 30000);

  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    console.log(`[STEP] Запрашиваем данные объекта ${objectId}...`);
    
    // Зачем: Запрашиваем данные объекта через GET
    ws.send(JSON.stringify({ type: 'get', state: [objectId] }));
  });

  let messageCount = 0;

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
      messageCount++;

      // Зачем: Обрабатываем ACTION_SET сообщения с нужным ID
      if (message.type === 'ACTION_SET' && message.id === objectId && message.payload) {
        objectData = { id: message.id, ...message.payload };
        clearTimeout(timeout);
        displayObject();
        ws.close();
        process.exit(0);
      }

      // Зачем: Если получили LIST, значит объект может не существовать
      if (message.type === 'list' && message.state) {
        const exists = message.state.some(([id]) => id === objectId);
        if (!exists) {
          console.log(`[WARNING] Объект ${objectId} не найден в списке объектов`);
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

  function displayObject() {
    if (!objectData) {
      console.log(`❌ Объект ${objectId} не найден`);
      return;
    }

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║ СОДЕРЖИМОЕ ОБЪЕКТА                                             ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    console.log(`UUID: ${objectData.id || objectId}`);
    console.log(`Тип: ${objectData.type || '(не указан)'}`);
    
    if (objectData.title) console.log(`Название: ${objectData.title}`);
    if (objectData.code) console.log(`Code: ${objectData.code}`);
    if (objectData.name) console.log(`Name: ${objectData.name}`);
    
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('ПОЛНОЕ СОДЕРЖИМОЕ (JSON)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    console.log(JSON.stringify(objectData, null, 2));
    console.log('');
  }
}

getObjectById().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
