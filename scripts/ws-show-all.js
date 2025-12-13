#!/usr/bin/env node

/**
 * ============================================================================
 * WebSocket Show All: Показать все сообщения (для отладки)
 * ============================================================================
 * 
 * Зачем: Показывает ВСЕ входящие сообщения с кратким описанием
 *        Полезно для понимания структуры и поиска нужных сообщений
 * 
 * Использование:
 *   node scripts/ws-show-all.js
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

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║   WebSocket Show All: Все сообщения (отладка)               ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('📊 Конфигурация:');
console.log(`   Малинка: ${PI_WS_URL}`);
console.log('');
console.log('⚠️  ВНИМАНИЕ: Будут показаны ВСЕ сообщения!');
console.log('   Используйте Ctrl+C для остановки');
console.log('');
console.log('🔍 Подключаюсь...');
console.log('');

// Счетчики
let totalMessages = 0;
let messagesByType = {};

// Подключение к WebSocket малинки
const ws = new WebSocket(PI_WS_URL);

ws.on('open', () => {
  console.log('✅ Подключено к малинке');
  console.log('👂 Показываю все сообщения...');
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
    const messageId = message.id || 'N/A';
    
    // Считаем статистику по типам
    messagesByType[messageType] = (messagesByType[messageType] || 0) + 1;
    
    // Краткий вывод
    console.log(`[${timestamp}] #${totalMessages}`);
    console.log(`  Тип: ${messageType}`);
    console.log(`  ID: ${messageId}`);
    
    // Показываем ключевые поля payload
    if (message.payload) {
      const keys = Object.keys(message.payload).slice(0, 5); // Первые 5 ключей
      if (keys.length > 0) {
        console.log(`  Payload: ${keys.join(', ')}${Object.keys(message.payload).length > 5 ? '...' : ''}`);
      }
    }
    
    console.log('');
    
  } catch (e) {
    // Не-JSON сообщение
    console.log(`[${new Date().toISOString()}] #${totalMessages} [BINARY или не-JSON]`);
    console.log('');
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
  console.log(`   Всего сообщений: ${totalMessages}`);
  console.log('');
  console.log('   По типам:');
  Object.entries(messagesByType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
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
  console.log(`   Всего сообщений: ${totalMessages}`);
  console.log('');
  console.log('   По типам:');
  Object.entries(messagesByType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
  console.log('');
  
  ws.close();
  process.exit(0);
});

