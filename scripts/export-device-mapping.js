#!/usr/bin/env node

/**
 * Экспорт маппинга устройств ID -> {все поля из БД + human} из LevelDB
 * Использование: node export-device-mapping.js [путь_к_бд] [выходной_файл]
 * 
 * Экспортирует ВСЕ поля из БД для каждой записи + вычисляемое поле 'human' для резолвинга
 */

const { Level } = require('level');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.argv[2] || '/tmp/reacthome-state/db';
const OUTPUT_FILE = process.argv[3] || './device-mapping.json';

async function exportMapping() {
  try {
    console.error(`📊 Открываю БД: ${DB_PATH}`);
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    const mapping = {};
    let totalCount = 0;
    let mappedCount = 0;
    
    for await (const [key, value] of db.iterator()) {
      totalCount++;
      
      // Фильтруем только записи с устройствами (объекты с timestamp)
      if (value && typeof value === 'object' && value.timestamp) {
        const humanName = getHumanName(value);
        
        // Экспортируем ВСЕ поля из БД + вычисляемое поле human
        mapping[key] = {
          ...value,  // Все поля из БД
          human: humanName  // Добавляем вычисляемое поле для резолвинга
        };
        
        if (humanName) {
          mappedCount++;
        }
      }
    }
    
    await db.close();
    
    // Сохраняем маппинг
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2));
    
    console.error(`✅ Маппинг сохранён в ${OUTPUT_FILE}`);
    console.error(`📊 Статистика:`);
    console.error(`   Всего записей в БД: ${totalCount}`);
    console.error(`   Устройств: ${Object.keys(mapping).length}`);
    console.error(`   С человекочитаемыми именами: ${mappedCount}`);
    
    // Выводим примеры
    console.error(`\n📝 Примеры маппинга:`);
    const examples = Object.entries(mapping)
      .filter(([id, data]) => data.human)
      .slice(0, 10);
    
    examples.forEach(([id, data]) => {
      console.error(`   ${id} => ${data.human}`);
    });
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Функция getHumanName (из event-log.js)
function getHumanName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  
  const parts = [];
  if (obj.title) parts.push(obj.title);
  if (obj.code) parts.push(obj.code);
  if (obj.name) parts.push(obj.name);
  
  return parts.length > 0 ? parts.join('/') : null;
}

exportMapping();
