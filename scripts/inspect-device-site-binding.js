#!/usr/bin/env node

/**
 * Скрипт для проверки привязки устройства к помещению (site)
 * 
 * Использование:
 *   node scripts/inspect-device-site-binding.js "34731215-af9b-4847-b2f9-67c8940271c0"
 *   node scripts/inspect-device-site-binding.js "6.D.L.3"
 * 
 * Зачем: Позволяет проверить, почему устройство не имеет привязку к site в базе данных
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const DEVICE_ID_OR_CODE = process.argv[2];

if (!DEVICE_ID_OR_CODE) {
  console.error('❌ Укажите ID устройства или код');
  console.error('Использование: node scripts/inspect-device-site-binding.js "ID или код"');
  process.exit(1);
}

async function inspectDeviceSiteBinding() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПРОВЕРКА ПРИВЯЗКИ УСТРОЙСТВА К ПОМЕЩЕНИЮ                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Поиск: "${DEVICE_ID_OR_CODE}"\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const sites = [];
  const siteMap = new Map();
  let foundDevice = null;
  
  try {
    // Зачем: Сначала загружаем все помещения
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({ id: key, name: siteName, raw: value });
        siteMap.set(key, siteName);
      }
    }
    
    console.log(`📋 Загружено помещений: ${sites.length}\n`);
    
    // Зачем: Ищем устройство по ID или коду
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      // Проверяем по ID
      if (key === DEVICE_ID_OR_CODE) {
        foundDevice = { id: key, raw: value };
        break;
      }
      
      // Проверяем по коду
      if (value.code && value.code.includes(DEVICE_ID_OR_CODE)) {
        foundDevice = { id: key, raw: value };
        break;
      }
      
      // Проверяем по названию
      const name = value.title || value.code || value.name || '';
      if (name.toLowerCase().includes(DEVICE_ID_OR_CODE.toLowerCase())) {
        foundDevice = { id: key, raw: value };
        break;
      }
    }
  } finally {
    await db.close();
  }
  
  if (!foundDevice) {
    console.log('❌ Устройство не найдено\n');
    process.exit(1);
  }
  
  const device = foundDevice.raw;
  const deviceId = foundDevice.id;
  
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📱 УСТРОЙСТВО НАЙДЕНО\n`);
  console.log(`ID: ${deviceId}`);
  console.log(`Название: ${device.title || device.code || device.name || '—'}`);
  console.log(`Code: ${device.code || '—'}`);
  console.log(`Title: ${device.title || '—'}`);
  console.log(`Name: ${device.name || '—'}`);
  console.log(`Тип: ${device.type || '—'}`);
  console.log('');
  
  // Зачем: Проверяем поле site
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`🔍 ПРОВЕРКА ПРИВЯЗКИ К ПОМЕЩЕНИЮ\n`);
  
  const siteField = device.site;
  console.log(`Поле 'site': ${JSON.stringify(siteField)}`);
  console.log(`Тип: ${typeof siteField}`);
  
  if (siteField === undefined) {
    console.log(`\n⚠️  ПРОБЛЕМА: Поле 'site' отсутствует (undefined)`);
  } else if (siteField === null) {
    console.log(`\n⚠️  ПРОБЛЕМА: Поле 'site' равно null`);
  } else if (siteField === '') {
    console.log(`\n⚠️  ПРОБЛЕМА: Поле 'site' пустая строка`);
  } else if (Array.isArray(siteField)) {
    console.log(`\n📋 Поле 'site' является массивом:`);
    siteField.forEach((siteId, index) => {
      const siteName = siteMap.get(siteId) || 'не найдено';
      console.log(`  [${index}]: ${siteId} → ${siteName}`);
    });
    if (siteField.length === 0) {
      console.log(`\n⚠️  ПРОБЛЕМА: Массив 'site' пустой`);
    }
  } else if (typeof siteField === 'string') {
    const siteName = siteMap.get(siteField) || 'не найдено';
    console.log(`\n✅ Поле 'site' содержит ID помещения:`);
    console.log(`  ID: ${siteField}`);
    console.log(`  Название: ${siteName}`);
    if (siteName === 'не найдено') {
      console.log(`\n⚠️  ПРОБЛЕМА: Помещение с ID "${siteField}" не найдено в БД`);
    }
  } else {
    console.log(`\n⚠️  ПРОБЛЕМА: Неожиданный тип поля 'site': ${typeof siteField}`);
  }
  
  // Зачем: Проверяем другие поля, которые могут содержать информацию о помещении
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log(`🔍 ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ\n`);
  
  const otherSiteFields = ['siteId', 'site_id', 'room', 'roomId', 'location', 'locationId'];
  let foundOtherFields = false;
  
  otherSiteFields.forEach(field => {
    if (device[field] !== undefined) {
      foundOtherFields = true;
      console.log(`  ${field}: ${JSON.stringify(device[field])}`);
    }
  });
  
  if (!foundOtherFields) {
    console.log(`  Дополнительные поля помещения не найдены`);
  }
  
  // Зачем: Проверяем, содержит ли код/название устройства название помещения
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log(`🔍 АНАЛИЗ КОДА/НАЗВАНИЯ УСТРОЙСТВА\n`);
  
  const deviceCode = device.code || '';
  const deviceTitle = device.title || '';
  const deviceName = device.name || '';
  
  console.log(`Code: "${deviceCode}"`);
  console.log(`Title: "${deviceTitle}"`);
  console.log(`Name: "${deviceName}"`);
  console.log('');
  
  const siteNames = sites.map(s => s.name);
  const matchingSites = [];
  
  siteNames.forEach(siteName => {
    const codeContains = deviceCode.toLowerCase().includes(siteName.toLowerCase());
    const titleContains = deviceTitle.toLowerCase().includes(siteName.toLowerCase());
    const nameContains = deviceName.toLowerCase().includes(siteName.toLowerCase());
    
    if (codeContains || titleContains || nameContains) {
      matchingSites.push({
        name: siteName,
        foundIn: {
          code: codeContains,
          title: titleContains,
          name: nameContains,
        }
      });
    }
  });
  
  if (matchingSites.length > 0) {
    console.log(`✅ Найдены совпадения с помещениями:\n`);
    matchingSites.forEach(match => {
      const foundIn = [];
      if (match.foundIn.code) foundIn.push('Code');
      if (match.foundIn.title) foundIn.push('Title');
      if (match.foundIn.name) foundIn.push('Name');
      console.log(`  - ${match.name} (найдено в: ${foundIn.join(', ')})`);
    });
    console.log(`\n💡 РЕКОМЕНДАЦИЯ: Устройство должно быть привязано к помещению "${matchingSites[0].name}"`);
  } else {
    console.log(`⚠️  Совпадений с названиями помещений не найдено`);
  }
  
  // Зачем: Показываем все поля устройства для полного анализа
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log(`📋 ВСЕ ПОЛЯ УСТРОЙСТВА\n`);
  
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
      if (displayValue.length > 50) {
        displayValue = displayValue.substring(0, 47) + '...';
      }
    }
    
    console.log(`  ${key}: ${displayValue} (${type})`);
  });
  
  // Зачем: Показываем список всех помещений для справки
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log(`📋 СПИСОК ВСЕХ ПОМЕЩЕНИЙ В БД\n`);
  
  if (sites.length === 0) {
    console.log('  Помещения не найдены');
  } else {
    sites.forEach((site, index) => {
      console.log(`  ${index + 1}. ${site.name} (ID: ${site.id})`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

inspectDeviceSiteBinding().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
