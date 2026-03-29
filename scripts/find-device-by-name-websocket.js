#!/usr/bin/env node

/**
 * Скрипт для поиска устройства по названию через WebSocket
 * 
 * Использование:
 *   node scripts/find-device-by-name-websocket.js "9.П.11 Гостиная окна"
 *   REACTHOME_WS_URI="wss://gate.reacthome.net/d31775ae-19e8-40c9-81df-d6d672379563" \
 *   node scripts/find-device-by-name-websocket.js "9.П.11"
 * 
 * Зачем: Позволяет найти устройство по части названия через WebSocket (локально или через gateway)
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const SEARCH_QUERY = process.argv[2];

if (!SEARCH_QUERY) {
  console.error('❌ Укажите поисковый запрос');
  console.error('Использование: node scripts/find-device-by-name-websocket.js "поисковый запрос"');
  process.exit(1);
}

// Зачем: Определяем, является ли URI gateway для использования subprotocol 'listen'
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');

// Зачем: Функция для проверки совпадения устройства с поисковым запросом
function matchesSearch(device, query) {
  const queryLower = query.toLowerCase();
  const title = (device.title || '').toLowerCase();
  const code = (device.code || '').toLowerCase();
  const name = (device.name || '').toLowerCase();
  const id = (device.id || '').toLowerCase();
  
  // Зачем: Проверяем совпадение в названии, коде, имени или ID
  return title.includes(queryLower) ||
         code.includes(queryLower) ||
         name.includes(queryLower) ||
         id.includes(queryLower);
}

async function findDevice() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОИСК УСТРОЙСТВА ЧЕРЕЗ WEBSOCKET: "${SEARCH_QUERY}"  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`WebSocket: ${WS_URI}`);
  if (isGateway) {
    console.log(`Тип: Gateway (используется subprotocol 'listen')\n`);
  } else {
    console.log(`Тип: Локальное подключение\n`);
  }
  
  // Зачем: Используем subprotocol 'listen' для gateway подключения
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  const deviceIds = [];
  const devices = [];
  const messages = [];
  const siteMap = new Map();
  
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    console.log(`Получено сообщений: ${messages.length}`);
    ws.close();
    process.exit(1);
  }, 30000);
  
  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    
    // Зачем: Сначала запрашиваем список всех объектов через LIST
    console.log('[STEP] Запрашиваем список всех объектов...');
    ws.send(JSON.stringify({ type: 'list' }));
    
    setTimeout(() => {
      // Зачем: Фильтруем только устройства (исключаем каналы и скрипты)
      const allDeviceIds = deviceIds.filter(id => !id.includes('/'));
      
      if (allDeviceIds.length === 0) {
        console.log('[WARNING] Устройства не найдены в LIST ответе');
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }
      
      console.log(`[STEP] Запрашиваем данные ${allDeviceIds.length} устройств...`);
      
      // Зачем: Запрашиваем данные устройствами батчами по 100 для оптимизации
      const BATCH_SIZE = 100;
      for (let i = 0; i < allDeviceIds.length; i += BATCH_SIZE) {
        const batch = allDeviceIds.slice(i, i + BATCH_SIZE);
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'get', state: batch }));
        }, i / BATCH_SIZE * 500); // Зачем: Распределяем запросы во времени
      }
      
      // Зачем: Даём время на получение всех ответов
      setTimeout(() => {
        clearTimeout(timeout);
        processResults();
        ws.close();
        process.exit(0);
      }, 5000 + Math.ceil(allDeviceIds.length / BATCH_SIZE) * 1000);
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      let dataStr = data.toString();
      
      // Зачем: Для gateway сообщения приходят с префиксом session ID (36 символов)
      if (isGateway && dataStr.length >= 36) {
        const prefix = dataStr.substring(0, 36);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(prefix)) {
          dataStr = dataStr.substring(36);
        }
      }
      
      const message = JSON.parse(dataStr);
      messages.push(message);
      
      // Зачем: Собираем ID устройств из LIST ответа
      if (message.type === 'list' && message.state) {
        message.state.forEach(([id]) => {
          deviceIds.push(id);
        });
      }
      
      // Зачем: Сохраняем данные помещений для резолва названий
      if (message.type === 'ACTION_SET' && message.payload) {
        const payload = message.payload;
        if (payload.type === 'site' || payload.type === 'SITE') {
          const siteName = payload.title || payload.code || message.id;
          siteMap.set(message.id, siteName);
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга отдельных сообщений
    }
  });
  
  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
  
  // Зачем: Функция для обработки результатов поиска
  function processResults() {
    console.log('\n═══════════════════════════════════════════════════════════\n');
    
    // Зачем: Обрабатываем все полученные сообщения ACTION_SET
    messages.forEach(msg => {
      if (msg.type === 'ACTION_SET' && msg.payload) {
        const payload = msg.payload;
        const deviceId = msg.id;
        
        // Зачем: Пропускаем каналы (содержат '/'), скрипты и помещения
        if (deviceId.includes('/')) return;
        if (payload.type === 'script' || payload.type === 'SCRIPT') return;
        if (payload.type === 'site' || payload.type === 'SITE') return;
        
        // Зачем: Проверяем совпадение с поисковым запросом
        if (matchesSearch(payload, SEARCH_QUERY)) {
          const siteId = payload.site ? (Array.isArray(payload.site) ? payload.site[0] : payload.site) : null;
          const siteName = siteId ? (siteMap.get(siteId) || siteId) : null;
          
          devices.push({
            id: deviceId,
            title: payload.title,
            code: payload.code,
            name: payload.name,
            type: payload.type,
            site: siteName,
            siteId: siteId,
            payload: payload
          });
        }
      }
    });
    
    console.log(`📊 НАЙДЕНО УСТРОЙСТВ: ${devices.length}\n`);
    
    if (devices.length === 0) {
      console.log('⚠️  Устройства не найдены\n');
      console.log('Попробуйте:');
      console.log(`- Использовать часть названия: "${SEARCH_QUERY.substring(0, Math.min(5, SEARCH_QUERY.length))}"`);
      console.log(`- Проверить правильность написания`);
      console.log('');
    } else {
      devices.forEach((device, index) => {
        const deviceName = device.title || device.code || device.name || device.id;
        console.log(`\n${index + 1}. ${deviceName}`);
        console.log(`   ID: ${device.id}`);
        if (device.code && device.code !== deviceName) {
          console.log(`   Code: ${device.code}`);
        }
        if (device.title && device.title !== deviceName) {
          console.log(`   Title: ${device.title}`);
        }
        if (device.type) {
          console.log(`   Тип: ${device.type}`);
        }
        if (device.site) {
          console.log(`   Помещение: ${device.site}`);
        }
      });
      
      console.log('\n═══════════════════════════════════════════════════════════\n');
      console.log('📋 ID НАЙДЕННЫХ УСТРОЙСТВ:\n');
      devices.forEach(device => {
        console.log(`  ${device.id}`);
      });
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
  }
}

findDevice().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
