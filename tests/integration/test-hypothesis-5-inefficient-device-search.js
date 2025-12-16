#!/usr/bin/env node

/**
 * Тест гипотезы 5: Неэффективный поиск связанных устройств
 * 
 * Гипотеза: Поиск устройства по `bind` выполняется только по точному совпадению `id`,
 * без учета возможных вариантов формата.
 * 
 * Что проверяет:
 * - Случаи, когда `bind` не совпадает с `id`, но устройство существует
 * - Эффективность fallback поиска по `code` и `name`
 * - Форматы `bind` и `id`, которые не совпадают
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-5-inefficient-device-search.js [ws://host:port]
 * 
 * Зачем: Проверяем, что поиск не находит устройства при несовпадении форматов,
 * что подтверждает гипотезу проблемы
 */

const WebSocket = require('ws');

// Зачем: Упрощенный класс для тестирования без требования TTY
class TestDisplay {
  constructor() {
    this.deviceStates = new Map();
    this.allDevices = [];
    this.devices = [];
    this.selectedIndex = -1;
    this.requestedMissingDevices = new Set();
    this.requestedChannelStates = new Map();
    this.wsUpdateCount = 0;
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

class Hypothesis5Test {
  constructor() {
    this.ws = null;
    this.display = null;
    this.allDevices = []; // Зачем: Все устройства для поиска
    this.channelsWithBind = []; // Зачем: Каналы с bind для проверки поиска
    this.searchResults = []; // Зачем: Результаты поиска для анализа
    this.messages = [];
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 5: Неэффективный поиск связанных устройств');
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
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            // Зачем: Устанавливаем таймаут для запроса каналов
            setTimeout(() => {
              this.requestActuatorChannels(ws);
            }, 10000);
          }

          // Зачем: Обрабатываем ACTION_SET
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const payload = message.payload || {};
            const isChannel = deviceId.includes('/');
            
            if (isChannel) {
              // Зачем: Обрабатываем каналы
              if (payload.bind !== null && payload.bind !== undefined) {
                this.channelsWithBind.push({
                  channelId: deviceId,
                  bind: payload.bind,
                  channelState: payload
                });
              }
              
              // Зачем: Обновляем состояние в display
              if (display && display.setDeviceState) {
                display.setDeviceState(deviceId, payload);
              }
            } else {
              // Зачем: Обрабатываем устройства
              this.allDevices.push({
                id: deviceId,
                code: payload.code || null,
                name: payload.name || payload.title || null,
                type: payload.type,
                payload: payload
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
      console.log(`   Запрошено ${channelIds.length} каналов\n`);
      
      // Зачем: Устанавливаем таймаут для анализа результатов
      setTimeout(() => {
        this.testSearch();
      }, 10000);
    }
  }

  // Зачем: Тестируем поиск устройств (реальная логика из monitor.js строки 1871-1878)
  testSearch() {
    console.log('🔍 [STEP 4] Тестирование поиска устройств...\n');
    
    // Зачем: Обновляем allDevices в display для тестирования
    if (this.display) {
      this.display.allDevices = this.allDevices;
    }
    
    this.channelsWithBind.forEach(channel => {
      const bindValue = channel.bind;
      const channelState = channel.channelState;
      
      // Зачем: Реальная логика поиска из monitor.js (строки 1869-1883)
      let linkedDevice = null;
      
      // Зачем: Проверяем наличие bind в channelState
      if (channelState && channelState.bind !== null && channelState.bind !== undefined) {
        // Зачем: bind в канале актуатора содержит ID потребителя (UUID)
        linkedDevice = this.display.allDevices.find(d => d.id === channelState.bind);
        
        // Зачем: Если не найдено по ID, пробуем найти по коду или имени (fallback)
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.display.allDevices.find(d => 
            d.code === channelState.bind || 
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
      }
      
      // Зачем: Проверяем, существует ли устройство с таким bind (любым способом)
      const deviceExists = this.allDevices.some(d => 
        d.id === bindValue || 
        d.code === bindValue || 
        d.name === bindValue
      );
      
      // Зачем: Проверяем различные форматы
      const formatAnalysis = this.analyzeFormat(bindValue);
      
      // Зачем: Проверяем, был ли найден через fallback
      const foundById = this.allDevices.find(d => d.id === bindValue);
      const foundByFallback = !foundById && linkedDevice && linkedDevice.id !== bindValue;
      
      this.searchResults.push({
        channelId: channel.channelId,
        bind: bindValue,
        foundById: !!foundById,
        foundByFallback: foundByFallback,
        deviceExists: deviceExists,
        formatAnalysis: formatAnalysis,
        linkedDevice: linkedDevice,
        searchWorked: !!linkedDevice
      });
    });
  }

  // Зачем: Анализируем формат bind
  analyzeFormat(bindValue) {
    if (typeof bindValue !== 'string') {
      return { type: 'non-string', normalized: null };
    }
    
    // Зачем: Проверяем различные форматы
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bindValue);
    const isMac = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(bindValue);
    const hasSlash = bindValue.includes('/');
    const isShort = bindValue.length < 8;
    
    return {
      type: isUuid ? 'uuid' : isMac ? 'mac' : hasSlash ? 'path' : isShort ? 'short' : 'other',
      normalized: bindValue.toLowerCase(),
      original: bindValue
    };
  }

  // Зачем: Анализируем результаты теста
  analyzeResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ');
    console.log('='.repeat(80) + '\n');

    console.log(`📋 Всего каналов с bind: ${this.channelsWithBind.length}`);
    console.log(`📋 Всего устройств: ${this.allDevices.length}`);
    console.log(`📋 Результатов поиска: ${this.searchResults.length}\n`);

    if (this.searchResults.length === 0) {
      console.log('⚠️  Не найдено каналов с bind для тестирования.\n');
      return;
    }

    // Зачем: Анализируем результаты поиска
    let foundById = 0;
    let foundByFallback = 0;
    let notFoundButExists = 0;
    let notFoundAndNotExists = 0;
    const formatStats = new Map();

    this.searchResults.forEach(result => {
      if (result.foundById) {
        foundById++;
      } else if (result.foundByFallback) {
        foundByFallback++;
      } else if (result.deviceExists) {
        notFoundButExists++;
      } else {
        notFoundAndNotExists++;
      }
      
      // Зачем: Собираем статистику по форматам
      const formatType = result.formatAnalysis.type;
      if (!formatStats.has(formatType)) {
        formatStats.set(formatType, { total: 0, found: 0, notFound: 0 });
      }
      const stats = formatStats.get(formatType);
      stats.total++;
      if (result.foundById || result.foundByFallback) {
        stats.found++;
      } else {
        stats.notFound++;
      }
    });

    console.log('📊 Статистика поиска:');
    console.log(`   Найдено по id: ${foundById} (${(foundById / this.searchResults.length * 100).toFixed(1)}%)`);
    console.log(`   Найдено по fallback: ${foundByFallback} (${(foundByFallback / this.searchResults.length * 100).toFixed(1)}%)`);
    console.log(`   Не найдено, но устройство существует: ${notFoundButExists} (${(notFoundButExists / this.searchResults.length * 100).toFixed(1)}%)`);
    console.log(`   Не найдено и устройство не существует: ${notFoundAndNotExists} (${(notFoundAndNotExists / this.searchResults.length * 100).toFixed(1)}%)\n`);

    // Зачем: Анализируем форматы
    console.log('📊 Статистика по форматам bind:');
    formatStats.forEach((stats, formatType) => {
      const foundPercent = (stats.found / stats.total * 100).toFixed(1);
      console.log(`   ${formatType}: ${stats.total} случаев, найдено: ${stats.found} (${foundPercent}%)`);
    });
    console.log('');

    // Зачем: Показываем примеры проблемных случаев
    const problematicCases = this.searchResults.filter(r => 
      !r.foundById && !r.foundByFallback && r.deviceExists
    );

    if (problematicCases.length > 0) {
      console.log(`⚠️  Проблемные случаи (устройство существует, но не найдено): ${problematicCases.length}`);
      problematicCases.slice(0, 10).forEach((item, index) => {
        console.log(`   ${index + 1}. Канал: ${item.channelId}`);
        console.log(`      bind: ${item.bind}`);
        console.log(`      Формат: ${item.formatAnalysis.type}`);
        
        // Зачем: Пытаемся найти устройство вручную
        const possibleMatches = this.allDevices.filter(d => 
          d.id.toLowerCase() === item.bind.toLowerCase() ||
          (d.code && d.code.toLowerCase() === item.bind.toLowerCase()) ||
          (d.name && d.name.toLowerCase() === item.bind.toLowerCase())
        );
        
        if (possibleMatches.length > 0) {
          console.log(`      Возможные совпадения: ${possibleMatches.map(d => d.id).join(', ')}`);
        }
      });
      if (problematicCases.length > 10) {
        console.log(`   ... и еще ${problematicCases.length - 10} случаев`);
      }
      console.log('');
    }

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    const problematicPercent = (notFoundButExists / this.searchResults.length * 100);
    
    if (problematicPercent > 5) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log(`   ${problematicPercent.toFixed(1)}% каналов имеют bind, который не находится поиском,`);
      console.log('   хотя устройство существует.');
      console.log('   Это подтверждает проблему: поиск неэффективен при несовпадении форматов.\n');
    } else if (problematicPercent > 0) {
      console.log('⚠️  ГИПОТЕЗА ЧАСТИЧНО ПОДТВЕРЖДЕНА:');
      console.log(`   ${problematicPercent.toFixed(1)}% каналов имеют проблему с поиском.`);
      console.log('   Проблема существует, но не критична.\n');
    } else {
      console.log('❓ ГИПОТЕЗА НЕ ПОДТВЕРЖДЕНА:');
      console.log('   Все устройства с bind успешно находятся.');
      console.log('   Возможно, проблема решена или не проявляется в текущих условиях.\n');
    }

    if (foundByFallback > 0) {
      console.log(`📌 Дополнительно: Fallback поиск помог найти ${foundByFallback} устройств.`);
      console.log('   Это указывает на то, что fallback работает, но может быть недостаточным.\n');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis5Test();
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

module.exports = { Hypothesis5Test };






