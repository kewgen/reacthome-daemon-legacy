#!/usr/bin/env node

/**
 * Скрипт для поиска устройства или записи по UUID в базе данных
 * 
 * Использование:
 *   node scripts/find-device-by-uuid.js "2dc36141-d0ea-49f6-9e21-0806f6125d3f"
 * 
 * Зачем: Позволяет найти любую запись в БД по UUID, включая каналы и другие типы записей
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const UUID = process.argv[2];

if (!UUID) {
  console.error('❌ Укажите UUID');
  console.error('Использование: node scripts/find-device-by-uuid.js "UUID"');
  process.exit(1);
}

async function findDeviceByUuid() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ ПОИСК ЗАПИСИ ПО UUID                                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`UUID: "${UUID}"\n`);
  console.log(`Открываем БД: ${DB_PATH}\n`);
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const sites = [];
  const siteMap = new Map();
  let foundRecords = [];
  
  try {
    // Зачем: Ищем запись по UUID (может быть в ключе или в значении)
    // Зачем: Загружаем помещения и ищем UUID за один проход
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем помещения
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({ id: key, name: siteName });
        siteMap.set(key, siteName);
      }
      if (!value || typeof value !== 'object') continue;
      
      // Проверяем по ключу
      if (key === UUID || key.includes(UUID)) {
        foundRecords.push({ key, value, matchType: 'key' });
      }
      
      // Проверяем по полям в значении
      if (value.id === UUID || 
          value.site === UUID ||
          value.onStartVentilation === UUID ||
          value.onStopVentilation === UUID ||
          value.bind === UUID ||
          (Array.isArray(value.site) && value.site.includes(UUID))) {
        foundRecords.push({ key, value, matchType: 'value' });
      }
      
      // Зачем: Проверяем вложенные объекты
      if (typeof value === 'object') {
        const checkNested = (obj, path = '') => {
          for (const [k, v] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${k}` : k;
            if (v === UUID || (typeof v === 'string' && v.includes(UUID))) {
              foundRecords.push({ 
                key, 
                value, 
                matchType: 'nested',
                matchPath: currentPath,
                matchValue: v
              });
            }
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              checkNested(v, currentPath);
            }
          }
        };
        checkNested(value);
      }
    }
  } finally {
    await db.close();
  }
  
  // Зачем: Удаляем дубликаты
  const uniqueRecords = [];
  const seenKeys = new Set();
  foundRecords.forEach(record => {
    if (!seenKeys.has(record.key)) {
      seenKeys.add(record.key);
      uniqueRecords.push(record);
    }
  });
  
  console.log('═══════════════════════════════════════════════════════════\n');
  
  if (uniqueRecords.length === 0) {
    console.log('❌ Запись с таким UUID не найдена\n');
    console.log('Возможные причины:');
    console.log('- UUID указан неверно');
    console.log('- Запись была удалена');
    console.log('- UUID относится к другой базе данных\n');
  } else {
    console.log(`📊 НАЙДЕНО ЗАПИСЕЙ: ${uniqueRecords.length}\n`);
    
    uniqueRecords.forEach((record, index) => {
      console.log(`\n${'═'.repeat(55)}`);
      console.log(`📋 ЗАПИСЬ ${index + 1}\n`);
      console.log(`Ключ: ${record.key}`);
      console.log(`Тип совпадения: ${record.matchType}`);
      if (record.matchPath) {
        console.log(`Путь совпадения: ${record.matchPath}`);
        console.log(`Значение: ${record.matchValue}`);
      }
      console.log('');
      
      const value = record.value;
      const type = value.type;
      
      console.log(`Тип записи: ${type || 'не указан'}`);
      
      // Зачем: Определяем название
      const name = value.title || value.code || value.name || 'без названия';
      console.log(`Название: ${name}`);
      
      if (value.code) console.log(`Code: ${value.code}`);
      if (value.title) console.log(`Title: ${value.title}`);
      if (value.name) console.log(`Name: ${value.name}`);
      
      // Зачем: Определяем помещение
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
      
      if (siteName) {
        console.log(`Помещение: ${siteName} (${siteId})`);
      }
      
      // Зачем: Показываем важные поля
      console.log('\nВажные поля:');
      const importantFields = ['bind', 'value', 'state', 'onStartVentilation', 'onStopVentilation', 'setpoint', 'hysteresis'];
      importantFields.forEach(field => {
        if (value[field] !== undefined) {
          console.log(`  ${field}: ${JSON.stringify(value[field])}`);
        }
      });
      
      // Зачем: Показываем все поля
      console.log('\nВсе поля:');
      const allKeys = Object.keys(value).sort();
      allKeys.forEach(key => {
        const val = value[key];
        const valType = typeof val;
        let displayValue;
        
        if (val === null) {
          displayValue = 'null';
        } else if (val === undefined) {
          displayValue = 'undefined';
        } else if (Array.isArray(val)) {
          displayValue = `[массив, длина: ${val.length}]`;
        } else if (typeof val === 'object') {
          displayValue = `{объект, ключей: ${Object.keys(val).length}}`;
        } else {
          displayValue = String(val);
          if (displayValue.length > 100) {
            displayValue = displayValue.substring(0, 97) + '...';
          }
        }
        
        console.log(`  ${key}: ${displayValue} (${valType})`);
      });
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

findDeviceByUuid().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
