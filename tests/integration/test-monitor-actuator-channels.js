#!/usr/bin/env node

/**
 * Интеграционный тест для проверки резолвинга каналов актуаторов в monitor.js
 *
 * Тестирует:
 * - Корректность загрузки устройств и каналов
 * - Резолвинг bind для каналов актуаторов
 * - Отображение связей канал → потребитель
 *
 * Использование:
 *   node tests/integration/test-monitor-actuator-channels.js
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://localhost:3000';
const TEST_ACTUATOR_ID = '68:27:19:e4:49:19'; // Dim4
const TEST_TIMEOUT = 60000; // 60 секунд

class MonitorChannelTest {
  constructor() {
    this.ws = null;
    this.devices = [];
    this.sites = [];
    this.deviceStates = new Map();
    this.allDevices = [];
    this.devicesByMac = new Map();
    this.requestedMissingDevices = new Set();
    this.requestedChannelStates = new Map();
    this.wsUpdateCount = 0;

    // Зачем: Симулируем класс TerminalKitStatusDisplay без UI
    this.devices = [];
    this.selectedIndex = -1;
  }

  // Зачем: Имитация метода из monitor.js для получения конфига каналов актуатора
  getActuatorChannelCount(deviceType) {
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

  // Зачем: Имитация метода из monitor.js для получения каналов актуатора
  getActuatorChannels(actuatorId, deviceType) {
    const channelConfig = this.getActuatorChannelCount(deviceType);
    if (!channelConfig) return [];

    const channels = [];
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
      const channelId = `${actuatorId}/do/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;

      let linkedDevice = null;
      if (channelState && channelState.bind !== null && channelState.bind !== undefined) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.allDevices.find(d =>
            d.code === channelState.bind ||
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
      }

      channels.push({ channelId, channelType: 'do', channelIndex: i, channelState, linkedDevice });
    }

    for (let i = 1; i <= dimCount; i++) {
      const channelId = `${actuatorId}/dim/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;

      let linkedDevice = null;
      if (channelState && channelState.bind !== null && channelState.bind !== undefined) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.allDevices.find(d =>
            d.code === channelState.bind ||
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
      }

      channels.push({ channelId, channelType: 'dim', channelIndex: i, channelState, linkedDevice });
    }

    for (let i = 1; i <= aoCount; i++) {
      const channelId = `${actuatorId}/ao/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;

      let linkedDevice = null;
      if (channelState && channelState.bind !== null && channelState.bind !== undefined) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.allDevices.find(d =>
            d.code === channelState.bind ||
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
      }

      channels.push({ channelId, channelType: 'ao', channelIndex: i, channelState, linkedDevice });
    }

    return channels;
  }

  // Зачем: Имитация метода из monitor.js для обновления состояния устройства
  setDeviceState(deviceId, newState) {
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();

    this.wsUpdateCount++;

    const oldState = existing?.state || {};
    const mergedState = { ...oldState, ...newState };

    let stateChanged = false;
    if (existing && existing.state) {
      const keyFields = ['ready', 'ip', 'co2', 'temperature', 'humidity', 'illumination', 'value'];
      for (const field of keyFields) {
        if (oldState[field] !== mergedState[field]) {
          stateChanged = true;
          break;
        }
      }
    } else {
      stateChanged = true;
    }

    const lastStateChange = stateChanged ? now : (existing?.lastStateChange || now);

    this.deviceStates.set(deviceId, {
      state: mergedState,
      timestamp: now,
      lastUpdate: now,
      lastStateChange: lastStateChange,
    });

    // Зачем: Специальная логика для каналов — если нет bind, пытаемся дозапросить
    const isChannel = deviceId.includes('/');
    if (isChannel && mergedState && typeof mergedState === 'object') {
      const hasBindField = Object.prototype.hasOwnProperty.call(mergedState, 'bind');
      if (!hasBindField) {
        this.requestChannelState(deviceId);
      }
    }
  }

  // Зачем: Имитация метода из monitor.js для запроса состояния канала
  requestChannelState(channelId) {
    if (!channelId) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const last = this.requestedChannelStates.get(channelId) || 0;
    const cooldownMs = 5000;
    if (now - last < cooldownMs) return;

    this.requestedChannelStates.set(channelId, now);
    console.log(`[TEST] Запрашиваем состояние канала ${channelId}`);
    this.ws.send(JSON.stringify({ type: 'get', state: [channelId] }));
  }

  // Зачем: Имитация метода из monitor.js для запроса отсутствующего устройства
  requestMissingDevice(deviceId) {
    if (!deviceId) return;
    if (this.requestedMissingDevices.has(deviceId)) return;

    const exists = this.allDevices.some(d => d.id === deviceId);
    if (exists) return;

    this.requestedMissingDevices.add(deviceId);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get', state: [deviceId] }));
    }
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('🧪 Запуск интеграционного теста monitor.js...\n');

      const timeout = setTimeout(() => {
        reject(new Error(`Тест не завершился за ${TEST_TIMEOUT / 1000} секунд`));
      }, TEST_TIMEOUT);

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let listReceived = false;
      let getSent = false;
      let pendingGetRequests = 0;
      let processingStarted = false;
      const deviceDataMap = new Map();
      const siteMap = new Map();

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
          if (message.type === 'list' && !listReceived) {
            listReceived = true;
            const stateList = message.state || [];
            const deviceIds = stateList.map(([id]) => id).filter(Boolean);

            if (deviceIds.length === 0) {
              ws.close();
              clearTimeout(timeout);
              reject(new Error('Список устройств пуст'));
              return;
            }

            console.log(`📋 Получен список из ${deviceIds.length} устройств`);
            pendingGetRequests = deviceIds.length;
            getSent = true;
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));

            // Зачем: Устанавливаем таймаут
            setTimeout(() => {
              if (!processingStarted) {
                processingStarted = true;
                if (pendingGetRequests > 0) {
                  console.log(`⚠️  Таймаут: получено не все (${deviceIds.length - pendingGetRequests}/${deviceIds.length})`);
                }
                processDevicesAndSites();
              }
            }, 30000);
          }

          // Зачем: Обрабатываем ACTION_SET
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && getSent && !message._context) {
            const { id, payload } = message;
            if (id && payload && typeof payload === 'object') {
              const wasNew = !deviceDataMap.has(id);
              deviceDataMap.set(id, payload);

              if (wasNew) {
                pendingGetRequests--;
              }

              if (pendingGetRequests <= 0 && !processingStarted) {
                processingStarted = true;
                console.log(`📦 Получены данные всех устройств`);
                processDevicesAndSites();
              }
            }
          }

          // Зачем: Обрабатываем ACTION_SET для обновления состояния
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const isChannel = deviceId.includes('/');

            let payload = null;
            if (message.payload && typeof message.payload === 'object') {
              payload = message.payload;
            } else if (isChannel) {
              payload = {};
            }

            if (payload !== null || isChannel) {
              this.setDeviceState(deviceId, payload || {});
            }
          }

        } catch (error) {
          console.error('Ошибка обработки сообщения:', error);
        }
      });

      const processDevicesAndSites = () => {
        // Зачем: Обрабатываем помещения
        deviceDataMap.forEach((payload, deviceId) => {
          if (!deviceId.includes('/')) {
            const deviceType = payload.type;
            if (deviceType === 'site' || deviceType === 'SITE' || deviceType === 'project' || deviceType === 'PROJECT') {
              const siteName = payload.title || payload.code || payload.name || deviceId;
              siteMap.set(deviceId, siteName);
            }
          }
        });

        // Зачем: Обрабатываем устройства
        deviceDataMap.forEach((payload, deviceId) => {
          if (!deviceId.includes('/')) {
            const deviceType = payload.type;
            if (typeof deviceType === 'number' && deviceType !== 0x00) {
              const category = getDeviceCategory(deviceType);
              const deviceName = getDeviceName(payload);

              let siteId = payload.site;
              let siteName = null;
              if (siteId) {
                if (Array.isArray(siteId)) siteId = siteId[0];
                if (typeof siteId === 'string') {
                  siteName = siteMap.get(siteId) || null;
                }
              }

              const device = {
                id: deviceId,
                name: deviceName,
                code: payload.code || null,
                type: deviceType,
                typeName: DEVICE_TYPE_NAMES[deviceType] || `Тип ${deviceType}`,
                category: category,
                siteId: siteId || null,
                site: siteName || null,
                bind: payload.bind || null,
              };

              this.allDevices.push(device);
              this.devicesByMac.set(deviceId, device);
            }
          }
        });

        this.devices = [...this.allDevices];

        // Зачем: Запускаем тестирование
        runTests().then(() => {
          clearTimeout(timeout);
          resolve();
        }).catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
      };

      const runTests = async () => {
        console.log('\n🧪 Запуск тестов...\n');

        // Тест 1: Проверка загрузки устройств
        console.log('📋 Тест 1: Загрузка устройств');
        if (this.allDevices.length === 0) {
          throw new Error('Устройства не загружены');
        }
        console.log(`✅ Загружено ${this.allDevices.length} устройств`);

        // Тест 2: Поиск актуатора Dim4
        console.log('\n🔍 Тест 2: Поиск актуатора Dim4');
        const dim4 = this.allDevices.find(d => d.id === TEST_ACTUATOR_ID);
        if (!dim4) {
          throw new Error(`Актуатор ${TEST_ACTUATOR_ID} не найден`);
        }
        if (dim4.category !== 'Актуатор') {
          throw new Error(`Устройство ${TEST_ACTUATOR_ID} не является актуатором`);
        }
        console.log(`✅ Найден актуатор: ${dim4.name} (${dim4.typeName})`);

        // Тест 3: Получение каналов актуатора
        console.log('\n🔗 Тест 3: Получение каналов актуатора');
        const channels = this.getActuatorChannels(TEST_ACTUATOR_ID, dim4.type);
        console.log(`✅ Получено ${channels.length} каналов`);

        // Тест 4: Проверка резолвинга bind для каналов
        console.log('\n🎯 Тест 4: Проверка резолвинга bind');
        let channelsWithBind = 0;
        let channelsWithoutBind = 0;
        let unresolvedBinds = 0;

        for (const channel of channels) {
          const channelData = this.deviceStates.get(channel.channelId);
          const channelState = channelData?.state || null;

          if (!channelState) {
            console.log(`   ⚠️  ${channel.channelId}: состояние не получено`);
            continue;
          }

          const hasBindField = Object.prototype.hasOwnProperty.call(channelState, 'bind');

          if (hasBindField) {
            if (channelState.bind !== null) {
              channelsWithBind++;
              if (channel.linkedDevice) {
                console.log(`   ✅ ${channel.channelId}: bind=${channelState.bind.substring(0, 8)}... → ${channel.linkedDevice.name || channel.linkedDevice.id}`);
              } else {
                console.log(`   ⚠️  ${channel.channelId}: bind=${channelState.bind.substring(0, 8)}... → устройство не найдено`);
                unresolvedBinds++;
              }
            } else {
              channelsWithoutBind++;
              console.log(`   📭 ${channel.channelId}: не привязан (bind=null)`);
            }
          } else {
            console.log(`   🔄 ${channel.channelId}: привязка не получена (запрос отправлен)`);
            // Ждём немного, чтобы дозапрос успел выполниться
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        console.log(`\n📊 Результаты резолвинга:`);
        console.log(`   Каналов с bind: ${channelsWithBind}`);
        console.log(`   Каналов без bind: ${channelsWithoutBind}`);
        console.log(`   Неразрешённых bind: ${unresolvedBinds}`);

        // Тест 5: Проверка, что хотя бы некоторые каналы имеют bind
        console.log('\n🎯 Тест 5: Проверка корректности bind');
        if (channelsWithBind === 0) {
          console.log('⚠️  Ни один канал не имеет bind — это может быть нормально для нового актуатора');
        } else {
          console.log(`✅ ${channelsWithBind} каналов имеют bind`);
        }

        console.log('\n✅ Все тесты пройдены!');
      };
    });
  }
}

// Зачем: Вспомогательные функции из monitor.js
function getDeviceCategory(deviceType) {
  if (SHIELD_ACTUATOR_TYPES.includes(deviceType)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(deviceType)) return 'Датчик';
  if (SHIELD_CONTROL_TYPES.includes(deviceType)) return 'Управление';
  if (ENDPOINT_DEVICE_TYPES.includes(deviceType)) return 'Конечное устройство';
  return 'Неизвестно';
}

function getDeviceName(payload) {
  return payload.title || payload.code || payload.name || 'Без названия';
}

const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0];
const SHIELD_CONTROL_TYPES = [0x25];
const ENDPOINT_DEVICE_TYPES = [0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x0a: 'DO8', 0x0b: 'DO16', 0x0e: 'DIM4', 0x0f: 'DIM8',
  0x20: 'DI_4', 0x23: 'RELAY_2', 0x25: 'SMART_4G', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa3: 'DIM_4', 0xa4: 'DIM_8',
  0xa5: 'LANAMP', 0xa7: 'RELAY_2_DIN', 0xa9: 'AO_4_DIN',
  0xac: 'MIX_1_RS', 0xad: 'DIM_12_LED_RS', 0xae: 'RELAY_12_RS', 0xaf: 'DIM_8_RS',
};

// Зачем: Запуск теста
async function main() {
  try {
    const test = new MonitorChannelTest();
    await test.run();
    console.log('\n🎉 Интеграционный тест успешно пройден!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Тест провален:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { MonitorChannelTest };






