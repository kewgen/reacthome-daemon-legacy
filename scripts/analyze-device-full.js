#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DEVICE_MAC = process.argv[2] || '50:85:48:15:00:f1';

const DEVICE_TYPES = {
  0xa4: 'DEVICE_TYPE_DIM_8 (Диммер 8 каналов)',
  0xa3: 'DEVICE_TYPE_DIM_4 (Диммер 4 канала)',
  0xa1: 'DEVICE_TYPE_RELAY_12 (Реле 12 каналов)',
  0xa0: 'DEVICE_TYPE_RELAY_6 (Реле 6 каналов)',
  0x23: 'DEVICE_TYPE_RELAY_2 (Реле 2 канала)',
};

async function analyzeDevice() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОЛНЫЙ АНАЛИЗ УСТРОЙСТВА ${DEVICE_MAC}     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  
  const ws = new WebSocket(WS_URI);
  const allMessages = [];
  let deviceData = null;
  let channels = {};
  
  const timeout = setTimeout(() => {
    ws.close();
    process.exit(1);
  }, 20000);
  
  ws.on('open', () => {
    console.log('✅ Подключено к WebSocket\n');
    
    // Запрашиваем устройство
    ws.send(JSON.stringify({ type: 'get', state: [DEVICE_MAC] }));
    
    // Запрашиваем все возможные каналы
    const channelTypes = ['do', 'di', 'dim', 'ao', 'rgb'];
    const requests = [];
    
    for (const type of channelTypes) {
      for (let i = 1; i <= 12; i++) {
        requests.push(`${DEVICE_MAC}/${type}/${i}`);
      }
    }
    
    // Отправляем запросы пачками
    setTimeout(() => {
      for (let i = 0; i < requests.length; i += 10) {
        const batch = requests.slice(i, i + 10);
        ws.send(JSON.stringify({ type: 'get', state: batch }));
      }
      
      // Даём время на получение ответов
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        
        displayResults(deviceData, channels);
      }, 8000);
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      allMessages.push(msg);
      
      if (msg.type === 'ACTION_SET' && msg.id === DEVICE_MAC) {
        deviceData = msg.payload;
      }
      
      if (msg.type === 'ACTION_SET' && typeof msg.id === 'string' && msg.id.startsWith(DEVICE_MAC + '/')) {
        channels[msg.id] = msg.payload;
      }
    } catch (e) {}
  });
  
  ws.on('error', () => {
    clearTimeout(timeout);
    process.exit(1);
  });
}

function displayResults(deviceData, channels) {
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // 1. ОСНОВНОЕ УСТРОЙСТВО
  console.log('📦 1. ЩИТОВОЕ УСТРОЙСТВО\n');
  
  if (!deviceData || Object.keys(deviceData).length === 0) {
    console.log('⚠️  Основные данные устройства не получены или пусты\n');
    console.log(`   Возможные причины:`);
    console.log(`   - Устройство offline`);
    console.log(`   - Устройство не существует`);
    console.log(`   - Нет доступа к данным\n`);
  } else {
    console.log(`  MAC-адрес:     ${DEVICE_MAC}`);
    console.log(`  Название:      ${deviceData.code || deviceData.title || deviceData.name || 'не указано'}`);
    console.log(`  IP-адрес:      ${deviceData.ip || 'не указан'}`);
    console.log(`  Статус:        ${deviceData.online ? '🟢 Online' : '🔴 Offline'}`);
    
    if (deviceData.type) {
      const typeName = DEVICE_TYPES[deviceData.type] || `Тип ${deviceData.type} (0x${deviceData.type.toString(16).toUpperCase()})`;
      console.log(`  Тип:           ${typeName}`);
    } else {
      console.log(`  Тип:           не указан`);
    }
    
    console.log(`\n  Данные: ${JSON.stringify(deviceData)}\n`);
  }
  
  // 2. КАНАЛЫ
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📡 2. КАНАЛЫ УСТРОЙСТВА\n');
  
  const channelIds = Object.keys(channels).sort();
  
  if (channelIds.length === 0) {
    console.log('⚠️  Каналы не найдены\n');
    console.log(`   Это может означать:`);
    console.log(`   - Устройство не имеет каналов (конечное устройство)`);
    console.log(`   - Устройство offline и не возвращает данные`);
    console.log(`   - Каналы не созданы в системе\n`);
  } else {
    console.log(`✅ Найдено каналов: ${channelIds.length}\n`);
    
    // Группируем по типам
    const byType = {};
    channelIds.forEach(id => {
      const parts = id.split('/');
      const type = parts[1];
      if (!byType[type]) byType[type] = [];
      byType[type].push(id);
    });
    
    for (const [type, ids] of Object.entries(byType)) {
      console.log(`  ┌─ ${type.toUpperCase()} (${ids.length} каналов)`);
      console.log(`  │`);
      
      for (const channelId of ids) {
        const channel = channels[channelId];
        const index = channelId.split('/')[2];
        
        console.log(`  ├─── Канал ${index}: ${channelId}`);
        
        if (!channel) {
          console.log(`  │    ⚠️  Нет данных`);
        } else {
          if (channel.bind) {
            console.log(`  │    Bind:  ${channel.bind}`);
            // Примечание: конечное устройство нужно запрашивать отдельно
          }
          
          if (channel.value !== undefined) {
            console.log(`  │    Value: ${channel.value}`);
          }
          
          if (channel.brightness !== undefined) {
            console.log(`  │    Brightness: ${channel.brightness}`);
          }
          
          if (channel.dimmable !== undefined) {
            console.log(`  │    Dimmable: ${channel.dimmable}`);
          }
        }
        
        console.log(`  │`);
      }
      
      console.log(`  └─────────────────────────────────────────────────`);
      console.log('');
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // 3. РЕЗЮМЕ
  console.log('📊 3. РЕЗЮМЕ\n');
  console.log(`  Устройство:       ${DEVICE_MAC}`);
  console.log(`  Статус анализа:   ${deviceData ? '✅ Успешно' : '⚠️  Частично'}`);
  console.log(`  Каналов найдено:  ${channelIds.length}`);
  
  if (channelIds.length > 0) {
    console.log(`\n  💡 Для получения конечных устройств используйте:`);
    console.log(`     node scripts/inspect-channel-dim3.js`);
    console.log(`     (измените channelId внутри скрипта)\n`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

analyzeDevice().catch(console.error);

