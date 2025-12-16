#!/usr/bin/env node

/**
 * Скрипт для проверки наличия устройств с CO2 и Doppler в базе данных
 * Зачем: Позволяет найти устройства, которые могут измерять CO2 или являются Doppler-сенсорами
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');

// Типы устройств, которые могут измерять CO2 или являются Doppler
const CO2_CAPABLE_TYPES = [0x01, 0x02, 0x03]; // SENSOR4, SENSOR6, THI
const DOPPLER_TYPES = [0x04, 0x2d, 0x2e]; // DOPPLER, DOPPLER_1_DI_4, DOPPLER_5_DI_4

const TYPE_NAMES = {
  0x01: 'DEVICE_TYPE_SENSOR4',
  0x02: 'DEVICE_TYPE_SENSOR6',
  0x03: 'DEVICE_TYPE_THI',
  0x04: 'DEVICE_TYPE_DOPPLER',
  0x2d: 'DEVICE_TYPE_DOPPLER_1_DI_4',
  0x2e: 'DEVICE_TYPE_DOPPLER_5_DI_4',
};

async function checkDevices() {
  console.log(`\n🔍 Поиск устройств с CO2 и Doppler...\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  let db;
  try {
    db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    const co2Devices = [];
    const dopplerDevices = [];
    const devicesWithCo2Field = [];
    
    for await (const [key, value] of db.iterator()) {
      if (value && typeof value === 'object' && typeof value.type === 'number') {
        if (!key.includes('/')) {
          const device = { id: key, ...value };
          
          // Проверяем тип устройства
          if (CO2_CAPABLE_TYPES.includes(value.type)) {
            co2Devices.push(device);
          }
          
          if (DOPPLER_TYPES.includes(value.type)) {
            dopplerDevices.push(device);
          }
          
          // Проверяем наличие поля co2 (даже если тип не в списке)
          if (value.co2 !== undefined) {
            devicesWithCo2Field.push(device);
          }
        }
      }
    }
    
    await db.close();
    
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Устройства, способные измерять CO2
    console.log(`📊 Устройства с возможностью измерения CO2 (SENSOR4/SENSOR6/THI): ${co2Devices.length}\n`);
    if (co2Devices.length > 0) {
      co2Devices.forEach((device, i) => {
        const name = device.title || device.code || device.name || 'без названия';
        const typeName = TYPE_NAMES[device.type] || `Тип ${device.type}`;
        const co2Value = device.co2 !== undefined ? `CO2: ${device.co2}` : 'CO2: не измеряется';
        console.log(`  ${i + 1}. ${name}`);
        console.log(`     ID: ${device.id}`);
        console.log(`     Тип: ${typeName}`);
        console.log(`     ${co2Value}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  Устройства с возможностью измерения CO2 не найдены\n');
    }
    
    // Doppler устройства
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📊 Doppler устройства: ${dopplerDevices.length}\n`);
    if (dopplerDevices.length > 0) {
      dopplerDevices.forEach((device, i) => {
        const name = device.title || device.code || device.name || 'без названия';
        const typeName = TYPE_NAMES[device.type] || `Тип ${device.type}`;
        console.log(`  ${i + 1}. ${name}`);
        console.log(`     ID: ${device.id}`);
        console.log(`     Тип: ${typeName}`);
        console.log(`     IP: ${device.ip || 'не указан'}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  Doppler устройства не найдены\n');
    }
    
    // Устройства с полем co2
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📊 Устройства с полем co2 в данных: ${devicesWithCo2Field.length}\n`);
    if (devicesWithCo2Field.length > 0) {
      devicesWithCo2Field.forEach((device, i) => {
        const name = device.title || device.code || device.name || 'без названия';
        const typeName = TYPE_NAMES[device.type] || `Тип ${device.type} (0x${device.type.toString(16)})`;
        console.log(`  ${i + 1}. ${name}`);
        console.log(`     ID: ${device.id}`);
        console.log(`     Тип: ${typeName}`);
        console.log(`     CO2: ${device.co2}`);
        console.log('');
      });
    } else {
      console.log('  ⚠️  Устройства с полем co2 не найдены\n');
    }
    
    console.log('═══════════════════════════════════════════════════════════\n');
    
  } catch (error) {
    if (db) {
      await db.close();
    }
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

checkDevices().catch(error => {
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});
