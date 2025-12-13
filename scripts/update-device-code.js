#!/usr/bin/env node

/**
 * Скрипт для обновления поля code физического устройства через WebSocket
 * 
 * Зачем: Позволяет исправить неправильные названия устройств (например, "S4 Ванна" → "S4 Ванная")
 * 
 * Использование:
 *   node scripts/update-device-code.js <MAC-адрес> <новый_code>
 *   node scripts/update-device-code.js 50:35:cc:2d:8e:fe "S4 Ванная"
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/update-device-code.js 50:35:cc:2d:8e:fe "S4 Ванная"
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTION_SET = 'ACTION_SET';

// Зачем: Проверяем аргументы командной строки
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('❌ Использование: node scripts/update-device-code.js <MAC-адрес> <новый_code>');
  console.error('   Пример: node scripts/update-device-code.js 50:35:cc:2d:8e:fe "S4 Ванная"');
  process.exit(1);
}

const deviceId = args[0];
const newCode = args[1];

console.log(`🔧 Обновление устройства ${deviceId}`);
console.log(`   Старое значение: (будет получено)`);
console.log(`   Новое значение: "${newCode}"`);
console.log(`   WebSocket: ${WS_URI}\n`);

async function updateDeviceCode() {
  const ws = new WebSocket(WS_URI);
  let deviceFound = false;
  let currentCode = null;
  let updateSent = false;
  let verificationReceived = false;
  
  const timeout = setTimeout(() => {
    console.error('❌ Таймаут ожидания ответа');
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    console.log('✅ Подключено к WebSocket');
    // Зачем: Сначала получаем текущее состояние устройства для проверки
    console.log(`📥 Запрашиваю текущее состояние устройства...`);
    ws.send(JSON.stringify({ type: 'get', state: [deviceId] }));
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Зачем: Обрабатываем ответ GET - получаем текущее состояние устройства
      if (msg.type === 'ACTION_SET' && msg.id === deviceId && msg.payload) {
        if (!deviceFound) {
          deviceFound = true;
          currentCode = msg.payload.code || null;
          
          console.log(`✅ Устройство найдено:`);
          console.log(`   MAC: ${deviceId}`);
          console.log(`   Тип: ${msg.payload.type !== undefined ? `0x${msg.payload.type.toString(16)}` : '—'}`);
          console.log(`   Текущий code: ${currentCode || '(не задан)'}`);
          console.log(`   Текущий title: ${msg.payload.title || '(не задан)'}`);
          
          // Зачем: Проверяем, нужно ли обновление
          if (currentCode === newCode) {
            console.log(`\n⚠️  Устройство уже имеет code="${newCode}". Обновление не требуется.`);
            clearTimeout(timeout);
            ws.close();
            process.exit(0);
          }
          
          // Зачем: Отправляем обновление
          console.log(`\n📤 Отправляю обновление...`);
          updateSent = true;
          ws.send(JSON.stringify({
            type: ACTION_SET,
            id: deviceId,
            payload: {
              code: newCode
            }
          }));
          
          // Зачем: Запрашиваем обновленное состояние для проверки
          setTimeout(() => {
            console.log(`📥 Проверяю результат обновления...`);
            ws.send(JSON.stringify({ type: 'get', state: [deviceId] }));
          }, 500);
        } else if (updateSent && !verificationReceived) {
          // Зачем: Проверяем результат обновления
          verificationReceived = true;
          const updatedCode = msg.payload.code || null;
          
          if (updatedCode === newCode) {
            console.log(`\n✅ Обновление успешно!`);
            console.log(`   Старое значение: ${currentCode || '(не задано)'}`);
            console.log(`   Новое значение: "${updatedCode}"`);
            clearTimeout(timeout);
            ws.close();
            process.exit(0);
          } else {
            console.error(`\n❌ Ошибка: устройство не обновилось`);
            console.error(`   Ожидалось: "${newCode}"`);
            console.error(`   Получено: "${updatedCode || '(не задано)'}"`);
            clearTimeout(timeout);
            ws.close();
            process.exit(1);
          }
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга других сообщений
    }
  });
  
  ws.on('error', (error) => {
    clearTimeout(timeout);
    console.error(`❌ Ошибка подключения: ${error.message}`);
    process.exit(1);
  });
  
  ws.on('close', () => {
    clearTimeout(timeout);
    if (!deviceFound) {
      console.error(`❌ Устройство ${deviceId} не найдено или соединение закрыто до получения данных`);
      process.exit(1);
    }
    if (updateSent && !verificationReceived) {
      console.error(`❌ Соединение закрыто до проверки результата`);
      process.exit(1);
    }
  });
}

// Запуск
updateDeviceCode().catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
