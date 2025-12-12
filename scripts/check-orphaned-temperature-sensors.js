#!/usr/bin/env node

// Зачем: Скрипт для проверки "потерянных" датчиков температуры - датчиков, которые имеют master,
// но не включены в массив temperature_ext мастер-устройства

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');

// Зачем: Цветовые коды для терминала
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

async function checkOrphanedSensors() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  
  try {
    log(colors.cyan + colors.bright, '\n═══════════════════════════════════════');
    log(colors.cyan + colors.bright, '🔍 Проверка "потерянных" датчиков температуры');
    log(colors.cyan + colors.bright, '═══════════════════════════════════════\n');
    
    // Зачем: Собираем все мастер-устройства с их датчиками
    const masters = new Map();
    
    // Зачем: Первый проход - собираем все мастер-устройства
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      // Зачем: Типы мастер-устройств (32 и 37 - сенсорные модули с 1-Wire)
      if ((value.type === 32 || value.type === 37) && value.temperature !== undefined) {
        masters.set(key, {
          id: key,
          type: value.type,
          title: value.title || value.code || key,
          temperature: value.temperature,
          temperature_ext: new Set(value.temperature_ext || []),
          site: value.site,
          sensors: []
        });
      }
    }
    
    // Зачем: Второй проход - собираем все датчики с master
    const allSensors = [];
    
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      if (value.master && masters.has(value.master)) {
        const sensor = {
          id: key,
          master: value.master,
          title: value.title || value.code || '',
          temperature: value.temperature || value.temperature_raw,
          type: value.type,
          online: value.online,
          ready: value.ready,
          site: value.site
        };
        
        allSensors.push(sensor);
        masters.get(value.master).sensors.push(sensor);
      }
    }
    
    // Зачем: Анализ и вывод результатов
    log(colors.blue, `📊 Найдено мастер-устройств: ${masters.size}`);
    log(colors.blue, `📊 Найдено датчиков с master: ${allSensors.length}\n`);
    
    let orphanedCount = 0;
    let anomalyCount = 0;
    let offlineCount = 0;
    let unnamedCount = 0;
    
    for (const [masterId, master] of masters) {
      const orphaned = master.sensors.filter(s => !master.temperature_ext.has(s.id));
      
      if (orphaned.length === 0 && master.sensors.length === 0) {
        // Зачем: Пропускаем мастеров без датчиков
        continue;
      }
      
      console.log('─────────────────────────────────────');
      log(colors.cyan, `📱 ${master.title} (${masterId})`);
      console.log(`   Тип: ${master.type} (0x${master.type.toString(16)})`);
      console.log(`   🌡️  Встроенная температура: ${master.temperature}°C`);
      
      if (master.site) {
        const site = await db.get(master.site).catch(() => null);
        if (site) {
          console.log(`   📍 Помещение: ${site.title || site.code}`);
        }
      }
      
      console.log();
      console.log(`   📊 Датчиков в temperature_ext: ${master.temperature_ext.size}`);
      console.log(`   📊 Датчиков с master: ${master.sensors.length}`);
      
      if (master.temperature_ext.size > 0) {
        console.log(`\n   ✅ Датчики в temperature_ext:`);
        let idx = 0;
        for (const sensorId of master.temperature_ext) {
          const sensor = master.sensors.find(s => s.id === sensorId);
          if (sensor) {
            console.log(`      [${idx}] ${sensorId}`);
            console.log(`          ${sensor.title || 'без названия'} - ${sensor.temperature || '?'}°C`);
          } else {
            log(colors.red, `      [${idx}] ${sensorId} ⚠️  НЕ НАЙДЕН В БАЗЕ!`);
          }
          idx++;
        }
      }
      
      if (orphaned.length > 0) {
        orphanedCount += orphaned.length;
        log(colors.yellow, `\n   ⚠️  "ПОТЕРЯННЫЕ" датчики (не в temperature_ext):`);
        
        for (const sensor of orphaned) {
          console.log(`      • ${sensor.id}`);
          console.log(`        Название: ${sensor.title || 'без названия'}`);
          console.log(`        Температура: ${sensor.temperature || '?'}°C`);
          
          // Зачем: Проверка аномалий
          const temp = sensor.temperature;
          if (temp !== undefined) {
            if (temp < 0 || temp > 50) {
              log(colors.red, `        ⚠️  АНОМАЛЬНАЯ ТЕМПЕРАТУРА! (нормально: 0-50°C)`);
              anomalyCount++;
            }
          }
          
          if (!sensor.online || !sensor.ready) {
            log(colors.red, `        ⚠️  OFFLINE (online: ${sensor.online}, ready: ${sensor.ready})`);
            offlineCount++;
          }
          
          if (!sensor.title) {
            log(colors.yellow, `        ⚠️  БЕЗ НАЗВАНИЯ`);
            unnamedCount++;
          }
        }
      }
      
      console.log();
    }
    
    // Зачем: Итоговая статистика
    console.log('═══════════════════════════════════════');
    log(colors.cyan + colors.bright, '📊 ИТОГОВАЯ СТАТИСТИКА');
    console.log('═══════════════════════════════════════\n');
    
    if (orphanedCount > 0) {
      log(colors.yellow, `⚠️  Найдено "потерянных" датчиков: ${orphanedCount}`);
    } else {
      log(colors.green, `✅ "Потерянных" датчиков не найдено`);
    }
    
    if (anomalyCount > 0) {
      log(colors.red, `⚠️  Датчиков с аномальной температурой: ${anomalyCount}`);
    }
    
    if (offlineCount > 0) {
      log(colors.red, `⚠️  Офлайн датчиков: ${offlineCount}`);
    }
    
    if (unnamedCount > 0) {
      log(colors.yellow, `⚠️  Датчиков без названия: ${unnamedCount}`);
    }
    
    console.log();
    
    // Зачем: Рекомендации
    if (orphanedCount > 0 || anomalyCount > 0 || offlineCount > 0) {
      console.log('═══════════════════════════════════════');
      log(colors.cyan + colors.bright, '💡 РЕКОМЕНДАЦИИ');
      console.log('═══════════════════════════════════════\n');
      
      if (anomalyCount > 0) {
        console.log('1. Проверьте физическое подключение датчиков с аномальной температурой');
        console.log('   • Температура < 0°C или > 50°C обычно указывает на неисправность');
        console.log('   • Проверьте качество контактов и целостность кабеля');
        console.log();
      }
      
      if (offlineCount > 0) {
        console.log('2. Проверьте питание и подключение офлайн датчиков');
        console.log('   • Датчики с offline = false могут быть физически отключены');
        console.log('   • Проверьте 1-Wire шину и контроллер');
        console.log();
      }
      
      if (orphanedCount > 0) {
        console.log('3. Для "потерянных" датчиков:');
        console.log('   • Если датчик рабочий - добавьте его в temperature_ext мастера');
        console.log('   • Если датчик неисправен - удалите из базы или пометьте как disabled');
        console.log('   • Если датчик привязан к DI каналу - проверьте bind термостата');
        console.log();
      }
      
      if (unnamedCount > 0) {
        console.log('4. Добавьте названия датчикам для удобства идентификации');
        console.log('   • Используйте поля title или code');
        console.log('   • Например: "Пол душ", "Стена гостиная", "Батарея спальня"');
        console.log();
      }
    }
    
  } catch (error) {
    log(colors.red, '❌ Ошибка:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Зачем: Запуск проверки
checkOrphanedSensors().catch(error => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
