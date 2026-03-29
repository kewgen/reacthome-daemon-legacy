#!/usr/bin/env node

/**
 * Скрипт для поиска устройства по названию (частичному совпадению)
 * 
 * Использование:
 *   node scripts/find-device-by-name.js "6.D.L.3"
 *   node scripts/find-device-by-name.js "Лоджия"
 * 
 * Зачем: Позволяет найти устройство по части названия, даже если точное название неизвестно
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const SEARCH_QUERY = process.argv[2];

if (!SEARCH_QUERY) {
  console.error('❌ Укажите поисковый запрос');
  console.error('Использование: node scripts/find-device-by-name.js "поисковый запрос"');
  process.exit(1);
}

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

function matchesSearch(device, query) {
  // Зачем: Поиск по названию (без учета регистра)
  const name = getDeviceName(device).toLowerCase();
  const searchLower = query.toLowerCase();
  
  // Проверяем точное совпадение или частичное
  return name.includes(searchLower) || 
         device.id.toLowerCase().includes(searchLower) ||
         (device.site && device.site.toLowerCase().includes(searchLower));
}

async function findDevice() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОИСК УСТРОЙСТВА: "${SEARCH_QUERY}"                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const sites = [];
  const siteMap = new Map();
  
  try {
    // Зачем: Загружаем помещения и устройства за один проход
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем помещения
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({ id: key, name: siteName });
        siteMap.set(key, siteName);
      }
      
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
          }
        }
        
        const device = {
          id: key,
          name: getDeviceName(value),
          type: type,
          typeName: DEVICE_TYPE_NAMES[type] || `Тип0x${type.toString(16)}`,
          siteId: siteId,
          site: siteName,
          raw: value, // Зачем: Сохраняем полные данные для отладки
        };
        
        // Зачем: Проверяем совпадение с поисковым запросом
        if (matchesSearch(device, SEARCH_QUERY)) {
          devices.push(device);
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
        
        const device = {
          id: key,
          name: getDeviceName(value),
          type: type,
          typeName: type.toUpperCase(),
          siteId: siteId,
          site: siteName,
          raw: value,
        };
        
        // Зачем: Проверяем совпадение с поисковым запросом
        if (matchesSearch(device, SEARCH_QUERY)) {
          devices.push(device);
        }
      }
      
      // Зачем: Также проверяем каналы устройств (могут содержать название в bind)
      if (key.includes('/')) {
        const parts = key.split('/');
        if (parts.length >= 3) {
          const deviceMac = parts[0];
          const channelType = parts[1];
          const channelIndex = parts[2];
          
          // Проверяем bind в значении
          if (value.bind && typeof value.bind === 'string') {
            const bindLower = value.bind.toLowerCase();
            if (bindLower.includes(SEARCH_QUERY.toLowerCase())) {
              devices.push({
                id: key,
                name: `Канал ${channelType}/${channelIndex} → ${value.bind}`,
                type: 'channel',
                typeName: `CHANNEL_${channelType.toUpperCase()}`,
                siteId: null,
                site: null,
                bind: value.bind,
                raw: value,
              });
            }
          }
        }
      }
    }
  } finally {
    await db.close();
  }
  
  // Выводим результаты
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📊 НАЙДЕНО УСТРОЙСТВ: ${devices.length}\n`);
  
  if (devices.length === 0) {
    console.log('⚠️  Устройства не найдены\n');
    console.log('Попробуйте:');
    console.log(`- Использовать часть названия: "${SEARCH_QUERY.substring(0, 3)}"`);
    console.log(`- Проверить правильность написания`);
    console.log('');
  } else {
    devices.forEach((device, index) => {
      console.log(`\n${index + 1}. ${device.name}`);
      console.log(`   ID: ${device.id}`);
      console.log(`   Тип: ${device.typeName}`);
      if (device.site) {
        console.log(`   Помещение: ${device.site}`);
      }
      if (device.bind) {
        console.log(`   Bind: ${device.bind}`);
      }
      
      // Зачем: Показываем дополнительные поля из raw данных
      if (device.raw) {
        const raw = device.raw;
        if (raw.code && raw.code !== device.name) {
          console.log(`   Code: ${raw.code}`);
        }
        if (raw.title && raw.title !== device.name) {
          console.log(`   Title: ${raw.title}`);
        }
        if (raw.name && raw.name !== device.name) {
          console.log(`   Name: ${raw.name}`);
        }
      }
    });
    
    // Выводим список ID
    console.log('\n═══════════════════════════════════════════════════════════\n');
    console.log('📋 ID НАЙДЕННЫХ УСТРОЙСТВ:\n');
    devices.forEach(device => {
      console.log(`  ${device.id}`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

findDevice().catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
