#!/usr/bin/env node

/**
 * Скрипт для проверки устройства в бэкапе
 * Использование: node check-device-in-backup.js <backup.tar.gz> <MAC_ADDRESS>
 * Зачем: Проверяет состояние устройства в бэкапе БД
 */

const { Level } = require('level');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKUP_PATH = process.argv[2] || 'backups/var-backup-20251209_230607.tar.gz';
const MAC_ADDRESS = process.argv[3] || '60:66:13:b4:aa:df';

if (!fs.existsSync(BACKUP_PATH)) {
  console.error(`❌ Ошибка: бэкап не найден: ${BACKUP_PATH}`);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-device-'));

async function checkDevice() {
  let db;
  try {
    // Распаковываем бэкап
    console.error(`📦 Распаковка ${BACKUP_PATH}...`);
    execSync(`tar -xzf "${BACKUP_PATH}" -C "${tmpDir}"`, { stdio: 'pipe' });
    
    // Находим БД
    let dbPath = null;
    if (fs.existsSync(path.join(tmpDir, 'var', 'var', 'db'))) {
      dbPath = path.join(tmpDir, 'var', 'var', 'db');
    } else if (fs.existsSync(path.join(tmpDir, 'var', 'db'))) {
      dbPath = path.join(tmpDir, 'var', 'db');
    } else if (fs.existsSync(path.join(tmpDir, 'db'))) {
      dbPath = path.join(tmpDir, 'db');
    }
    
    if (!dbPath) {
      console.error(JSON.stringify({error: 'БД не найдена в бэкапе'}, null, 2));
      process.exit(1);
    }
    
    console.error(`📊 Открываю БД: ${dbPath}`);
    db = new Level(dbPath, { valueEncoding: 'json' });
    
    try {
      const device = await db.get(MAC_ADDRESS);
      console.log(JSON.stringify({
        found: true,
        mac: MAC_ADDRESS,
        online: device.online,
        ready: device.ready,
        initialized: device.initialized,
        timestamp: device.timestamp,
        timestampDate: new Date(device.timestamp).toISOString(),
        ip: device.ip,
        code: device.code,
        site: device.site,
        type: device.type,
        version: device.version,
        temperature: device.temperature,
        humidity: device.humidity,
        co2: device.co2
      }, null, 2));
    } catch (error) {
      if (error.type === 'NotFoundError') {
        console.log(JSON.stringify({
          found: false,
          mac: MAC_ADDRESS,
          error: 'Устройство не найдено в бэкапе'
        }, null, 2));
      } else {
        throw error;
      }
    }
    
    await db.close();
    
    // Очистка
    execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
  } catch (error) {
    console.error(JSON.stringify({error: error.message, stack: error.stack}, null, 2));
    if (db) {
      await db.close().catch(() => {});
    }
    try {
      execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' });
    } catch {}
    process.exit(1);
  }
}

checkDevice();
















