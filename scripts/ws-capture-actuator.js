#!/usr/bin/env node

/**
 * ============================================================================
 * WebSocket Capture: Перехват сообщений актуатора
 * ============================================================================
 * 
 * Зачем: Показывает ВСЕ сообщения от конкретного актуатора для отладки
 * 
 * Использование:
 *   node scripts/ws-capture-actuator.js <actuator-mac>
 * 
 * Пример:
 *   node scripts/ws-capture-actuator.js 68:27:19:e4:49:17
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

// Получаем MAC актуатора из аргументов командной строки
const TARGET_ACTUATOR = process.argv[2];

if (!TARGET_ACTUATOR) {
  console.error('❌ Ошибка: Не указан MAC актуатора');
  console.error('');
  console.error('Использование:');
  console.error('  node scripts/ws-capture-actuator.js <actuator-mac>');
  console.error('');
  console.error('Пример:');
  console.error('  node scripts/ws-capture-actuator.js 68:27:19:e4:49:17');
  console.error('');
  process.exit(1);
}

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║   WebSocket Capture: Перехват сообщений актуатора           ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('📊 Конфигурация:');
console.log(`   Малинка: ${PI_WS_URL}`);
console.log(`   MAC актуатора: ${TARGET_ACTUATOR}`);
console.log('');
console.log('🔍 Подключаюсь...');
console.log('');

// Счетчики
let totalMessages = 0;
let matchedMessages = 0;

// Подключение к WebSocket малинки
const ws = new WebSocket(PI_WS_URL);

ws.on('open', () => {
  console.log('✅ Подключено к малинке');
  console.log('👂 Слушаю сообщения от актуатора...');
  console.log('');
  console.log('─'.repeat(80));
  console.log('');
});

ws.on('message', (data) => {
  totalMessages++;
  
  try {
    const messageStr = data.toString('utf8');
    const message = JSON.parse(messageStr);
    
    // Зачем: Ищем сообщения, где ID начинается с MAC актуатора
    // Формат: MAC/channel или просто MAC
    const messageId = message.id || '';
    const isActuatorMessage = messageId.startsWith(TARGET_ACTUATOR);
    
    if (isActuatorMessage) {
      matchedMessages++;
      
      const timestamp = new Date().toISOString();
      const messageType = message.type || 'unknown';
      
      console.log(`[${timestamp}] Сообщение #${matchedMessages} (всего: ${totalMessages})`);
      console.log(`🎯 ID: ${messageId}`);
      console.log(`📝 Тип: ${messageType}`);
      
      // Показываем краткую информацию о payload
      if (message.payload) {
        console.log('📦 Payload:');
        const keys = Object.keys(message.payload);
        keys.forEach(key => {
          const value = message.payload[key];
          if (typeof value === 'object' && value !== null) {
            console.log(`   ${key}: ${JSON.stringify(value)}`);
          } else {
            console.log(`   ${key}: ${value}`);
          }
        });
      }
      
      // Показываем контекст если есть
      if (message._context) {
        console.log(`🔗 Context: ${JSON.stringify(message._context)}`);
      }
      
      console.log('');
      console.log('📋 Полное содержимое:');
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
  console.log(`   Найдено сообщений от актуатора: ${matchedMessages}`);
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
  console.log(`   Найдено сообщений от актуатора: ${matchedMessages}`);
  console.log('');
  
  ws.close();
  process.exit(0);
});

