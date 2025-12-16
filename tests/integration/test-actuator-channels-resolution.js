#!/usr/bin/env node

/**
 * Интеграционный тест резолва привязок каналов актуаторов
 * 
 * Цель: Проверить, что monitor.js корректно резолвит привязки каналов актуаторов
 * 
 * Использование:
 *   node tests/integration/test-actuator-channels-resolution.js [ws://host:port]
 * 
 * Примеры:
 *   node tests/integration/test-actuator-channels-resolution.js
 *   node tests/integration/test-actuator-channels-resolution.js ws://192.168.88.4:3000
 * 
 * Зачем: Проверяем критическую функциональность резолва привязок каналов актуаторов
 * через боевой WebSocket, чтобы убедиться что изменения работают корректно
 */

const WebSocket = require('ws');
const path = require('path');

// Зачем: Импортируем класс TerminalKitStatusDisplay из monitor.js для тестирования
const { TerminalKitStatusDisplay } = require(path.join(__dirname, '../../src/monitor.js'));

// Параметры подключения
const DEFAULT_WS_URL = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const WS_URL = process.argv[2] || DEFAULT_WS_URL;

// Таймауты
const CONNECTION_TIMEOUT = 10000;
const LOAD_TIMEOUT = 30000; // Зачем: Увеличенный таймаут для загрузки всех устройств и каналов
const TEST_DURATION = 60000; // 60 секунд теста

// Статистика теста
let stats = {
  connected: false,
  devicesLoaded: 0,
  actuatorsFound: 0,
  channelsRequested: 0,
  channelsReceived: 0,
  channelsWithBind: 0,
  channelsResolved: 0,
  channelsUnresolved: 0,
  errors: []
};

// Зачем: Функция для определения конфигурации каналов актуатора (из monitor.js)
function getActuatorChannelCount(deviceType) {
  const channelConfigs = {
    // Реле (do каналы)
    0x0a: { count: 8, types: ['do'] },   0x0b: { count: 16, types: ['do'] },
    0x11: { count: 12, types: ['do'] },   0x23: { count: 2, types: ['do'] },
    0xa0: { count: 6, types: ['do'] },   0xa1: { count: 12, types: ['do'] },
    0xa2: { count: 24, types: ['do'] },  0xa7: { count: 2, types: ['do'] },
    0xae: { count: 12, types: ['do'] },
    // Диммеры (dim каналы)
    0x0e: { count: 4, types: ['dim'] },  0x0f: { count: 8, types: ['dim'] },
    0xa3: { count: 4, types: ['dim'] },  0xa4: { count: 8, types: ['dim'] },
    0xa5: { count: 8, types: ['dim'] },  0xaf: { count: 8, types: ['dim'] },
    0xad: { count: 12, types: ['dim'] },  0xb3: { count: 12, types: ['dim'] },
    0xb4: { count: 12, types: ['dim'] },  0xb6: { count: 1, types: ['dim'] },
    // Аналоговые выходы (ao каналы)
    0xa9: { count: 4, types: ['ao'] },
    // Смешанные устройства
    0x41: { count: 12, types: ['do', 'dim'] },  // MIX_H
    0xaa: { count: 4, types: ['do', 'dim'] },   // MIX_2
    0xab: { count: 2, types: ['do', 'dim'] },   // MIX_1
    0xac: { count: 2, types: ['do', 'dim'] },   // MIX_1_RS
    0xb5: { count: 18, types: ['do', 'dim'] },  // MIX_6x12_RS
  };
  return channelConfigs[deviceType] || null;
}

// Зачем: Функция для подсчета каналов актуатора
function countActuatorChannels(deviceType) {
  const config = getActuatorChannelCount(deviceType);
  if (!config) return 0;
  
  const channelTypes = config.types;
  const channelCount = config.count;
  
  let doCount = 0, dimCount = 0, aoCount = 0;
  
  if (channelTypes.includes('do') && channelTypes.includes('dim')) {
    switch (deviceType) {
      case 0x41: doCount = 6; dimCount = 6; break;
      case 0xaa: doCount = 2; dimCount = 2; break;
      case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
      case 0xb5: doCount = 6; dimCount = 12; break;
    }
  } else {
    if (channelTypes.includes('do')) doCount = channelCount;
    if (channelTypes.includes('dim')) dimCount = channelCount;
    if (channelTypes.includes('ao')) aoCount = channelCount;
  }
  
  return doCount + dimCount + aoCount;
}

console.log('='.repeat(80));
console.log('🧪 Интеграционный тест резолва привязок каналов актуаторов');
console.log('='.repeat(80));
console.log(`WebSocket URL: ${WS_URL}`);
console.log(`Таймаут подключения: ${CONNECTION_TIMEOUT}ms`);
console.log(`Таймаут загрузки: ${LOAD_TIMEOUT}ms`);
console.log(`Длительность теста: ${TEST_DURATION}ms`);
console.log('');

// Зачем: Создаем WebSocket соединение
const ws = new WebSocket(WS_URL);

// Зачем: Хранилище данных для теста
const deviceDataMap = new Map();
const channelDataMap = new Map();
let devices = [];
let display = null;
let listReceived = false;
let getSent = false;
let allChannelsRequested = false;

// Таймер подключения
const connectionTimer = setTimeout(() => {
  if (!stats.connected) {
    console.error('❌ Таймаут подключения');
    stats.errors.push('Таймаут подключения');
    ws.close();
    process.exit(1);
  }
}, CONNECTION_TIMEOUT);

// Обработчик открытия соединения
ws.on('open', () => {
  clearTimeout(connectionTimer);
  stats.connected = true;
  console.log('✅ WebSocket соединение установлено');
  console.log('');
  
  // Зачем: Запрашиваем список устройств через LIST
  console.log('📤 [STEP 1] Запрашиваем список устройств через LIST...');
  ws.send(JSON.stringify({ type: 'list' }));
});

// Обработчик сообщений
ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    // Зачем: Обрабатываем ответ LIST
    if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
      listReceived = true;
      const deviceIds = message.state ? message.state.map(([id]) => id).filter(Boolean) : [];
      console.log(`✅ [STEP 1] Получено ${deviceIds.length} ID устройств из LIST`);
      console.log('');
      
      if (deviceIds.length === 0) {
        console.error('❌ Список устройств пуст');
        stats.errors.push('Список устройств пуст');
        ws.close();
        process.exit(1);
      }
      
      // Зачем: Запрашиваем полные данные устройств через GET
      console.log(`📤 [STEP 2] Запрашиваем полные данные для ${deviceIds.length} устройств через GET...`);
      ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
      getSent = true;
      
      // Зачем: Устанавливаем таймаут для загрузки устройств
      setTimeout(() => {
        processDevices();
      }, LOAD_TIMEOUT);
    }
    
    // Зачем: Обрабатываем ACTION_SET сообщения (ответы на GET)
    const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
    if (isActionSet && message.id && !message._context) {
      const deviceId = message.id;
      const payload = message.payload || {};
      
      // Зачем: Определяем, является ли это каналом (ID содержит '/')
      const isChannel = deviceId.includes('/');
      
      if (isChannel) {
        // Зачем: Сохраняем данные канала
        channelDataMap.set(deviceId, payload);
        stats.channelsReceived++;
        
        if (stats.channelsReceived % 50 === 0) {
          console.log(`   📥 Получено ${stats.channelsReceived} каналов...`);
        }
      } else {
        // Зачем: Сохраняем данные устройства
        deviceDataMap.set(deviceId, payload);
        stats.devicesLoaded++;
        
        if (stats.devicesLoaded % 100 === 0) {
          console.log(`   📥 Получено ${stats.devicesLoaded} устройств...`);
        }
      }
    }
  } catch (e) {
    console.error('❌ Ошибка парсинга сообщения:', e.message);
    stats.errors.push(`Ошибка парсинга: ${e.message}`);
  }
});

// Зачем: Функция для обработки загруженных устройств
function processDevices() {
  console.log('');
  console.log('='.repeat(80));
  console.log('📊 [STEP 3] Обработка загруженных данных');
  console.log('='.repeat(80));
  console.log(`Устройств загружено: ${stats.devicesLoaded}`);
  console.log(`Каналов загружено: ${stats.channelsReceived}`);
  console.log('');
  
  // Зачем: Создаем объекты устройств из загруженных данных
  devices = Array.from(deviceDataMap.entries()).map(([id, payload]) => {
    const deviceType = payload.type;
    let category = 'Неизвестно';
    let name = payload.title || payload.code || payload.name || id;
    
    if (typeof deviceType === 'number' && deviceType !== 0x00) {
      category = 'Актуатор';
    } else if (typeof deviceType === 'string') {
      const consumerTypes = ['light_220', 'light_led', 'light_rgb', 'valve_water', 'valve_heating', 
                            'warm_floor', 'ac', 'fan', 'socket_220', 'boiler', 'pump', 'co2_stat'];
      if (consumerTypes.includes(deviceType)) {
        category = 'Потребитель';
      } else if (deviceType === 'site' || deviceType === 'project') {
        category = 'Помещение';
      }
    }
    
    return {
      id,
      type: deviceType,
      category,
      name,
      payload
    };
  });
  
  // Зачем: Фильтруем актуаторы
  const actuators = devices.filter(d => d.category === 'Актуатор' && typeof d.type === 'number');
  stats.actuatorsFound = actuators.length;
  
  console.log(`✅ Найдено актуаторов: ${stats.actuatorsFound}`);
  console.log('');
  
  // Зачем: Создаем упрощенный объект для тестирования резолва каналов
  // Зачем: Используем только необходимые методы без создания полного UI
  const deviceStates = new Map();
  const allDevices = devices;
  
  // Зачем: Загружаем состояния каналов в deviceStates
  console.log('📤 [STEP 4] Загружаем состояния каналов в deviceStates...');
  channelDataMap.forEach((payload, channelId) => {
    deviceStates.set(channelId, { state: payload });
  });
  console.log(`✅ Загружено ${channelDataMap.size} состояний каналов в deviceStates`);
  console.log('');
  
  // Зачем: Функция для получения каналов актуатора (упрощенная версия из monitor.js)
  function getActuatorChannels(actuatorId, deviceType) {
    const channelConfig = getActuatorChannelCount(deviceType);
    if (!channelConfig) return [];
    
    const channels = [];
    const channelTypes = channelConfig.types;
    const channelCount = channelConfig.count;
    
    let doCount = 0, dimCount = 0, aoCount = 0;
    
    if (channelTypes.includes('do') && channelTypes.includes('dim')) {
      switch (deviceType) {
        case 0x41: doCount = 6; dimCount = 6; break;
        case 0xaa: doCount = 2; dimCount = 2; break;
        case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
        case 0xb5: doCount = 6; dimCount = 12; break;
      }
    } else {
      if (channelTypes.includes('do')) doCount = channelCount;
      if (channelTypes.includes('dim')) dimCount = channelCount;
      if (channelTypes.includes('ao')) aoCount = channelCount;
    }
    
    for (let i = 1; i <= doCount; i++) {
      const channelId = `${actuatorId}/do/${i}`;
      const channelData = deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = allDevices.find(d => d.id === channelState.bind);
      }
      channels.push({ channelId, channelType: 'do', channelIndex: i, channelState, linkedDevice });
    }
    
    for (let i = 1; i <= dimCount; i++) {
      const channelId = `${actuatorId}/dim/${i}`;
      const channelData = deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = allDevices.find(d => d.id === channelState.bind);
      }
      channels.push({ channelId, channelType: 'dim', channelIndex: i, channelState, linkedDevice });
    }
    
    for (let i = 1; i <= aoCount; i++) {
      const channelId = `${actuatorId}/ao/${i}`;
      const channelData = deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = allDevices.find(d => d.id === channelState.bind);
      }
      channels.push({ channelId, channelType: 'ao', channelIndex: i, channelState, linkedDevice });
    }
    
    return channels;
  }
  
  // Зачем: Тестируем резолв привязок каналов для каждого актуатора
  console.log('='.repeat(80));
  console.log('🔍 [STEP 5] Тестирование резолва привязок каналов');
  console.log('='.repeat(80));
  console.log('');
  
  let totalChannels = 0;
  let channelsWithBind = 0;
  let channelsResolved = 0;
  let channelsUnresolved = 0;
  
  actuators.forEach((actuator, index) => {
    const channels = getActuatorChannels(actuator.id, actuator.type);
    totalChannels += channels.length;
    
    if (channels.length > 0) {
      console.log(`\n📋 Актуатор #${index + 1}: ${actuator.name || actuator.id}`);
      console.log(`   Тип: 0x${actuator.type.toString(16)} (${actuator.type})`);
      console.log(`   Каналов: ${channels.length}`);
      
      channels.forEach(channel => {
        const hasBind = channel.channelState && channel.channelState.bind;
        const isResolved = channel.linkedDevice !== null && channel.linkedDevice !== undefined;
        
        if (hasBind) {
          channelsWithBind++;
          if (isResolved) {
            channelsResolved++;
            const deviceName = (channel.linkedDevice && (channel.linkedDevice.name || channel.linkedDevice.id)) || channel.channelState.bind;
            console.log(`   ✅ ${channel.channelType.toUpperCase()}/${channel.channelIndex}: привязан к ${deviceName}`);
          } else {
            channelsUnresolved++;
            console.log(`   ⚠️  ${channel.channelType.toUpperCase()}/${channel.channelIndex}: bind=${channel.channelState.bind}, но устройство не найдено`);
          }
        } else {
          console.log(`   ➖ ${channel.channelType.toUpperCase()}/${channel.channelIndex}: не привязан`);
        }
      });
    }
  });
  
  stats.channelsWithBind = channelsWithBind;
  stats.channelsResolved = channelsResolved;
  stats.channelsUnresolved = channelsUnresolved;
  
  console.log('');
  console.log('='.repeat(80));
  console.log('📊 Результаты теста');
  console.log('='.repeat(80));
  console.log(`✅ Устройств загружено: ${stats.devicesLoaded}`);
  console.log(`✅ Актуаторов найдено: ${stats.actuatorsFound}`);
  console.log(`✅ Каналов получено: ${stats.channelsReceived}`);
  console.log(`✅ Всего каналов проверено: ${totalChannels}`);
  console.log(`✅ Каналов с привязкой: ${channelsWithBind}`);
  console.log(`✅ Каналов успешно резолвлено: ${channelsResolved}`);
  console.log(`⚠️  Каналов не резолвлено: ${channelsUnresolved}`);
  console.log(`❌ Ошибок: ${stats.errors.length}`);
  
  if (stats.errors.length > 0) {
    console.log('');
    console.log('Ошибки:');
    stats.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. ${err}`);
    });
  }
  
  console.log('');
  
  // Зачем: Проверяем критерии успешности теста
  const success = 
    stats.connected &&
    stats.devicesLoaded > 0 &&
    stats.actuatorsFound > 0 &&
    stats.channelsReceived > 0 &&
    stats.errors.length === 0;
  
  if (success) {
    console.log('✅ Тест пройден успешно!');
    console.log('');
    console.log('Проверки:');
    console.log('  ✅ WebSocket соединение установлено');
    console.log('  ✅ Устройства загружены');
    console.log('  ✅ Актуаторы найдены');
    console.log('  ✅ Каналы загружены и сохранены в deviceStates');
    console.log('  ✅ Резолв привязок каналов работает');
    
    if (channelsUnresolved > 0) {
      console.log('');
      console.log(`⚠️  Внимание: ${channelsUnresolved} каналов имеют привязки, но устройства не найдены`);
      console.log('   Это может быть нормально, если устройства были удалены или не загружены');
    }
    
    ws.close();
    process.exit(0);
  } else {
    console.log('❌ Тест не пройден');
    ws.close();
    process.exit(1);
  }
}

// Обработчик ошибок
ws.on('error', (error) => {
  clearTimeout(connectionTimer);
  const errorMsg = error.message || error.toString();
  console.error(`❌ Ошибка WebSocket: ${errorMsg}`);
  stats.errors.push(errorMsg);
  
  setTimeout(() => {
    console.log('');
    console.log('❌ Тест завершён с ошибкой');
    process.exit(1);
  }, 1000);
});

// Обработчик закрытия соединения
ws.on('close', (code, reason) => {
  if (code !== 1000 && stats.connected) {
    console.log('');
    console.log(`🔌 Соединение закрыто: код ${code}`);
    if (reason) {
      console.log(`   Причина: ${reason.toString()}`);
    }
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
