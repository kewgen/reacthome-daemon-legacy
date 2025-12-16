#!/usr/bin/env node

/**
 * Тест гипотезы 1: Каналы не запрашиваются при начальной загрузке
 * 
 * Гипотеза: При старте monitor.js выполняется массовый GET для всех устройств,
 * но каналы актуаторов не включаются в этот запрос.
 * 
 * Что проверяет:
 * - Массовый GET при старте не содержит каналов актуаторов
 * - Каналы не загружаются автоматически
 * - Состояния каналов (включая bind) отсутствуют после начальной загрузки
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-1-channels-not-initial-load.js [ws://host:port]
 * 
 * Зачем: Проверяем, что каналы актуаторов действительно не запрашиваются
 * при начальной загрузке, что подтверждает гипотезу проблемы
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || process.argv[2] || 'ws://192.168.88.4:3000';
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT) || 30000;

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

class Hypothesis1Test {
  constructor() {
    this.ws = null;
    this.devices = [];
    this.actuators = [];
    this.expectedChannels = new Map(); // actuatorId -> Set<channelId>
    this.requestedIds = new Set(); // Зачем: Отслеживаем все запрошенные ID
    this.receivedChannels = new Set(); // Зачем: Отслеживаем полученные каналы
    this.messages = [];
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 1: Каналы не запрашиваются при начальной загрузке');
      console.log('='.repeat(80));
      console.log(`WebSocket URI: ${WS_URI}\n`);

      const timeout = setTimeout(() => {
        this.analyzeResults();
        clearTimeout(timeout);
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

          // Зачем: Обрабатываем LIST
          if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
            listReceived = true;
            const stateList = message.state || [];
            const deviceIds = stateList.map(([id]) => id).filter(Boolean);
            
            console.log(`✅ [STEP 1] Получен LIST: ${deviceIds.length} устройств\n`);
            
            // Зачем: Отправляем GET для всех устройств (симулируем начальную загрузку)
            console.log('📤 [STEP 2] Отправляем массовый GET (как при начальной загрузке monitor.js)...');
            console.log(`   Запрашиваем ${deviceIds.length} устройств (БЕЗ каналов)`);
            
            // Зачем: Сохраняем запрошенные ID
            deviceIds.forEach(id => this.requestedIds.add(id));
            
            getSent = true;
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            // Зачем: Устанавливаем таймаут для анализа результатов
            setTimeout(() => {
              this.processDevices(deviceIds);
              setTimeout(() => {
                this.analyzeResults();
                clearTimeout(timeout);
                ws.close();
                resolve();
              }, 2000);
            }, 10000); // Зачем: Даем время на получение всех ответов
          }

          // Зачем: Обрабатываем ACTION_SET для отслеживания полученных данных
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id && !message._context) {
            const deviceId = message.id;
            const isChannel = deviceId.includes('/');
            
            if (isChannel) {
              this.receivedChannels.add(deviceId);
            }
          }
        } catch (error) {
          console.error('Ошибка обработки сообщения:', error);
        }
      });
    });
  }

  // Зачем: Обрабатываем полученные устройства и определяем ожидаемые каналы
  processDevices(deviceIds) {
    console.log('\n📊 [STEP 3] Обработка полученных устройств...\n');
    
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

    // Зачем: Определяем актуаторы и их ожидаемые каналы
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

          // Зачем: Вычисляем ожидаемые каналы для этого актуатора
          const channelTypes = channelConfig.types;
          const channelCount = channelConfig.count;
          const expectedChannels = new Set();
          
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
            expectedChannels.add(`${deviceId}/do/${i}`);
          }
          for (let i = 1; i <= dimCount; i++) {
            expectedChannels.add(`${deviceId}/dim/${i}`);
          }
          for (let i = 1; i <= aoCount; i++) {
            expectedChannels.add(`${deviceId}/ao/${i}`);
          }
          
          this.expectedChannels.set(deviceId, expectedChannels);
        }
      }
    });

    console.log(`✅ Найдено актуаторов: ${this.actuators.length}`);
    const totalExpectedChannels = Array.from(this.expectedChannels.values())
      .reduce((sum, channels) => sum + channels.size, 0);
    console.log(`✅ Ожидаемых каналов: ${totalExpectedChannels}`);
  }

  // Зачем: Анализируем результаты теста
  analyzeResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ');
    console.log('='.repeat(80) + '\n');

    // Зачем: Проверяем, были ли каналы в массовом GET
    const channelsInRequest = Array.from(this.requestedIds).filter(id => id.includes('/'));
    const channelsReceived = Array.from(this.receivedChannels);
    
    console.log('🔍 Проверка массового GET:');
    console.log(`   Запрошенных ID: ${this.requestedIds.size}`);
    console.log(`   Каналов в запросе: ${channelsInRequest.length}`);
    console.log(`   Получено каналов: ${channelsReceived.length}\n`);

    // Зачем: Проверяем каждый актуатор
    let totalExpected = 0;
    let totalMissing = 0;
    const missingChannelsByActuator = [];

    this.actuators.forEach(actuator => {
      const expected = this.expectedChannels.get(actuator.id);
      if (expected) {
        const missing = Array.from(expected).filter(ch => !this.receivedChannels.has(ch));
        totalExpected += expected.size;
        totalMissing += missing.length;
        
        if (missing.length > 0) {
          missingChannelsByActuator.push({
            actuator: actuator.name || actuator.id,
            type: `0x${actuator.type.toString(16)}`,
            expected: expected.size,
            missing: missing.length,
            missingChannels: missing.slice(0, 5) // Зачем: Показываем первые 5 для примера
          });
        }
      }
    });

    console.log('📋 Статистика по актуаторам:');
    console.log(`   Всего актуаторов: ${this.actuators.length}`);
    console.log(`   Ожидаемых каналов: ${totalExpected}`);
    console.log(`   Отсутствующих каналов: ${totalMissing}`);
    console.log(`   Процент отсутствующих: ${totalExpected > 0 ? ((totalMissing / totalExpected) * 100).toFixed(1) : 0}%\n`);

    if (missingChannelsByActuator.length > 0) {
      console.log('⚠️  Актуаторы с отсутствующими каналами (первые 10):');
      missingChannelsByActuator.slice(0, 10).forEach(item => {
        console.log(`   ${item.actuator} (${item.type}):`);
        console.log(`     Ожидалось: ${item.expected}, отсутствует: ${item.missing}`);
        if (item.missingChannels.length > 0) {
          console.log(`     Примеры: ${item.missingChannels.join(', ')}${item.missing > 5 ? '...' : ''}`);
        }
      });
      console.log('');
    }

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    if (channelsInRequest.length === 0 && totalMissing > 0) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log('   Каналы актуаторов НЕ были включены в массовый GET при начальной загрузке.');
      console.log(`   ${totalMissing} из ${totalExpected} ожидаемых каналов не были запрошены.`);
      console.log('   Это подтверждает проблему: каналы не загружаются автоматически.\n');
    } else if (channelsInRequest.length > 0) {
      console.log('⚠️  ГИПОТЕЗА ЧАСТИЧНО ОПРОВЕРГНУТА:');
      console.log(`   В массовом GET были запрошены ${channelsInRequest.length} каналов.`);
      console.log('   Однако это может быть из-за других механизмов загрузки.\n');
    } else {
      console.log('❓ НЕДОСТАТОЧНО ДАННЫХ:');
      console.log('   Не удалось определить, были ли каналы запрошены.\n');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis1Test();
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

module.exports = { Hypothesis1Test };






