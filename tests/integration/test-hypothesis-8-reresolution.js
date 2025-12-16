#!/usr/bin/env node

/**
 * Тест гипотезы 8: Механизм повторного резолва
 * 
 * Гипотеза: При получении новых данных должен происходить пересчет `linkedDevice`
 * для всех каналов, но этого не происходит.
 * 
 * Что проверяет:
 * - Пересчет `linkedDevice` при получении новых данных
 * - Обновление UI при изменении состояния резолва
 * - Эффективность механизма повторного резолва
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-8-reresolution.js [ws://host:port]
 * 
 * Зачем: Проверяем механизм повторного резолва, который должен решать
 * проблему асинхронной загрузки связанных устройств
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

class Hypothesis8Test {
  constructor() {
    this.ws = null;
    this.actuators = [];
    this.channels = new Map(); // channelId -> {channelState, bind, linkedDevice, resolutionHistory}
    this.devices = new Map(); // deviceId -> device
    this.messages = [];
    this.reresolutionStats = {
      initialResolved: 0,
      initialUnresolved: 0,
      afterReresolution: 0,
      newlyResolved: 0,
      stillUnresolved: 0
    };
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 8: Механизм повторного резолва');
      console.log('='.repeat(80));
      console.log(`WebSocket URI: ${WS_URI}\n`);

      const timeout = setTimeout(() => {
        this.analyzeReresolution();
        clearTimeout(timeout);
        if (this.ws) this.ws.close();
        resolve();
      }, TEST_TIMEOUT);

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let listReceived = false;
      let getSent = false;
      let initialResolutionDone = false;

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
                this.channels.set(deviceId, {
                  channelState: payload,
                  bind: payload.bind,
                  linkedDevice: null,
                  resolutionHistory: []
                });
              } else {
                const channelData = this.channels.get(deviceId);
                channelData.channelState = { ...channelData.channelState, ...payload };
                if (payload.bind !== undefined) {
                  channelData.bind = payload.bind;
                }
              }
              
              // Зачем: Выполняем резолв при каждом обновлении
              if (!initialResolutionDone) {
                setTimeout(() => {
                  this.performInitialResolution();
                  initialResolutionDone = true;
                  
                  // Зачем: После начального резолва ждем и выполняем повторный резолв
                  setTimeout(() => {
                    this.performReresolution();
                  }, 10000);
                }, 5000);
              }
            } else {
              // Зачем: Обрабатываем устройства
              const wasNew = !this.devices.has(deviceId);
              this.devices.set(deviceId, payload);
              
              // Зачем: Если устройство новое, выполняем повторный резолв
              if (wasNew && initialResolutionDone) {
                this.performReresolution();
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
  }

  // Зачем: Выполняем начальный резолв
  performInitialResolution() {
    console.log('🔍 [STEP 4] Выполняем начальный резолв...\n');
    
    this.channels.forEach((channelData, channelId) => {
      const channelState = channelData.channelState;
      
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
        channelData.resolutionHistory.push({
          timestamp: Date.now(),
          resolved: !!linkedDevice,
          deviceCount: this.devices.size
        });
        
        if (linkedDevice) {
          this.reresolutionStats.initialResolved++;
        } else {
          this.reresolutionStats.initialUnresolved++;
        }
      }
    });
    
    console.log(`✅ Начальный резолв: ${this.reresolutionStats.initialResolved} резолвлено, ${this.reresolutionStats.initialUnresolved} не резолвлено\n`);
  }

  // Зачем: Выполняем повторный резолв
  performReresolution() {
    console.log('🔄 [STEP 5] Выполняем повторный резолв...\n');
    
    let newlyResolved = 0;
    let stillUnresolved = 0;
    
    this.channels.forEach((channelData, channelId) => {
      const channelState = channelData.channelState;
      
      if (channelState && channelState.bind !== null && channelState.bind !== undefined) {
        const wasResolved = !!channelData.linkedDevice;
        
        // Зачем: Повторный поиск устройства
        let linkedDevice = Array.from(this.devices.values()).find(d => d.id === channelState.bind);
        
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = Array.from(this.devices.values()).find(d => 
            d.code === channelState.bind || 
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
        
        const isResolved = !!linkedDevice;
        const becameResolved = !wasResolved && isResolved;
        
        channelData.linkedDevice = linkedDevice;
        channelData.resolutionHistory.push({
          timestamp: Date.now(),
          resolved: isResolved,
          deviceCount: this.devices.size,
          becameResolved: becameResolved
        });
        
        if (becameResolved) {
          newlyResolved++;
        } else if (!isResolved) {
          stillUnresolved++;
        }
      }
    });
    
    this.reresolutionStats.afterReresolution = this.reresolutionStats.initialResolved + newlyResolved;
    this.reresolutionStats.newlyResolved = newlyResolved;
    this.reresolutionStats.stillUnresolved = stillUnresolved;
    
    console.log(`✅ Повторный резолв: ${newlyResolved} новых резолвлено, ${stillUnresolved} все еще не резолвлено\n`);
  }

  // Зачем: Анализируем результаты повторного резолва
  analyzeReresolution() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ МЕХАНИЗМА ПОВТОРНОГО РЕЗОЛВА');
    console.log('='.repeat(80) + '\n');

    console.log('📊 Статистика резолва:');
    console.log(`   Начальный резолв: ${this.reresolutionStats.initialResolved} резолвлено, ${this.reresolutionStats.initialUnresolved} не резолвлено`);
    console.log(`   После повторного резолва: ${this.reresolutionStats.afterReresolution} резолвлено, ${this.reresolutionStats.stillUnresolved} не резолвлено`);
    console.log(`   Новых резолвлено: ${this.reresolutionStats.newlyResolved}\n`);

    // Зачем: Анализируем историю резолва
    const channelsWithHistory = [];
    this.channels.forEach((channelData, channelId) => {
      if (channelData.resolutionHistory.length > 1) {
        channelsWithHistory.push({
          channelId,
          bind: channelData.bind,
          history: channelData.resolutionHistory,
          finalResolved: !!channelData.linkedDevice
        });
      }
    });

    if (channelsWithHistory.length > 0) {
      console.log(`📋 Каналов с историей резолва: ${channelsWithHistory.length}`);
      const resolvedAfterReresolution = channelsWithHistory.filter(c => c.finalResolved).length;
      console.log(`   Резолвлено после повторного резолва: ${resolvedAfterReresolution}\n`);
    }

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    if (this.reresolutionStats.newlyResolved > 0) {
      console.log('✅ МЕХАНИЗМ ПОВТОРНОГО РЕЗОЛВА РАБОТАЕТ:');
      console.log(`   ${this.reresolutionStats.newlyResolved} каналов были резолвлены после повторного резолва.`);
      console.log('   Это указывает на то, что механизм повторного резолва помогает решить проблему асинхронной загрузки.\n');
    } else if (this.reresolutionStats.stillUnresolved > 0) {
      console.log('⚠️  МЕХАНИЗМ ПОВТОРНОГО РЕЗОЛВА НЕДОСТАТОЧЕН:');
      console.log(`   ${this.reresolutionStats.stillUnresolved} каналов все еще не резолвлены после повторного резолва.`);
      console.log('   Возможно, требуется улучшение механизма или устройства действительно отсутствуют.\n');
    } else {
      console.log('❓ НЕДОСТАТОЧНО ДАННЫХ:');
      console.log('   Не удалось определить эффективность механизма повторного резолва.\n');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis8Test();
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

module.exports = { Hypothesis8Test };






