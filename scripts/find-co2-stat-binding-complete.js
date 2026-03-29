#!/usr/bin/env node

/**
 * Скрипт для полного анализа привязки CO2_STAT устройства к актуаторам
 * 
 * Использование:
 *   node scripts/find-co2-stat-binding-complete.js "91edb26e-ecf5-4680-b920-83f38f236842"
 *   node scripts/find-co2-stat-binding-complete.js "co2 младшая"
 * 
 * Зачем: Показывает полную цепочку привязок: CO2_STAT → скрипты → устройства вентиляции → актуаторы
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const DEVICE_ID_OR_NAME = process.argv[2];

if (!DEVICE_ID_OR_NAME) {
  console.error('❌ Укажите ID устройства или название');
  console.error('Использование: node scripts/find-co2-stat-binding-complete.js "ID или название"');
  process.exit(1);
}

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

async function findCo2StatBindingComplete() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОЛНЫЙ АНАЛИЗ ПРИВЯЗКИ CO2_STAT УСТРОЙСТВА                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Поиск: "${DEVICE_ID_OR_NAME}"\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const sites = [];
  const siteMap = new Map();
  let co2StatDevice = null;
  
  try {
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем помещения
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({ id: key, name: siteName });
        siteMap.set(key, siteName);
      }
      
      // Ищем CO2_STAT устройство
      if (type === 'co2_stat' && (
        key === DEVICE_ID_OR_NAME || 
        getDeviceName(value).toLowerCase().includes(DEVICE_ID_OR_NAME.toLowerCase()) ||
        (value.code && value.code.toLowerCase().includes(DEVICE_ID_OR_NAME.toLowerCase()))
      )) {
        co2StatDevice = { id: key, data: value };
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
  console.log(`📱 CO2_STAT УСТРОЙСТВО\n`);
  console.log(`ID: ${deviceId}`);
  console.log(`Название: ${getDeviceName(device)}`);
  console.log(`Тип: ${device.type}`);
  
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
  
  const onStartVentilation = device.onStartVentilation;
  const onStopVentilation = device.onStopVentilation;
  
  if (!onStartVentilation || !onStopVentilation) {
    console.log('⚠️  Поля onStartVentilation или onStopVentilation отсутствуют\n');
    process.exit(1);
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`🔗 ЦЕПОЧКА ПРИВЯЗОК\n`);
  
  // Зачем: Загружаем скрипты
  const db2 = new Level(DB_PATH, { valueEncoding: 'json' });
  let startScript = null;
  let stopScript = null;
  
  try {
    startScript = await db2.get(onStartVentilation).catch(() => null);
    stopScript = await db2.get(onStopVentilation).catch(() => null);
  } finally {
    await db2.close();
  }
  
  if (!startScript || startScript.type !== 'script') {
    console.log(`❌ Скрипт запуска не найден: ${onStartVentilation}\n`);
    process.exit(1);
  }
  
  if (!stopScript || stopScript.type !== 'script') {
    console.log(`❌ Скрипт остановки не найден: ${onStopVentilation}\n`);
    process.exit(1);
  }
  
  console.log(`1️⃣  CO2_STAT: ${getDeviceName(device)} (${deviceId})`);
  console.log(`   ↓`);
  console.log(`2️⃣  Скрипт запуска: ${startScript.title || onStartVentilation} (${onStartVentilation})`);
  console.log(`   Скрипт остановки: ${stopScript.title || onStopVentilation} (${onStopVentilation})`);
  console.log(`   ↓`);
  
  // Зачем: Анализируем действия скриптов для поиска устройств вентиляции
  const db3 = new Level(DB_PATH, { valueEncoding: 'json' });
  const ventilationDevices = new Set();
  
  try {
    // Анализируем скрипт запуска
    if (startScript.action && Array.isArray(startScript.action)) {
      for (const actionId of startScript.action) {
        const action = await db3.get(actionId).catch(() => null);
        if (action && action.payload && action.payload.id) {
          ventilationDevices.add(action.payload.id);
        }
      }
    }
    
    // Анализируем скрипт остановки
    if (stopScript.action && Array.isArray(stopScript.action)) {
      for (const actionId of stopScript.action) {
        const action = await db3.get(actionId).catch(() => null);
        if (action && action.payload && action.payload.id) {
          ventilationDevices.add(action.payload.id);
        }
      }
    }
  } finally {
    await db3.close();
  }
  
  if (ventilationDevices.size === 0) {
    console.log(`⚠️  Устройства вентиляции не найдены в действиях скриптов\n`);
    process.exit(1);
  }
  
  console.log(`3️⃣  Устройства вентиляции:`);
  
  const db4 = new Level(DB_PATH, { valueEncoding: 'json' });
  const actuators = new Map();
  
  try {
    for (const ventDeviceId of ventilationDevices) {
      const ventDevice = await db4.get(ventDeviceId).catch(() => null);
      if (ventDevice) {
        const ventName = getDeviceName(ventDevice);
        const ventType = ventDevice.type || 'неизвестно';
        console.log(`   - ${ventName} (${ventType})`);
        console.log(`     ID: ${ventDeviceId}`);
        
        if (ventDevice.bind) {
          console.log(`     Bind: ${ventDevice.bind}`);
          
          // Зачем: Парсим bind для поиска актуатора
          const parts = ventDevice.bind.split('/');
          if (parts.length >= 3) {
            const [deviceMac, channelType, channelIndex] = parts;
            console.log(`     ↓`);
            console.log(`4️⃣  Канал актуатора: ${channelType}/${channelIndex}`);
            console.log(`     MAC актуатора: ${deviceMac}`);
            
            // Зачем: Ищем актуатор
            const actuator = await db4.get(deviceMac).catch(() => null);
            if (actuator) {
              const actuatorType = typeof actuator.type === 'number' 
                ? (DEVICE_TYPE_NAMES[actuator.type] || `Тип0x${actuator.type.toString(16)}`)
                : actuator.type.toUpperCase();
              
              const actuatorName = getDeviceName(actuator);
              
              if (!actuators.has(deviceMac)) {
                actuators.set(deviceMac, {
                  id: deviceMac,
                  name: actuatorName,
                  type: actuatorType,
                  channels: []
                });
              }
              
              actuators.get(deviceMac).channels.push({
                type: channelType,
                index: channelIndex,
                device: ventName,
                deviceId: ventDeviceId
              });
            } else {
              console.log(`     ⚠️  Актуатор не найден: ${deviceMac}`);
            }
          }
        } else {
          console.log(`     ⚠️  Устройство не имеет привязку к актуатору (bind отсутствует)`);
        }
        console.log('');
      }
    }
  } finally {
    await db4.close();
  }
  
  // Зачем: Выводим итоговую информацию об актуаторах
  if (actuators.size > 0) {
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`✅ ИТОГОВАЯ ИНФОРМАЦИЯ О ПРИВЯЗКАХ\n`);
    
    actuators.forEach((actuator, mac) => {
      console.log(`Актуатор: ${actuator.name}`);
      console.log(`  ID: ${mac}`);
      console.log(`  Тип: ${actuator.type}`);
      console.log(`  Управляемые каналы:`);
      actuator.channels.forEach(ch => {
        console.log(`    - ${ch.type}/${ch.index} → ${ch.device} (${ch.deviceId})`);
      });
      console.log('');
    });
    
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`💡 ВЫВОД:\n`);
    console.log(`CO2_STAT устройство "${getDeviceName(device)}" управляет вентиляцией через:`);
    console.log(`- Скрипт запуска: "${startScript.title}"`);
    console.log(`- Скрипт остановки: "${stopScript.title}"`);
    console.log(`- Устройства вентиляции: ${Array.from(ventilationDevices).map(id => {
      const db5 = new Level(DB_PATH, { valueEncoding: 'json' });
      return db5.get(id).then(d => getDeviceName(d)).catch(() => id);
    }).join(', ')}`);
    console.log(`- Актуаторы: ${Array.from(actuators.values()).map(a => `${a.name} (${a.type})`).join(', ')}`);
    console.log('');
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

findCo2StatBindingComplete().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
