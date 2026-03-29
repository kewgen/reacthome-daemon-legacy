#!/usr/bin/env node

/**
 * Скрипт для сравнения устройства в двух бэкапах
 * Использование: node compare-device-in-backups.js <backup1.tar.gz> <backup2.tar.gz> <MAC_ADDRESS>
 * Зачем: Сравнивает состояние конкретного устройства в двух бэкапах БД
 */

const { Level } = require('level');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKUP1_PATH = process.argv[2];
const BACKUP2_PATH = process.argv[3];
const MAC_ADDRESS = process.argv[4] || '60:66:13:b4:aa:df';

if (!BACKUP1_PATH || !BACKUP2_PATH) {
  console.error('Использование: node compare-device-in-backups.js <backup1.tar.gz> <backup2.tar.gz> [MAC_ADDRESS]');
  process.exit(1);
}

if (!fs.existsSync(BACKUP1_PATH)) {
  console.error(`❌ Ошибка: первый бэкап не найден: ${BACKUP1_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(BACKUP2_PATH)) {
  console.error(`❌ Ошибка: второй бэкап не найден: ${BACKUP2_PATH}`);
  process.exit(1);
}

// Создаём временные директории для распаковки
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'device-compare-'));
const BACKUP1_DIR = path.join(TMP_DIR, 'backup1');
const BACKUP2_DIR = path.join(TMP_DIR, 'backup2');

// Функция для поиска БД в распакованном архиве
function findDBPath(baseDir) {
  const paths = [
    path.join(baseDir, 'var', 'var', 'db'),
    path.join(baseDir, 'var', 'db'),
    path.join(baseDir, 'db')
  ];
  
  for (const dbPath of paths) {
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
  }
  
  return null;
}

// Функция для получения устройства из БД
async function getDevice(dbPath, mac) {
  try {
    const db = new Level(dbPath, { valueEncoding: 'json' });
    const device = await db.get(mac);
    
    // Получаем каналы устройства
    const channels = [];
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith(mac + '/')) {
        channels.push({
          channel: key.replace(mac + '/', ''),
          value: value.value,
          timestamp: value.timestamp,
          bind: value.bind,
          modified: value.modified
        });
      }
    }
    
    await db.close();
    
    return {
      found: true,
      device: device,
      channels: channels
    };
  } catch (error) {
    if (error.type === 'NotFoundError') {
      return {
        found: false,
        device: null,
        channels: []
      };
    }
    throw error;
  }
}

// Основная функция сравнения
async function compareDevice() {
  try {
    console.error('╔═══════════════════════════════════════════════════════════════╗');
    console.error('║   Сравнение устройства в двух бэкапах                         ║');
    console.error('╚═══════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error(`MAC адрес: ${MAC_ADDRESS}`);
    console.error(`Бэкап 1: ${BACKUP1_PATH}`);
    console.error(`Бэкап 2: ${BACKUP2_PATH}`);
    console.error('');
    
    // Распаковываем оба бэкапа
    console.error('📦 Распаковка первого бэкапа...');
    fs.mkdirSync(BACKUP1_DIR, { recursive: true });
    execSync(`tar -xzf "${BACKUP1_PATH}" -C "${BACKUP1_DIR}"`, { stdio: 'pipe' });
    
    console.error('📦 Распаковка второго бэкапа...');
    fs.mkdirSync(BACKUP2_DIR, { recursive: true });
    execSync(`tar -xzf "${BACKUP2_PATH}" -C "${BACKUP2_DIR}"`, { stdio: 'pipe' });
    
    // Находим БД в обоих бэкапах
    const db1Path = findDBPath(BACKUP1_DIR);
    const db2Path = findDBPath(BACKUP2_DIR);
    
    if (!db1Path) {
      throw new Error(`БД не найдена в первом бэкапе: ${BACKUP1_PATH}`);
    }
    
    if (!db2Path) {
      throw new Error(`БД не найдена во втором бэкапе: ${BACKUP2_PATH}`);
    }
    
    console.error(`📊 БД 1: ${db1Path}`);
    console.error(`📊 БД 2: ${db2Path}`);
    console.error('');
    
    // Получаем устройства из обоих бэкапов
    console.error('🔍 Поиск устройства в первом бэкапе...');
    const device1 = await getDevice(db1Path, MAC_ADDRESS);
    
    console.error('🔍 Поиск устройства во втором бэкапе...');
    const device2 = await getDevice(db2Path, MAC_ADDRESS);
    
    // Формируем результат сравнения
    const result = {
      mac: MAC_ADDRESS,
      backup1: {
        path: BACKUP1_PATH,
        name: path.basename(BACKUP1_PATH),
        found: device1.found,
        device: device1.found ? {
          type: device1.device.type,
          version: device1.device.version,
          ip: device1.device.ip,
          online: device1.device.online,
          ready: device1.device.ready,
          initialized: device1.device.initialized,
          timestamp: device1.device.timestamp,
          timestampDate: new Date(device1.device.timestamp).toISOString(),
          hub: device1.device.hub,
          site: device1.device.site,
          code: device1.device.code,
          modified: device1.device.modified,
          temperature: device1.device.temperature,
          humidity: device1.device.humidity,
          co2: device1.device.co2,
          temperature_correct: device1.device.temperature_correct,
          humidity_correct: device1.device.humidity_correct,
          co2_correct: device1.device.co2_correct
        } : null,
        channels: device1.channels
      },
      backup2: {
        path: BACKUP2_PATH,
        name: path.basename(BACKUP2_PATH),
        found: device2.found,
        device: device2.found ? {
          type: device2.device.type,
          version: device2.device.version,
          ip: device2.device.ip,
          online: device2.device.online,
          ready: device2.device.ready,
          initialized: device2.device.initialized,
          timestamp: device2.device.timestamp,
          timestampDate: new Date(device2.device.timestamp).toISOString(),
          hub: device2.device.hub,
          site: device2.device.site,
          code: device2.device.code,
          modified: device2.device.modified,
          temperature: device2.device.temperature,
          humidity: device2.device.humidity,
          co2: device2.device.co2,
          temperature_correct: device2.device.temperature_correct,
          humidity_correct: device2.device.humidity_correct,
          co2_correct: device2.device.co2_correct
        } : null,
        channels: device2.channels
      },
      differences: {
        found: device1.found !== device2.found,
        onlyInBackup1: device1.found && !device2.found,
        onlyInBackup2: !device1.found && device2.found,
        deviceDifferences: [],
        channelDifferences: []
      }
    };
    
    // Сравниваем устройства, если оба найдены
    if (device1.found && device2.found) {
      const d1 = device1.device;
      const d2 = device2.device;
      
      const fields = ['type', 'version', 'ip', 'online', 'ready', 'initialized', 'site', 'code', 
                      'temperature', 'humidity', 'co2', 'temperature_correct', 'humidity_correct', 'co2_correct'];
      
      for (const field of fields) {
        if (d1[field] !== d2[field]) {
          result.differences.deviceDifferences.push({
            field: field,
            backup1: d1[field],
            backup2: d2[field]
          });
        }
      }
      
      // Сравниваем timestamp (разница более 1 минуты считается различием)
      const timestampDiff = Math.abs(d1.timestamp - d2.timestamp);
      if (timestampDiff > 60000) {
        result.differences.deviceDifferences.push({
          field: 'timestamp',
          backup1: d1.timestamp,
          backup2: d2.timestamp,
          diff_ms: timestampDiff,
          diff_minutes: Math.floor(timestampDiff / 60000)
        });
      }
      
      // Сравниваем каналы
      const channels1Map = new Map(device1.channels.map(c => [c.channel, c]));
      const channels2Map = new Map(device2.channels.map(c => [c.channel, c]));
      
      const allChannels = new Set([...channels1Map.keys(), ...channels2Map.keys()]);
      
      for (const channel of allChannels) {
        const c1 = channels1Map.get(channel);
        const c2 = channels2Map.get(channel);
        
        if (!c1) {
          result.differences.channelDifferences.push({
            channel: channel,
            type: 'only_in_backup2',
            backup2: c2
          });
        } else if (!c2) {
          result.differences.channelDifferences.push({
            channel: channel,
            type: 'only_in_backup1',
            backup1: c1
          });
        } else {
          const diff = [];
          if (c1.value !== c2.value) diff.push('value');
          if (c1.bind !== c2.bind) diff.push('bind');
          if (Math.abs(c1.timestamp - c2.timestamp) > 60000) diff.push('timestamp');
          
          if (diff.length > 0) {
            result.differences.channelDifferences.push({
              channel: channel,
              type: 'different',
              differences: diff,
              backup1: c1,
              backup2: c2
            });
          }
        }
      }
    }
    
    // Выводим результат в JSON
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2));
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

compareDevice();
















