#!/usr/bin/env node

/**
 * Скрипт для поиска всех устройств, связанных с каналами dim/2
 * 
 * Зачем: Находит все каналы диммера с индексом 2 (dim/2) и показывает
 * связанные с ними устройства через поле bind
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * ==============
 *   node scripts/find-dim2-devices.js
 * 
 * ВЫВОД:
 * ======
 * Показывает для каждого канала dim/2:
 * - Информацию об актуаторе (диммере)
 * - Информацию о канале dim/2
 * - Информацию о связанном устройстве (потребителе)
 */

const { Level } = require('level');
const path = require('path');
const WebSocket = require('ws');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

// Зачем: Маппинг типов устройств для читаемого вывода
const DEVICE_TYPE_NAMES = {
  0x0e: 'DIM4',
  0x0f: 'DIM8',
  0xa3: 'DIM_4',
  0xa4: 'DIM_8',
  0xa5: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS',
  0xaf: 'DIM_8_RS',
  0xb3: 'DIM_12_AC_RS',
  0xb4: 'DIM_12_DC_RS',
  0xb6: 'DIM_1_AC_RS',
};

// Зачем: Типы потребителей для определения категории устройства
const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'warm_floor', 'socket_220',
  'PUMP', 'FAN', 'HEATER', 'CONDITIONER', 'VENTILATION'
];

/**
 * Зачем: Получает читаемое имя устройства из данных БД
 */
function getDeviceName(value) {
  return value.title || value.code || value.name || value.id || 'Без названия';
}

/**
 * Зачем: Определяет категорию устройства по типу
 */
function getDeviceCategory(type) {
  if (typeof type === 'string' && CONSUMER_TYPES.includes(type)) {
    return 'Потребитель';
  }
  if (typeof type === 'number') {
    if (DEVICE_TYPE_NAMES[type]) {
      return 'Актуатор';
    }
  }
  return 'Другое';
}

/**
 * Зачем: Загружает все каналы dim/2 из LevelDB и находит связанные устройства
 */
async function findDim2Devices() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const dim2Channels = [];
  const devicesMap = new Map(); // Зачем: Кэш всех устройств для быстрого поиска
  const sitesMap = new Map(); // Зачем: Кэш помещений для резолвинга названий

  try {
    console.log('[INFO] Загрузка данных из LevelDB...\n');

    // Зачем: Первый проход - загружаем все устройства и помещения
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;

      const type = value.type;

      // Зачем: Сохраняем помещения для резолвинга названий
      if (type === 'site') {
        const siteName = getDeviceName(value);
        sitesMap.set(key, siteName);
      }

      // Зачем: Сохраняем все устройства (не каналы) в кэш
      if (!key.includes('/')) {
        devicesMap.set(key, {
          id: key,
          name: getDeviceName(value),
          type: type,
          typeName: typeof type === 'number' 
            ? (DEVICE_TYPE_NAMES[type] || `Тип0x${type.toString(16)}`)
            : type,
          category: getDeviceCategory(type),
          site: value.site || null,
          bind: value.bind || null,
          ...value // Зачем: Сохраняем все остальные поля
        });
      }
    }

    // Зачем: Второй проход - ищем каналы dim/2
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;

      // Зачем: Каналы имеют формат {MAC}/{тип}/{индекс}, например "68:27:19:e4:49:17/dim/2"
      if (key.includes('/dim/2')) {
        const [actuatorId] = key.split('/');
        const actuator = devicesMap.get(actuatorId);
        const bind = value.bind; // UUID связанного устройства

        let linkedDevice = null;
        if (bind) {
          linkedDevice = devicesMap.get(bind);
        }

        // Зачем: Резолвим название помещения для актуатора
        let actuatorSiteName = null;
        if (actuator && actuator.site) {
          const siteId = Array.isArray(actuator.site) ? actuator.site[0] : actuator.site;
          if (typeof siteId === 'string') {
            actuatorSiteName = sitesMap.get(siteId) || null;
          }
        }

        // Зачем: Резолвим название помещения для связанного устройства
        let linkedDeviceSiteName = null;
        if (linkedDevice && linkedDevice.site) {
          const siteId = Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site;
          if (typeof siteId === 'string') {
            linkedDeviceSiteName = sitesMap.get(siteId) || null;
          }
        }

        dim2Channels.push({
          channelId: key,
          actuatorId: actuatorId,
          actuator: actuator,
          actuatorSiteName: actuatorSiteName,
          channelState: {
            value: value.value,
            type: value.type,
            dimmable: value.dimmable,
            velocity: value.velocity,
            group: value.group,
            onOn: value.onOn,
            onOff: value.onOff
          },
          bind: bind,
          linkedDevice: linkedDevice,
          linkedDeviceSiteName: linkedDeviceSiteName
        });
      }
    }
  } finally {
    await db.close();
  }

  return dim2Channels;
}

/**
 * Зачем: Получает актуальное состояние устройств через WebSocket
 */
async function getDeviceStates(deviceIds) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URI);
    const states = new Map();
    const timeout = setTimeout(() => {
      ws.close();
      resolve(states);
    }, 5000);

    ws.on('open', () => {
      // Зачем: Запрашиваем состояние всех устройств и каналов
      ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
          states.set(msg.id, msg.payload);
        }
      } catch (e) {
        // Игнорируем ошибки парсинга
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      resolve(states);
    });
  });
}

/**
 * Зачем: Выводит информацию о найденных каналах dim/2 и связанных устройствах
 */
function printResults(channels, states) {
  console.log('='.repeat(80));
  console.log(`НАЙДЕНО КАНАЛОВ DIM/2: ${channels.length}`);
  console.log('='.repeat(80));
  console.log();

  if (channels.length === 0) {
    console.log('Каналы dim/2 не найдены в базе данных.');
    return;
  }

  channels.forEach((channel, index) => {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`КАНАЛ #${index + 1}: ${channel.channelId}`);
    console.log('─'.repeat(80));

    // Информация об актуаторе
    if (channel.actuator) {
      const actuatorState = states.get(channel.actuatorId);
      console.log('\n📡 АКТУАТОР (Диммер):');
      console.log(`   ID: ${channel.actuatorId}`);
      console.log(`   Название: ${channel.actuator.name}`);
      console.log(`   Тип: ${channel.actuator.typeName} (0x${channel.actuator.type?.toString(16) || '?'})`);
      console.log(`   Категория: ${channel.actuator.category}`);
      if (channel.actuatorSiteName) {
        console.log(`   Помещение: ${channel.actuatorSiteName}`);
      }
      if (actuatorState) {
        console.log(`   IP: ${actuatorState.ip || 'не указан'}`);
        console.log(`   Статус: ${actuatorState.online ? '🟢 Онлайн' : '🔴 Оффлайн'}`);
        console.log(`   Готовность: ${actuatorState.ready ? '✓ Готов' : '✗ Не готов'}`);
      }
    } else {
      console.log('\n⚠️  АКТУАТОР НЕ НАЙДЕН в базе данных');
      console.log(`   ID актуатора: ${channel.actuatorId}`);
    }

    // Информация о канале dim/2
    const channelState = states.get(channel.channelId);
    console.log('\n⚙️  КАНАЛ DIM/2:');
    console.log(`   ID канала: ${channel.channelId}`);
    if (channelState) {
      console.log(`   Значение: ${channelState.value !== undefined ? channelState.value : 'не указано'} (0-255)`);
      console.log(`   Тип диммера: ${channelState.type !== undefined ? channelState.type : 'не указан'}`);
      console.log(`   Диммируемый: ${channelState.dimmable ? 'Да' : 'Нет'}`);
      console.log(`   Скорость: ${channelState.velocity !== undefined ? channelState.velocity : 'не указана'}`);
      if (channelState.group !== undefined) {
        console.log(`   Группа: ${channelState.group}`);
      }
    } else {
      console.log(`   Значение: ${channel.channelState.value !== undefined ? channel.channelState.value : 'не указано'} (из БД)`);
      console.log(`   Тип диммера: ${channel.channelState.type !== undefined ? channel.channelState.type : 'не указан'}`);
      console.log(`   Диммируемый: ${channel.channelState.dimmable ? 'Да' : 'Нет'}`);
    }
    if (channel.channelState.onOn) {
      console.log(`   Скрипт при включении: ${channel.channelState.onOn}`);
    }
    if (channel.channelState.onOff) {
      console.log(`   Скрипт при выключении: ${channel.channelState.onOff}`);
    }

    // Информация о связанном устройстве
    if (channel.bind) {
      console.log('\n🔗 СВЯЗАННОЕ УСТРОЙСТВО:');
      console.log(`   Bind: ${channel.bind}`);
      
      if (channel.linkedDevice) {
        const linkedState = states.get(channel.linkedDevice.id);
        console.log(`   ID: ${channel.linkedDevice.id}`);
        console.log(`   Название: ${channel.linkedDevice.name}`);
        console.log(`   Тип: ${channel.linkedDevice.typeName}`);
        console.log(`   Категория: ${channel.linkedDevice.category}`);
        if (channel.linkedDeviceSiteName) {
          console.log(`   Помещение: ${channel.linkedDeviceSiteName}`);
        }
        if (linkedState) {
          console.log(`   Значение: ${linkedState.value !== undefined ? linkedState.value : 'не указано'}`);
          if (linkedState.brightness !== undefined) {
            console.log(`   Яркость: ${linkedState.brightness}`);
          }
          if (linkedState.mode !== undefined) {
            console.log(`   Режим: ${linkedState.mode}`);
          }
        }
        
        // Зачем: Проверяем обратную связь (устройство должно иметь bind на канал)
        if (channel.linkedDevice.bind === channel.channelId) {
          console.log(`   ✓ Обратная связь: устройство имеет bind на этот канал`);
        } else if (channel.linkedDevice.bind) {
          console.log(`   ⚠ Обратная связь: устройство связано с другим каналом (${channel.linkedDevice.bind})`);
        } else {
          console.log(`   ⚠ Обратная связь: устройство не имеет bind на канал`);
        }
      } else {
        console.log(`   ⚠️  УСТРОЙСТВО НЕ НАЙДЕНО в базе данных`);
        console.log(`   UUID: ${channel.bind}`);
      }
    } else {
      console.log('\n⚠️  КАНАЛ НЕ СВЯЗАН с устройством (bind отсутствует)');
    }
  });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`ИТОГО: ${channels.length} канал(ов) dim/2`);
  console.log('='.repeat(80));
}

/**
 * Зачем: Главная функция
 */
async function main() {
  try {
    // Зачем: Загружаем каналы dim/2 из БД
    const channels = await findDim2Devices();

    // Зачем: Собираем все ID устройств и каналов для запроса состояния
    const deviceIds = [];
    channels.forEach(channel => {
      if (channel.actuatorId) deviceIds.push(channel.actuatorId);
      if (channel.channelId) deviceIds.push(channel.channelId);
      if (channel.bind) deviceIds.push(channel.bind);
    });

    // Зачем: Получаем актуальное состояние через WebSocket
    let states = new Map();
    if (deviceIds.length > 0) {
      console.log('[INFO] Получение актуального состояния через WebSocket...\n');
      try {
        states = await getDeviceStates(deviceIds);
      } catch (error) {
        console.log(`[WARN] Не удалось подключиться к WebSocket (${WS_URI}): ${error.message}`);
        console.log('[INFO] Будут показаны только данные из БД\n');
      }
    }

    // Зачем: Выводим результаты
    printResults(channels, states);

  } catch (error) {
    console.error('[ERROR] Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();







