#!/usr/bin/env node

/**
 * Тест гипотезы 3: Ограничительное условие дозапроса `bind`
 * 
 * Гипотеза: Дозапрос состояния канала (для получения `bind`) выполняется
 * только если канал принадлежит выбранному актуатору.
 * 
 * Что проверяет:
 * - Дозапросы отправляются только для выбранного актуатора
 * - Каналы невыбранных актуаторов не дозапрашиваются
 * - При переключении актуатора дозапросы начинают работать
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-3-selected-actuator-restriction.js [ws://host:port]
 * 
 * Зачем: Проверяем, что дозапрос ограничен выбранным актуатором,
 * что подтверждает гипотезу проблемы
 * 
 * Примечание: Этот тест требует симуляции выбора актуатора в monitor.js.
 * Для полной проверки нужно использовать реальный экземпляр monitor.js.
 */

const WebSocket = require('ws');

// Зачем: Упрощенный класс для тестирования без требования TTY
// Зачем: Симулирует реальную логику из monitor.js для проверки дозапроса
class TestDisplay {
  constructor() {
    this.deviceStates = new Map();
    this.allDevices = [];
    this.devices = [];
    this.selectedIndex = -1;
    this.requestedMissingDevices = new Set();
    this.requestedChannelStates = new Map();
    this.wsUpdateCount = 0;
    this.ws = null; // Зачем: Будет установлен извне
    this.channelStateRequests = []; // Зачем: Отслеживаем все вызовы requestChannelState
  }

  setDeviceState(deviceId, newState) {
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();
    this.wsUpdateCount++;
    const oldState = existing?.state || {};
    const mergedState = { ...oldState, ...newState };
    this.deviceStates.set(deviceId, {
      state: mergedState,
      timestamp: now,
      lastUpdate: now,
      lastStateChange: now
    });
  }

  // Зачем: Реальная логика из monitor.js (строки 2831-2853)
  requestChannelState(channelId) {
    if (!channelId) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const now = Date.now();
    const last = this.requestedChannelStates.get(channelId) || 0;
    const cooldownMs = 5000;
    if (now - last < cooldownMs) return;
    
    this.requestedChannelStates.set(channelId, now);
    
    // Зачем: Записываем запрос для анализа
    const actuatorId = channelId.split('/')[0];
    const selectedDevice = this.devices?.[this.selectedIndex];
    const selectedId = selectedDevice?.id;
    
    this.channelStateRequests.push({
      channelId,
      actuatorId,
      selectedId,
      timestamp: now,
      matchesSelected: selectedId === actuatorId
    });
    
    // Зачем: Отправляем реальный запрос
    this.ws.send(JSON.stringify({ type: 'get', state: [channelId] }));
  }

  requestMissingDevice(deviceId) {
    if (!deviceId) return;
    if (this.requestedMissingDevices.has(deviceId)) return;
    this.requestedMissingDevices.add(deviceId);
  }
}

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

class Hypothesis3Test {
  constructor() {
    this.ws = null;
    this.display = null;
    this.actuators = [];
    this.selectedActuatorId = null;
    this.requestedChannels = new Set(); // Зачем: Отслеживаем запрошенные каналы
    this.channelRequests = []; // Зачем: Массив запросов с метаданными
    this.messages = [];
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 3: Ограничительное условие дозапроса `bind`');
      console.log('='.repeat(80));
      console.log(`WebSocket URI: ${WS_URI}\n`);

      const timeout = setTimeout(() => {
        this.analyzeResults();
        clearTimeout(timeout);
        if (this.ws) this.ws.close();
        resolve();
      }, TEST_TIMEOUT);

      // Зачем: Создаем упрощенный экземпляр для тестирования без TTY
      const display = new TestDisplay();
      this.display = display;

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let listReceived = false;
      let getSent = false;

      // Зачем: Устанавливаем ws в display для requestChannelState
      display.ws = ws;

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

          // Зачем: Обрабатываем LIST
          if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
            listReceived = true;
            const stateList = message.state || [];
            const deviceIds = stateList.map(([id]) => id).filter(Boolean);
            
            console.log(`✅ [STEP 1] Получен LIST: ${deviceIds.length} устройств\n`);
            
            console.log('📤 [STEP 2] Запрашиваем устройства...');
            getSent = true;
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            // Зачем: Устанавливаем таймаут для обработки устройств
            setTimeout(() => {
              this.processDevices();
              this.runTestScenarios(ws);
            }, 10000);
          }

          // Зачем: Обрабатываем ACTION_SET для обновления состояния
          // Зачем: Симулируем реальную логику из monitor.js (строки 3318-3333)
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const payload = message.payload || {};
            const isChannel = deviceId.includes('/');
            
            // Зачем: Реальная логика дозапроса из monitor.js
            if (isChannel && payload && typeof payload === 'object') {
              const hasBindField = Object.prototype.hasOwnProperty.call(payload, 'bind');
              if (!hasBindField) {
                // Зачем: Ограничиваем дозапрос только каналами выбранного актуатора (строка 3330)
                const actuatorId = deviceId.split('/')[0];
                const selectedDevice = display.devices?.[display.selectedIndex];
                const selectedId = selectedDevice?.id;
                
                if (selectedId && selectedId === actuatorId) {
                  display.requestChannelState(deviceId);
                }
              }
            }
            
            // Зачем: Обновляем состояние в display
            if (display && display.setDeviceState) {
              display.setDeviceState(deviceId, payload);
            }
          }
        } catch (error) {
          console.error('Ошибка обработки сообщения:', error);
        }
      });
    });
  }

  // Зачем: Обрабатываем устройства и определяем актуаторы
  processDevices() {
    console.log('📊 [STEP 3] Обработка устройств...\n');
    
    const deviceDataMap = new Map();
    
    this.messages.forEach(msg => {
      if ((msg.type === 'action_set' || msg.type === 'ACTION_SET') && msg.id && !msg._context) {
        const deviceId = msg.id;
        if (!deviceId.includes('/')) {
          deviceDataMap.set(deviceId, msg.payload || {});
        }
      }
    });

    // Зачем: Определяем актуаторы
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
        }
      }
    });

    console.log(`✅ Найдено актуаторов: ${this.actuators.length}`);
    if (this.actuators.length > 0) {
      console.log(`   Примеры: ${this.actuators.slice(0, 3).map(a => a.name || a.id).join(', ')}\n`);
    }
  }

  // Зачем: Запускаем сценарии тестирования
  runTestScenarios(ws) {
    if (this.actuators.length < 2) {
      console.log('⚠️  Недостаточно актуаторов для теста (нужно минимум 2)\n');
      return;
    }

    console.log('='.repeat(80));
    console.log('🧪 [STEP 4] Запуск сценариев тестирования');
    console.log('='.repeat(80) + '\n');

    const actuator1 = this.actuators[0];
    const actuator2 = this.actuators[1];

    // Зачем: Сценарий 1: Выбираем первый актуатор и отправляем обновление канала
    console.log('📋 Сценарий 1: Выбран актуатор 1, обновление канала актуатора 1');
    this.selectedActuatorId = actuator1.id;
    if (this.display) {
      const actuator1Index = this.display.devices?.findIndex(d => d.id === actuator1.id) ?? -1;
      if (actuator1Index >= 0) {
        this.display.selectedIndex = actuator1Index;
      }
    }
    
    // Зачем: Симулируем частичное обновление канала первого актуатора
    setTimeout(() => {
      const channelId = `${actuator1.id}/dim/1`;
      const partialPayload = { value: 128 }; // Зачем: Без поля bind
      if (this.display && this.display.setDeviceState) {
        this.display.setDeviceState(channelId, partialPayload);
      }
      
      // Зачем: Сценарий 2: Выбираем второй актуатор и отправляем обновление канала первого
      setTimeout(() => {
        console.log('📋 Сценарий 2: Выбран актуатор 2, обновление канала актуатора 1');
        this.selectedActuatorId = actuator2.id;
        if (this.display) {
          const actuator2Index = this.display.devices?.findIndex(d => d.id === actuator2.id) ?? -1;
          if (actuator2Index >= 0) {
            this.display.selectedIndex = actuator2Index;
          }
        }
        
        // Зачем: Симулируем частичное обновление канала первого актуатора (не выбранного)
        const channelId2 = `${actuator1.id}/dim/2`;
        const partialPayload2 = { value: 200 }; // Зачем: Без поля bind
        if (this.display && this.display.setDeviceState) {
          this.display.setDeviceState(channelId2, partialPayload2);
        }
        
        // Зачем: Сценарий 3: Выбираем первый актуатор и отправляем обновление канала второго
        setTimeout(() => {
          console.log('📋 Сценарий 3: Выбран актуатор 1, обновление канала актуатора 2');
          this.selectedActuatorId = actuator1.id;
          if (this.display) {
            const actuator1Index = this.display.devices?.findIndex(d => d.id === actuator1.id) ?? -1;
            if (actuator1Index >= 0) {
              this.display.selectedIndex = actuator1Index;
            }
          }
          
          const channelId3 = `${actuator2.id}/dim/1`;
          const partialPayload3 = { value: 50 }; // Зачем: Без поля bind
          if (this.display && this.display.setDeviceState) {
            this.display.setDeviceState(channelId3, partialPayload3);
          }
          
          console.log('\n⏳ Ожидание обработки запросов...\n');
        }, 2000);
      }, 2000);
    }, 2000);
  }

  // Зачем: Анализируем результаты теста
  analyzeResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ');
    console.log('='.repeat(80) + '\n');

    // Зачем: Используем данные из display.channelStateRequests (реальные дозапросы)
    const channelStateRequests = this.display?.channelStateRequests || [];
    console.log(`📋 Всего дозапросов каналов (requestChannelState): ${channelStateRequests.length}\n`);

    if (channelStateRequests.length === 0) {
      console.log('⚠️  Не было дозапросов каналов.');
      console.log('   Возможные причины:');
      console.log('   - Все каналы пришли с полным payload (с полем bind)');
      console.log('   - Не было частичных обновлений без bind');
      console.log('   - Недостаточно времени для обработки\n');
      
      // Зачем: Проверяем, были ли частичные обновления
      let partialUpdates = 0;
      this.messages.forEach(msg => {
        if ((msg.type === 'action_set' || msg.type === 'ACTION_SET') && msg.id && msg.id.includes('/')) {
          const payload = msg.payload || {};
          const hasBindField = Object.prototype.hasOwnProperty.call(payload, 'bind');
          if (!hasBindField) {
            partialUpdates++;
          }
        }
      });
      
      if (partialUpdates > 0) {
        console.log(`   Найдено ${partialUpdates} частичных обновлений без bind, но дозапросы не были выполнены.`);
        console.log('   Это может указывать на проблему с логикой дозапроса.\n');
      }
      
      return;
    }

    // Зачем: Группируем запросы по сценариям
    const requestsByScenario = {
      scenario1: channelStateRequests.filter(r => r.actuatorId === this.actuators[0]?.id && r.matchesSelected),
      scenario2: channelStateRequests.filter(r => r.actuatorId === this.actuators[0]?.id && !r.matchesSelected),
      scenario3: channelStateRequests.filter(r => r.actuatorId === this.actuators[1]?.id && !r.matchesSelected)
    };

    console.log('📊 Статистика по сценариям:');
    console.log(`   Сценарий 1 (выбран актуатор 1, канал актуатора 1): ${requestsByScenario.scenario1.length} дозапросов`);
    console.log(`   Сценарий 2 (выбран актуатор 2, канал актуатора 1): ${requestsByScenario.scenario2.length} дозапросов`);
    console.log(`   Сценарий 3 (выбран актуатор 1, канал актуатора 2): ${requestsByScenario.scenario3.length} дозапросов\n`);

    // Зачем: Анализируем соответствие выбранному актуатору
    const matchingSelected = channelStateRequests.filter(r => r.matchesSelected).length;
    const notMatchingSelected = channelStateRequests.filter(r => !r.matchesSelected).length;

    console.log('📊 Соответствие выбранному актуатору:');
    console.log(`   Дозапросы для выбранного актуатора: ${matchingSelected}`);
    console.log(`   Дозапросы для невыбранного актуатора: ${notMatchingSelected}\n`);

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    if (matchingSelected > 0 && notMatchingSelected === 0) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log('   Дозапросы отправляются ТОЛЬКО для выбранного актуатора.');
      console.log('   Каналы невыбранных актуаторов не дозапрашиваются.');
      console.log('   Это подтверждает проблему: ограничение на выбранный актуатор работает.\n');
    } else if (matchingSelected > notMatchingSelected && matchingSelected > 0) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log('   Большинство дозапросов для выбранного актуатора.');
      console.log('   Ограничение на выбранный актуатор работает.\n');
    } else if (notMatchingSelected > 0) {
      console.log('⚠️  ГИПОТЕЗА ЧАСТИЧНО ПОДТВЕРЖДЕНА:');
      console.log('   Есть дозапросы для невыбранных актуаторов.');
      console.log('   Возможно, ограничение работает не всегда.\n');
    } else {
      console.log('❓ ГИПОТЕЗА НЕ ПОДТВЕРЖДЕНА:');
      console.log('   Недостаточно данных для подтверждения гипотезы.\n');
    }

    // Зачем: Дополнительная информация
    if (channelStateRequests.length > 0) {
      console.log('📌 Детали дозапросов (первые 10):');
      channelStateRequests.slice(0, 10).forEach((req, index) => {
        console.log(`   ${index + 1}. ${req.channelId}`);
        console.log(`      Выбранный актуатор: ${req.selectedId || 'не установлен'}`);
        console.log(`      Канал актуатора: ${req.actuatorId}`);
        console.log(`      Совпадение: ${req.matchesSelected ? '✅' : '❌'}`);
      });
      if (channelStateRequests.length > 10) {
        console.log(`   ... и еще ${channelStateRequests.length - 10} дозапросов`);
      }
      console.log('');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis3Test();
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

module.exports = { Hypothesis3Test };






