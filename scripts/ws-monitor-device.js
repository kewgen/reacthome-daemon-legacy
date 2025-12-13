#!/usr/bin/env node

/**
 * ============================================================================
 * WebSocket Monitor: Мониторинг устройства с запросом состояния
 * ============================================================================
 * 
 * Зачем: Отправляет GET запрос для подписки на устройство, затем слушает изменения
 * 
 * Использование:
 *   node scripts/ws-monitor-device.js <device-id>
 * 
 * Пример:
 *   node scripts/ws-monitor-device.js 34731215-af9b-4847-b2f9-67c8940271c0
 * 
 * ============================================================================
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Загружаем переменные окружения из .env
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
  // Игнорируем ошибки загрузки .env
}

// Конфигурация
const PI_HOST = process.env.REACTHOME_PI_HOST || '192.168.88.4';
const PI_WS_PORT = process.env.REACTHOME_PI_WS_PORT || '3000';
const PI_WS_URL = `ws://${PI_HOST}:${PI_WS_PORT}`;

// Получаем ID устройства из аргументов командной строки
const TARGET_DEVICE_ID = process.argv[2];

if (!TARGET_DEVICE_ID) {
  console.error('❌ Ошибка: Не указан ID устройства');
  console.error('');
  console.error('Использование:');
  console.error('  node scripts/ws-monitor-device.js <device-id>');
  console.error('');
  console.error('Пример:');
  console.error('  node scripts/ws-monitor-device.js 34731215-af9b-4847-b2f9-67c8940271c0');
  console.error('');
  process.exit(1);
}

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║   WebSocket Monitor: Мониторинг устройства                   ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('📊 Конфигурация:');
console.log(`   Малинка: ${PI_WS_URL}`);
console.log(`   ID устройства: ${TARGET_DEVICE_ID}`);
console.log('');
console.log('🔍 Подключаюсь...');
console.log('');

// Счетчики
let totalMessages = 0;
let matchedMessages = 0;
let getRequestSent = false;

// Подключение к WebSocket малинки
const ws = new WebSocket(PI_WS_URL);

ws.on('open', () => {
  console.log('✅ Подключено к малинке');
  console.log('');
  
  // Зачем: Отправляем GET запрос для получения текущего состояния и подписки на изменения
  console.log('📤 Отправляю GET запрос для устройства...');
  const getRequest = {
    type: 'get',
    state: [TARGET_DEVICE_ID]
  };
  ws.send(JSON.stringify(getRequest));
  getRequestSent = true;
  
  console.log('✅ GET запрос отправлен');
  console.log('👂 Слушаю изменения...');
  console.log('');
  console.log('─'.repeat(80));
  console.log('');
});

ws.on('message', (data) => {
  totalMessages++;
  
  try {
    const messageStr = data.toString('utf8');
    const message = JSON.parse(messageStr);
    
    const timestamp = new Date().toISOString();
    const messageType = message.type || 'unknown';
    const messageId = message.id || '';
    
    // Зачем: Показываем ВСЕ сообщения, связанные с устройством
    const isDirectMatch = messageId === TARGET_DEVICE_ID;
    const containsId = messageStr.includes(TARGET_DEVICE_ID);
    
    if (isDirectMatch || containsId) {
      matchedMessages++;
      
      const matchType = isDirectMatch ? '🎯 ПРЯМОЕ' : '🔗 СВЯЗАННОЕ';
      
      console.log(`[${timestamp}] Сообщение #${matchedMessages} (всего: ${totalMessages})`);
      console.log(`${matchType} | Тип: ${messageType} | ID: ${messageId}`);
      console.log('');
      
      // Показываем payload подробно
      if (message.payload) {
        console.log('📦 Payload:');
        Object.entries(message.payload).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            console.log(`   ${key}: ${JSON.stringify(value)}`);
          } else {
            console.log(`   ${key}: ${value}`);
          }
        });
        console.log('');
      }
      
      console.log('📋 Полное сообщение:');
      console.log(JSON.stringify(message, null, 2));
      console.log('');
      console.log('─'.repeat(80));
      console.log('');
    }
  } catch (e) {
    // Игнорируем не-JSON сообщения
  }
});

ws.on('error', (error) => {
  console.error(`❌ Ошибка WebSocket: ${error.message}`);
});

ws.on('close', (code, reason) => {
  const reasonStr = reason ? reason.toString() : 'нет причины';
  console.log('');
  console.log('─'.repeat(80));
  console.log('');
  console.log('📊 Финальная статистика:');
  console.log(`   Всего сообщений получено: ${totalMessages}`);
  console.log(`   Найдено сообщений для устройства: ${matchedMessages}`);
  console.log('');
  console.log(`⚠️  Соединение закрыто. Код: ${code}, Причина: ${reasonStr}`);
  process.exit(0);
});

// Обработка сигналов завершения
process.on('SIGINT', () => {
  console.log('');
  console.log('');
  console.log('⚠️  Получен сигнал завершения (Ctrl+C)');
  console.log('');
  console.log('📊 Финальная статистика:');
  console.log(`   Всего сообщений получено: ${totalMessages}`);
  console.log(`   Найдено сообщений для устройства: ${matchedMessages}`);
  console.log('');
  
  ws.close();
  process.exit(0);
});

