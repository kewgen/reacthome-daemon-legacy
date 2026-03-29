#!/usr/bin/env node

/**
 * Скрипт для поиска всех устройств освещения (light_220, light_LED, light_RGB)
 * 
 * Использование:
 *   node scripts/find-all-lights.js
 *   node scripts/find-all-lights.js "Лоджия"
 * 
 * Зачем: Позволяет найти все устройства освещения, включая споты, бра и другие светильники
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const SITE_FILTER = process.argv[2]; // Опциональный фильтр по помещению

const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP',
  'thermostat', 'hygrostat', 'co2_stat'
];

async function findAllLights() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОИСК ВСЕХ УСТРОЙСТВ ОСВЕЩЕНИЯ${SITE_FILTER ? ` (${SITE_FILTER})` : ''}                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const sites = [];
  const siteMap = new Map();
  
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
      
      // Загружаем устройства освещения (light_220, light_LED, light_RGB)
      if (typeof type === 'string' && 
          (type === 'light_220' || type === 'light_LED' || type === 'light_RGB' || type === 'light_led') &&
          !key.includes('/')) {
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
        
        // Зачем: Фильтруем по помещению, если указан фильтр
        if (SITE_FILTER && siteName !== SITE_FILTER) {
          continue;
        }
        
        const deviceName = value.title || value.code || value.name || 'без названия';
        
        devices.push({
          id: key,
          name: deviceName,
          code: value.code || null,
          title: value.title || null,
          name_field: value.name || null,
          type: type,
          typeName: type.toUpperCase(),
          siteId: siteId,
          site: siteName,
          bind: value.bind || null,
        });
      }
    }
  } finally {
    await db.close();
  }
  
  // Сортируем по помещению и названию
  devices.sort((a, b) => {
    if (a.site !== b.site) {
      if (!a.site) return 1;
      if (!b.site) return -1;
      return a.site.localeCompare(b.site);
    }
    return a.name.localeCompare(b.name);
  });
  
  // Выводим результаты
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📊 НАЙДЕНО УСТРОЙСТВ ОСВЕЩЕНИЯ: ${devices.length}\n`);
  
  if (devices.length === 0) {
    console.log('⚠️  Устройства освещения не найдены\n');
  } else {
    // Группируем по помещениям
    const bySite = {};
    devices.forEach(device => {
      const site = device.site || 'Без помещения';
      if (!bySite[site]) {
        bySite[site] = [];
      }
      bySite[site].push(device);
    });
    
    // Выводим по помещениям
    for (const [site, siteDevices] of Object.entries(bySite)) {
      console.log(`\n🏠 ${site.toUpperCase()} (${siteDevices.length} устройств)\n`);
      
      siteDevices.forEach((device, index) => {
        console.log(`  ${index + 1}. ${device.name}`);
        console.log(`     ID: ${device.id}`);
        console.log(`     Тип: ${device.typeName}`);
        if (device.code && device.code !== device.name) {
          console.log(`     Code: ${device.code}`);
        }
        if (device.title && device.title !== device.name && device.title !== device.code) {
          console.log(`     Title: ${device.title}`);
        }
        if (device.bind) {
          console.log(`     Bind: ${device.bind}`);
        }
        console.log('');
      });
    }
    
    // Выводим список ID
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('📋 ID УСТРОЙСТВ ОСВЕЩЕНИЯ:\n');
    devices.forEach(device => {
      console.log(`  ${device.id}`);
    });
    
    // Выводим список в формате: id | type | name | site
    console.log('\n═══════════════════════════════════════════════════════════\n');
    console.log('📋 СПИСОК: ID | TYPE | NAME | SITE\n');
    devices.forEach(device => {
      const site = device.site || '—';
      console.log(`${device.id} | ${device.typeName} | ${device.name} | ${site}`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

findAllLights().catch(error => {
  console.error('❌ Ошибка:', error.message);
  process.exit(1);
});
