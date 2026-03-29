#!/usr/bin/env node

/**
 * Локальный монитор WebSocket для отслеживания конкретного устройства
 * 
 * Подключается к демону через WebSocket и логирует все события
 * для указанного устройства
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Конфигурация
const WS_URL = 'ws://192.168.88.4:3000';
const TARGET_DEVICE_ID = '4a86f6b1-a621-4617-9f1f-e6ad2f471587'; // Не используется (фильтр отключён)
const LOG_DIR = './logs/device-monitor';
const LOG_FILE = path.join(LOG_DIR, `all-devices-${new Date().toISOString().split('T')[0]}.log`);
const MAPPING_FILE = './device-mapping.json';

// Загружаем маппинг из файла
let deviceMapping = {};
try {
  if (fs.existsSync(MAPPING_FILE)) {
    deviceMapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    console.log(`✅ Загружен маппинг: ${Object.keys(deviceMapping).length} устройств`);
    const namedCount = Object.values(deviceMapping).filter(d => d.human).length;
    console.log(`   С именами: ${namedCount}`);
  } else {
    console.warn(`⚠️ Файл маппинга не найден: ${MAPPING_FILE}`);
    console.warn(`   Запустите: node scripts/export-device-mapping.js`);
  }
} catch (err) {
  console.error(`❌ Ошибка загрузки маппинга: ${err.message}`);
}

// Кэш состояния устройств для резолвинга ID -> имена (обновляется динамически)
const deviceStateCache = new Map();

// Функция резолвинга ID в человекочитаемое имя (из event-log.js)
const getHumanName = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  
  const parts = [];
  if (obj.title) parts.push(obj.title);
  if (obj.code) parts.push(obj.code);
  if (obj.name) parts.push(obj.name);
  
  return parts.length > 0 ? parts.join('/') : null;
};

// Резолвинг ID устройства в имя
const resolveDeviceName = (id) => {
  // Сначала проверяем статический маппинг из БД
  if (deviceMapping[id] && deviceMapping[id].human) {
    return `${deviceMapping[id].human} [${id}]`;
  }
  
  // Затем проверяем динамический кэш (обновляется из ACTION_SET)
  const cached = deviceStateCache.get(id);
  if (cached) {
    const humanName = getHumanName(cached);
    if (humanName) {
      return `${humanName} [${id}]`;
    }
  }
  
  return id;
};

// Создаём директорию для логов
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Логирование
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message,
    ...(data && { data })
  };
  
  const logLine = JSON.stringify(logEntry, null, 2);
  console.log(`[${timestamp}] ${message}`);
  
  // Записываем в файл
  fs.appendFileSync(LOG_FILE, logLine + '\n---\n');
};

const logError = (message, error = null) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: 'ERROR',
    message,
    ...(error && { error: error.message, stack: error.stack })
  };
  
  const logLine = JSON.stringify(logEntry, null, 2);
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (error) {
    console.error(error);
  }
  
  // Записываем в файл
  fs.appendFileSync(LOG_FILE, logLine + '\n---\n');
};

// Подключение к WebSocket
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

const connect = () => {
  log(`Подключение к ${WS_URL}...`);
  
  ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    reconnectAttempts = 0;
    log('✅ WebSocket подключен', {
      url: WS_URL,
      readyState: ws.readyState
    });
    
    // Запрашиваем список устройств
    log('Запрашиваем список устройств (LIST)...');
    ws.send(JSON.stringify({ type: 'LIST' }));
    
    // Запрашиваем состояние всех устройств для кэша имён
    setTimeout(() => {
      log('Запрашиваем состояние устройств для резолвинга имён (GET)...');
      // Запрашиваем по одному для первых 100 устройств (для примера)
      // В реальности лучше использовать batch запрос или полагаться на ACTION_SET
      ws.send(JSON.stringify({ type: 'LIST' }));
    }, 1000);
    
    log('✅ Мониторинг всех устройств активен (фильтр отключён, резолвинг имён включён)');
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Обновляем кэш состояния устройств
      if (message.type === 'GET' && message.state) {
        // GET ответ - обновляем состояние устройств
        Object.entries(message.state).forEach(([deviceId, state]) => {
          if (deviceId && state && typeof state === 'object') {
            deviceStateCache.set(deviceId, state);
          }
        });
        
        const devicesCount = Object.keys(message.state).length;
        const namedDevices = Array.from(deviceStateCache.entries())
          .filter(([id, state]) => getHumanName(state))
          .length;
        
        log(`✅ Обновлён кэш: ${devicesCount} устройств, ${namedDevices} с именами`);
        // Не логируем полное GET сообщение - слишком много данных
        return;
      } else if (message.type === 'LIST' && message.state) {
        // LIST ответ - список ID устройств
        const deviceIds = message.state;
        log(`📋 Получен LIST: ${deviceIds.length} устройств`);
        
        // Запрашиваем полное состояние для резолвинга имён
        // GET требует массив ID в параметре state
        setTimeout(() => {
          log(`Запрашиваем GET для ${deviceIds.length} устройств...`);
          ws.send(JSON.stringify({ 
            type: 'GET', 
            state: deviceIds  // Передаём массив ID
          }));
        }, 100);
        return;
      } else if (message.type === 'ACTION_SET' && message.id) {
        // ACTION_SET - обновляем состояние из payload
        const existingState = deviceStateCache.get(message.id) || {};
        const updatedState = {
          ...existingState,
          ...message.payload
        };
        deviceStateCache.set(message.id, updatedState);
      }
      
      // ФИЛЬТР ОТКЛЮЧЁН - логируем ВСЕ сообщения с резолвингом ID
      const deviceId = message.id || 'N/A';
      const deviceName = deviceId !== 'N/A' ? resolveDeviceName(deviceId) : 'N/A';
      
      // Краткая информация для консоли
      console.log(`[${new Date().toISOString()}] 📨 ${message.type} | ${deviceName}`);
      
      // Полная информация в файл
      log(`📨 ${message.type}`, {
        device: {
          id: deviceId,
          name: deviceName
        },
        type: message.type,
        data: message.data || message.payload,
        context: message.context,
        fullMessage: message
      });
      
    } catch (err) {
      logError('Ошибка обработки сообщения', err);
    }
  });
  
  ws.on('error', (error) => {
    logError('WebSocket ошибка', error);
  });
  
  ws.on('close', (code, reason) => {
    log(`WebSocket закрыт`, {
      code,
      reason: reason.toString()
    });
    
    // Переподключение
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      log(`Переподключение через ${RECONNECT_DELAY}ms (попытка ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(connect, RECONNECT_DELAY);
    } else {
      logError('Превышено максимальное количество попыток переподключения');
      process.exit(1);
    }
  });
};

// Обработка сигналов завершения
const shutdown = () => {
  log('Получен сигнал завершения, закрываем соединение...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Запуск
log('='.repeat(80));
log('Запуск монитора устройства');
log('='.repeat(80));
log('Конфигурация:', {
  wsUrl: WS_URL,
  targetDeviceId: TARGET_DEVICE_ID,
  logFile: LOG_FILE
});
log('='.repeat(80));

connect();

// Периодическая проверка соединения
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Пингуем, запрашивая список устройств
    ws.send(JSON.stringify({ type: 'LIST' }));
  }
}, 30000); // Каждые 30 секунд
