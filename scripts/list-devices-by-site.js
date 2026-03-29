#!/usr/bin/env node

/**
 * Скрипт для получения списка всех устройств в указанном помещении
 * 
 * Использование:
 *   node scripts/list-devices-by-site.js "Лоджия"
 *   node scripts/list-devices-by-site.js "Лоджия" DB_PATH=/path/to/db
 * 
 * Зачем: Позволяет быстро получить список всех устройств (щитовых, конечных, потребителей)
 *        в указанном помещении из базы данных LevelDB
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const SITE_NAME = process.argv[2];

if (!SITE_NAME) {
  console.error('❌ Укажите название помещения');
  console.error('Использование: node scripts/list-devices-by-site.js "Название помещения"');
  process.exit(1);
}

// Типы устройств
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0];
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

const ENDPOINT_DEVICE_TYPES = [
  0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b,
];

const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP',
  'thermostat', 'hygrostat', 'co2_stat'
];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x0a: 'DO8', 0x0b: 'DO16', 0x0e: 'DIM4', 0x0f: 'DIM8',
  0x20: 'DI_4', 0x23: 'RELAY_2', 0x25: 'SMART_4G', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa3: 'DIM_4', 0xa4: 'DIM_8',
  0xa5: 'LANAMP', 0xa7: 'RELAY_2_DIN', 0xa9: 'AO_4_DIN',
  0xac: 'MIX_1_RS', 0xad: 'DIM_12_LED_RS', 0xae: 'RELAY_12_RS', 0xaf: 'DIM_8_RS',
  0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb5: 'MIX_6x12_RS', 0xb6: 'DIM_1_AC_RS',
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
  0xab: 'MIX_1', 0xf0: 'TEMPERATURE_EXT',
};

function getDeviceName(device) {
  return device.title || device.code || device.name || 'без названия';
}

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'Конечное';
  if (typeof type === 'string' && CONSUMER_TYPES.includes(type)) return 'Потребитель';
  return 'Другое';
}

async function listDevicesBySite() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ УСТРОЙСТВА В ПОМЕЩЕНИИ: ${SITE_NAME.padEnd(30)} ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const sites = [];
  const siteMap = new Map(); // UUID -> название
  
  try {
    // Зачем: Сначала загружаем ВСЕ помещения, чтобы siteMap был заполнен
    // Это гарантирует, что при обработке устройств мы сможем найти название помещения по UUID
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем помещения
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({ id: key, name: siteName });
        siteMap.set(key, siteName);
      }
    }
    
    console.log(`📋 Загружено помещений: ${sites.length}`);
    console.log(`🔍 Ищем устройства в помещении: "${SITE_NAME}"\n`);
    
    // Зачем: Теперь загружаем устройства, когда siteMap уже заполнен
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем устройства с числовым типом
      if (typeof type === 'number' && !key.includes('/') && type !== 0x00) {
        let siteId = value.site;
        let siteName = null;
        
        if (siteId) {
          if (Array.isArray(siteId)) {
            siteId = siteId[0];
          }
          if (typeof siteId === 'string') {
            siteName = siteMap.get(siteId) || null;
            // Зачем: Если помещение не найдено, выводим предупреждение для отладки
            if (!siteName && siteId) {
              console.log(`⚠️  Устройство ${key}: помещение с ID "${siteId}" не найдено в siteMap`);
            }
          }
        }
        
        // Зачем: Фильтруем устройства в указанном помещении
        // Проверяем как по site, так и по коду/названию устройства (может содержать название помещения)
        const deviceName = getDeviceName(value);
        const deviceCode = value.code || '';
        const deviceTitle = value.title || '';
        const nameContainsSite = deviceName.toLowerCase().includes(SITE_NAME.toLowerCase()) ||
                                 deviceCode.toLowerCase().includes(SITE_NAME.toLowerCase()) ||
                                 deviceTitle.toLowerCase().includes(SITE_NAME.toLowerCase());
        
        if (siteName === SITE_NAME || (siteName === null && nameContainsSite)) {
          devices.push({
            id: key,
            name: deviceName,
            type: type,
            typeName: DEVICE_TYPE_NAMES[type] || `Тип0x${type.toString(16)}`,
            category: getDeviceCategory(type),
            siteId: siteId,
            site: siteName || (nameContainsSite ? SITE_NAME : null),
            code: deviceCode,
          });
        }
      }
      
      // Загружаем потребители (строковые типы)
      if (typeof type === 'string' && CONSUMER_TYPES.includes(type) && !key.includes('/')) {
        let siteId = value.site;
        let siteName = null;
        
        if (siteId) {
          if (Array.isArray(siteId)) {
            siteId = siteId[0];
          }
          if (typeof siteId === 'string') {
            siteName = siteMap.get(siteId) || null;
          }
        }
        
        // Зачем: Фильтруем потребители в указанном помещении
        // Проверяем как по site, так и по коду/названию устройства
        const deviceName = getDeviceName(value);
        const deviceCode = value.code || '';
        const deviceTitle = value.title || '';
        const nameContainsSite = deviceName.toLowerCase().includes(SITE_NAME.toLowerCase()) ||
                                 deviceCode.toLowerCase().includes(SITE_NAME.toLowerCase()) ||
                                 deviceTitle.toLowerCase().includes(SITE_NAME.toLowerCase());
        
        if (siteName === SITE_NAME || (siteName === null && nameContainsSite)) {
          devices.push({
            id: key,
            name: deviceName,
            type: type,
            typeName: type.toUpperCase(),
            category: 'Потребитель',
            siteId: siteId,
            site: siteName || (nameContainsSite ? SITE_NAME : null),
            code: deviceCode,
          });
        }
      }
    }
  } finally {
    await db.close();
  }
  
  // Сортируем по категории и названию
  devices.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
  
  // Выводим результаты
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📊 НАЙДЕНО УСТРОЙСТВ: ${devices.length}\n`);
  
  if (devices.length === 0) {
    console.log('⚠️  Устройства не найдены в указанном помещении\n');
    console.log('Возможные причины:');
    console.log(`- Помещение "${SITE_NAME}" не существует`);
    console.log(`- В помещении нет устройств`);
    console.log(`- Название помещения указано неверно\n`);
    
    // Показываем список доступных помещений
    if (sites.length > 0) {
      console.log('📋 Доступные помещения:\n');
      sites.forEach(site => {
        console.log(`  - ${site.name}`);
      });
      console.log('');
    }
  } else {
    // Группируем по категориям
    const byCategory = {};
    devices.forEach(device => {
      if (!byCategory[device.category]) {
        byCategory[device.category] = [];
      }
      byCategory[device.category].push(device);
    });
    
    // Выводим по категориям
    for (const [category, categoryDevices] of Object.entries(byCategory)) {
      console.log(`\n📦 ${category.toUpperCase()} (${categoryDevices.length} устройств)\n`);
      
      categoryDevices.forEach((device, index) => {
        console.log(`  ${index + 1}. ${device.name}`);
        console.log(`     ID: ${device.id}`);
        console.log(`     Тип: ${device.typeName}`);
        if (device.code && device.code !== device.name) {
          console.log(`     Code: ${device.code}`);
        }
        if (device.site) {
          console.log(`     Помещение: ${device.site}`);
        } else {
          console.log(`     ⚠️  Помещение не указано (найдено по коду/названию)`);
        }
        console.log('');
      });
    }
    
    // Выводим список ID
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('📋 ID УСТРОЙСТВ:\n');
    devices.forEach(device => {
      console.log(`  ${device.id}`);
    });
    
    // Выводим список в формате: id | type | name
    console.log('\n═══════════════════════════════════════════════════════════\n');
    console.log('📋 СПИСОК: ID | TYPE | NAME\n');
    devices.forEach(device => {
      console.log(`${device.id} | ${device.typeName} | ${device.name}`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

listDevicesBySite().catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
