#!/usr/bin/env node

/**
 * Тест гипотезы 4: Асинхронность загрузки связанных устройств
 * 
 * Гипотеза: Устройства, упомянутые в `bind` каналов, могут быть еще
 * не загружены в момент резолва.
 * 
 * Что проверяет:
 * - Количество каналов с `bind`, но без `linkedDevice`
 * - Время между появлением `bind` и загрузкой связанного устройства
 * - Эффективность механизма запроса отсутствующих устройств
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-4-async-linked-devices.js [ws://host:port]
 * 
 * Зачем: Проверяем, что связанные устройства загружаются асинхронно с задержкой,
 * что подтверждает гипотезу проблемы
 */

const WebSocket = require('ws');

// Зачем: Упрощенный класс для тестирования без требования TTY
// Зачем: Симулирует реальную логику из monitor.js для проверки requestMissingDevice
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
    this.missingDeviceRequests = []; // Зачем: Отслеживаем все вызовы requestMissingDevice
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

  requestChannelState(channelId) {
    if (!channelId) return;
    const now = Date.now();
    const last = this.requestedChannelStates.get(channelId) || 0;
    const cooldownMs = 5000;
    if (now - last < cooldownMs) return;
    this.requestedChannelStates.set(channelId, now);
  }

  // Зачем: Реальная логика из monitor.js (строки 1881-1883, 1927-1929, 1956-1958)
  requestMissingDevice(deviceId) {
    if (!deviceId) return;
    if (this.requestedMissingDevices.has(deviceId)) return;
    
    this.requestedMissingDevices.add(deviceId);
    
    // Зачем: Записываем запрос для анализа
    this.missingDeviceRequests.push({
      deviceId,
      timestamp: Date.now(),
      exists: this.allDevices.some(d => d.id === deviceId)
    });
    
    // Зачем: Отправляем реальный запрос
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get', state: [deviceId] }));
    }
  }
  
  // Зачем: Метод для получения каналов актуатора (симуляция getActuatorChannels)
  getActuatorChannels(actuatorId, deviceType) {
    // Зачем: Упрощенная версия для тестирования
    const channels = [];
    // Зачем: Здесь должна быть полная логика из monitor.js, но для теста достаточно проверить вызов requestMissingDevice
    return channels;
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

class Hypothesis4Test {
  constructor() {
    this.ws = null;
    this.display = null;
    this.actuators = [];
    this.channelsWithBind = new Map(); // channelId -> {bind, timestamp, linkedDevice, deviceLoadedAt}
    this.deviceLoadTimes = new Map(); // deviceId -> timestamp
    this.requestedDevices = new Set(); // Зачем: Отслеживаем запрошенные устройства
    this.messages = [];
    this.startTime = Date.now();
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 4: Асинхронность загрузки связанных устройств');
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
      display.ws = ws; // Зачем: Устанавливаем ws для requestMissingDevice

      let listReceived = false;
      let getSent = false;

      // Зачем: Перехватываем отправку сообщений для отслеживания запросов устройств
      const originalSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'get' && Array.isArray(message.state)) {
            message.state.forEach(id => {
              if (!id.includes('/')) {
                // Зачем: Это запрос устройства (не канала)
                this.requestedDevices.add(id);
              }
            });
          }
        } catch (e) {
          // Игнорируем ошибки парсинга
        }
        return originalSend(data);
      };

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
            
            console.log('📤 [STEP 2] Запрашиваем устройства и каналы актуаторов...');
            getSent = true;
            
            // Зачем: Сначала запрашиваем только устройства (без каналов)
            // чтобы симулировать ситуацию, когда каналы загружаются позже
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            // Зачем: Устанавливаем таймаут для запроса каналов
            setTimeout(() => {
              this.requestActuatorChannels(ws);
            }, 5000);
          }

          // Зачем: Обрабатываем ACTION_SET
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const payload = message.payload || {};
            const isChannel = deviceId.includes('/');
            const timestamp = Date.now();
            
            if (isChannel) {
              // Зачем: Обрабатываем каналы
              if (payload.bind !== null && payload.bind !== undefined) {
                if (!this.channelsWithBind.has(deviceId)) {
                  this.channelsWithBind.set(deviceId, {
                    bind: payload.bind,
                    timestamp: timestamp,
                    linkedDevice: null,
                    deviceLoadedAt: null
                  });
                  
                  // Зачем: Симулируем реальную логику из monitor.js (строки 1869-1883)
                  // Проверяем наличие bind и вызываем requestMissingDevice если устройство не найдено
                  const channelState = payload;
                  let linkedDevice = display.allDevices.find(d => d.id === channelState.bind);
                  
                  // Зачем: Если не найдено по ID, пробуем найти по коду или имени
                  if (!linkedDevice && typeof channelState.bind === 'string') {
                    linkedDevice = display.allDevices.find(d => 
                      d.code === channelState.bind || 
                      d.name === channelState.bind ||
                      d.id === channelState.bind
                    );
                  }
                  
                  // Зачем: Если устройство не найдено, запрашиваем через WebSocket (реальная логика)
                  if (!linkedDevice && typeof channelState.bind === 'string') {
                    display.requestMissingDevice(channelState.bind);
                  }
                  
                  // Зачем: Проверяем, загружено ли связанное устройство
                  this.checkLinkedDevice(deviceId, payload.bind, timestamp);
                }
              }
              
              // Зачем: Обновляем состояние в display
              if (display && display.setDeviceState) {
                display.setDeviceState(deviceId, payload);
              }
            } else {
              // Зачем: Обрабатываем устройства
              this.deviceLoadTimes.set(deviceId, timestamp);
              
              // Зачем: Добавляем устройство в allDevices для поиска
              if (!display.allDevices.find(d => d.id === deviceId)) {
                display.allDevices.push({
                  id: deviceId,
                  code: payload.code || null,
                  name: payload.name || payload.title || null,
                  type: payload.type,
                  ...payload
                });
              }
              
              // Зачем: Проверяем, является ли это устройство связанным для какого-то канала
              this.channelsWithBind.forEach((channelData, channelId) => {
                if (channelData.bind === deviceId && !channelData.linkedDevice) {
                  channelData.linkedDevice = { id: deviceId, ...payload };
                  channelData.deviceLoadedAt = timestamp;
                }
              });
              
              // Зачем: Обновляем состояние в display
              if (display && display.setDeviceState) {
                display.setDeviceState(deviceId, payload);
              }
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
    
    // Зачем: Собираем данные устройств из сообщений
    this.messages.forEach(msg => {
      if ((msg.type === 'action_set' || msg.type === 'ACTION_SET') && msg.id && !msg._context) {
        const deviceId = msg.id;
        if (!deviceId.includes('/')) {
          deviceDataMap.set(deviceId, msg.payload || {});
        }
      }
    });

    // Зачем: Определяем актуаторы и запрашиваем их каналы
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

          // Зачем: Вычисляем каналы для этого актуатора
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

    // Зачем: Запрашиваем каналы батчами
    if (channelIds.length > 0) {
      for (let i = 0; i < channelIds.length; i += 50) {
        const batch = channelIds.slice(i, i + 50);
        ws.send(JSON.stringify({ type: 'get', state: batch }));
      }
      console.log(`   Запрошено ${channelIds.length} каналов от ${this.actuators.length} актуаторов\n`);
    }
  }

  // Зачем: Проверяем, загружено ли связанное устройство
  checkLinkedDevice(channelId, bindValue, timestamp) {
    // Зачем: Проверяем, загружено ли устройство уже
    if (this.deviceLoadTimes.has(bindValue)) {
      const deviceLoadTime = this.deviceLoadTimes.get(bindValue);
      const channelData = this.channelsWithBind.get(channelId);
      if (channelData) {
        channelData.deviceLoadedAt = deviceLoadTime;
        // Зачем: Устройство уже было загружено до появления bind
      }
    } else {
      // Зачем: Устройство еще не загружено - проверяем, запрошено ли оно
      if (!this.requestedDevices.has(bindValue)) {
        // Зачем: Устройство не было запрошено - это проблема асинхронности
      }
    }
  }

  // Зачем: Анализируем результаты теста
  analyzeResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ');
    console.log('='.repeat(80) + '\n');

    console.log(`📋 Каналов с bind: ${this.channelsWithBind.size}\n`);

    if (this.channelsWithBind.size === 0) {
      console.log('⚠️  Не найдено каналов с bind.');
      console.log('   Возможные причины:');
      console.log('   - Каналы не были загружены');
      console.log('   - Каналы не имеют привязок');
      console.log('   - Недостаточно времени для загрузки\n');
      return;
    }

    // Зачем: Анализируем резолв связанных устройств
    let channelsWithLinkedDevice = 0;
    let channelsWithoutLinkedDevice = 0;
    const delays = []; // Зачем: Задержки между появлением bind и загрузкой устройства

    this.channelsWithBind.forEach((channelData, channelId) => {
      if (channelData.linkedDevice) {
        channelsWithLinkedDevice++;
        if (channelData.deviceLoadedAt && channelData.deviceLoadedAt > channelData.timestamp) {
          const delay = channelData.deviceLoadedAt - channelData.timestamp;
          delays.push(delay);
        }
      } else {
        channelsWithoutLinkedDevice++;
      }
    });

    console.log('📊 Статистика резолва связанных устройств:');
    console.log(`   Каналов с linkedDevice: ${channelsWithLinkedDevice} (${(channelsWithLinkedDevice / this.channelsWithBind.size * 100).toFixed(1)}%)`);
    console.log(`   Каналов без linkedDevice: ${channelsWithoutLinkedDevice} (${(channelsWithoutLinkedDevice / this.channelsWithBind.size * 100).toFixed(1)}%)\n`);

    if (delays.length > 0) {
      const avgDelay = delays.reduce((sum, d) => sum + d, 0) / delays.length;
      const maxDelay = Math.max(...delays);
      const minDelay = Math.min(...delays);
      
      console.log('📊 Задержки загрузки связанных устройств:');
      console.log(`   Средняя задержка: ${avgDelay.toFixed(0)} мс (${(avgDelay / 1000).toFixed(1)} сек)`);
      console.log(`   Минимальная задержка: ${minDelay.toFixed(0)} мс`);
      console.log(`   Максимальная задержка: ${maxDelay.toFixed(0)} мс (${(maxDelay / 1000).toFixed(1)} сек)`);
      console.log(`   Количество с задержкой: ${delays.length}\n`);
    }

    // Зачем: Проверяем вызовы requestMissingDevice (реальная логика из monitor.js)
    const missingDeviceRequests = this.display?.missingDeviceRequests || [];
    console.log('📊 Статистика вызовов requestMissingDevice:');
    console.log(`   Всего вызовов: ${missingDeviceRequests.length}`);
    const requestsForExisting = missingDeviceRequests.filter(r => r.exists).length;
    const requestsForMissing = missingDeviceRequests.filter(r => !r.exists).length;
    console.log(`   Для существующих устройств: ${requestsForExisting}`);
    console.log(`   Для отсутствующих устройств: ${requestsForMissing}\n`);
    
    if (missingDeviceRequests.length > 0) {
      console.log('📌 Примеры вызовов requestMissingDevice (первые 10):');
      missingDeviceRequests.slice(0, 10).forEach((req, index) => {
        console.log(`   ${index + 1}. ${req.deviceId}`);
        console.log(`      Устройство существовало: ${req.exists ? '✅' : '❌'}`);
      });
      if (missingDeviceRequests.length > 10) {
        console.log(`   ... и еще ${missingDeviceRequests.length - 10} вызовов`);
      }
      console.log('');
    }

    // Зачем: Анализируем каналы без linkedDevice
    const unresolvedChannels = [];
    this.channelsWithBind.forEach((channelData, channelId) => {
      if (!channelData.linkedDevice) {
        const wasRequested = this.requestedDevices.has(channelData.bind);
        unresolvedChannels.push({
          channelId,
          bind: channelData.bind,
          wasRequested,
          timeSinceBind: Date.now() - channelData.timestamp
        });
      }
    });

    if (unresolvedChannels.length > 0) {
      console.log(`⚠️  Каналы без linkedDevice (первые 10):`);
      unresolvedChannels.slice(0, 10).forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.channelId}`);
        console.log(`      bind: ${item.bind}`);
        console.log(`      Запрошено: ${item.wasRequested ? '✅' : '❌'}`);
        console.log(`      Время с момента bind: ${(item.timeSinceBind / 1000).toFixed(1)} сек`);
      });
      if (unresolvedChannels.length > 10) {
        console.log(`   ... и еще ${unresolvedChannels.length - 10} каналов`);
      }
      console.log('');
    }

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    const unresolvedPercent = (channelsWithoutLinkedDevice / this.channelsWithBind.size * 100);
    
    if (unresolvedPercent > 20) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log(`   ${unresolvedPercent.toFixed(1)}% каналов с bind не имеют linkedDevice.`);
      console.log('   Это подтверждает проблему: связанные устройства загружаются асинхронно с задержкой.\n');
    } else if (unresolvedPercent > 5) {
      console.log('⚠️  ГИПОТЕЗА ЧАСТИЧНО ПОДТВЕРЖДЕНА:');
      console.log(`   ${unresolvedPercent.toFixed(1)}% каналов с bind не имеют linkedDevice.`);
      console.log('   Проблема существует, но не критична.\n');
    } else {
      console.log('❓ ГИПОТЕЗА НЕ ПОДТВЕРЖДЕНА:');
      console.log(`   Только ${unresolvedPercent.toFixed(1)}% каналов с bind не имеют linkedDevice.`);
      console.log('   Возможно, проблема решена или не проявляется в текущих условиях.\n');
    }

    if (delays.length > 0 && delays.some(d => d > 1000)) {
      console.log(`📌 Дополнительно: Наблюдаются задержки загрузки связанных устройств.`);
      console.log(`   Это указывает на асинхронность загрузки.\n`);
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis4Test();
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

module.exports = { Hypothesis4Test };






