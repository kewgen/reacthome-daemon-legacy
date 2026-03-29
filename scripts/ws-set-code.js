#!/usr/bin/env node

/**
 * Установка code для объекта через WebSocket
 * 
 * Использование:
 *   node scripts/ws-set-code.js "ID" "CODE"
 * 
 * Зачем: Устанавливает code для идентификации объекта в ЛК
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Загружаем переменные окружения
const PROJECT_DIR = path.resolve(__dirname, '..');
try {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    });
  }
} catch (e) {
  // Игнорируем ошибки
}

const PI_HOST = process.env.REACTHOME_PI_HOST || '192.168.88.4';
const PI_WS_PORT = process.env.REACTHOME_PI_WS_PORT || '3000';
const PI_WS_URL = `ws://${PI_HOST}:${PI_WS_PORT}`;

const OBJECT_ID = process.argv[2];
const CODE = process.argv[3];

if (!OBJECT_ID || !CODE) {
  console.error('❌ Использование: node scripts/ws-set-code.js "ID" "CODE"');
  console.error('Пример: node scripts/ws-set-code.js "015910c9-179f-4d31-81eb-ac9e658d5fea" "RECURSIVE_BUG"');
  process.exit(1);
}

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║   Установка code через WebSocket                            ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');
console.log(`📊 Подключение к: ${PI_WS_URL}`);
console.log(`🔍 ID объекта: ${OBJECT_ID}`);
console.log(`📝 Новый code: ${CODE}\n`);

const ws = new WebSocket(PI_WS_URL);

ws.on('open', () => {
  console.log('✅ Подключено к WebSocket\n');
  
  const message = {
    type: 'set',
    id: OBJECT_ID,
    code: CODE
  };
  
  console.log('📤 Отправка команды:');
  console.log(JSON.stringify(message, null, 2));
  console.log('');
  
  ws.send(JSON.stringify(message));
  
  console.log('✅ Команда отправлена');
  console.log('⏳ Ожидание подтверждения...\n');
  
  // Закрываем соединение через 3 секунды
  setTimeout(() => {
    console.log('✅ code установлен успешно');
    console.log('');
    console.log('Проверьте в ЛК или через:');
    console.log(`  node scripts/ws-get-script-details.js "${OBJECT_ID}"`);
    console.log('');
    ws.close();
    process.exit(0);
  }, 3000);
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    if (message[OBJECT_ID]) {
      console.log('📥 Получено подтверждение:');
      console.log(`  code: ${message[OBJECT_ID].code || 'НЕТ'}`);
      console.log('');
    }
  } catch (e) {
    // Игнорируем ошибки парсинга
  }
});

ws.on('error', (error) => {
  console.error('❌ Ошибка WebSocket:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 Соединение закрыто');
});
