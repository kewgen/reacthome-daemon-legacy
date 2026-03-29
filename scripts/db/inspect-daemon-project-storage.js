#!/usr/bin/env node

/**
 * Проверка хранения id демона и проекта в LevelDB
 * 
 * Использование:
 *   node scripts/inspect-daemon-project-storage.js [путь_к_бд]
 * 
 * Переменные окружения:
 *   DB_PATH - путь к LevelDB (по умолчанию: var/db)
 * 
 * Зачем: Понять структуру хранения id демона и проекта в БД
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || process.argv[2] || path.join(process.cwd(), 'var', 'db');

async function inspectStorage() {
  try {
    console.log(`📂 Открываю БД: ${DB_PATH}\n`);
    
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    let macKey = null;
    let daemonId = null;
    let daemonObject = null;
    let projectId = null;
    let projectObject = null;
    
    // Проходим по всем записям в БД
    for await (const [key, value] of db.iterator()) {
      const keyStr = String(key);
      
      // 1. Ищем ключ "mac" - хранит UUID демона
      if (keyStr === 'mac') {
        macKey = value;
        console.log('✅ Найден ключ "mac":');
        console.log(`   Ключ: "mac"`);
        console.log(`   Значение (UUID демона): ${value}\n`);
        daemonId = value;
      }
      
      // 2. Ищем объект демона по его UUID (значение из ключа "mac")
      if (macKey && keyStr === macKey) {
        daemonObject = value;
        console.log('✅ Найден объект демона:');
        console.log(`   Ключ: ${keyStr}`);
        console.log(`   Тип: ${value.type || 'не указан'}`);
        console.log(`   Project ID: ${value.project || 'не указан'}`);
        if (value.device) {
          console.log(`   Устройств: ${Array.isArray(value.device) ? value.device.length : 'не массив'}`);
        }
        console.log(`   Полный объект:`, JSON.stringify(value, null, 2));
        console.log();
        projectId = value.project;
      }
      
      // 3. Ищем объект проекта по project ID из демона
      if (projectId && keyStr === projectId) {
        projectObject = value;
        console.log('✅ Найден объект проекта:');
        console.log(`   Ключ: ${keyStr}`);
        console.log(`   Тип: ${value.type || 'не указан'}`);
        console.log(`   Название: ${value.title || value.code || 'не указано'}`);
        if (value.site) {
          console.log(`   Сайтов: ${Array.isArray(value.site) ? value.site.length : 'не массив'}`);
        }
        if (value.device) {
          console.log(`   Устройств: ${Array.isArray(value.device) ? value.device.length : 'не массив'}`);
        }
        console.log(`   Полный объект:`, JSON.stringify(value, null, 2));
        console.log();
      }
    }
    
    // Итоговая информация
    console.log('\n=== 📊 ИТОГОВАЯ СТРУКТУРА ХРАНЕНИЯ ===\n');
    
    if (macKey) {
      console.log('1️⃣  ID демона хранится в двух местах:');
      console.log(`   • Ключ "mac" → значение: "${macKey}" (UUID демона)`);
      console.log(`   • Ключ "${macKey}" → объект демона с type="daemon"`);
      console.log();
    } else {
      console.log('❌ Ключ "mac" не найден в БД');
      console.log();
    }
    
    if (daemonObject) {
      console.log('2️⃣  Объект демона содержит:');
      console.log(`   • type: "${daemonObject.type}"`);
      if (daemonObject.project) {
        console.log(`   • project: "${daemonObject.project}" (ID проекта)`);
      } else {
        console.log(`   • project: отсутствует`);
      }
      console.log();
    } else {
      console.log('❌ Объект демона не найден в БД');
      console.log();
    }
    
    if (projectObject) {
      console.log('3️⃣  Объект проекта содержит:');
      console.log(`   • type: "${projectObject.type}"`);
      console.log(`   • ID проекта: "${projectId}" (используется как ключ в БД)`);
      if (projectObject.project) {
        console.log(`   • project: "${projectObject.project}" (родительский проект, если есть)`);
      }
      console.log();
    } else {
      console.log('⚠️  Объект проекта не найден в БД');
      console.log('   (возможно, демон ещё не настроен или проект не создан)');
      console.log();
    }
    
    // Схема связей
    console.log('=== 🔗 СХЕМА СВЯЗЕЙ ===\n');
    console.log('LevelDB структура:');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│ Ключ: "mac"                              │');
    console.log('│ Значение: UUID демона (например)         │');
    console.log('│   "d31775ae-2025-12-28T18-06-41-h4s"     │');
    console.log('└─────────────────────────────────────────┘');
    console.log('                    ↓');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│ Ключ: <UUID демона>                     │');
    console.log('│ Значение: {                             │');
    console.log('│   type: "daemon",                        │');
    console.log('│   project: "<ID проекта>",  ←──────┐     │');
    console.log('│   device: [...],                    │     │');
    console.log('│   ...                               │     │');
    console.log('│ }                                    │     │');
    console.log('└─────────────────────────────────────────┘');
    console.log('                    │');
    console.log('                    └──────────────────────┐');
    console.log('                                         │');
    console.log('                                         ↓');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│ Ключ: <ID проекта>                      │');
    console.log('│ Значение: {                             │');
    console.log('│   type: "project",                      │');
    console.log('│   site: [...],                          │');
    console.log('│   device: [...],                        │');
    console.log('│   driver: [...],                        │');
    console.log('│   script: [...],                        │');
    console.log('│   ...                                   │');
    console.log('│ }                                       │');
    console.log('└─────────────────────────────────────────┘');
    console.log();
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.code === 'ENOENT') {
      console.error(`   БД не найдена по пути: ${DB_PATH}`);
      console.error('   Проверьте путь к БД\n');
    } else if (error.code === 'LEVEL_NOT_FOUND') {
      console.error('   Запись не найдена в БД\n');
    } else {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

inspectStorage();
