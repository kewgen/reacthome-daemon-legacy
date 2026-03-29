#!/usr/bin/env node

/**
 * Скрипт для сравнения двух бэкапов LevelDB
 * Использование: node compare-db-backups.js <backup1.tar.gz> <backup2.tar.gz>
 * Зачем: Сравнивает два бэкапа БД по количеству записей, размеру и содержимому
 */

const { Level } = require('level');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const BACKUP1_PATH = process.argv[2];
const BACKUP2_PATH = process.argv[3];

if (!BACKUP1_PATH || !BACKUP2_PATH) {
  console.error('Использование: node compare-db-backups.js <backup1.tar.gz> <backup2.tar.gz>');
  process.exit(1);
}

if (!fs.existsSync(BACKUP1_PATH)) {
  console.error(`❌ Ошибка: бэкап не найден: ${BACKUP1_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(BACKUP2_PATH)) {
  console.error(`❌ Ошибка: бэкап не найден: ${BACKUP2_PATH}`);
  process.exit(1);
}

// Создаём временные директории для распаковки
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'db-compare-'));
const BACKUP1_DIR = path.join(TMP_DIR, 'backup1');
const BACKUP2_DIR = path.join(TMP_DIR, 'backup2');
const BACKUP1_DB_DIR = path.join(BACKUP1_DIR, 'db');
const BACKUP2_DB_DIR = path.join(BACKUP2_DIR, 'db');

// Функция для распаковки бэкапа
function extractBackup(backupPath, targetDir) {
  console.error(`📦 Распаковка ${path.basename(backupPath)}...`);
  fs.mkdirSync(targetDir, { recursive: true });
  
  try {
    execSync(`tar -xzf "${backupPath}" -C "${targetDir}"`, { stdio: 'pipe' });
    
    // Проверяем структуру - может быть var/var/db или var/db или просто db
    let dbPath = null;
    
    // Проверяем var/var/db (вложенная структура)
    const nestedPath = path.join(targetDir, 'var', 'var', 'db');
    if (fs.existsSync(nestedPath)) {
      dbPath = nestedPath;
    }
    // Проверяем var/db
    else {
      const varDbPath = path.join(targetDir, 'var', 'db');
      if (fs.existsSync(varDbPath)) {
        dbPath = varDbPath;
      }
      // Проверяем просто db
      else if (fs.existsSync(path.join(targetDir, 'db'))) {
        dbPath = path.join(targetDir, 'db');
      }
    }
    
    return dbPath;
  } catch (error) {
    console.error(`❌ Ошибка при распаковке ${backupPath}:`, error.message);
    throw error;
  }
}

// Функция для подсчёта записей в БД
async function countEntries(dbPath) {
  try {
    const db = new Level(dbPath, { valueEncoding: 'json' });
    let count = 0;
    
    for await (const key of db.keys()) {
      count++;
    }
    
    await db.close();
    return count;
  } catch (error) {
    console.error(`❌ Ошибка при подсчёте записей в ${dbPath}:`, error.message);
    return 0;
  }
}

// Функция для получения всех ключей из БД
async function getAllKeys(dbPath) {
  const keys = new Set();
  try {
    const db = new Level(dbPath, { valueEncoding: 'json' });
    
    for await (const key of db.keys()) {
      keys.add(key);
    }
    
    await db.close();
  } catch (error) {
    console.error(`❌ Ошибка при получении ключей из ${dbPath}:`, error.message);
  }
  return keys;
}

// Функция для получения значения по ключу
async function getValue(dbPath, key) {
  try {
    const db = new Level(dbPath, { valueEncoding: 'json' });
    const value = await db.get(key);
    await db.close();
    return value;
  } catch (error) {
    return null;
  }
}

// Функция для получения размера директории
function getDirSize(dirPath) {
  try {
    const result = execSync(`du -sh "${dirPath}" 2>/dev/null | cut -f1`, { encoding: 'utf8' });
    return result.trim();
  } catch (error) {
    return 'N/A';
  }
}

// Функция для подсчёта файлов LevelDB
function countLevelDBFiles(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    const ldbFiles = files.filter(f => f.endsWith('.ldb') || f.endsWith('.log') || f === 'MANIFEST' || f === 'CURRENT');
    return {
      total: files.length,
      ldb: files.filter(f => f.endsWith('.ldb')).length,
      log: files.filter(f => f.endsWith('.log')).length,
      manifest: files.filter(f => f === 'MANIFEST').length,
      current: files.filter(f => f === 'CURRENT').length
    };
  } catch (error) {
    return { total: 0, ldb: 0, log: 0, manifest: 0, current: 0 };
  }
}

// Основная функция сравнения
async function compareBackups() {
  console.error('╔═══════════════════════════════════════════════════════════════╗');
  console.error('║   Сравнение бэкапов БД                                        ║');
  console.error('╚═══════════════════════════════════════════════════════════════╝');
  console.error('');
  
  const results = {
    backup1: {
      path: BACKUP1_PATH,
      name: path.basename(BACKUP1_PATH),
      archiveSize: fs.statSync(BACKUP1_PATH).size,
      dbPath: null,
      entryCount: 0,
      dbSize: null,
      fileStats: null,
      keys: null
    },
    backup2: {
      path: BACKUP2_PATH,
      name: path.basename(BACKUP2_PATH),
      archiveSize: fs.statSync(BACKUP2_PATH).size,
      dbPath: null,
      entryCount: 0,
      dbSize: null,
      fileStats: null,
      keys: null
    },
    differences: {
      entryCountDiff: 0,
      onlyInBackup1: [],
      onlyInBackup2: [],
      differentValues: []
    }
  };
  
  try {
    // Распаковываем оба бэкапа
    results.backup1.dbPath = extractBackup(BACKUP1_PATH, BACKUP1_DIR);
    results.backup2.dbPath = extractBackup(BACKUP2_PATH, BACKUP2_DIR);
    
    if (!results.backup1.dbPath || !fs.existsSync(results.backup1.dbPath)) {
      throw new Error(`БД не найдена в первом бэкапе: ${BACKUP1_PATH}`);
    }
    
    if (!results.backup2.dbPath || !fs.existsSync(results.backup2.dbPath)) {
      throw new Error(`БД не найдена во втором бэкапе: ${BACKUP2_PATH}`);
    }
    
    console.error('');
    console.error('📊 Анализ бэкапов...');
    
    // Получаем статистику по файлам
    results.backup1.fileStats = countLevelDBFiles(results.backup1.dbPath);
    results.backup2.fileStats = countLevelDBFiles(results.backup2.dbPath);
    
    // Получаем размеры БД
    results.backup1.dbSize = getDirSize(results.backup1.dbPath);
    results.backup2.dbSize = getDirSize(results.backup2.dbPath);
    
    // Подсчитываем записи
    console.error('🔢 Подсчёт записей в первом бэкапе...');
    results.backup1.entryCount = await countEntries(results.backup1.dbPath);
    
    console.error('🔢 Подсчёт записей во втором бэкапе...');
    results.backup2.entryCount = await countEntries(results.backup2.dbPath);
    
    // Получаем ключи
    console.error('🔑 Получение ключей из первого бэкапа...');
    results.backup1.keys = await getAllKeys(results.backup1.dbPath);
    
    console.error('🔑 Получение ключей из второго бэкапа...');
    results.backup2.keys = await getAllKeys(results.backup2.dbPath);
    
    // Сравниваем ключи
    console.error('🔍 Сравнение ключей...');
    const keys1 = results.backup1.keys;
    const keys2 = results.backup2.keys;
    
    // Ключи только в первом бэкапе
    for (const key of keys1) {
      if (!keys2.has(key)) {
        results.differences.onlyInBackup1.push(key);
      }
    }
    
    // Ключи только во втором бэкапе
    for (const key of keys2) {
      if (!keys1.has(key)) {
        results.differences.onlyInBackup2.push(key);
      }
    }
    
    // Сравниваем значения общих ключей (выборочно, первые 1000)
    console.error('🔍 Сравнение значений (выборочно)...');
    const commonKeys = Array.from(keys1).filter(k => keys2.has(k));
    const sampleSize = Math.min(1000, commonKeys.length);
    const sampleKeys = commonKeys.slice(0, sampleSize);
    
    for (const key of sampleKeys) {
      const value1 = await getValue(results.backup1.dbPath, key);
      const value2 = await getValue(results.backup2.dbPath, key);
      
      if (JSON.stringify(value1) !== JSON.stringify(value2)) {
        results.differences.differentValues.push({
          key: key,
          value1: value1,
          value2: value2
        });
      }
    }
    
    // Разница в количестве записей
    results.differences.entryCountDiff = results.backup1.entryCount - results.backup2.entryCount;
    
    // Выводим результаты в JSON
    console.log(JSON.stringify(results, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка при сравнении:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Очистка временных файлов
    try {
      execSync(`rm -rf "${TMP_DIR}"`, { stdio: 'pipe' });
    } catch (error) {
      // Игнорируем ошибки очистки
    }
  }
}

compareBackups().catch(error => {
  console.error('❌ Критическая ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});

















