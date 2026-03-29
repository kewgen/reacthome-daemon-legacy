#!/usr/bin/env node

/**
 * Скрипт для поиска привязки устройства CO2_STAT к актуаторам вентиляции
 * 
 * Использование:
 *   node scripts/find-co2-stat-binding.js "91edb26e-ecf5-4680-b920-83f38f236842"
 *   node scripts/find-co2-stat-binding.js "co2 младшая"
 * 
 * Зачем: CO2_STAT устройства управляют вентиляцией через поля onStartVentilation и onStopVentilation
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const DEVICE_ID_OR_NAME = process.argv[2];

if (!DEVICE_ID_OR_NAME) {
  console.error('❌ Укажите ID устройства или название');
  console.error('Использование: node scripts/find-co2-stat-binding.js "ID или название"');
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

async function findCo2StatBinding() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОИСК ПРИВЯЗКИ CO2_STAT УСТРОЙСТВА                        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Поиск: "${DEVICE_ID_OR_NAME}"\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const sites = [];
  const siteMap = new Map();
  const allDevices = new Map(); // Зачем: Сохраняем все устройства для поиска по UUID
  let co2StatDevice = null;
  
  try {
    // Зачем: Загружаем все данные из БД
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем помещения
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({ id: key, name: siteName });
        siteMap.set(key, siteName);
      }
      
      // Загружаем все устройства
      if ((typeof type === 'number' && !key.includes('/') && type !== 0x00) ||
          (typeof type === 'string' && CONSUMER_TYPES.includes(type) && !key.includes('/'))) {
        allDevices.set(key, value);
        
        // Ищем CO2_STAT устройство
        if (key === DEVICE_ID_OR_NAME || 
            (type === 'co2_stat' && (
              getDeviceName(value).toLowerCase().includes(DEVICE_ID_OR_NAME.toLowerCase()) ||
              (value.code && value.code.toLowerCase().includes(DEVICE_ID_OR_NAME.toLowerCase()))
            ))) {
          co2StatDevice = { id: key, data: value };
        }
      }
    }
  } finally {
    await db.close();
  }
  
  if (!co2StatDevice) {
    console.log('❌ CO2_STAT устройство не найдено\n');
    process.exit(1);
  }
  
  const device = co2StatDevice.data;
  const deviceId = co2StatDevice.id;
  
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📱 CO2_STAT УСТРОЙСТВО НАЙДЕНО\n`);
  console.log(`ID: ${deviceId}`);
  console.log(`Название: ${getDeviceName(device)}`);
  console.log(`Code: ${device.code || '—'}`);
  console.log(`Тип: ${device.type}`);
  
  // Зачем: Определяем помещение
  let siteId = device.site;
  let siteName = null;
  if (siteId) {
    if (Array.isArray(siteId)) {
      siteId = siteId[0];
    }
    if (typeof siteId === 'string') {
      siteName = siteMap.get(siteId) || null;
    }
  }
  
  if (siteName) {
    console.log(`Помещение: ${siteName} (${siteId})`);
  }
  console.log('');
  
  // Зачем: Проверяем поля вентиляции
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`🔍 АНАЛИЗ ПРИВЯЗОК К ВЕНТИЛЯЦИИ\n`);
  
  const onStartVentilation = device.onStartVentilation;
  const onStopVentilation = device.onStopVentilation;
  
  console.log(`onStartVentilation: ${onStartVentilation || '—'}`);
  console.log(`onStopVentilation: ${onStopVentilation || '—'}`);
  console.log('');
  
  // Зачем: Ищем устройства вентиляции по UUID
  const ventilationDevices = [];
  
  if (onStartVentilation) {
    const startDevice = allDevices.get(onStartVentilation);
    if (startDevice) {
      let startSiteId = startDevice.site;
      let startSiteName = null;
      if (startSiteId) {
        if (Array.isArray(startSiteId)) {
          startSiteId = startSiteId[0];
        }
        if (typeof startSiteId === 'string') {
          startSiteName = siteMap.get(startSiteId) || null;
        }
      }
      
      ventilationDevices.push({
        id: onStartVentilation,
        name: getDeviceName(startDevice),
        type: startDevice.type,
        typeName: typeof startDevice.type === 'number' 
          ? (DEVICE_TYPE_NAMES[startDevice.type] || `Тип0x${startDevice.type.toString(16)}`)
          : startDevice.type.toUpperCase(),
        action: 'start',
        site: startSiteName,
        bind: startDevice.bind || null,
        raw: startDevice,
      });
    } else {
      console.log(`⚠️  Устройство запуска вентиляции не найдено: ${onStartVentilation}`);
    }
  }
  
  if (onStopVentilation) {
    const stopDevice = allDevices.get(onStopVentilation);
    if (stopDevice) {
      let stopSiteId = stopDevice.site;
      let stopSiteName = null;
      if (stopSiteId) {
        if (Array.isArray(stopSiteId)) {
          stopSiteId = stopSiteId[0];
        }
        if (typeof stopSiteId === 'string') {
          stopSiteName = siteMap.get(stopSiteId) || null;
        }
      }
      
      ventilationDevices.push({
        id: onStopVentilation,
        name: getDeviceName(stopDevice),
        type: stopDevice.type,
        typeName: typeof stopDevice.type === 'number' 
          ? (DEVICE_TYPE_NAMES[stopDevice.type] || `Тип0x${stopDevice.type.toString(16)}`)
          : stopDevice.type.toUpperCase(),
        action: 'stop',
        site: stopSiteName,
        bind: stopDevice.bind || null,
        raw: stopDevice,
      });
    } else {
      console.log(`⚠️  Устройство остановки вентиляции не найдено: ${onStopVentilation}`);
    }
  }
  
  if (ventilationDevices.length === 0) {
    console.log('❌ Устройства вентиляции не найдены по UUID из onStartVentilation/onStopVentilation\n');
  } else {
    console.log(`✅ НАЙДЕНО УСТРОЙСТВ ВЕНТИЛЯЦИИ: ${ventilationDevices.length}\n`);
    
    ventilationDevices.forEach((ventDevice, index) => {
      console.log(`\n${index + 1}. ${ventDevice.action === 'start' ? '🚀 Запуск' : '🛑 Остановка'} вентиляции:`);
      console.log(`   ID: ${ventDevice.id}`);
      console.log(`   Название: ${ventDevice.name}`);
      console.log(`   Тип: ${ventDevice.typeName}`);
      if (ventDevice.site) {
        console.log(`   Помещение: ${ventDevice.site}`);
      }
      if (ventDevice.bind) {
        console.log(`   Bind: ${ventDevice.bind}`);
        console.log(`   ✅ Устройство имеет привязку к актуатору`);
      } else {
        console.log(`   ⚠️  Устройство не имеет привязку к актуатору (bind отсутствует)`);
      }
      
      // Зачем: Показываем дополнительные поля устройства
      console.log(`   Дополнительные поля:`);
      const importantFields = ['code', 'title', 'value', 'state', 'mode', 'fan_speed'];
      importantFields.forEach(field => {
        if (ventDevice.raw[field] !== undefined) {
          console.log(`     ${field}: ${JSON.stringify(ventDevice.raw[field])}`);
        }
      });
    });
    
    // Зачем: Ищем актуаторы, к которым могут быть привязаны устройства вентиляции
    console.log('\n═══════════════════════════════════════════════════════════\n');
    console.log(`🔍 ПОИСК АКТУАТОРОВ ПО BIND\n`);
    
    ventilationDevices.forEach(ventDevice => {
      if (ventDevice.bind) {
        console.log(`\nУстройство: ${ventDevice.name} (${ventDevice.id})`);
        console.log(`Bind: ${ventDevice.bind}`);
        
        // Зачем: Парсим bind: "MAC-адрес/тип/индекс"
        const parts = ventDevice.bind.split('/');
        if (parts.length >= 3) {
          const [deviceMac, channelType, channelIndex] = parts;
          console.log(`  MAC актуатора: ${deviceMac}`);
          console.log(`  Тип канала: ${channelType}`);
          console.log(`  Индекс канала: ${channelIndex}`);
          
          // Зачем: Ищем актуатор по MAC-адресу
          const actuator = allDevices.get(deviceMac);
          if (actuator) {
            const actuatorType = typeof actuator.type === 'number' 
              ? (DEVICE_TYPE_NAMES[actuator.type] || `Тип0x${actuator.type.toString(16)}`)
              : actuator.type.toUpperCase();
            
            console.log(`  ✅ Актуатор найден:`);
            console.log(`     ID: ${deviceMac}`);
            console.log(`     Название: ${getDeviceName(actuator)}`);
            console.log(`     Тип: ${actuatorType}`);
            
            // Зачем: Проверяем канал актуатора
            const channelId = ventDevice.bind;
            console.log(`     Канал: ${channelId}`);
          } else {
            console.log(`  ⚠️  Актуатор с MAC ${deviceMac} не найден в БД`);
          }
        } else {
          console.log(`  ⚠️  Неверный формат bind: ожидается "MAC/тип/индекс"`);
        }
      }
    });
  }
  
  // Зачем: Показываем все поля CO2_STAT устройства для анализа
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log(`📋 ВСЕ ПОЛЯ CO2_STAT УСТРОЙСТВА\n`);
  
  const allKeys = Object.keys(device).sort();
  allKeys.forEach(key => {
    const value = device[key];
    const type = typeof value;
    let displayValue;
    
    if (value === null) {
      displayValue = 'null';
    } else if (value === undefined) {
      displayValue = 'undefined';
    } else if (Array.isArray(value)) {
      displayValue = `[массив, длина: ${value.length}]`;
    } else if (typeof value === 'object') {
      displayValue = `{объект, ключей: ${Object.keys(value).length}}`;
    } else {
      displayValue = String(value);
      if (displayValue.length > 80) {
        displayValue = displayValue.substring(0, 77) + '...';
      }
    }
    
    console.log(`  ${key}: ${displayValue} (${type})`);
  });
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

findCo2StatBinding().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
