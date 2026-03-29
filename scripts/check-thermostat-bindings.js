#!/usr/bin/env node

// Зачем: Скрипт для проверки правильности привязки термостатов к DI каналам S4 модулей
// Проверяет соответствие между термостатами, их датчиками температуры и мастер-устройствами

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

// Зачем: Типы мастер-устройств (S4 и сенсорные модули)
const MASTER_TYPES = {
  32: 'Sensor 0x20',  // Тип 32 (0x20) - сенсорные модули
  37: 'S4 0x25',      // Тип 37 (0x25) - S4 модули
};

async function checkThermostatBindings() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  
  try {
    log(colors.cyan + colors.bright, '\n═══════════════════════════════════════');
    log(colors.cyan + colors.bright, '🌡️  Проверка привязки термостатов к DI/4 и S4');
    log(colors.cyan + colors.bright, '═══════════════════════════════════════\n');
    
    // Зачем: Собираем все термостаты
    const thermostats = [];
    
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      if (value.type === 'thermostat' || value.type === 'THERMOSTAT') {
        thermostats.push({
          id: key,
          title: value.title || value.code || key,
          bind: value.bind,
          sensor: value.sensor,
          site: value.site,
          onStartHeat: value.onStartHeat,
          onStopHeat: value.onStopHeat,
          onStartCool: value.onStartCool,
          onStopCool: value.onStopCool,
        });
      }
    }
    
    log(colors.blue, `📊 Найдено термостатов: ${thermostats.length}\n`);
    
    if (thermostats.length === 0) {
      log(colors.yellow, '⚠️  Термостаты не найдены в системе');
      return;
    }
    
    let okCount = 0;
    let noBind = 0;
    let noSensor = 0;
    let noScripts = 0;
    let wrongBind = 0;
    
    for (const thermostat of thermostats) {
      console.log('─────────────────────────────────────');
      log(colors.cyan, `🌡️  ${thermostat.title}`);
      console.log(`   ID: ${thermostat.id}`);
      
      // Зачем: Получаем помещение
      let siteName = '—';
      if (thermostat.site) {
        const site = await db.get(thermostat.site).catch(() => null);
        if (site) {
          siteName = site.title || site.code || thermostat.site;
        }
      }
      console.log(`   📍 Помещение: ${siteName}`);
      console.log();
      
      let hasIssues = false;
      
      // Зачем: Проверка 1 - bind к DI каналу
      console.log('   🔗 Bind к DI каналу:');
      if (thermostat.bind) {
        // Зачем: Парсим bind для проверки корректности
        const bindParts = thermostat.bind.split('/');
        
        if (bindParts.length === 3) {
          const actuatorId = bindParts[0];
          const channelType = bindParts[1];
          const channelNum = bindParts[2];
          
          log(colors.green, `      ✅ ${thermostat.bind}`);
          console.log(`         Актуатор: ${actuatorId}`);
          console.log(`         Канал: ${channelType.toUpperCase()}/${channelNum}`);
          
          // Зачем: Проверяем, что это DI канал
          if (channelType.toLowerCase() !== 'di') {
            log(colors.yellow, `         ⚠️  Не DI канал (ожидается DI, получен ${channelType})`);
            hasIssues = true;
            wrongBind++;
          }
          
          // Зачем: Проверяем существование актуатора
          const actuator = await db.get(actuatorId).catch(() => null);
          if (actuator) {
            console.log(`         Тип актуатора: ${MASTER_TYPES[actuator.type] || actuator.type}`);
            console.log(`         Название: ${actuator.title || actuator.code || '—'}`);
            
            // Зачем: Проверяем наличие встроенного датчика температуры
            if (actuator.temperature !== undefined) {
              console.log(`         🌡️  Встроенная температура: ${actuator.temperature}°C`);
            }
          } else {
            log(colors.red, `         ⚠️  Актуатор не найден в БД!`);
            hasIssues = true;
            wrongBind++;
          }
        } else {
          log(colors.red, `      ❌ Некорректный формат bind: ${thermostat.bind}`);
          hasIssues = true;
          wrongBind++;
        }
      } else {
        log(colors.red, `      ❌ ОТСУТСТВУЕТ`);
        log(colors.yellow, `         Рекомендация: добавить bind к DI/4 сенсорного модуля`);
        hasIssues = true;
        noBind++;
      }
      console.log();
      
      // Зачем: Проверка 2 - датчик температуры
      console.log('   🌡️  Датчик температуры (sensor):');
      if (thermostat.sensor) {
        const sensor = await db.get(thermostat.sensor).catch(() => null);
        
        if (sensor) {
          log(colors.green, `      ✅ ${thermostat.sensor}`);
          console.log(`         Название: ${sensor.title || sensor.code || '—'}`);
          console.log(`         Температура: ${sensor.temperature || sensor.temperature_raw || '?'}°C`);
          console.log(`         Статус: online=${sensor.online}, ready=${sensor.ready}`);
          
          // Зачем: Проверяем мастер-устройство датчика
          if (sensor.master) {
            const master = await db.get(sensor.master).catch(() => null);
            if (master) {
              console.log(`         Мастер: ${master.title || master.code || sensor.master}`);
              console.log(`         Тип мастера: ${MASTER_TYPES[master.type] || master.type}`);
              
              // Зачем: Сравниваем мастер датчика с bind термостата
              if (thermostat.bind) {
                const bindActuatorId = thermostat.bind.split('/')[0];
                
                if (sensor.master === bindActuatorId) {
                  log(colors.green, `         ✅ Мастер датчика совпадает с bind термостата`);
                } else {
                  log(colors.yellow, `         ⚠️  Мастер датчика (${sensor.master.substring(0, 17)}...)`);
                  log(colors.yellow, `             НЕ совпадает с bind (${bindActuatorId.substring(0, 17)}...)`);
                  hasIssues = true;
                }
              }
              
              // Зачем: Проверяем, что датчик в temperature_ext мастера
              if (master.temperature_ext && Array.isArray(master.temperature_ext)) {
                if (master.temperature_ext.includes(thermostat.sensor)) {
                  log(colors.green, `         ✅ Датчик включен в temperature_ext мастера`);
                } else {
                  log(colors.yellow, `         ⚠️  Датчик НЕ включен в temperature_ext мастера`);
                  hasIssues = true;
                }
              }
            }
          } else {
            log(colors.yellow, `         ⚠️  У датчика нет мастер-устройства`);
          }
        } else {
          log(colors.red, `      ❌ Датчик не найден в БД: ${thermostat.sensor}`);
          hasIssues = true;
        }
      } else {
        log(colors.red, `      ❌ ОТСУТСТВУЕТ`);
        hasIssues = true;
        noSensor++;
      }
      console.log();
      
      // Зачем: Проверка 3 - скрипты управления
      console.log('   📜 Скрипты управления:');
      
      const scripts = [
        { name: 'onStartHeat', id: thermostat.onStartHeat },
        { name: 'onStopHeat', id: thermostat.onStopHeat },
        { name: 'onStartCool', id: thermostat.onStartCool },
        { name: 'onStopCool', id: thermostat.onStopCool },
      ];
      
      let hasScripts = false;
      
      for (const script of scripts) {
        if (script.id) {
          const scriptData = await db.get(script.id).catch(() => null);
          if (scriptData) {
            log(colors.green, `      ✅ ${script.name}: ${scriptData.title || script.id.substring(0, 8)}...`);
            hasScripts = true;
          } else {
            log(colors.red, `      ❌ ${script.name}: скрипт не найден (${script.id})`);
            hasIssues = true;
          }
        }
      }
      
      if (!hasScripts) {
        log(colors.yellow, `      ⚠️  Нет скриптов управления`);
        hasIssues = true;
        noScripts++;
      }
      
      console.log();
      
      if (!hasIssues) {
        log(colors.green + colors.bright, '   ✅ Термостат настроен правильно');
        okCount++;
      } else {
        log(colors.yellow + colors.bright, '   ⚠️  Требуется проверка конфигурации');
      }
      
      console.log();
    }
    
    // Зачем: Итоговая статистика
    console.log('═══════════════════════════════════════');
    log(colors.cyan + colors.bright, '📊 ИТОГОВАЯ СТАТИСТИКА');
    console.log('═══════════════════════════════════════\n');
    
    log(colors.green, `✅ Правильно настроенных: ${okCount} из ${thermostats.length}`);
    
    if (noBind > 0) {
      log(colors.red, `❌ Без bind к DI каналу: ${noBind}`);
    }
    
    if (noSensor > 0) {
      log(colors.red, `❌ Без датчика температуры: ${noSensor}`);
    }
    
    if (noScripts > 0) {
      log(colors.yellow, `⚠️  Без скриптов управления: ${noScripts}`);
    }
    
    if (wrongBind > 0) {
      log(colors.yellow, `⚠️  С некорректным bind: ${wrongBind}`);
    }
    
    console.log();
    
    // Зачем: Рекомендации
    if (okCount < thermostats.length) {
      console.log('═══════════════════════════════════════');
      log(colors.cyan + colors.bright, '💡 ОБЩИЙ АЛГОРИТМ ПРИВЯЗКИ ТЕРМОСТАТА');
      console.log('═══════════════════════════════════════\n');
      
      console.log('1️⃣  ОПРЕДЕЛИТЬ ПОМЕЩЕНИЕ');
      console.log('   • Термостат должен быть в том же помещении, что и S4 модуль');
      console.log('   • site термостата = site S4 модуля');
      console.log();
      
      console.log('2️⃣  НАЙТИ S4 МОДУЛЬ В ПОМЕЩЕНИИ');
      console.log('   • Тип устройства: 37 (0x25) - S4 модуль');
      console.log('   • Или тип 32 (0x20) - сенсорный модуль');
      console.log('   • У модуля должен быть встроенный датчик температуры');
      console.log();
      
      console.log('3️⃣  НАСТРОИТЬ ДАТЧИК ТЕМПЕРАТУРЫ');
      console.log('   • Датчик должен иметь master = ID S4 модуля');
      console.log('   • Датчик должен быть включен в temperature_ext S4 модуля');
      console.log('   • sensor термостата = ID датчика температуры');
      console.log();
      
      console.log('4️⃣  ПРИВЯЗАТЬ К DI/4 КАНАЛУ');
      console.log('   • bind термостата = "ID_S4_МОДУЛЯ/di/4"');
      console.log('   • Например: "80:98:67:45:dc:23/di/4"');
      console.log('   • DI/4 используется для управления и индикации');
      console.log();
      
      console.log('5️⃣  СОЗДАТЬ СКРИПТЫ УПРАВЛЕНИЯ');
      console.log('   • onStartHeat - скрипт включения обогрева');
      console.log('   • onStopHeat - скрипт выключения обогрева');
      console.log('   • onStartCool - скрипт включения охлаждения (опционально)');
      console.log('   • onStopCool - скрипт выключения охлаждения (опционально)');
      console.log();
      
      console.log('6️⃣  ПРОВЕРИТЬ ЦЕЛОСТНОСТЬ');
      console.log('   • Все устройства в одном помещении');
      console.log('   • Мастер датчика = bind термостата (первая часть до /)');
      console.log('   • Датчик в temperature_ext мастера');
      console.log('   • Все скрипты существуют и имеют действия');
      console.log();
      
      console.log('═══════════════════════════════════════');
      log(colors.cyan + colors.bright, '🔧 ПРИМЕР ПРАВИЛЬНОЙ КОНФИГУРАЦИИ');
      console.log('═══════════════════════════════════════\n');
      
      console.log('Термостат:');
      console.log('{');
      console.log('  "type": "thermostat",');
      console.log('  "title": "Т Душ",');
      console.log('  "site": "7669d319-f98f-41a0-a021-97c808442481",');
      console.log('  "bind": "80:98:67:45:dc:23/di/4",  // ← S4 Душ / DI/4');
      console.log('  "sensor": "28:aa:47:0b:70:21:07:c8",  // ← Датчик "Пол душ"');
      console.log('  "onStartHeat": "b3ebb927-5629-41d1-9b16-5f8f81db0f99",');
      console.log('  "onStopHeat": "22046a4c-2325-498e-a914-76c3cdcec900"');
      console.log('}');
      console.log();
      
      console.log('S4 Модуль:');
      console.log('{');
      console.log('  "id": "80:98:67:45:dc:23",');
      console.log('  "type": 37,  // 0x25 - S4');
      console.log('  "title": "S4 Душ",');
      console.log('  "site": "7669d319-f98f-41a0-a021-97c808442481",');
      console.log('  "temperature": 25.64,  // Встроенный датчик');
      console.log('  "temperature_ext": [');
      console.log('    "28:aa:47:0b:70:21:07:c8"  // ← Датчик в массиве');
      console.log('  ]');
      console.log('}');
      console.log();
      
      console.log('Датчик:');
      console.log('{');
      console.log('  "id": "28:aa:47:0b:70:21:07:c8",');
      console.log('  "type": 240,  // TEMPERATURE_EXT');
      console.log('  "title": "Пол душ",');
      console.log('  "master": "80:98:67:45:dc:23",  // ← Ссылка на S4');
      console.log('  "temperature": 26.81');
      console.log('}');
      console.log();
    } else {
      log(colors.green + colors.bright, '\n🎉 Все термостаты настроены правильно!');
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
checkThermostatBindings().catch(error => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
