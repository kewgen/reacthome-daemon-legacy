#!/usr/bin/env node

/**
 * Скрипт для поиска скриптов в базе данных LevelDB
 * Использует прямое чтение файлов БД через leveldown или поиск через WebSocket
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SEARCH_TERM = process.argv[2] || process.env.REACTHOME_SCRIPT_SEARCH || '';
const DB_PATH = process.env.REACTHOME_DB_PATH || '/home/pi/reacthome-daemon/var/db';
const USE_SSH = process.env.REACTHOME_USE_SSH === 'true';
const SSH_HOST = process.env.REACTHOME_SSH_HOST || 'pi@192.168.88.4';

if (!SEARCH_TERM) {
  console.error('Использование: node search-script-in-db.js "название скрипта"');
  console.error('Или: REACTHOME_SCRIPT_SEARCH="название" node search-script-in-db.js');
  console.error('');
  console.error('Переменные окружения:');
  console.error('  REACTHOME_DB_PATH - путь к БД (по умолчанию: /home/pi/reacthome-daemon/var/db)');
  console.error('  REACTHOME_USE_SSH - использовать SSH (true/false)');
  console.error('  REACTHOME_SSH_HOST - хост для SSH (по умолчанию: pi@192.168.88.4)');
  process.exit(1);
}

/**
 * Поиск через SSH (если БД на удалённом сервере)
 */
function searchViaSSH(searchTerm) {
  console.log(`[INFO] Поиск через SSH: ${SSH_HOST}`);
  console.log(`[INFO] Ищем: "${searchTerm}"\n`);
  
  try {
    // Ищем файлы БД
    const findDbCmd = `ssh ${SSH_HOST} "find ${DB_PATH} -name '*.ldb' -type f 2>/dev/null"`;
    console.log(`[STEP] Поиск файлов БД...`);
    const dbFiles = execSync(findDbCmd, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(f => f);
    
    if (dbFiles.length === 0) {
      console.log('[WARNING] Файлы БД не найдены');
      return;
    }
    
    console.log(`[INFO] Найдено файлов БД: ${dbFiles.length}\n`);
    
    // Ищем в каждом файле
    const results = [];
    for (const dbFile of dbFiles) {
      try {
        console.log(`[STEP] Поиск в ${path.basename(dbFile)}...`);
        
        // Используем strings для поиска текста в бинарных файлах
        const grepCmd = `ssh ${SSH_HOST} "strings '${dbFile}' 2>/dev/null | grep -i '${searchTerm}' | head -n 20"`;
        const output = execSync(grepCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        
        if (output) {
          const lines = output.split('\n').filter(l => l);
          results.push({ file: dbFile, matches: lines });
          console.log(`  ✓ Найдено совпадений: ${lines.length}`);
        } else {
          console.log(`  - Совпадений не найдено`);
        }
      } catch (e) {
        // Игнорируем ошибки для отдельных файлов
        console.log(`  - Ошибка при поиске: ${e.message}`);
      }
    }
    
    // Выводим результаты
    console.log('\n=== РЕЗУЛЬТАТЫ ПОИСКА В БД ===\n');
    
    if (results.length === 0) {
      console.log(`❌ Совпадения для "${searchTerm}" не найдены в БД`);
    } else {
      results.forEach(({ file, matches }) => {
        console.log(`Файл: ${path.basename(file)}`);
        console.log(`Совпадений: ${matches.length}\n`);
        
        matches.slice(0, 10).forEach((match, idx) => {
          console.log(`  ${idx + 1}. ${match}`);
        });
        
        if (matches.length > 10) {
          console.log(`  ... и ещё ${matches.length - 10} совпадений`);
        }
        console.log('');
      });
      
      console.log('💡 Совет: Используйте найденные UUID для дальнейшего поиска через WebSocket API');
    }
    
  } catch (error) {
    console.error('[ERROR] Ошибка при поиске через SSH:', error.message);
    console.error('');
    console.error('Возможные причины:');
    console.error('  1. Нет доступа по SSH (проверьте ключи или пароль)');
    console.error('  2. Неверный путь к БД');
    console.error('  3. На сервере нет утилиты strings');
    console.error('');
    console.error('Альтернатива: используйте поиск через WebSocket API:');
    console.error(`  node scripts/find-script-advanced.js "${SEARCH_TERM}"`);
  }
}

/**
 * Поиск в локальной БД (если БД доступна локально)
 */
function searchLocal(searchTerm) {
  console.log(`[INFO] Поиск в локальной БД: ${DB_PATH}`);
  console.log(`[INFO] Ищем: "${searchTerm}"\n`);
  
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[ERROR] Путь к БД не существует: ${DB_PATH}`);
    console.error('');
    console.error('Используйте поиск через SSH:');
    console.error('  REACTHOME_USE_SSH=true node search-script-in-db.js "' + searchTerm + '"');
    return;
  }
  
  try {
    // Ищем файлы БД
    const dbFiles = fs.readdirSync(DB_PATH)
      .filter(f => f.endsWith('.ldb'))
      .map(f => path.join(DB_PATH, f));
    
    if (dbFiles.length === 0) {
      console.log('[WARNING] Файлы БД не найдены');
      return;
    }
    
    console.log(`[INFO] Найдено файлов БД: ${dbFiles.length}\n`);
    
    // Ищем в каждом файле
    const results = [];
    for (const dbFile of dbFiles) {
      try {
        console.log(`[STEP] Поиск в ${path.basename(dbFile)}...`);
        
        // Используем strings для поиска текста в бинарных файлах
        const grepCmd = `strings '${dbFile}' 2>/dev/null | grep -i '${searchTerm}' | head -n 20`;
        const output = execSync(grepCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        
        if (output) {
          const lines = output.split('\n').filter(l => l);
          results.push({ file: dbFile, matches: lines });
          console.log(`  ✓ Найдено совпадений: ${lines.length}`);
        } else {
          console.log(`  - Совпадений не найдено`);
        }
      } catch (e) {
        // Игнорируем ошибки для отдельных файлов
        console.log(`  - Ошибка при поиске: ${e.message}`);
      }
    }
    
    // Выводим результаты
    console.log('\n=== РЕЗУЛЬТАТЫ ПОИСКА В БД ===\n');
    
    if (results.length === 0) {
      console.log(`❌ Совпадения для "${searchTerm}" не найдены в БД`);
    } else {
      results.forEach(({ file, matches }) => {
        console.log(`Файл: ${path.basename(file)}`);
        console.log(`Совпадений: ${matches.length}\n`);
        
        matches.slice(0, 10).forEach((match, idx) => {
          console.log(`  ${idx + 1}. ${match}`);
        });
        
        if (matches.length > 10) {
          console.log(`  ... и ещё ${matches.length - 10} совпадений`);
        }
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('[ERROR] Ошибка при поиске:', error.message);
  }
}

// Запуск
if (USE_SSH) {
  searchViaSSH(SEARCH_TERM);
} else {
  searchLocal(SEARCH_TERM);
}

