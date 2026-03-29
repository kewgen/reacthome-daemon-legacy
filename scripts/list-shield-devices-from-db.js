#!/usr/bin/env node

/**
 * Скрипт для получения списка всех щитовых устройств из LevelDB
 * Выводит ID устройств и их названия
 * 
 * Использование:
 *   node scripts/list-shield-devices-from-db.js
 *   DB_PATH=/path/to/db node scripts/list-shield-devices-from-db.js
 * 
 * Зачем: Позволяет получить список щитовых устройств напрямую из базы данных,
 *        без необходимости подключения к WebSocket серверу
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');

// Типы щитовых устройств (из src/constants.js и scripts/inspect-device-detailed.js)
// Зачем: Определяем полный список типов щитовых устройств для фильтрации
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f]; // 0x2b - CO2 сенсор (не определён в константах)
const SHIELD_CONTROL_TYPES = [0x25]; // Smart 4G и другие панели управления
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

// Названия типов устройств
// Зачем: Маппинг числовых кодов типов устройств на их читаемые названия
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
  0x25: 'DEVICE_TYPE_SMART_4G',
  0x2b: 'DEVICE_TYPE_CO2_SENSOR', // CO2 сенсор (не определён в константах, но используется в системе)
  0x2d: 'DEVICE_TYPE_DOPPLER_1_DI_4',
  0x2e: 'DEVICE_TYPE_DOPPLER_5_DI_4',
  0x2f: 'DEVICE_TYPE_DI_4_RSM',
  0xa0: 'DEVICE_TYPE_RELAY_6',
  0xa1: 'DEVICE_TYPE_RELAY_12',
  0xa3: 'DEVICE_TYPE_DIM_4',
  0xa4: 'DEVICE_TYPE_DIM_8',
  0xa5: 'DEVICE_TYPE_LANAMP',
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
  // Зачем: Определяем категорию устройства для группировки в выводе
  if (SHIELD_ACTUATOR_TYPES.includes(type)) {
    return 'Актуатор';
  } else if (SHIELD_SENSOR_TYPES.includes(type)) {
    return 'Сенсор';
  } else if (SHIELD_CONTROL_TYPES.includes(type)) {
    return 'Панель управления';
  }
  return 'Другое';
}

function getDeviceName(device) {
  return device.title || device.code || device.name || 'без названия';
}

async function listShieldDevicesFromDB() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ СПИСОК ЩИТОВЫХ УСТРОЙСТВ ИЗ БАЗЫ ДАННЫХ              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  let db;
  try {
    db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    const shieldDevices = [];
    let totalDevices = 0;
    
    // Проходим по всем записям в базе данных
    for await (const [key, value] of db.iterator()) {
      // Проверяем, что это устройство (type - число, и не канал)
      if (value && typeof value === 'object' && typeof value.type === 'number') {
        // Проверяем, что это не канал (каналы содержат '/' в ключе)
        if (!key.includes('/')) {
          totalDevices++;
          
          // Проверяем, является ли устройство щитовым
          if (isShieldDevice(value.type)) {
            shieldDevices.push({
              id: key,
              name: getDeviceName(value),
              type: value.type,
              typeName: DEVICE_TYPE_NAMES[value.type] || `Тип ${value.type} (0x${value.type.toString(16).toUpperCase()})`,
              category: getDeviceCategory(value.type),
              online: value.online || false,
              ip: value.ip || 'не указан',
            });
          }
        }
      }
    }
    
    await db.close();
    
    // Сортируем по категории и названию
    shieldDevices.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
    
    // Выводим результаты
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📊 ВСЕГО УСТРОЙСТВ В БД: ${totalDevices}`);
    console.log(`📊 НАЙДЕНО ЩИТОВЫХ УСТРОЙСТВ: ${shieldDevices.length}\n`);
    
    if (shieldDevices.length === 0) {
      console.log('⚠️  Щитовые устройства не найдены\n');
      console.log('Возможные причины:');
      console.log('- Устройства не подключены к системе');
      console.log('- Устройства имеют другие типы');
      console.log('- База данных пуста или находится в другом месте\n');
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
      
      // Выводим список в формате: id, type, name
      console.log('\n═══════════════════════════════════════════════════════════\n');
      console.log('📋 СПИСОК: ID | TYPE | NAME\n');
      shieldDevices.forEach(device => {
        const typeStr = device.typeName || `Тип ${device.type}`;
        console.log(`${device.id} | ${typeStr} | ${device.name}`);
      });
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    if (db) {
      await db.close();
    }
    console.error('❌ Ошибка:', error.message);
    console.error('\nВозможные причины:');
    console.error(`- База данных не найдена по пути: ${DB_PATH}`);
    console.error(`- Нет прав доступа к базе данных`);
    console.error(`- База данных повреждена\n`);
    console.error('Попробуйте указать путь к базе данных:');
    console.error(`  DB_PATH=/path/to/db node scripts/list-shield-devices-from-db.js\n`);
    process.exit(1);
  }
}

listShieldDevicesFromDB().catch(error => {
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});
