#!/usr/bin/env node

/**
 * Тест: проверяет, что каналы актуаторов добавляются в массовый GET
 * 
 * Симулирует логику из monitor.js ws.on('open'):
 * - Собирает deviceIds для всех устройств
 * - Добавляет каналы для актуаторов
 * - Проверяет, что каналы Dim4 присутствуют в списке
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const TEST_ACTUATOR_ID = '68:27:19:e4:49:19'; // Dim4
const TEST_TIMEOUT = 30000;

// Зачем: Имитация getActuatorChannelCount из monitor.js
function getActuatorChannelCount(deviceType) {
  const channelConfigs = {
    0x0a: { count: 8, types: ['do'] },   0x0b: { count: 16, types: ['do'] },
    0x0e: { count: 4, types: ['dim'] },  0x0f: { count: 8, types: ['dim'] },
    0xa3: { count: 4, types: ['dim'] },  0xa4: { count: 8, types: ['dim'] },
    0xa5: { count: 8, types: ['dim'] },  0xaf: { count: 8, types: ['dim'] },
    0xad: { count: 12, types: ['dim'] }, 0xb3: { count: 12, types: ['dim'] },
    0xb4: { count: 12, types: ['dim'] }, 0xb6: { count: 1, types: ['dim'] },
    0xa9: { count: 4, types: ['ao'] },
    0x41: { count: 12, types: ['do', 'dim'] }, 0xaa: { count: 4, types: ['do', 'dim'] },
    0xab: { count: 2, types: ['do', 'dim'] }, 0xac: { count: 2, types: ['do', 'dim'] },
    0xb5: { count: 18, types: ['do', 'dim'] },
  };
  return channelConfigs[deviceType] || null;
}

async function main() {
  return new Promise((resolve, reject) => {
    console.log('🧪 Тест: Проверка добавления каналов в массовый GET\n');

    const timeout = setTimeout(() => {
      reject(new Error(`Тест не завершился за ${TEST_TIMEOUT / 1000} секунд`));
    }, TEST_TIMEOUT);

    const ws = new WebSocket(WS_URI);
    let devices = [];
    let deviceIds = [];

    // Зачем: Определяем processDevices до использования
    const processDevices = () => {
      console.log(`\n📦 Загружено ${devices.length} устройств, симулируем добавление каналов...\n`);

      // Зачем: Симулируем логику из monitor.js ws.on('open')
      devices.forEach(device => {
        deviceIds.push(device.id);

        // Зачем: Для актуаторов добавляем ID всех каналов
        if (device.category === 'Актуатор' && typeof device.type === 'number') {
          const channelConfig = getActuatorChannelCount(device.type);
          if (channelConfig) {
            const channelTypes = channelConfig.types;
            const channelCount = channelConfig.count;

            let doCount = 0, dimCount = 0, aoCount = 0;

            if (channelTypes.includes('do') && channelTypes.includes('dim')) {
              switch (device.type) {
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
              deviceIds.push(`${device.id}/do/${i}`);
            }
            for (let i = 1; i <= dimCount; i++) {
              deviceIds.push(`${device.id}/dim/${i}`);
            }
            for (let i = 1; i <= aoCount; i++) {
              deviceIds.push(`${device.id}/ao/${i}`);
            }

            // Зачем: Отладка для Dim4
            if (device.id === TEST_ACTUATOR_ID) {
              console.log(`✅ Найден Dim4:`);
              console.log(`   category: ${device.category}`);
              console.log(`   type: ${device.type} (0x${device.type.toString(16)})`);
              console.log(`   channelConfig: ${!!channelConfig}`);
              console.log(`   Добавлено каналов: do=${doCount}, dim=${dimCount}, ao=${aoCount}`);
            }
          }
        }
      });

      // Зачем: Проверяем, что каналы Dim4 присутствуют
      const dim4Channels = deviceIds.filter(id => id.startsWith(`${TEST_ACTUATOR_ID}/dim/`));
      console.log(`\n📊 Результаты:`);
      console.log(`   Всего ID в запросе: ${deviceIds.length}`);
      console.log(`   Каналов Dim4: ${dim4Channels.length}`);
      
      if (dim4Channels.length > 0) {
        console.log(`\n✅ УСПЕХ: Каналы Dim4 добавлены в массовый GET:`);
        dim4Channels.forEach(ch => console.log(`   - ${ch}`));
      } else {
        console.log(`\n❌ ПРОБЛЕМА: Каналы Dim4 НЕ добавлены в массовый GET`);
        
        // Зачем: Диагностика
        const dim4 = devices.find(d => d.id === TEST_ACTUATOR_ID);
        if (!dim4) {
          console.log(`   Dim4 не найден в списке устройств (всего устройств: ${devices.length})`);
          console.log(`   Примеры устройств:`, devices.slice(0, 5).map(d => `${d.id} (${d.category})`).join(', '));
        } else {
          console.log(`   Dim4 найден: category=${dim4.category}, type=${dim4.type}`);
          const channelConfig = getActuatorChannelCount(dim4.type);
          console.log(`   channelConfig: ${!!channelConfig}`);
        }
      }

      clearTimeout(timeout);
      resolve();
    };

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket ошибка: ${error.message}`));
    });

    ws.on('open', () => {
      console.log(`✅ Подключено к ${WS_URI}`);
      ws.send(JSON.stringify({ type: 'list' }));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Зачем: Обрабатываем LIST
        if (message.type === 'list' && devices.length === 0) {
          const stateList = message.state || [];
          const ids = stateList.map(([id]) => id).filter(Boolean);
          console.log(`📋 Получен список из ${ids.length} устройств`);
          ws.send(JSON.stringify({ type: 'get', state: ids }));
        }

        // Зачем: Обрабатываем ACTION_SET для загрузки устройств
        const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
        if (isActionSet && message.id && !message._context) {
          const { id, payload } = message;
          if (id && payload && typeof payload === 'object' && !id.includes('/')) {
            const deviceType = payload.type;
            if (typeof deviceType === 'number' && deviceType !== 0x00) {
              const category = getDeviceCategory(deviceType);
              devices.push({
                id: id,
                name: payload.title || payload.code || payload.name || 'Без названия',
                category: category,
                type: deviceType,
              });
            }
          }
        }

        // Зачем: Когда получили все устройства (нет больше pending), симулируем логику monitor.js
        // Зачем: В monitor.js устройства загружаются через loadDevicesAndSitesViaWebSocket ДО ws.on('open')
        // Поэтому здесь мы должны дождаться всех устройств
        if (devices.length > 0 && deviceIds.length === 0) {
          // Зачем: Ждём немного, чтобы получить все устройства
          setTimeout(() => {
            if (deviceIds.length === 0) {
              processDevices();
            }
          }, 5000);
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
      }
    });
  });
}

function getDeviceCategory(deviceType) {
  const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
  if (SHIELD_ACTUATOR_TYPES.includes(deviceType)) return 'Актуатор';
  return 'Неизвестно';
}

if (require.main === module) {
  main().then(() => {
    console.log('\n✅ Тест завершён');
    process.exit(0);
  }).catch((error) => {
    console.error('\n❌ Тест провален:', error.message);
    process.exit(1);
  });
}

module.exports = { main };






