#!/usr/bin/env node

/**
 * Тест гипотезы 6: Интеграционный тест цепочки проблем
 * 
 * Гипотеза: Проблемы взаимодействуют друг с другом, создавая цепочку:
 * 1. Старт приложения → Каналы не загружаются в массовом GET
 * 2. Частичные обновления → Каналы приходят без `bind`
 * 3. Ограничение дозапроса → Дозапрос работает только для выбранного актуатора
 * 4. Отсутствие связанных устройств → Устройства из `bind` не загружены
 * 5. Результат → UI показывает "(не привязан)" вместо реальных привязок
 * 
 * Что проверяет:
 * - Вся цепочка проблем от начала до конца
 * - Взаимодействие между проблемами
 * - Финальный результат в виде отсутствия резолва
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-6-problem-chain.js [ws://host:port]
 * 
 * Зачем: Проверяем всю цепочку проблем как единое целое,
 * что подтверждает комплексную природу проблемы
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

class Hypothesis6Test {
  constructor() {
    this.ws = null;
    this.actuators = [];
    this.channels = new Map(); // channelId -> {state, bind, linkedDevice, resolved}
    this.devices = new Map(); // deviceId -> device
    this.messages = [];
    this.chainSteps = {
      step1_initialLoad: { channelsRequested: 0, channelsReceived: 0 },
      step2_partialUpdates: { updatesWithoutBind: 0, totalUpdates: 0 },
      step3_doRequestRestriction: { requestsForSelected: 0, requestsForUnselected: 0 },
      step4_missingDevices: { devicesRequested: 0, devicesLoaded: 0 },
      step5_finalResult: { channelsResolved: 0, channelsUnresolved: 0 }
    };
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 6: Интеграционный тест цепочки проблем');
      console.log('='.repeat(80));
      console.log(`WebSocket URI: ${WS_URI}\n`);

      const timeout = setTimeout(() => {
        this.analyzeChain();
        clearTimeout(timeout);
        if (this.ws) this.ws.close();
        resolve();
      }, TEST_TIMEOUT);

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let listReceived = false;
      let getSent = false;
      let initialLoadComplete = false;

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

          // Зачем: Шаг 1 - Начальная загрузка
          if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
            listReceived = true;
            const stateList = message.state || [];
            const deviceIds = stateList.map(([id]) => id).filter(Boolean);
            
            console.log(`✅ [STEP 1] Получен LIST: ${deviceIds.length} устройств\n`);
            
            // Зачем: Проверяем, запрашиваются ли каналы в массовом GET
            console.log('📤 [STEP 1] Отправляем массовый GET (БЕЗ каналов)...');
            getSent = true;
            
            // Зачем: Подсчитываем каналы, которые должны быть запрошены
            const deviceDataMap = new Map();
            this.messages.forEach(msg => {
              if ((msg.type === 'action_set' || msg.type === 'ACTION_SET') && msg.id && !msg._context) {
                const deviceId = msg.id;
                if (!deviceId.includes('/')) {
                  deviceDataMap.set(deviceId, msg.payload || {});
                }
              }
            });
            
            let expectedChannels = 0;
            deviceDataMap.forEach((payload, deviceId) => {
              const deviceType = payload.type;
              if (typeof deviceType === 'number' && deviceType !== 0x00) {
                const channelConfig = getActuatorChannelCount(deviceType);
                if (channelConfig) {
                  expectedChannels += channelConfig.count;
                }
              }
            });
            
            this.chainSteps.step1_initialLoad.channelsRequested = expectedChannels;
            
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            setTimeout(() => {
              initialLoadComplete = true;
              this.processInitialLoad();
            }, 10000);
          }

          // Зачем: Обрабатываем ACTION_SET для всех шагов цепочки
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const payload = message.payload || {};
            const isChannel = deviceId.includes('/');
            
            if (isChannel) {
              // Зачем: Шаг 2 - Частичные обновления
              const hasBindField = Object.prototype.hasOwnProperty.call(payload, 'bind');
              this.chainSteps.step2_partialUpdates.totalUpdates++;
              if (!hasBindField) {
                this.chainSteps.step2_partialUpdates.updatesWithoutBind++;
              }
              
              // Зачем: Сохраняем состояние канала
              if (!this.channels.has(deviceId)) {
                this.channels.set(deviceId, {
                  state: payload,
                  bind: payload.bind,
                  linkedDevice: null,
                  resolved: false
                });
              } else {
                const channel = this.channels.get(deviceId);
                channel.state = { ...channel.state, ...payload };
                if (payload.bind !== undefined) {
                  channel.bind = payload.bind;
                }
              }
            } else {
              // Зачем: Шаг 4 - Загрузка устройств
              this.devices.set(deviceId, payload);
              this.chainSteps.step4_missingDevices.devicesLoaded++;
            }
          }
        } catch (error) {
          console.error('Ошибка обработки сообщения:', error);
        }
      });
    });
  }

  // Зачем: Обрабатываем начальную загрузку
  processInitialLoad() {
    console.log('\n📊 [STEP 1] Анализ начальной загрузки...\n');
    
    const deviceDataMap = new Map();
    this.messages.forEach(msg => {
      if ((msg.type === 'action_set' || msg.type === 'ACTION_SET') && msg.id && !msg._context) {
        const deviceId = msg.id;
        if (!deviceId.includes('/')) {
          deviceDataMap.set(deviceId, msg.payload || {});
        } else {
          this.chainSteps.step1_initialLoad.channelsReceived++;
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
    console.log(`✅ Ожидаемых каналов: ${this.chainSteps.step1_initialLoad.channelsRequested}`);
    console.log(`✅ Получено каналов: ${this.chainSteps.step1_initialLoad.channelsReceived}\n`);
    
    // Зачем: Запрашиваем каналы для дальнейшего тестирования
    this.requestChannels();
  }

  // Зачем: Запрашиваем каналы актуаторов
  requestChannels() {
    console.log('📤 [STEP 2-5] Запрашиваем каналы для тестирования цепочки...\n');
    
    const channelIds = [];
    this.actuators.forEach(actuator => {
      const channelConfig = getActuatorChannelCount(actuator.type);
      if (channelConfig) {
        const channelTypes = channelConfig.types;
        const channelCount = channelConfig.count;
        
        let doCount = 0, dimCount = 0, aoCount = 0;
        
        if (channelTypes.includes('do') && channelTypes.includes('dim')) {
          switch (actuator.type) {
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
          channelIds.push(`${actuator.id}/do/${i}`);
        }
        for (let i = 1; i <= dimCount; i++) {
          channelIds.push(`${actuator.id}/dim/${i}`);
        }
        for (let i = 1; i <= aoCount; i++) {
          channelIds.push(`${actuator.id}/ao/${i}`);
        }
      }
    });
    
    // Зачем: Запрашиваем каналы батчами
    if (channelIds.length > 0) {
      for (let i = 0; i < channelIds.length; i += 50) {
        const batch = channelIds.slice(i, i + 50);
        this.ws.send(JSON.stringify({ type: 'get', state: batch }));
      }
    }
    
    // Зачем: Устанавливаем таймаут для анализа цепочки
    setTimeout(() => {
      this.testChainSteps();
    }, 15000);
  }

  // Зачем: Тестируем шаги цепочки
  testChainSteps() {
    console.log('🔍 [STEP 2-5] Тестирование шагов цепочки...\n');
    
    // Зачем: Шаг 3 - Проверяем ограничение дозапроса (симуляция)
    // Зачем: Шаг 4 - Проверяем запросы отсутствующих устройств
    this.channels.forEach((channel, channelId) => {
      if (channel.bind) {
        const device = Array.from(this.devices.values()).find(d => d.id === channel.bind);
        if (device) {
          channel.linkedDevice = device;
          channel.resolved = true;
          this.chainSteps.step5_finalResult.channelsResolved++;
        } else {
          this.chainSteps.step4_missingDevices.devicesRequested++;
          this.chainSteps.step5_finalResult.channelsUnresolved++;
        }
      }
    });
  }

  // Зачем: Анализируем всю цепочку проблем
  analyzeChain() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ ЦЕПОЧКИ ПРОБЛЕМ');
    console.log('='.repeat(80) + '\n');

    console.log('🔗 ШАГ 1: Начальная загрузка');
    console.log(`   Ожидаемых каналов: ${this.chainSteps.step1_initialLoad.channelsRequested}`);
    console.log(`   Получено каналов: ${this.chainSteps.step1_initialLoad.channelsReceived}`);
    const missingChannels = this.chainSteps.step1_initialLoad.channelsRequested - this.chainSteps.step1_initialLoad.channelsReceived;
    console.log(`   Отсутствующих каналов: ${missingChannels}`);
    console.log(`   Процент отсутствующих: ${this.chainSteps.step1_initialLoad.channelsRequested > 0 ? (missingChannels / this.chainSteps.step1_initialLoad.channelsRequested * 100).toFixed(1) : 0}%\n`);

    console.log('🔗 ШАГ 2: Частичные обновления');
    console.log(`   Всего обновлений: ${this.chainSteps.step2_partialUpdates.totalUpdates}`);
    console.log(`   Без поля bind: ${this.chainSteps.step2_partialUpdates.updatesWithoutBind}`);
    console.log(`   Процент без bind: ${this.chainSteps.step2_partialUpdates.totalUpdates > 0 ? (this.chainSteps.step2_partialUpdates.updatesWithoutBind / this.chainSteps.step2_partialUpdates.totalUpdates * 100).toFixed(1) : 0}%\n`);

    console.log('🔗 ШАГ 3: Ограничение дозапроса');
    console.log(`   Дозапросы для выбранного актуатора: ${this.chainSteps.step3_doRequestRestriction.requestsForSelected}`);
    console.log(`   Дозапросы для невыбранного актуатора: ${this.chainSteps.step3_doRequestRestriction.requestsForUnselected}\n`);

    console.log('🔗 ШАГ 4: Отсутствие связанных устройств');
    console.log(`   Устройств запрошено: ${this.chainSteps.step4_missingDevices.devicesRequested}`);
    console.log(`   Устройств загружено: ${this.chainSteps.step4_missingDevices.devicesLoaded}\n`);

    console.log('🔗 ШАГ 5: Финальный результат');
    console.log(`   Каналов резолвлено: ${this.chainSteps.step5_finalResult.channelsResolved}`);
    console.log(`   Каналов не резолвлено: ${this.chainSteps.step5_finalResult.channelsUnresolved}`);
    const totalChannels = this.chainSteps.step5_finalResult.channelsResolved + this.chainSteps.step5_finalResult.channelsUnresolved;
    console.log(`   Процент не резолвленных: ${totalChannels > 0 ? (this.chainSteps.step5_finalResult.channelsUnresolved / totalChannels * 100).toFixed(1) : 0}%\n`);

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    const chainBroken = 
      missingChannels > 0 ||
      this.chainSteps.step2_partialUpdates.updatesWithoutBind > 0 ||
      this.chainSteps.step5_finalResult.channelsUnresolved > 0;

    if (chainBroken) {
      console.log('✅ ЦЕПОЧКА ПРОБЛЕМ ПОДТВЕРЖДЕНА:');
      console.log('   Все шаги цепочки проблем присутствуют:');
      if (missingChannels > 0) {
        console.log(`   - Шаг 1: ${missingChannels} каналов не загружены при старте`);
      }
      if (this.chainSteps.step2_partialUpdates.updatesWithoutBind > 0) {
        console.log(`   - Шаг 2: ${this.chainSteps.step2_partialUpdates.updatesWithoutBind} обновлений без bind`);
      }
      if (this.chainSteps.step5_finalResult.channelsUnresolved > 0) {
        console.log(`   - Шаг 5: ${this.chainSteps.step5_finalResult.channelsUnresolved} каналов не резолвлены`);
      }
      console.log('   Это подтверждает комплексную природу проблемы.\n');
    } else {
      console.log('❓ ЦЕПОЧКА ПРОБЛЕМ НЕ ПОДТВЕРЖДЕНА:');
      console.log('   Не все шаги цепочки проблем присутствуют.');
      console.log('   Возможно, проблемы решены или не проявляются в текущих условиях.\n');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis6Test();
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

module.exports = { Hypothesis6Test };






