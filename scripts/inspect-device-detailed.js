#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DEVICE_MAC = process.argv[2] || '50:85:48:15:00:f1';

// Константы типов устройств (из src/constants.js)
const DEVICE_TYPES = {
  0x00: 'DEVICE_TYPE_UNKNOWN',
  0x01: 'DEVICE_TYPE_SENSOR4',
  0x02: 'DEVICE_TYPE_SENSOR6',
  0x03: 'DEVICE_TYPE_THI',
  0x04: 'DEVICE_TYPE_DOPPLER',
  0x0e: 'DEVICE_TYPE_DIM4',
  0x0f: 'DEVICE_TYPE_DIM8',
  0x20: 'DEVICE_TYPE_DI_4',
  0x23: 'DEVICE_TYPE_RELAY_2',
  0x2f: 'DEVICE_TYPE_DI_4_RSM',
  0xa0: 'DEVICE_TYPE_RELAY_6',
  0xa1: 'DEVICE_TYPE_RELAY_12',
  0xa3: 'DEVICE_TYPE_DIM_4',
  0xa4: 'DEVICE_TYPE_DIM_8',
  0xa7: 'DEVICE_TYPE_RELAY_2_DIN',
  0xa9: 'DEVICE_TYPE_AO_4_DIN',
  0xac: 'DEVICE_TYPE_MIX_1_RS',
  0xad: 'DEVICE_TYPE_DIM_12_LED_RS',
  0xae: 'DEVICE_TYPE_RELAY_12_RS',
  0xaf: 'DEVICE_TYPE_DIM_8_RS',
  0xb3: 'DEVICE_TYPE_DIM_12_AC_RS',
  0xb4: 'DEVICE_TYPE_DIM_12_DC_RS',
  0xb5: 'DEVICE_TYPE_MIX_6x12_RS',
  0xb6: 'DEVICE_TYPE_DIM_1_AC_RS',
  0xfe: 'DEVICE_TYPE_PLC',
};

async function inspectDevice() {
  console.log(`\n🔍 ДЕТАЛЬНЫЙ АНАЛИЗ УСТРОЙСТВА ${DEVICE_MAC}\n`);
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  
  const ws = new WebSocket(WS_URI);
  const messages = [];
  let allDevices = [];
  
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
  ws.on('open', () => {
    console.log('[INFO] Подключение установлено\n');
    
    // Запрашиваем устройство и список всех устройств для поиска каналов
    ws.send(JSON.stringify({ type: 'list' }));
    
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'get', state: [DEVICE_MAC] }));
      
      setTimeout(async () => {
        clearTimeout(timeout);
        ws.close();
        
        await analyzeDevice(messages, allDevices);
        
      }, 5000);
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      
      // Собираем все устройства из LIST
      if (msg.type === 'ACTION_LIST') {
        allDevices = msg.payload || [];
      }
    } catch (e) {
      console.error('[ERROR] Ошибка парсинга сообщения:', e.message);
    }
  });
  
  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
}

async function analyzeDevice(messages, allDevices) {
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Находим устройство
  const deviceMsgs = messages.filter(m => 
    m.type === 'ACTION_SET' && m.id === DEVICE_MAC
  );
  
  if (deviceMsgs.length === 0) {
    console.log('❌ УСТРОЙСТВО НЕ НАЙДЕНО В СИСТЕМЕ\n');
    console.log(`Проверьте, что устройство ${DEVICE_MAC} подключено и онлайн.\n`);
    return;
  }
  
  const device = deviceMsgs[0].payload || {};
  
  // 1. ОСНОВНАЯ ИНФОРМАЦИЯ
  console.log('📋 1. ОСНОВНАЯ ИНФОРМАЦИЯ\n');
  console.log(`  MAC-адрес:        ${DEVICE_MAC}`);
  console.log(`  Название (code):  ${device.code || 'не указано'}`);
  console.log(`  Название (title): ${device.title || 'не указано'}`);
  console.log(`  Название (name):  ${device.name || 'не указано'}`);
  
  const humanName = [device.title, device.code, device.name].filter(Boolean).join(' / ');
  if (humanName) {
    console.log(`  \n  ✨ Полное название: ${humanName}`);
  }
  
  // 2. ТИП УСТРОЙСТВА
  console.log('\n📊 2. ТИП УСТРОЙСТВА (DEVICE_TYPE)\n');
  const deviceType = device.type;
  const deviceTypeName = DEVICE_TYPES[deviceType] || 'Неизвестный тип';
  console.log(`  Числовой код:     ${deviceType} (0x${deviceType?.toString(16)?.toUpperCase() || 'N/A'})`);
  console.log(`  Константа:        ${deviceTypeName}`);
  console.log(`  Категория:        ${getDeviceCategory(deviceType)}`);
  console.log(`  Класс:            ${getDeviceClass(deviceType)}`);
  
  // 3. СЕТЕВАЯ ИНФОРМАЦИЯ
  console.log('\n🌐 3. СЕТЕВАЯ ИНФОРМАЦИЯ\n');
  console.log(`  IP-адрес:         ${device.ip || 'не указан'}`);
  console.log(`  Статус:           ${device.online ? '🟢 Online' : '🔴 Offline'}`);
  console.log(`  Ready:            ${device.ready !== undefined ? device.ready : 'не указано'}`);
  console.log(`  Hub:              ${device.hub || 'нет'}`);
  
  // 4. ИЕРАРХИЯ И ПРИВЯЗКИ
  console.log('\n🔗 4. ИЕРАРХИЯ И ПРИВЯЗКИ\n');
  console.log(`  Site (локация):   ${device.site ? JSON.stringify(device.site) : 'не указано'}`);
  console.log(`  Project:          ${device.project || 'не указано'}`);
  console.log(`  Parent:           ${device.parent || 'нет'}`);
  
  // Получаем название локации
  if (device.site) {
    const siteId = Array.isArray(device.site) ? device.site[0] : device.site;
    const siteMsgs = messages.filter(m => m.type === 'ACTION_SET' && m.id === siteId);
    if (siteMsgs.length > 0) {
      const site = siteMsgs[0].payload || {};
      console.log(`  \n  📍 Локация: ${site.title || site.code || siteId}`);
    }
  }
  
  // 5. КАНАЛЫ УСТРОЙСТВА
  console.log('\n📡 5. КАНАЛЫ УСТРОЙСТВА\n');
  
  // Ищем все каналы этого устройства
  const channels = allDevices.filter(id => {
    if (typeof id !== 'string') return false;
    return id.startsWith(DEVICE_MAC + '/');
  });
  
  if (channels.length > 0) {
    console.log(`  Найдено каналов: ${channels.length}\n`);
    
    // Группируем по типам
    const channelsByType = {};
    channels.forEach(channelId => {
      const parts = channelId.split('/');
      const type = parts[1];
      if (!channelsByType[type]) {
        channelsByType[type] = [];
      }
      channelsByType[type].push(channelId);
    });
    
    // Выводим каналы по типам
    for (const [type, channelIds] of Object.entries(channelsByType)) {
      console.log(`  ┌─ Тип: ${type.toUpperCase()} (${channelIds.length} каналов)`);
      
      for (const channelId of channelIds.sort()) {
        const channelMsgs = messages.filter(m => m.type === 'ACTION_SET' && m.id === channelId);
        if (channelMsgs.length > 0) {
          const channel = channelMsgs[0].payload || {};
          const index = channelId.split('/')[2];
          
          console.log(`  │  ├─ Канал ${index}:`);
          console.log(`  │  │   ID: ${channelId}`);
          
          if (channel.bind) {
            console.log(`  │  │   Bind: ${channel.bind}`);
            
            // Получаем конечное устройство
            const endDeviceMsgs = messages.filter(m => m.type === 'ACTION_SET' && m.id === channel.bind);
            if (endDeviceMsgs.length > 0) {
              const endDevice = endDeviceMsgs[0].payload || {};
              const endName = [endDevice.title, endDevice.code, endDevice.name].filter(Boolean).join(' / ');
              console.log(`  │  │   → Конечное устройство: ${endName || channel.bind}`);
              console.log(`  │  │     Тип: ${endDevice.type || 'не указан'}`);
            } else {
              console.log(`  │  │   → Конечное устройство не найдено`);
            }
          } else {
            console.log(`  │  │   Bind: не указан`);
          }
          
          if (channel.value !== undefined) {
            console.log(`  │  │   Value: ${channel.value}`);
          }
          if (channel.brightness !== undefined) {
            console.log(`  │  │   Brightness: ${channel.brightness}`);
          }
          
          console.log(`  │  │`);
        }
      }
      console.log(`  │`);
    }
    console.log(`  └─────────────────────────────────────────────────\n`);
  } else {
    console.log(`  ⚠️  Каналов не найдено (возможно, это сенсор или конечное устройство)\n`);
  }
  
  // 6. ПОЛНЫЕ ДАННЫЕ
  console.log('📄 6. ПОЛНЫЕ ДАННЫЕ УСТРОЙСТВА (JSON)\n');
  console.log(JSON.stringify(device, null, 2));
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  // 7. СТАТИСТИКА
  console.log('📊 7. СТАТИСТИКА\n');
  console.log(`  Всего сообщений получено: ${messages.length}`);
  console.log(`  Всего устройств в системе: ${allDevices.length}`);
  console.log(`  Каналов у этого устройства: ${channels.length}\n`);
}

function getDeviceCategory(type) {
  const actuatorTypes = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
  const sensorTypes = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2f];
  
  if (actuatorTypes.includes(type)) {
    return 'Щитовое устройство (Актуатор)';
  } else if (sensorTypes.includes(type)) {
    return 'Щитовое устройство (Сенсор/Входы)';
  } else if (type === 0xfe) {
    return 'Программируемый контроллер (PLC)';
  }
  return 'Специализированное устройство';
}

function getDeviceClass(type) {
  const actuatorTypes = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
  const sensorTypes = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2f];
  
  if (actuatorTypes.includes(type)) {
    return 'Actuator (Управляющее)';
  } else if (sensorTypes.includes(type)) {
    return 'Sensor (Измерительное)';
  }
  return 'Controller (Контроллер)';
}

inspectDevice().catch(console.error);















