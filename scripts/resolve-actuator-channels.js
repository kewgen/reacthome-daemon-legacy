#!/usr/bin/env node

/**
 * Скрипт для резолва привязок каналов актуатора
 * 
 * Использование:
 *   node scripts/resolve-actuator-channels.js "68:27:19:e4:2a:87"
 * 
 * Зачем: Загружает состояния каналов актуатора через WebSocket и показывает их привязки
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTUATOR_ID = process.argv[2];

if (!ACTUATOR_ID) {
  console.error('❌ Укажите ID актуатора');
  console.error('Использование: node scripts/resolve-actuator-channels.js "68:27:19:e4:2a:87"');
  process.exit(1);
}

// Зачем: Функция для определения конфигурации каналов актуатора
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

async function resolveActuatorChannels() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ РЕЗОЛВ ПРИВЯЗОК КАНАЛОВ АКТУАТОРА                        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Актуатор ID: ${ACTUATOR_ID}\n`);
  
  const ws = new WebSocket(WS_URI);
  const messages = [];
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    console.log(`[INFO] Подключено к ${WS_URI}\n`);
    
    // Зачем: Сначала запрашиваем данные самого актуатора, чтобы узнать его тип
    console.log('[STEP] Запрашиваем данные актуатора...');
    ws.send(JSON.stringify({ type: 'get', state: [ACTUATOR_ID] }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      messages.push(message);
      
      // Зачем: Если получили данные актуатора, запрашиваем его каналы
      if (message.type === 'ACTION_SET' && message.id === ACTUATOR_ID && message.payload) {
        const deviceType = message.payload.type;
        
        if (typeof deviceType !== 'number') {
          console.log('❌ Актуатор не найден или не имеет числового типа');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        console.log(`[INFO] Тип актуатора: 0x${deviceType.toString(16)} (${deviceType})\n`);
        
        // Зачем: Определяем каналы актуатора
        const channelConfig = getActuatorChannelCount(deviceType);
        if (!channelConfig) {
          console.log('❌ Неизвестный тип актуатора или каналы не поддерживаются');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        const channelIds = [];
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
          channelIds.push(`${ACTUATOR_ID}/do/${i}`);
        }
        for (let i = 1; i <= dimCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/dim/${i}`);
        }
        for (let i = 1; i <= aoCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/ao/${i}`);
        }
        
        console.log(`[STEP] Запрашиваем ${channelIds.length} каналов...`);
        ws.send(JSON.stringify({ type: 'get', state: channelIds }));
        
        // Зачем: Устанавливаем таймаут для сбора данных каналов и запроса связанных устройств
        setTimeout(() => {
          // Зачем: Собираем UUID из bind каналов после получения данных каналов
        const bindUuids = new Set();
        channelIds.forEach(channelId => {
          const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
          if (channelMsg && channelMsg.payload && channelMsg.payload.bind) {
            const bind = channelMsg.payload.bind;
            // Зачем: Если bind это UUID (не содержит '/'), добавляем его для запроса
            if (!bind.includes('/')) {
              bindUuids.add(bind);
            }
          }
        });
        
        // Зачем: Запрашиваем связанные устройства, если они есть
        if (bindUuids.size > 0) {
          console.log(`[STEP] Запрашиваем ${bindUuids.size} связанных устройств...`);
          ws.send(JSON.stringify({ type: 'get', state: Array.from(bindUuids) }));
        
            // Зачем: Устанавливаем дополнительный таймаут для обработки результатов после получения связанных устройств
        setTimeout(() => {
          clearTimeout(timeout);
          processResults(messages, channelIds);
          ws.close();
          process.exit(0);
            }, 3000);
          } else {
            // Зачем: Если связанных устройств нет, обрабатываем результаты сразу
            clearTimeout(timeout);
            processResults(messages, channelIds);
            ws.close();
            process.exit(0);
          }
        }, 2000); // Зачем: Таймаут для получения данных каналов
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

function processResults(messages, channelIds) {
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  // Зачем: Собираем данные каналов из сообщений
  const channelData = new Map();
  const deviceData = new Map();
  
  messages.forEach(msg => {
    if (msg.type === 'ACTION_SET' && msg.id) {
      if (channelIds.includes(msg.id)) {
        channelData.set(msg.id, msg.payload || {});
      } else if (msg.id === ACTUATOR_ID) {
        deviceData.set(msg.id, msg.payload || {});
      } else {
        // Зачем: Сохраняем данные устройств, которые могут быть привязаны к каналам
        deviceData.set(msg.id, msg.payload || {});
      }
    }
  });
  
  console.log(`📊 РЕЗУЛЬТАТЫ РЕЗОЛВА:\n`);
  console.log(`Найдено каналов: ${channelData.size} из ${channelIds.length} запрошенных\n`);
  
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
  
  // Зачем: Выводим информацию о каналах
  Object.keys(channelsByType).sort().forEach(channelType => {
    const channels = channelsByType[channelType];
    if (channels.length === 0) return;
    
    const typeName = channelType === 'do' ? 'Реле (DO)' : channelType === 'dim' ? 'Диммер (DIM)' : 'Аналоговый выход (AO)';
    console.log(`${typeName} каналы:`);
    
    channels.forEach(channel => {
      const data = channel.data;
      const value = data.value !== undefined ? data.value : '—';
      const bind = data.bind || null;
      
      let valueStr = '';
      if (channelType === 'dim') {
        valueStr = `${value} (0-255)`;
      } else if (channelType === 'do') {
        valueStr = value ? 'ВКЛ' : 'ВЫКЛ';
      } else {
        valueStr = `${value}`;
      }
      
      const channelTypeName = channelType.toUpperCase();
      let line = `  ${channelTypeName}/${channel.index}: ${valueStr}`;
      
      if (bind) {
        // Зачем: Проверяем, является ли bind UUID или MAC-адресом
        if (bind.includes('/')) {
          // Зачем: Формат MAC-адрес/тип/индекс
          const [mac, type, index] = bind.split('/');
          const linkedDevice = deviceData.get(mac);
          if (linkedDevice) {
            const deviceName = linkedDevice.title || linkedDevice.code || linkedDevice.name || mac;
            const deviceType = linkedDevice.type || '—';
            const deviceSite = linkedDevice.site ? (Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site) : null;
            line += ` → ${deviceName} (${deviceType})`;
            if (deviceSite) {
              // Зачем: Пытаемся найти название помещения
              const siteDevice = deviceData.get(deviceSite);
              if (siteDevice) {
                const siteName = siteDevice.title || siteDevice.code || siteDevice.name || deviceSite;
                line += ` / ${siteName}`;
              }
            }
          } else {
            line += ` → ⚠️  Устройство не найдено (bind: ${bind})`;
          }
        } else {
          // Зачем: UUID формата
          const linkedDevice = deviceData.get(bind);
          if (linkedDevice) {
            const deviceName = linkedDevice.title || linkedDevice.code || linkedDevice.name || bind.substring(0, 8) + '...';
            const deviceType = linkedDevice.type || '—';
            const deviceSite = linkedDevice.site ? (Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site) : null;
            line += ` → ${deviceName} (${deviceType})`;
            if (deviceSite) {
              // Зачем: Пытаемся найти название помещения
              const siteDevice = deviceData.get(deviceSite);
              if (siteDevice) {
                const siteName = siteDevice.title || siteDevice.code || siteDevice.name || deviceSite;
                line += ` / ${siteName}`;
              }
            }
          } else {
            line += ` → ⚠️  Устройство не найдено`;
            console.log(`      bind: ${bind}`);
          }
        }
      } else {
        line += ` → (не привязан)`;
      }
      
      console.log(line);
    });
    
    console.log('');
  });
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

resolveActuatorChannels().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
