#!/usr/bin/env node

/**
 * Скрипт для получения списка всех щитовых устройств
 * Выводит ID устройств и их названия
 * 
 * Использование:
 *   node scripts/list-shield-devices.js
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/list-shield-devices.js
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

// Типы щитовых устройств (из src/constants.js и scripts/inspect-device-detailed.js)
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2f];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES];

// Названия типов устройств
const DEVICE_TYPE_NAMES = {
  0x00: 'DEVICE_TYPE_UNKNOWN',
  0x01: 'DEVICE_TYPE_SENSOR4',
  0x02: 'DEVICE_TYPE_SENSOR6',
  0x03: 'DEVICE_TYPE_THI',
  0x04: 'DEVICE_TYPE_DOPPLER',
  0x0a: 'DEVICE_TYPE_DO8',
  0x0b: 'DEVICE_TYPE_DO16',
  0x0e: 'DEVICE_TYPE_DIM4',
  0x0f: 'DEVICE_TYPE_DIM8',
  0x20: 'DEVICE_TYPE_DI_4',
  0x23: 'DEVICE_TYPE_RELAY_2',
  0x2f: 'DEVICE_TYPE_DI_4_RSM',
  0xa0: 'DEVICE_TYPE_RELAY_6',
  0xa1: 'DEVICE_TYPE_RELAY_12',
  0xa3: 'DEVICE_TYPE_DIM_4',
  0xa4: 'DEVICE_TYPE_DIM_8',
  0xa7: 'DEVICE_TYPE_RELAY_2_DIN',
  0xa9: 'DEVICE_TYPE_AO_4_DIN',
  0xac: 'DEVICE_TYPE_MIX_1_RS',
  0xad: 'DEVICE_TYPE_DIM_12_LED_RS',
  0xae: 'DEVICE_TYPE_RELAY_12_RS',
  0xaf: 'DEVICE_TYPE_DIM_8_RS',
  0xb3: 'DEVICE_TYPE_DIM_12_AC_RS',
  0xb4: 'DEVICE_TYPE_DIM_12_DC_RS',
  0xb5: 'DEVICE_TYPE_MIX_6x12_RS',
  0xb6: 'DEVICE_TYPE_DIM_1_AC_RS',
};

function isShieldDevice(type) {
  return SHIELD_TYPES.includes(type);
}

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) {
    return 'Актуатор';
  } else if (SHIELD_SENSOR_TYPES.includes(type)) {
    return 'Сенсор';
  }
  return 'Другое';
}

function getDeviceName(device) {
  return device.title || device.code || device.name || 'без названия';
}

async function listShieldDevices() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ СПИСОК ЩИТОВЫХ УСТРОЙСТВ                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Подключение к ${WS_URI}...\n`);
  
  const ws = new WebSocket(WS_URI);
  const deviceIds = [];
  const deviceData = {};
  let listReceived = false;
  
  const timeout = setTimeout(() => {
    console.error('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 20000);
  
  ws.on('open', () => {
    console.log('✅ Подключение установлено\n');
    
    // Запрашиваем список всех устройств
    ws.send(JSON.stringify({ type: 'list' }));
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Обрабатываем ответ LIST
      if (msg.type === 'ACTION_LIST' && msg.state && Array.isArray(msg.state)) {
        listReceived = true;
        
        // Извлекаем ID устройств из списка
        // Формат: [[id, timestamp], ...]
        msg.state.forEach(item => {
          if (Array.isArray(item) && item.length > 0) {
            const deviceId = item[0];
            if (typeof deviceId === 'string' && !deviceId.includes('/')) {
              // Только устройства, не каналы (каналы содержат '/')
              deviceIds.push(deviceId);
            }
          }
        });
        
        console.log(`📋 Получено устройств: ${deviceIds.length}\n`);
        console.log(`📥 Запрашиваем данные устройств...\n`);
        
        // Запрашиваем данные всех устройств
        if (deviceIds.length > 0) {
          ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
        }
      }
      
      // Обрабатываем ответы GET (данные устройств)
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const deviceId = msg.id;
        const device = msg.payload;
        
        // Сохраняем только если это устройство (не канал)
        if (!deviceId.includes('/')) {
          deviceData[deviceId] = device;
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });
  
  ws.on('error', (error) => {
    console.error(`❌ Ошибка WebSocket: ${error.message}`);
    clearTimeout(timeout);
    process.exit(1);
  });
  
  ws.on('close', () => {
    clearTimeout(timeout);
    
    if (!listReceived) {
      console.error('❌ Не получен список устройств');
      process.exit(1);
    }
    
    // Фильтруем щитовые устройства
    const shieldDevices = [];
    
    for (const [deviceId, device] of Object.entries(deviceData)) {
      if (device.type !== undefined && isShieldDevice(device.type)) {
        shieldDevices.push({
          id: deviceId,
          name: getDeviceName(device),
          type: device.type,
          typeName: DEVICE_TYPE_NAMES[device.type] || `Тип ${device.type} (0x${device.type.toString(16).toUpperCase()})`,
          category: getDeviceCategory(device.type),
          online: device.online || false,
          ip: device.ip || 'не указан',
        });
      }
    }
    
    // Сортируем по категории и названию
    shieldDevices.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
    
    // Выводим результаты
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📊 НАЙДЕНО ЩИТОВЫХ УСТРОЙСТВ: ${shieldDevices.length}\n`);
    
    if (shieldDevices.length === 0) {
      console.log('⚠️  Щитовые устройства не найдены\n');
      console.log('Возможные причины:');
      console.log('- Устройства не подключены к системе');
      console.log('- Устройства имеют другие типы');
      console.log('- Проблемы с подключением к WebSocket\n');
    } else {
      // Группируем по категориям
      const byCategory = {};
      shieldDevices.forEach(device => {
        if (!byCategory[device.category]) {
          byCategory[device.category] = [];
        }
        byCategory[device.category].push(device);
      });
      
      // Выводим по категориям
      for (const [category, devices] of Object.entries(byCategory)) {
        console.log(`\n📦 ${category.toUpperCase()} (${devices.length} устройств)\n`);
        
        devices.forEach((device, index) => {
          const status = device.online ? '🟢' : '🔴';
          console.log(`  ${index + 1}. ${status} ${device.name}`);
          console.log(`     ID: ${device.id}`);
          console.log(`     Тип: ${device.typeName}`);
          console.log(`     IP: ${device.ip}`);
          console.log('');
        });
      }
      
      // Выводим только ID
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('📋 ID ЩИТОВЫХ УСТРОЙСТВ:\n');
      shieldDevices.forEach(device => {
        console.log(`  ${device.id}`);
      });
      
      // Выводим только названия
      console.log('\n═══════════════════════════════════════════════════════════\n');
      console.log('📝 НАЗВАНИЯ ЩИТОВЫХ УСТРОЙСТВ:\n');
      shieldDevices.forEach(device => {
        console.log(`  ${device.name}`);
      });
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
  });
}

listShieldDevices().catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
