#!/usr/bin/env node
/**
 * Тест WebSocket соединения с демоном
 * 
 * Использование:
 *   node tests/websocket/test-websocket-connection.js [ws://host:port]
 * 
 * Примеры:
 *   node tests/websocket/test-websocket-connection.js
 *   node tests/websocket/test-websocket-connection.js ws://192.168.88.4:3000
 *   node tests/websocket/test-websocket-connection.js ws://localhost:3000
 */

const WebSocket = require('ws');

// Параметры подключения
const DEFAULT_WS_URL = process.env.REACTHOME_WS_URI || 'ws://localhost:3000';
const WS_URL = process.argv[2] || DEFAULT_WS_URL;

// Таймауты
const CONNECTION_TIMEOUT = 5000;
const MESSAGE_TIMEOUT = 3000;
const TEST_DURATION = 10000; // 10 секунд теста

let connected = false;
let messagesReceived = 0;
let errors = [];
let startTime = Date.now();

console.log('='.repeat(60));
console.log('🧪 Тест WebSocket соединения');
console.log('='.repeat(60));
console.log(`URL: ${WS_URL}`);
console.log(`Таймаут подключения: ${CONNECTION_TIMEOUT}ms`);
console.log(`Длительность теста: ${TEST_DURATION}ms`);
console.log('');

// Создаём WebSocket соединение
const ws = new WebSocket(WS_URL);

// Таймер подключения
const connectionTimer = setTimeout(() => {
  if (!connected) {
    console.error('❌ Таймаут подключения');
    errors.push('Таймаут подключения');
    process.exit(1);
  }
}, CONNECTION_TIMEOUT);

// Обработчик открытия соединения
ws.on('open', () => {
  clearTimeout(connectionTimer);
  connected = true;
  const connectTime = Date.now() - startTime;
  console.log(`✅ Соединение установлено за ${connectTime}ms`);
  console.log('');
  
  // Отправляем тестовые сообщения
  console.log('📤 Отправка тестовых сообщений...');
  
  // 1. LIST - запрос списка
  setTimeout(() => {
    const listMsg = { type: 'list' };
    console.log(`  → ${JSON.stringify(listMsg)}`);
    ws.send(JSON.stringify(listMsg));
  }, 100);
  
  // 2. GET - запрос состояния
  setTimeout(() => {
    const getMsg = { type: 'get', state: ['pool'] };
    console.log(`  → ${JSON.stringify(getMsg)}`);
    ws.send(JSON.stringify(getMsg));
  }, 500);
  
  // 3. Простое сообщение для проверки
  setTimeout(() => {
    const testMsg = { type: 'ACTION_SET', id: 'test', payload: { test: true } };
    console.log(`  → ${JSON.stringify(testMsg)}`);
    ws.send(JSON.stringify(testMsg));
  }, 1000);
  
  // Завершаем тест через TEST_DURATION
  setTimeout(() => {
    console.log('');
    console.log('='.repeat(60));
    console.log('📊 Результаты теста:');
    console.log('='.repeat(60));
    console.log(`✅ Соединение: ${connected ? 'установлено' : 'не установлено'}`);
    console.log(`📨 Сообщений получено: ${messagesReceived}`);
    console.log(`❌ Ошибок: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('');
      console.log('Ошибки:');
      errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }
    
    const duration = Date.now() - startTime;
    console.log(`⏱️  Длительность: ${duration}ms`);
    console.log('');
    
    if (connected && messagesReceived > 0 && errors.length === 0) {
      console.log('✅ Тест пройден успешно!');
      process.exit(0);
    } else {
      console.log('❌ Тест не пройден');
      process.exit(1);
    }
  }, TEST_DURATION);
});

// Обработчик сообщений
ws.on('message', (data) => {
  messagesReceived++;
  try {
    const message = JSON.parse(data.toString());
    console.log(`📥 Сообщение #${messagesReceived}: ${message.type || 'unknown'}`);
    
    // Логируем первые несколько сообщений полностью
    if (messagesReceived <= 3) {
      console.log(`   ${JSON.stringify(message).substring(0, 200)}...`);
    }
  } catch (e) {
    console.log(`📥 Сообщение #${messagesReceived} (не JSON): ${data.toString().substring(0, 100)}`);
  }
});

// Обработчик ошибок
ws.on('error', (error) => {
  clearTimeout(connectionTimer);
  const errorMsg = error.message || error.toString();
  console.error(`❌ Ошибка WebSocket: ${errorMsg}`);
  errors.push(errorMsg);
  
  // Детальная информация об ошибке
  if (error.code) {
    console.error(`   Код ошибки: ${error.code}`);
  }
  if (error.errno) {
    console.error(`   Errno: ${error.errno}`);
  }
  if (error.syscall) {
    console.error(`   Syscall: ${error.syscall}`);
  }
  
  setTimeout(() => {
    console.log('');
    console.log('❌ Тест завершён с ошибкой');
    process.exit(1);
  }, 1000);
});

// Обработчик закрытия соединения
ws.on('close', (code, reason) => {
  const reasonStr = reason ? reason.toString() : 'нет причины';
  console.log('');
  console.log(`🔌 Соединение закрыто:`);
  console.log(`   Код: ${code}`);
  console.log(`   Причина: ${reasonStr}`);
  
  if (code !== 1000) {
    errors.push(`Неожиданное закрытие: код ${code}, причина: ${reasonStr}`);
  }
});

// Обработка сигналов завершения
process.on('SIGINT', () => {
  console.log('');
  console.log('⚠️  Прервано пользователем');
  ws.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  ws.close();
  process.exit(0);
});

