#!/usr/bin/env node

/**
 * Скрипт для выполнения скрипта через внешний шлюз (gate.reacthome.net)
 * 
 * Использование:
 *   node scripts/external-run-script.js <script-id>
 * 
 * Переменные окружения:
 *   REACTHOME_MAC - MAC-адрес устройства (по умолчанию: e4:5f:01:20:44:0a)
 *   REACTHOME_GATE_URL - URL шлюза (по умолчанию: wss://gate.reacthome.net/<mac>)
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const MAC_ADDRESS = process.env.REACTHOME_MAC || 'e4:5f:01:20:44:0a';
const GATE_URL = process.env.REACTHOME_GATE_URL || `wss://gate.reacthome.net/${MAC_ADDRESS}`;
const PROTOCOL = 'listen';
const SCRIPT_ID = process.argv[2];

if (!SCRIPT_ID) {
  console.error('Использование: node scripts/external-run-script.js <script-id>');
  console.error('');
  console.error('Примеры:');
  console.error('  node scripts/external-run-script.js 41f41ead-2329-4a9e-a455-81da3651c6b4');
  console.error('  REACTHOME_MAC=e4:5f:01:20:44:0a node scripts/external-run-script.js <script-id>');
  console.error('');
  console.error('Переменные окружения:');
  console.error('  REACTHOME_MAC - MAC-адрес устройства');
  console.error('  REACTHOME_GATE_URL - URL шлюза (опционально)');
  process.exit(1);
}

console.log(`[INFO] Подключение к внешнему шлюзу: ${GATE_URL}`);
console.log(`[INFO] MAC-адрес: ${MAC_ADDRESS}`);
console.log(`[INFO] Скрипт ID: ${SCRIPT_ID}`);
console.log('');

const sessionId = uuidv4();
const ws = new WebSocket(GATE_URL, PROTOCOL);

let commandSent = false;
let responsesReceived = 0;
const timeout = setTimeout(() => {
  if (!commandSent) {
    console.error('[ERROR] Таймаут подключения к шлюзу');
    process.exit(1);
  } else {
    console.log(`\n[INFO] Получено ответов: ${responsesReceived}`);
    console.log('[INFO] Завершение работы');
    ws.close();
    process.exit(0);
  }
}, 10000);

ws.on('open', () => {
  console.log('[INFO] ✅ Подключено к шлюзу');
  console.log(`[INFO] UUID сеанса: ${sessionId}`);
  console.log('');
  
  const command = {
    type: 'ACTION_SCRIPT_RUN',
    id: SCRIPT_ID
  };
  
  // Формируем сообщение: UUID (36 символов) + JSON
  const message = sessionId + JSON.stringify(command);
  ws.send(message);
  commandSent = true;
  
  console.log('[INFO] 📤 Команда отправлена:');
  console.log(JSON.stringify(command, null, 2));
  console.log('');
  
  // Закрываем соединение через 5 секунд
  setTimeout(() => {
    clearTimeout(timeout);
    console.log(`\n[INFO] Получено ответов: ${responsesReceived}`);
    console.log('[INFO] Завершение работы');
    ws.close();
    process.exit(0);
  }, 5000);
});

ws.on('message', (data) => {
  try {
    const dataStr = data.toString();
    
    // Извлекаем UUID сеанса (первые 36 символов)
    if (dataStr.length < 36) {
      console.log('[WARNING] Получено сообщение неверного формата (слишком короткое)');
      return;
    }
    
    const receivedSessionId = dataStr.substring(0, 36);
    const message = dataStr.substring(36);
    
    // Проверяем, что это наш сеанс
    if (receivedSessionId === sessionId) {
      responsesReceived++;
      try {
        const response = JSON.parse(message);
        console.log(`[INFO] 📥 Получен ответ #${responsesReceived}:`);
        console.log(JSON.stringify(response, null, 2));
        console.log('');
      } catch (e) {
        console.log(`[INFO] 📥 Получен ответ #${responsesReceived} (raw):`);
        console.log(message);
        console.log('');
      }
    } else {
      // Сообщение для другого сеанса, игнорируем
      console.log('[DEBUG] Получено сообщение для другого сеанса, игнорируем');
    }
  } catch (e) {
    console.error('[ERROR] Ошибка обработки сообщения:', e.message);
  }
});

ws.on('error', (error) => {
  clearTimeout(timeout);
  console.error('[ERROR] ❌ Ошибка WebSocket:', error.message);
  console.error('');
  console.error('Возможные причины:');
  console.error('  1. Шлюз недоступен');
  console.error('  2. Неверный MAC-адрес');
  console.error('  3. Проблемы с сетью');
  console.error('  4. Демон не подключен к шлюзу');
  process.exit(1);
});

ws.on('close', (code, reason) => {
  clearTimeout(timeout);
  if (code === 1000) {
    console.log('[INFO] Соединение закрыто нормально');
  } else {
    console.log(`[INFO] Соединение закрыто (код: ${code}, причина: ${reason})`);
  }
});

