#!/usr/bin/env node

/**
 * Скрипт для получения списка всех физических устройств через WebSocket
 * Выводит каждое устройство в формате: MAC / code / title / Тип / Категория / site / Онлайн
 * 
 * Зачем: Получить полный список физических устройств (щитовые + конечные) только через WebSocket API
 * 
 * Использование:
 *   node scripts/list-physical-devices-ws.js
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/list-physical-devices-ws.js
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

// Типы щитовых устройств
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x22, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0];
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

// Конечные устройства
const ENDPOINT_DEVICE_TYPES = [
  0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b
];

// Названия типов устройств
const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x20: 'DI_4', 0x22: 'DOPPLER', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xf0: 'TEMPERATURE_EXT',
  0x0a: 'DO8', 0x0b: 'DO16', 0x11: 'DO12', 0x23: 'RELAY_2',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa2: 'RELAY_24', 0xa7: 'RELAY_2_DIN', 0xae: 'RELAY_12_RS',
  0x0e: 'DIM4', 0x0f: 'DIM8',
  0xa3: 'DIM_4', 0xa4: 'DIM_8', 0xa5: 'LANAMP', 0xaf: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS', 0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb6: 'DIM_1_AC_RS',
  0xa9: 'AO_4_DIN',
  0x41: 'MIX_H', 0xaa: 'MIX_2', 0xab: 'MIX_1', 0xac: 'MIX_1_RS', 0xb5: 'MIX_6x12_RS',
  0x25: 'SMART_4G',
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
  0x05: 'DMX', 0x06: 'RS485', 0x07: 'IR6', 0x08: 'DI16', 0x09: 'DI32',
  0x10: 'IR_RECEIVER', 0x12: 'DI24', 0x14: 'IR1', 0x24: 'IR_4',
  0x40: 'DI_4_LA',
  0xb0: 'RS_HUB1_RS', 0xb1: 'RS_HUB1_LEGACY', 0xb2: 'RS_HUB4_LEGACY',
  0xc0: 'SERVER', 0xc1: 'RS_HUB4', 0xc2: 'SOUNDBOX',
  0xe0: 'PNP', 0xfe: 'PLC', 0xff: 'BOOTLOADER', 0x00: 'UNKNOWN',
};

function isPhysicalDevice(type) {
  // Зачем: Физические устройства имеют числовой тип (не строковый)
  return typeof type === 'number' && type !== null && type !== undefined;
}

function getDeviceCategory(type) {
  // Зачем: Определяем категорию устройства для классификации
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'Конечное';
  return 'Другое';
}

function getDeviceName(device) {
  // Зачем: Получаем человекочитаемое название устройства
  return device.title || device.code || device.name || 'без названия';
}

function getDeviceTypeName(type) {
  // Зачем: Получаем название типа устройства
  return DEVICE_TYPE_NAMES[type] || `Тип0x${type.toString(16)}`;
}

function formatDeviceLine(device) {
  // Зачем: Форматируем устройство в строку с полями через / с пробелами
  const mac = device.id || '—';
  const code = (device.code || '—').replace(/\//g, '_'); // Заменяем / на _ чтобы не ломать формат
  const title = (device.title || '—').replace(/\//g, '_'); // Заменяем / на _ чтобы не ломать формат
  const type = getDeviceTypeName(device.type);
  const category = getDeviceCategory(device.type);
  
  // Зачем: Обрабатываем site - может быть строкой (UUID) или массивом UUID
  let site = '—';
  if (device.site) {
    if (Array.isArray(device.site)) {
      site = device.site.length > 0 ? device.site[0] : '—';
    } else {
      site = device.site;
    }
  }
  
  const online = device.online ? '1' : '0';
  
  // Зачем: Выводим в формате MAC / code / title / Тип / Категория / site / Онлайн с пробелами вокруг /
  return `${mac} / ${code} / ${title} / ${type} / ${category} / ${site} / ${online}`;
}

async function listPhysicalDevices() {
  const ws = new WebSocket(WS_URI);
  const physicalDevices = [];
  const deviceDataMap = new Map();
  let listReceived = false;
  let getSent = false;
  let pendingGetRequests = 0;
  
  const timeout = setTimeout(() => {
    console.error('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 30000);
  
  ws.on('open', () => {
    // Зачем: Запрашиваем список всех устройств через LIST
    ws.send(JSON.stringify({ type: 'list' }));
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Обрабатываем ответ LIST
      if (msg.type === 'list' && msg.state && Array.isArray(msg.state)) {
        listReceived = true;
        
        // Зачем: Извлекаем ID всех устройств из списка
        const allDeviceIds = msg.state.map(([id]) => id).filter(Boolean);
        
        if (allDeviceIds.length > 0) {
          // Зачем: Запрашиваем полные данные для всех устройств через GET
          getSent = true;
          pendingGetRequests = allDeviceIds.length;
          ws.send(JSON.stringify({ type: 'get', state: allDeviceIds }));
        } else {
          clearTimeout(timeout);
          ws.close();
          console.log('Устройства не найдены');
          process.exit(0);
        }
      }
      
      // Обрабатываем ответы ACTION_SET от GET запроса
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const deviceId = msg.id;
        const payload = msg.payload;
        
        // Зачем: Фильтруем только физические устройства (числовые типы, не каналы)
        if (isPhysicalDevice(payload.type) && !deviceId.includes('/')) {
          deviceDataMap.set(deviceId, {
            id: deviceId,
            ...payload
          });
        }
        
        pendingGetRequests--;
        
        // Зачем: Когда получили все ответы, выводим результат
        if (getSent && pendingGetRequests <= 0) {
          clearTimeout(timeout);
          
          // Зачем: Преобразуем Map в массив и сортируем
          const devices = Array.from(deviceDataMap.values())
            .sort((a, b) => {
              const categoryA = getDeviceCategory(a.type);
              const categoryB = getDeviceCategory(b.type);
              if (categoryA !== categoryB) {
                return categoryA.localeCompare(categoryB);
              }
              return getDeviceName(a).localeCompare(getDeviceName(b));
            });
          
          // Зачем: Выводим каждое устройство в формате MAC / code / title / Тип / Категория / site / Онлайн
          devices.forEach(device => {
            console.log(formatDeviceLine(device));
          });
          
          ws.close();
          process.exit(0);
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });
  
  ws.on('error', (error) => {
    clearTimeout(timeout);
    console.error(`❌ Ошибка подключения: ${error.message}`);
    process.exit(1);
  });
  
  ws.on('close', () => {
    clearTimeout(timeout);
    if (!listReceived || !getSent) {
      console.error('❌ Соединение закрыто до получения данных');
      process.exit(1);
    }
  });
}

// Запуск
listPhysicalDevices().catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
