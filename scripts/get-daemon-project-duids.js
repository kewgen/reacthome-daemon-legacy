#!/usr/bin/env node

/**
 * Получение duid демона и проекта из БД
 * 
 * Использование:
 *   node scripts/get-daemon-project-duids.js [путь_к_бд]
 * 
 * Переменные окружения:
 *   DB_PATH - путь к LevelDB
 * 
 * Зачем: Извлечь duid демона и проекта из БД для идентификации
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || process.argv[2] || path.join(process.cwd(), 'var', 'db');

async function getDuids() {
  try {
    console.log(`📂 Открываю БД: ${DB_PATH}\n`);
    
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    let macKey = null;
    let daemonId = null;
    let daemonObject = null;
    let projectId = null;
    let projectObject = null;
    let allKeys = [];
    
    // Собираем все ключи
    for await (const [key, value] of db.iterator()) {
      const keyStr = String(key);
      allKeys.push(keyStr);
      
      // 1. Ищем ключ "mac"
      if (keyStr === 'mac') {
        macKey = value;
        daemonId = value;
        console.log('✅ Найден ключ "mac":');
        console.log(`   UUID демона: ${value}\n`);
      }
      
      // 2. Проверяем, является ли ключ UUID демона
      if (macKey && keyStr === macKey) {
        daemonObject = value;
        console.log('✅ Найден объект демона:');
        console.log(`   Ключ: ${keyStr}`);
        console.log(`   Тип: ${value.type || 'не указан'}`);
        console.log(`   Project ID: ${value.project || 'не указан'}`);
        if (value.project) {
          projectId = value.project;
        }
        console.log();
      }
      
      // 3. Проверяем тип объекта
      if (value && typeof value === 'object' && value.type === 'daemon') {
        if (!daemonObject || keyStr !== macKey) {
          console.log(`⚠️  Найден объект с type="daemon" по ключу: ${keyStr}`);
          console.log(`   Project ID: ${value.project || 'не указан'}`);
          if (value.project) {
            projectId = value.project;
          }
          console.log();
        }
      }
      
      // 4. Проверяем тип проекта
      if (value && typeof value === 'object' && (value.type === 'project' || value.type === 'PROJECT')) {
        if (!projectObject || keyStr !== projectId) {
          projectObject = value;
          console.log('✅ Найден объект проекта:');
          console.log(`   Ключ: ${keyStr}`);
          console.log(`   Тип: ${value.type}`);
          console.log(`   Название: ${value.title || value.code || 'не указано'}`);
          console.log();
        }
      }
    }
    
    // Если не нашли объект демона по UUID, ищем по типу
    if (!daemonObject && macKey) {
      console.log(`⚠️  Объект демона не найден по ключу "${macKey}"`);
      console.log(`   Проверяю все записи с type="daemon"...\n`);
      
      for await (const [key, value] of db.iterator()) {
        if (value && typeof value === 'object' && value.type === 'daemon') {
          daemonObject = value;
          daemonId = String(key);
          projectId = value.project;
          console.log('✅ Найден объект демона:');
          console.log(`   Ключ: ${daemonId}`);
          console.log(`   Project ID: ${projectId || 'не указан'}`);
          console.log();
          break;
        }
      }
    }
    
    // Ищем проект по ID из демона
    if (projectId && !projectObject) {
      try {
        const project = await db.get(projectId);
        if (project && (project.type === 'project' || project.type === 'PROJECT')) {
          projectObject = project;
          console.log('✅ Найден объект проекта по ID из демона:');
          console.log(`   Ключ: ${projectId}`);
          console.log(`   Тип: ${project.type}`);
          console.log(`   Название: ${project.title || project.code || 'не указано'}`);
          console.log();
        }
      } catch (e) {
        console.log(`⚠️  Проект с ID "${projectId}" не найден в БД\n`);
      }
    }
    
    // Итоговый результат
    console.log('\n' + '='.repeat(60));
    console.log('📊 РЕЗУЛЬТАТЫ');
    console.log('='.repeat(60) + '\n');
    
    if (macKey) {
      console.log('🆔 DUID ДЕМОНА:');
      console.log(`   ${macKey}\n`);
    } else {
      console.log('❌ DUID демона не найден (ключ "mac" отсутствует)\n');
    }
    
    if (daemonObject) {
      console.log('📦 ОБЪЕКТ ДЕМОНА:');
      console.log(`   Ключ: ${daemonId}`);
      console.log(`   Тип: ${daemonObject.type}`);
      console.log(`   Project ID: ${daemonObject.project || 'не указан'}`);
      console.log();
    } else {
      console.log('❌ Объект демона не найден в БД\n');
    }
    
    if (projectId) {
      console.log('🆔 DUID ПРОЕКТА:');
      console.log(`   ${projectId}\n`);
    } else {
      console.log('❌ DUID проекта не найден (поле project отсутствует в демоне)\n');
    }
    
    if (projectObject) {
      console.log('📦 ОБЪЕКТ ПРОЕКТА:');
      console.log(`   Ключ: ${projectId}`);
      console.log(`   Тип: ${projectObject.type}`);
      console.log(`   Название: ${projectObject.title || projectObject.code || 'не указано'}`);
      if (projectObject.site) {
        console.log(`   Сайтов: ${Array.isArray(projectObject.site) ? projectObject.site.length : 'не массив'}`);
      }
      if (projectObject.device) {
        console.log(`   Устройств: ${Array.isArray(projectObject.device) ? projectObject.device.length : 'не массив'}`);
      }
      console.log();
    } else {
      console.log('❌ Объект проекта не найден в БД\n');
    }
    
    // Статистика
    console.log('📈 СТАТИСТИКА БД:');
    console.log(`   Всего записей: ${allKeys.length}`);
    console.log();
    
    await db.close();
    
    // Возвращаем результат в формате JSON для использования в других скриптах
    const result = {
      daemon: {
        duid: macKey || daemonId || null,
        object: daemonObject || null
      },
      project: {
        duid: projectId || null,
        object: projectObject || null
      }
    };
    
    console.log('📋 JSON результат:');
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.code === 'ENOENT') {
      console.error(`   БД не найдена по пути: ${DB_PATH}`);
    } else if (error.code === 'LEVEL_NOT_FOUND') {
      console.error('   Запись не найдена в БД');
    } else {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

getDuids();
