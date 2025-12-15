#!/usr/bin/env node

/**
 * Скрипт для создания бэкапов БД всех умных домов
 * 
 * Зачем: Автоматически создаёт бэкапы для всех известных демонов
 * 
 * Использование:
 *   node backup-all.js [output-dir]
 * 
 * Примеры:
 *   # Бэкап всех УД в директорию по умолчанию (./backups)
 *   node backup-all.js
 * 
 *   # Бэкап всех УД в указанную директорию
 *   node backup-all.js ./my-backups
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Список известных демонов
// Соответствия названий: Почтовая = Архитекторов, Лучистое = Миндальный
const KNOWN_DAEMONS = [
  { id: 'fd6765f1-ed61-4ae4-8d72-9a078a9f4316', name: 'Почтовая (Архитекторов)' },
  { id: 'd31775ae-19e8-40c9-81df-d6d672379563', name: 'Лучистое (Миндальный)' },
];

// Параметры
// Зачем: используем проекную папку backups по умолчанию, которая находится на уровень выше ws-ssh
const projectBackupsDir = path.join(__dirname, '..', 'backups');
const outputDir = process.argv[2] || projectBackupsDir;
const backupScript = path.join(__dirname, 'backup-db.js');

// Проверяем, что скрипт бэкапа существует
if (!fs.existsSync(backupScript)) {
  console.error(`Ошибка: скрипт бэкапа не найден: ${backupScript}`);
  process.exit(1);
}

console.log('='.repeat(80));
console.log('Создание бэкапов БД для всех умных домов');
console.log('='.repeat(80));
console.log(`Количество УД: ${KNOWN_DAEMONS.length}`);
console.log(`Директория для сохранения: ${path.resolve(outputDir)}`);
console.log('');

/**
 * Выполнение бэкапа для одного демона
 */
function backupDaemon(daemon, index, total) {
  return new Promise((resolve, reject) => {
    console.log(`[${index + 1}/${total}] Создание бэкапа для "${daemon.name}" (${daemon.id.substring(0, 8)}...)`);
    
    const child = spawn('node', [backupScript, daemon.id, outputDir], {
      stdio: 'inherit',
      cwd: __dirname
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        // Проверяем, что файл действительно создан и валиден
        const files = fs.readdirSync(outputDir)
          .filter(f => f.includes(daemon.id.substring(0, 8)) && f.endsWith('.tar.gz'))
          .sort()
          .reverse();
        
        if (files.length > 0) {
          const latestFile = path.join(outputDir, files[0]);
          try {
            const stats = fs.statSync(latestFile);
            const size = stats.size;
            
            // Проверяем минимальный размер (бэкап не должен быть меньше 1KB)
            if (size < 1024) {
              console.error(`⚠️  Бэкап "${daemon.name}" слишком мал (${size} байт), возможно повреждён`);
              reject(new Error(`Бэкап слишком мал для ${daemon.name}`));
              return;
            }
            
            // Пробуем проверить формат
            try {
              const { execSync } = require('child_process');
              execSync(`tar -tzf "${latestFile}" > /dev/null 2>&1`, { encoding: 'utf8' });
              console.log(`✅ Бэкап "${daemon.name}" успешно создан (${(size / 1024 / 1024).toFixed(2)} MB)`);
            } catch (_) {
              console.error(`⚠️  Бэкап "${daemon.name}" создан, но не удалось проверить формат`);
              console.log(`✅ Бэкап "${daemon.name}" создан (${(size / 1024 / 1024).toFixed(2)} MB, формат не проверен)`);
            }
          } catch (error) {
            console.error(`❌ Ошибка проверки файла для "${daemon.name}": ${error.message}`);
            reject(error);
            return;
          }
        } else {
          console.error(`❌ Файл бэкапа не найден для "${daemon.name}"`);
          reject(new Error(`Файл не найден для ${daemon.name}`));
          return;
        }
        
        console.log('');
        resolve();
      } else {
        console.error(`❌ Ошибка создания бэкапа для "${daemon.name}" (код: ${code})`);
        console.log('');
        reject(new Error(`Бэкап не создан для ${daemon.name} (код: ${code})`));
      }
    });
    
    child.on('error', (error) => {
      console.error(`❌ Ошибка запуска скрипта для "${daemon.name}": ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Основная функция
 */
async function main() {
  const results = {
    success: [],
    failed: []
  };
  
  for (let i = 0; i < KNOWN_DAEMONS.length; i++) {
    const daemon = KNOWN_DAEMONS[i];
    
    try {
      await backupDaemon(daemon, i, KNOWN_DAEMONS.length);
      results.success.push(daemon);
    } catch (error) {
      results.failed.push({ daemon, error: error.message });
    }
  }
  
  // Итоговый отчёт
  console.log('='.repeat(80));
  console.log('ИТОГОВЫЙ ОТЧЁТ');
  console.log('='.repeat(80));
  console.log(`Успешно: ${results.success.length}/${KNOWN_DAEMONS.length}`);
  
  if (results.success.length > 0) {
    console.log('');
    console.log('Успешно созданы бэкапы для:');
    results.success.forEach(daemon => {
      console.log(`  ✅ ${daemon.name} (${daemon.id.substring(0, 8)}...)`);
    });
  }
  
  if (results.failed.length > 0) {
    console.log('');
    console.log('Ошибки при создании бэкапов:');
    results.failed.forEach(({ daemon, error }) => {
      console.log(`  ❌ ${daemon.name} (${daemon.id.substring(0, 8)}...): ${error}`);
    });
  }
  
  console.log('');
  console.log(`Все бэкапы сохранены в: ${path.resolve(outputDir)}`);
  console.log('');
  
  // Список созданных файлов (только валидные)
  if (fs.existsSync(outputDir)) {
    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('db-backup-') && f.endsWith('.tar.gz'))
      .sort()
      .reverse()
      .slice(0, KNOWN_DAEMONS.length * 2); // Последние N файлов
    
    if (files.length > 0) {
      console.log('Последние созданные бэкапы:');
      files.forEach(file => {
        const filePath = path.join(outputDir, file);
        try {
          const stats = fs.statSync(filePath);
          const size = (stats.size / 1024 / 1024).toFixed(2);
          const date = stats.mtime.toISOString().replace(/[:.]/g, '-').slice(0, -5);
          
          // Проверяем валидность
          let valid = '❓';
          try {
            const { execSync } = require('child_process');
            execSync(`tar -tzf "${filePath}" > /dev/null 2>&1`, { encoding: 'utf8' });
            valid = '✅';
          } catch (_) {
            if (stats.size < 1024) {
              valid = '⚠️ ';
            }
          }
          
          console.log(`  ${valid} ${file} (${size} MB, ${date})`);
        } catch (error) {
          console.log(`  ❌ ${file} (ошибка чтения)`);
        }
      });
      console.log('');
    }
  }
  
  // Код выхода: 0 если все успешно, 1 если были ошибки
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Запуск
main().catch(error => {
  console.error('Критическая ошибка:', error.message);
  process.exit(1);
});
