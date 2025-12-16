#!/usr/bin/env node

/**
 * Скрипт для анализа действий скрипта
 * 
 * Использование:
 *   node scripts/inspect-script-actions.js "2dc36141-d0ea-49f6-9e21-0806f6125d3f"
 * 
 * Зачем: Показывает, какие устройства и каналы управляются скриптом
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const SCRIPT_ID = process.argv[2];

if (!SCRIPT_ID) {
  console.error('❌ Укажите ID скрипта');
  console.error('Использование: node scripts/inspect-script-actions.js "ID скрипта"');
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

async function inspectScriptActions() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ АНАЛИЗ ДЕЙСТВИЙ СКРИПТА                                 ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`ID скрипта: "${SCRIPT_ID}"\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const allDevices = new Map();
  let script = null;
  
  try {
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      // Загружаем скрипт
      if (key === SCRIPT_ID && value.type === 'script') {
        script = value;
      }
      
      // Загружаем устройства для поиска по bind
      const type = value.type;
      if ((typeof type === 'number' && !key.includes('/') && type !== 0x00) ||
          (typeof type === 'string' && !key.includes('/'))) {
        allDevices.set(key, value);
      }
    }
  } finally {
    await db.close();
  }
  
  if (!script) {
    console.log('❌ Скрипт не найден\n');
    process.exit(1);
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📋 ИНФОРМАЦИЯ О СКРИПТЕ\n`);
  console.log(`Название: ${script.title || 'без названия'}`);
  console.log(`Тип: ${script.type}`);
  console.log('');
  
  if (!script.action || !Array.isArray(script.action) || script.action.length === 0) {
    console.log('⚠️  Скрипт не содержит действий (action пуст)\n');
  } else {
    console.log(`📋 ДЕЙСТВИЯ СКРИПТА (${script.action.length} действий)\n`);
    
    script.action.forEach((action, index) => {
      console.log(`${'═'.repeat(55)}`);
      console.log(`ДЕЙСТВИЕ ${index + 1}\n`);
      console.log(`Тип: ${action.type || 'не указан'}`);
      
      if (action.payload) {
        console.log(`Payload: ${JSON.stringify(action.payload, null, 2)}`);
      }
      
      if (action.delay !== undefined) {
        console.log(`Задержка: ${action.delay}мс`);
      }
      
      // Зачем: Анализируем payload для поиска устройств и каналов
      if (action.payload) {
        const payload = action.payload;
        
        // Зачем: Ищем device/channel в payload
        if (payload.device || payload.channel) {
          const deviceId = payload.device;
          const channelId = payload.channel;
          
          console.log('\n🔍 АНАЛИЗ УСТРОЙСТВА/КАНАЛА:');
          
          if (deviceId) {
            const device = allDevices.get(deviceId);
            if (device) {
              const deviceType = typeof device.type === 'number' 
                ? (DEVICE_TYPE_NAMES[device.type] || `Тип0x${device.type.toString(16)}`)
                : device.type.toUpperCase();
              
              console.log(`  Устройство:`);
              console.log(`    ID: ${deviceId}`);
              console.log(`    Название: ${device.title || device.code || device.name || 'без названия'}`);
              console.log(`    Тип: ${deviceType}`);
              
              if (device.bind) {
                console.log(`    Bind: ${device.bind}`);
              }
            } else {
              console.log(`  ⚠️  Устройство ${deviceId} не найдено в БД`);
            }
          }
          
          if (channelId) {
            console.log(`  Канал: ${channelId}`);
            
            // Зачем: Парсим канал: "MAC-адрес/тип/индекс"
            const parts = channelId.split('/');
            if (parts.length >= 3) {
              const [deviceMac, channelType, channelIndex] = parts;
              console.log(`    MAC актуатора: ${deviceMac}`);
              console.log(`    Тип канала: ${channelType}`);
              console.log(`    Индекс канала: ${channelIndex}`);
              
              // Зачем: Ищем актуатор по MAC-адресу
              const actuator = allDevices.get(deviceMac);
              if (actuator) {
                const actuatorType = typeof actuator.type === 'number' 
                  ? (DEVICE_TYPE_NAMES[actuator.type] || `Тип0x${actuator.type.toString(16)}`)
                  : actuator.type.toUpperCase();
                
                console.log(`    ✅ Актуатор найден:`);
                console.log(`       ID: ${deviceMac}`);
                console.log(`       Название: ${actuator.title || actuator.code || actuator.name || 'без названия'}`);
                console.log(`       Тип: ${actuatorType}`);
              } else {
                console.log(`    ⚠️  Актуатор с MAC ${deviceMac} не найден в БД`);
              }
            }
          }
          
          // Зачем: Ищем устройства, привязанные к этому каналу
          if (channelId) {
            console.log('\n  🔗 УСТРОЙСТВА, ПРИВЯЗАННЫЕ К КАНАЛУ:');
            let foundBindings = false;
            
            for (const [deviceKey, deviceValue] of allDevices.entries()) {
              if (deviceValue.bind === channelId) {
                foundBindings = true;
                const deviceType = typeof deviceValue.type === 'number' 
                  ? (DEVICE_TYPE_NAMES[deviceValue.type] || `Тип0x${deviceValue.type.toString(16)}`)
                  : deviceValue.type.toUpperCase();
                
                console.log(`    - ${deviceValue.title || deviceValue.code || deviceValue.name || deviceKey}`);
                console.log(`      ID: ${deviceKey}`);
                console.log(`      Тип: ${deviceType}`);
              }
            }
            
            if (!foundBindings) {
              console.log(`    ⚠️  Устройства не привязаны к каналу ${channelId}`);
            }
          }
        }
        
        // Зачем: Показываем значение (value) для действий типа ACTION_DIM, ACTION_DO и т.д.
        if (payload.value !== undefined) {
          console.log(`\n  Значение: ${payload.value}`);
        }
      }
      
      console.log('');
    });
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

inspectScriptActions().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
