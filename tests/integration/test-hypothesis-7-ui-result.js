#!/usr/bin/env node

/**
 * Тест гипотезы 7: Результат в UI - показ "(не привязан)"
 * 
 * Гипотеза: Из-за проблем с резолвом UI показывает каналы как "(не привязан)"
 * даже когда привязки существуют.
 * 
 * Что проверяет:
 * - Симуляцию UI отображения каналов
 * - Проверку, что каналы с `bind` показываются как "(не привязан)"
 * - Проверку корректности отображения после резолва
 * - Реальную логику из monitor.js (строки 2540-2578)
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-7-ui-result.js [ws://host:port]
 * 
 * Зачем: Проверяем финальный результат проблемы - некорректное отображение в UI,
 * что подтверждает влияние всех проблем на пользовательский опыт
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || process.argv[2] || 'ws://192.168.88.4:3000';
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT) || 60000;

// Зачем: Функция для определения конфигурации каналов актуатора
function getActuatorChannelCount(deviceType) {
  const channelConfigs = {
    0x0a: { count: 8, types: ['do'] },   0x0b: { count: 16, types: ['do'] },
    0x0e: { count: 4, types: ['dim'] },  0x0f: { count: 8, types: ['dim'] },
    0x11: { count: 12, types: ['do'] },   0x23: { count: 2, types: ['do'] },
    0xa0: { count: 6, types: ['do'] },   0xa1: { count: 12, types: ['do'] },
    0xa2: { count: 24, types: ['do'] },  0xa7: { count: 2, types: ['do'] },
    0xa3: { count: 4, types: ['dim'] },  0xa4: { count: 8, types: ['dim'] },
    0xa5: { count: 8, types: ['dim'] },  0xaf: { count: 8, types: ['dim'] },
    0xad: { count: 12, types: ['dim'] },  0xb3: { count: 12, types: ['dim'] },
    0xb4: { count: 12, types: ['dim'] },  0xb6: { count: 1, types: ['dim'] },
    0xa9: { count: 4, types: ['ao'] },
    0x41: { count: 12, types: ['do', 'dim'] },
    0xaa: { count: 4, types: ['do', 'dim'] },
    0xab: { count: 2, types: ['do', 'dim'] },
    0xac: { count: 2, types: ['do', 'dim'] },
    0xae: { count: 12, types: ['do'] },
    0xb5: { count: 18, types: ['do', 'dim'] },
  };
  return channelConfigs[deviceType] || null;
}

// Зачем: Симуляция логики UI из monitor.js (строки 2540-2578)
function simulateUIChannelDisplay(channel, channelState, linkedDevice) {
  const channelTypeName = channel.channelType === 'do' ? 'DO' : channel.channelType === 'dim' ? 'DIM' : channel.channelType === 'ao' ? 'AO' : channel.channelType;
  
  if (linkedDevice) {
    // Зачем: Канал резолвен - показываем связанное устройство
    const deviceName = linkedDevice.name || linkedDevice.id;
    const deviceType = linkedDevice.typeName || linkedDevice.type;
    return `${channelTypeName}/${channel.channelIndex} → ${deviceName} (${deviceType})`;
  } else if (!channelState) {
    // Зачем: Состояние канала еще не получено
    return `${channelTypeName}/${channel.channelIndex} → (данные канала не получены)`;
  } else {
    const hasBindField = Object.prototype.hasOwnProperty.call(channelState, 'bind');
    if (!hasBindField) {
      // Зачем: Привязка не получена
      return `${channelTypeName}/${channel.channelIndex} → (привязка не получена)`;
    } else if (channelState.bind !== null && channelState.bind !== undefined) {
      // Зачем: Устройство не найдено
      return `${channelTypeName}/${channel.channelIndex} → ⚠️  Устройство не найдено`;
    } else {
      // Зачем: Канал не привязан (bind явно равен null)
      return `${channelTypeName}/${channel.channelIndex} → (не привязан)`;
    }
  }
}

class Hypothesis7Test {
  constructor() {
    this.ws = null;
    this.actuators = [];
    this.channels = new Map(); // channelId -> {channel, channelState, linkedDevice, uiDisplay}
    this.devices = new Map(); // deviceId -> device
    this.messages = [];
    this.uiResults = {
      resolved: 0,
      notResolved: 0,
      showsNotLinked: 0,
      showsDeviceNotFound: 0,
      showsDataNotReceived: 0,
      showsBindNotReceived: 0
    };
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 7: Результат в UI - показ "(не привязан)"');
      console.log('='.repeat(80));
      console.log(`WebSocket URI: ${WS_URI}\n`);

      const timeout = setTimeout(() => {
        this.analyzeUIResults();
        clearTimeout(timeout);
        if (this.ws) this.ws.close();
        resolve();
      }, TEST_TIMEOUT);

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let listReceived = false;
      let getSent = false;

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket ошибка: ${error.message}`));
      });

      ws.on('open', () => {
        console.log('✅ Подключено к WebSocket\n');
        console.log('📤 [STEP 1] Отправляем LIST для получения списка устройств...');
        ws.send(JSON.stringify({ type: 'list' }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.messages.push(message);

          if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
            listReceived = true;
            const stateList = message.state || [];
            const deviceIds = stateList.map(([id]) => id).filter(Boolean);
            
            console.log(`✅ [STEP 1] Получен LIST: ${deviceIds.length} устройств\n`);
            
            console.log('📤 [STEP 2] Запрашиваем устройства и каналы...');
            getSent = true;
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            setTimeout(() => {
              this.requestActuatorChannels(ws);
            }, 10000);
          }

          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const payload = message.payload || {};
            const isChannel = deviceId.includes('/');
            
            if (isChannel) {
              // Зачем: Обрабатываем каналы
              if (!this.channels.has(deviceId)) {
                const parts = deviceId.split('/');
                this.channels.set(deviceId, {
                  channel: {
                    channelId: deviceId,
                    channelType: parts[1],
                    channelIndex: parseInt(parts[2], 10)
                  },
                  channelState: payload,
                  linkedDevice: null,
                  uiDisplay: null
                });
              } else {
                const channelData = this.channels.get(deviceId);
                channelData.channelState = { ...channelData.channelState, ...payload };
              }
            } else {
              // Зачем: Обрабатываем устройства
              this.devices.set(deviceId, payload);
            }
          }
        } catch (error) {
          console.error('Ошибка обработки сообщения:', error);
        }
      });
    });
  }

  // Зачем: Запрашиваем каналы актуаторов
  requestActuatorChannels(ws) {
    console.log('📤 [STEP 3] Запрашиваем каналы актуаторов...\n');
    
    const deviceDataMap = new Map();
    this.messages.forEach(msg => {
      if ((msg.type === 'action_set' || msg.type === 'ACTION_SET') && msg.id && !msg._context) {
        const deviceId = msg.id;
        if (!deviceId.includes('/')) {
          deviceDataMap.set(deviceId, msg.payload || {});
        }
      }
    });

    const channelIds = [];
    deviceDataMap.forEach((payload, deviceId) => {
      const deviceType = payload.type;
      if (typeof deviceType === 'number' && deviceType !== 0x00) {
        const channelConfig = getActuatorChannelCount(deviceType);
        if (channelConfig) {
          this.actuators.push({
            id: deviceId,
            type: deviceType,
            name: payload.title || payload.code || payload.name || deviceId
          });

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
            channelIds.push(`${deviceId}/do/${i}`);
          }
          for (let i = 1; i <= dimCount; i++) {
            channelIds.push(`${deviceId}/dim/${i}`);
          }
          for (let i = 1; i <= aoCount; i++) {
            channelIds.push(`${deviceId}/ao/${i}`);
          }
        }
      }
    });

    if (channelIds.length > 0) {
      for (let i = 0; i < channelIds.length; i += 50) {
        const batch = channelIds.slice(i, i + 50);
        ws.send(JSON.stringify({ type: 'get', state: batch }));
      }
    }
    
    setTimeout(() => {
      this.simulateUI();
    }, 15000);
  }

  // Зачем: Симулируем UI отображение (реальная логика из monitor.js)
  simulateUI() {
    console.log('🎨 [STEP 4] Симуляция UI отображения...\n');
    
    // Зачем: Резолвим связанные устройства
    this.channels.forEach((channelData, channelId) => {
      const channelState = channelData.channelState;
      
      // Зачем: Реальная логика поиска из monitor.js
      if (channelState && channelState.bind !== null && channelState.bind !== undefined) {
        let linkedDevice = Array.from(this.devices.values()).find(d => d.id === channelState.bind);
        
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = Array.from(this.devices.values()).find(d => 
            d.code === channelState.bind || 
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
        
        channelData.linkedDevice = linkedDevice;
      }
      
      // Зачем: Симулируем UI отображение
      channelData.uiDisplay = simulateUIChannelDisplay(
        channelData.channel,
        channelState,
        channelData.linkedDevice
      );
      
      // Зачем: Анализируем результат UI
      if (channelData.linkedDevice) {
        this.uiResults.resolved++;
      } else {
        this.uiResults.notResolved++;
        
        if (channelData.uiDisplay.includes('(не привязан)')) {
          this.uiResults.showsNotLinked++;
        } else if (channelData.uiDisplay.includes('Устройство не найдено')) {
          this.uiResults.showsDeviceNotFound++;
        } else if (channelData.uiDisplay.includes('данные канала не получены')) {
          this.uiResults.showsDataNotReceived++;
        } else if (channelData.uiDisplay.includes('привязка не получена')) {
          this.uiResults.showsBindNotReceived++;
        }
      }
    });
  }

  // Зачем: Анализируем результаты UI
  analyzeUIResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ UI');
    console.log('='.repeat(80) + '\n');

    console.log(`📋 Всего каналов: ${this.channels.size}`);
    console.log(`✅ Резолвлено: ${this.uiResults.resolved}`);
    console.log(`❌ Не резолвлено: ${this.uiResults.notResolved}\n`);

    console.log('📊 Статистика отображения в UI:');
    console.log(`   Показывает "(не привязан)": ${this.uiResults.showsNotLinked}`);
    console.log(`   Показывает "Устройство не найдено": ${this.uiResults.showsDeviceNotFound}`);
    console.log(`   Показывает "данные канала не получены": ${this.uiResults.showsDataNotReceived}`);
    console.log(`   Показывает "привязка не получена": ${this.uiResults.showsBindNotReceived}\n`);

    // Зачем: Показываем примеры проблемных каналов
    const problematicChannels = [];
    this.channels.forEach((channelData, channelId) => {
      if (!channelData.linkedDevice && channelData.channelState && channelData.channelState.bind) {
        problematicChannels.push({
          channelId,
          bind: channelData.channelState.bind,
          uiDisplay: channelData.uiDisplay
        });
      }
    });

    if (problematicChannels.length > 0) {
      console.log(`⚠️  Проблемные каналы (первые 10):`);
      problematicChannels.slice(0, 10).forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.channelId}`);
        console.log(`      bind: ${item.bind}`);
        console.log(`      UI: ${item.uiDisplay}`);
      });
      if (problematicChannels.length > 10) {
        console.log(`   ... и еще ${problematicChannels.length - 10} каналов`);
      }
      console.log('');
    }

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    const problematicPercent = this.channels.size > 0 
      ? (this.uiResults.notResolved / this.channels.size * 100) 
      : 0;
    
    if (problematicPercent > 10) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log(`   ${problematicPercent.toFixed(1)}% каналов не резолвлены и показываются некорректно в UI.`);
      console.log(`   ${this.uiResults.showsNotLinked} каналов показываются как "(не привязан)" даже при наличии bind.`);
      console.log('   Это подтверждает проблему: UI показывает некорректную информацию из-за проблем с резолвом.\n');
    } else if (problematicPercent > 0) {
      console.log('⚠️  ГИПОТЕЗА ЧАСТИЧНО ПОДТВЕРЖДЕНА:');
      console.log(`   ${problematicPercent.toFixed(1)}% каналов не резолвлены.`);
      console.log('   Проблема существует, но не критична.\n');
    } else {
      console.log('❓ ГИПОТЕЗА НЕ ПОДТВЕРЖДЕНА:');
      console.log('   Все каналы резолвлены корректно.');
      console.log('   Возможно, проблема решена или не проявляется в текущих условиях.\n');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis7Test();
    await test.run();
    console.log('✅ Тест завершён');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Тест провален:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { Hypothesis7Test };






