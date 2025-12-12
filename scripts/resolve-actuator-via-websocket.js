#!/usr/bin/env node

/**
 * Универсальный скрипт для резолва актуаторов через WebSocket (БЕЗ БД)
 * 
 * Использование:
 *   node scripts/resolve-actuator-via-websocket.js <ACTUATOR_ID>
 * 
 * Примеры:
 *   node scripts/resolve-actuator-via-websocket.js "68:27:19:e4:49:17"  # DIM_8
 *   node scripts/resolve-actuator-via-websocket.js "68:27:19:e4:2a:87"  # RELAY_12
 * 
 * Зачем: Отрезолвить привязки каналов любого актуатора используя только WebSocket API
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTUATOR_ID = process.argv[2];

if (!ACTUATOR_ID) {
  console.error('❌ Укажите ID актуатора');
  console.error('Использование: node scripts/resolve-actuator-via-websocket.js "68:27:19:e4:49:17"');
  process.exit(1);
}

// Зачем: Названия типов устройств для отображения
const DEVICE_TYPE_NAMES = {
  // Реле
  0x0a: 'DO8',
  0x0b: 'DO16',
  0x11: 'DO12',
  0x23: 'RELAY_2',
  0xa0: 'RELAY_6',
  0xa1: 'RELAY_12',
  0xa2: 'RELAY_24',
  0xa7: 'RELAY_2_DIN',
  0xae: 'RELAY_12_RS',
  // Диммеры
  0x0e: 'DIM4',
  0x0f: 'DIM8',
  0xa3: 'DIM_4',
  0xa4: 'DIM_8',
  0xa5: 'LANAMP',
  0xaf: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS',
  0xb3: 'DIM_12_AC_RS',
  0xb4: 'DIM_12_DC_RS',
  0xb6: 'DIM_1_AC_RS',
  // Аналоговые выходы
  0xa9: 'AO_4_DIN',
  // Смешанные
  0x41: 'MIX_H',
  0xaa: 'MIX_2',
  0xab: 'MIX_1',
  0xac: 'MIX_1_RS',
  0xb5: 'MIX_6x12_RS',
};

// Зачем: Функция для определения конфигурации каналов актуатора
function getActuatorChannelCount(deviceType) {
  const channelConfigs = {
    // Реле (do каналы)
    0x0a: { count: 8, types: ['do'] },
    0x0b: { count: 16, types: ['do'] },
    0x11: { count: 12, types: ['do'] },
    0x23: { count: 2, types: ['do'] },
    0xa0: { count: 6, types: ['do'] },
    0xa1: { count: 12, types: ['do'] },
    0xa2: { count: 24, types: ['do'] },
    0xa7: { count: 2, types: ['do'] },
    0xae: { count: 12, types: ['do'] },
    // Диммеры (dim каналы)
    0x0e: { count: 4, types: ['dim'] },
    0x0f: { count: 8, types: ['dim'] },
    0xa3: { count: 4, types: ['dim'] },
    0xa4: { count: 8, types: ['dim'] },
    0xa5: { count: 8, types: ['dim'] },
    0xaf: { count: 8, types: ['dim'] },
    0xad: { count: 12, types: ['dim'] },
    0xb3: { count: 12, types: ['dim'] },
    0xb4: { count: 12, types: ['dim'] },
    0xb6: { count: 1, types: ['dim'] },
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

// Зачем: Генерация списка ID каналов на основе типа устройства
function generateChannelIds(actuatorId, deviceType) {
  const channelConfig = getActuatorChannelCount(deviceType);
  if (!channelConfig) return [];
  
  const channelIds = [];
  const channelTypes = channelConfig.types;
  const channelCount = channelConfig.count;
  
  let doCount = 0, dimCount = 0, aoCount = 0;
  
  // Зачем: Для смешанных устройств определяем количество каналов каждого типа
  if (channelTypes.includes('do') && channelTypes.includes('dim')) {
    switch (deviceType) {
      case 0x41: doCount = 6; dimCount = 6; break;  // MIX_H: 6 DO + 6 DIM
      case 0xaa: doCount = 2; dimCount = 2; break;  // MIX_2: 2 DO + 2 DIM
      case 0xab: case 0xac: doCount = 1; dimCount = 1; break;  // MIX_1: 1 DO + 1 DIM
      case 0xb5: doCount = 6; dimCount = 12; break;  // MIX_6x12_RS: 6 DO + 12 DIM
    }
  } else {
    if (channelTypes.includes('do')) doCount = channelCount;
    if (channelTypes.includes('dim')) dimCount = channelCount;
    if (channelTypes.includes('ao')) aoCount = channelCount;
  }
  
  // Зачем: Генерируем ID каналов
  for (let i = 1; i <= doCount; i++) {
    channelIds.push(`${actuatorId}/do/${i}`);
  }
  for (let i = 1; i <= dimCount; i++) {
    channelIds.push(`${actuatorId}/dim/${i}`);
  }
  for (let i = 1; i <= aoCount; i++) {
    channelIds.push(`${actuatorId}/ao/${i}`);
  }
  
  return channelIds;
}

async function resolveDeviceViaWebSocket() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ РЕЗОЛВИНГ АКТУАТОРА ЧЕРЕЗ WEBSOCKET (БЕЗ БД)            ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Актуатор ID: ${ACTUATOR_ID}\n`);
  
  const ws = new WebSocket(WS_URI);
  const messages = [];
  let requestPhase = 1;
  let channelIds = [];
  
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
  ws.on('open', () => {
    console.log(`[✓] Подключено к ${WS_URI}\n`);
    
    // Зачем: Фаза 1 - запрашиваем данные актуатора
    console.log('[ФАЗА 1] Запрашиваем данные актуатора...');
    ws.send(JSON.stringify({ type: 'get', state: [ACTUATOR_ID] }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      messages.push(message);
      
      // Зачем: Фаза 1 - получили данные актуатора, определяем каналы
      if (requestPhase === 1 && message.type === 'ACTION_SET' && message.id === ACTUATOR_ID && message.payload) {
        const deviceType = message.payload.type;
        
        if (typeof deviceType !== 'number') {
          console.log('❌ Устройство не найдено или не является актуатором');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип 0x${deviceType.toString(16)}`;
        console.log(`[✓] Тип актуатора: ${deviceTypeName} (0x${deviceType.toString(16)})\n`);
        
        // Зачем: Определяем каналы актуатора
        const channelConfig = getActuatorChannelCount(deviceType);
        if (!channelConfig) {
          console.log('❌ Неизвестный тип актуатора или каналы не поддерживаются');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        channelIds = generateChannelIds(ACTUATOR_ID, deviceType);
        
        console.log(`[ФАЗА 2] Запрашиваем ${channelIds.length} каналов (${channelConfig.types.join(', ')})...`);
        ws.send(JSON.stringify({ type: 'get', state: channelIds }));
        requestPhase = 2;
        
        // Зачем: Ждем получения данных каналов
        setTimeout(() => {
          // Зачем: Собираем UUID из bind каналов
          console.log('\n[ФАЗА 3] Собираем UUID для запроса связанных устройств...');
          const uuidsToRequest = new Set();
          
          channelIds.forEach(channelId => {
            const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
            if (channelMsg && channelMsg.payload && channelMsg.payload.bind) {
              const bind = channelMsg.payload.bind;
              // Зачем: Если bind это UUID (не содержит '/'), добавляем его
              if (!bind.includes('/')) {
                uuidsToRequest.add(bind);
                const channelName = channelId.split('/').slice(1).join('/');
                console.log(`  - Найден bind: ${bind} (${channelName})`);
              }
            }
          });
          
          // Зачем: Добавляем UUID помещения актуатора
          const actuatorMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === ACTUATOR_ID);
          if (actuatorMsg && actuatorMsg.payload && actuatorMsg.payload.site) {
            const site = actuatorMsg.payload.site;
            if (typeof site === 'string') {
              uuidsToRequest.add(site);
              console.log(`  - Найдено помещение актуатора: ${site}`);
            } else if (Array.isArray(site) && site.length > 0) {
              uuidsToRequest.add(site[0]);
              console.log(`  - Найдено помещение актуатора: ${site[0]}`);
            }
          }
          
          if (uuidsToRequest.size > 0) {
            console.log(`\n[ФАЗА 3] Запрашиваем ${uuidsToRequest.size} связанных устройств...`);
            ws.send(JSON.stringify({ type: 'get', state: Array.from(uuidsToRequest) }));
            requestPhase = 3;
            
            // Зачем: Ждем ответы на запрос связанных устройств
            setTimeout(() => {
              console.log('[✓] Обработка завершена\n');
              clearTimeout(timeout);
              processResults(messages, channelIds, deviceType);
              ws.close();
              process.exit(0);
            }, 3000);
          } else {
            console.log('\n[!] Не найдено связанных устройств для запроса\n');
            clearTimeout(timeout);
            processResults(messages, channelIds, deviceType);
            ws.close();
            process.exit(0);
          }
        }, 2000);
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

function processResults(messages, channelIds, deviceType) {
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📊 РЕЗУЛЬТАТЫ РЕЗОЛВИНГА\n');
  
  // Зачем: Собираем данные из сообщений
  const deviceData = new Map();
  const channelData = new Map();
  
  messages.forEach(msg => {
    if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
      if (channelIds.includes(msg.id)) {
        channelData.set(msg.id, msg.payload);
      } else {
        deviceData.set(msg.id, msg.payload);
      }
    }
  });
  
  // Зачем: Получаем данные актуатора
  const actuatorData = deviceData.get(ACTUATOR_ID) || {};
  const actuatorSite = actuatorData.site ? (Array.isArray(actuatorData.site) ? actuatorData.site[0] : actuatorData.site) : null;
  
  // Зачем: Получаем название помещения
  let siteName = null;
  if (actuatorSite) {
    const siteData = deviceData.get(actuatorSite);
    if (siteData) {
      siteName = siteData.title || siteData.code || siteData.name || actuatorSite;
    }
  }
  
  const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип 0x${deviceType.toString(16)}`;
  
  // Зачем: Выводим информацию об актуаторе
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║ ИНФОРМАЦИЯ ОБ УСТРОЙСТВЕ                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  console.log(`Название (title): ${actuatorData.title || '—'}`);
  console.log(`Код (code): ${actuatorData.code || '—'}`);
  console.log(`Имя (name): ${actuatorData.name || '—'}`);
  console.log(`ID: ${ACTUATOR_ID}`);
  console.log(`Тип: ${deviceTypeName} (${deviceType})`);
  console.log(`Категория: Актуатор`);
  console.log(`Помещение: ${siteName || actuatorSite || '—'}`);
  if (actuatorSite) {
    console.log(`UUID помещения: ${actuatorSite}`);
  }
  
  console.log('\nСтатус подключения:');
  console.log(`  Значение (value): ${actuatorData.value !== undefined ? actuatorData.value : '—'}`);
  console.log(`  Инициализировано (initialized): ${actuatorData.initialized ? 'Да' : 'Нет'}`);
  console.log(`  Онлайн (online): ${actuatorData.online ? 'Да' : 'Нет'}`);
  console.log(`  Готов (ready): ${actuatorData.ready ? '🟢 Да' : '🔴 Нет'}`);
  console.log(`  IP-адрес (ip): ${actuatorData.ip || '—'}`);
  
  if (actuatorData.timestamp) {
    const date = new Date(actuatorData.timestamp);
    console.log(`  Timestamp: ${date.toLocaleString('ru-RU')}`);
  }
  
  // Зачем: Выводим информацию о каналах
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║ КАНАЛЫ АКТУАТОРА                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  // Зачем: Группируем каналы по типам
  const channelsByType = {
    do: [],
    dim: [],
    ao: []
  };
  
  channelIds.forEach(channelId => {
    const parts = channelId.split('/');
    const channelType = parts[1];
    const channelIndex = parseInt(parts[2]);
    
    if (channelsByType[channelType]) {
      channelsByType[channelType].push({
        id: channelId,
        index: channelIndex,
        data: channelData.get(channelId) || {}
      });
    }
  });
  
  // Зачем: Выводим каналы по типам
  Object.keys(channelsByType).sort().forEach(channelType => {
    const channels = channelsByType[channelType];
    if (channels.length === 0) return;
    
    const typeName = channelType === 'do' ? 'Реле (DO)' : channelType === 'dim' ? 'Диммер (DIM)' : 'Аналоговый выход (AO)';
    console.log(`  ${typeName} каналы:`);
    
    channels.forEach(channel => {
      const data = channel.data;
      const value = data.value !== undefined ? data.value : '—';
      const bind = data.bind || null;
      
      let valueStr = '';
      if (channelType === 'dim') {
        valueStr = `${value} (0-255)`;
      } else if (channelType === 'do') {
        valueStr = value === 1 ? 'ВКЛ' : value === 0 ? 'ВЫКЛ' : `${value}`;
      } else if (channelType === 'ao') {
        valueStr = `${value}`;
      }
      
      const channelTypeName = channelType.toUpperCase();
      let line = `    ${channelTypeName}/${channel.index}: ${valueStr}`;
      
      if (bind) {
        // Зачем: Проверяем, является ли bind UUID
        if (!bind.includes('/')) {
          const linkedDevice = deviceData.get(bind);
          if (linkedDevice) {
            const deviceType = linkedDevice.type || '—';
            const deviceSiteId = linkedDevice.site ? (Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site) : null;
            
            // Зачем: Формируем отображение имени устройства
            const displayName = linkedDevice.title || linkedDevice.code || linkedDevice.name || bind.substring(0, 8) + '...';
            line += ` → ${displayName}`;
            
            // Зачем: Добавляем информацию о типе устройства
            if (deviceType) {
              line += ` (${deviceType})`;
            }
            
            // Зачем: Добавляем информацию о помещении
            if (deviceSiteId) {
              const deviceSiteData = deviceData.get(deviceSiteId);
              if (deviceSiteData) {
                const deviceSiteName = deviceSiteData.title || deviceSiteData.code || deviceSiteData.name || deviceSiteId;
                line += ` / ${deviceSiteName}`;
              }
            }
            
            console.log(line);
            console.log(`      bind: ${bind}`);
            
            // Зачем: Выводим детальную информацию о связанном устройстве
            if (linkedDevice.title || linkedDevice.code || linkedDevice.name) {
              const details = [];
              if (linkedDevice.title) details.push(`title: "${linkedDevice.title}"`);
              if (linkedDevice.code) details.push(`code: "${linkedDevice.code}"`);
              if (linkedDevice.name) details.push(`name: "${linkedDevice.name}"`);
              console.log(`      └─ ${details.join(', ')}`);
            }
          } else {
            console.log(line + ` → ⚠️  Устройство не найдено`);
            console.log(`      bind: ${bind} [запрошено через WebSocket]`);
          }
        } else {
          // Зачем: Формат MAC-адрес/тип/индекс
          const [mac, type, idx] = bind.split('/');
          console.log(line + ` → Связь с ${mac}/${type}/${idx}`);
          console.log(`      bind: ${bind}`);
        }
      } else {
        console.log(line + ` → (не привязан)`);
      }
    });
    
    console.log('');
  });
  
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Зачем: Выводим сводку
  const channelsWithBind = Array.from(channelData.values()).filter(d => d.bind).length;
  const channelsWithoutBind = channelIds.length - channelsWithBind;
  const unresolvedBinds = Array.from(channelData.values()).filter(d => {
    if (!d.bind || d.bind.includes('/')) return false;
    return !deviceData.has(d.bind);
  }).length;
  
  console.log('📈 СВОДКА:');
  console.log(`  Всего каналов: ${channelIds.length}`);
  console.log(`  С привязками (bind): ${channelsWithBind}`);
  console.log(`  Без привязок: ${channelsWithoutBind}`);
  console.log(`  Не отрезолвлено: ${unresolvedBinds}`);
  console.log('');
}

resolveDeviceViaWebSocket().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
