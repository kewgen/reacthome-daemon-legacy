#!/usr/bin/env node

/**
 * Скрипт проверки целостности связей S3/S4 модулей с датчиками температуры
 * 
 * Зачем: Проверяет соответствие между:
 * - temperature_ext[] мастер-модулей (список датчиков в конфигурации)
 * - master полем датчиков (обратная ссылка на мастер)
 * 
 * Обнаруживает:
 * 1. Датчики с master, но НЕ в temperature_ext[] мастера
 * 2. Датчики в temperature_ext[], но с другим master
 * 3. Датчики без master
 * 4. Датчики с некорректным master (не S3/S4)
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');

async function checkS3S4TemperatureSensors() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 ПРОВЕРКА ЦЕЛОСТНОСТИ СВЯЗЕЙ S3/S4 ↔ ДАТЧИКИ ТЕМПЕРАТУРЫ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Зачем: Собираем все S3/S4 модули и датчики температуры
  const masterModules = [];
  const temperatureSensors = [];
  
  for await (const [key, value] of db.iterator()) {
    if (!value || typeof value !== 'object') continue;
    
    // S3 модули (тип 32 = 0x20) И S4 модули (тип 37 = 0x25)
    if (value.type === 32 || value.type === 0x20 || value.type === 37 || value.type === 0x25) {
      masterModules.push({
        id: key,
        title: value.title || value.code || '—',
        type: value.type,
        typeName: value.type === 32 ? 'S3' : 'S4',
        ip: value.ip,
        temperature: value.temperature,
        temperature_ext: value.temperature_ext || [],
        online: value.online,
        ready: value.ready,
        device: value
      });
    }
    
    // Датчики температуры (тип 240 = 0xF0 = TEMPERATURE_EXT)
    if (value.type === 240 || value.type === 0xF0) {
      temperatureSensors.push({
        id: key,
        title: value.title || value.code || '—',
        master: value.master,
        temperature: value.temperature || value.temperature_raw,
        online: value.online,
        ready: value.ready,
        device: value
      });
    }
  }
  
  console.log(`📊 Найдено мастер-модулей S3/S4: ${masterModules.length}`);
  console.log(`   • S3: ${masterModules.filter(m => m.type === 32).length}`);
  console.log(`   • S4: ${masterModules.filter(m => m.type === 37).length}`);
  console.log(`📊 Найдено датчиков температуры: ${temperatureSensors.length}`);
  console.log();
  
  // Зачем: Сортируем по типу (S3 сначала, потом S4)
  masterModules.sort((a, b) => a.type - b.type);
  
  // Зачем: Проверяем каждый модуль
  let totalIssues = 0;
  const issuesByModule = [];
  
  for (const master of masterModules) {
    const sensorsInExt = master.temperature_ext;
    const sensorsPointingToMaster = temperatureSensors.filter(s => s.master === master.id);
    
    // Зачем: Ищем несоответствия
    const onlyInExt = sensorsInExt.filter(id => 
      !sensorsPointingToMaster.find(s => s.id === id) && 
      temperatureSensors.find(s => s.id === id) // но датчик существует
    );
    const onlyInMaster = sensorsPointingToMaster.filter(s => 
      !sensorsInExt.includes(s.id)
    );
    
    if (onlyInExt.length > 0 || onlyInMaster.length > 0) {
      issuesByModule.push({
        module: master,
        onlyInExt,
        onlyInMaster
      });
      totalIssues += onlyInExt.length + onlyInMaster.length;
    }
  }
  
  // Зачем: Выводим краткую статистику
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 КРАТКАЯ СТАТИСТИКА');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (issuesByModule.length === 0) {
    console.log('✅ ВСЕ СВЯЗИ КОРРЕКТНЫ!');
    console.log('   Все датчики правильно связаны с мастер-модулями.\n');
  } else {
    console.log(`❌ ОБНАРУЖЕНО ПРОБЛЕМ: ${totalIssues}`);
    console.log(`📱 Модулей с проблемами: ${issuesByModule.length}\n`);
    
    for (const item of issuesByModule) {
      const { module, onlyInExt, onlyInMaster } = item;
      
      console.log(`🔴 ${module.typeName}: ${module.title}`);
      console.log(`   ID: ${module.id}`);
      console.log(`   temperature_ext[]: ${module.temperature_ext.length} датчиков`);
      console.log(`   С master на этот модуль: ${temperatureSensors.filter(s => s.master === module.id).length} датчиков`);
      
      if (onlyInExt.length > 0) {
        console.log(`   ⚠️  В temperature_ext[], но master != модуль: ${onlyInExt.length}`);
      }
      if (onlyInMaster.length > 0) {
        console.log(`   ⚠️  НЕ в temperature_ext[]: ${onlyInMaster.length} датчиков`);
      }
      console.log();
    }
  }
  
  // Зачем: Детальный отчет по проблемам
  if (issuesByModule.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔍 ДЕТАЛЬНЫЙ ОТЧЕТ ПО ПРОБЛЕМАМ');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    for (const item of issuesByModule) {
      const { module, onlyInExt, onlyInMaster } = item;
      
      console.log(`📱 ${module.typeName}: ${module.title} (${module.id})\n`);
      
      if (onlyInExt.length > 0) {
        console.log(`   🔴 В temperature_ext[], но master != модуль (${onlyInExt.length}):\n`);
        onlyInExt.forEach(id => {
          const sensor = temperatureSensors.find(s => s.id === id);
          const status = sensor?.ready ? '🟢' : '🔴';
          const temp = sensor?.temperature ? `${sensor.temperature}°C` : '—';
          const name = sensor?.title || '(без названия)';
          console.log(`      • ${id}`);
          console.log(`        ${status} ${name} - ${temp}`);
          console.log(`        master: ${sensor?.master || 'не указан'}`);
        });
        console.log();
      }
      
      if (onlyInMaster.length > 0) {
        console.log(`   🔴 master = модуль, но НЕ в temperature_ext[] (${onlyInMaster.length}):\n`);
        onlyInMaster.forEach(sensor => {
          const status = sensor.ready ? '🟢' : '🔴';
          const temp = sensor.temperature ? `${sensor.temperature}°C` : '—';
          const name = sensor.title || '(без названия)';
          console.log(`      • ${sensor.id}`);
          console.log(`        ${status} ${name} - ${temp}`);
        });
        console.log();
      }
    }
    
    // Зачем: Рекомендации по исправлению
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('💡 РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    for (const item of issuesByModule) {
      const { module, onlyInMaster } = item;
      
      if (onlyInMaster.length > 0) {
        console.log(`📝 ${module.typeName}: ${module.title} (${module.id})`);
        console.log(`   Добавить в temperature_ext[] следующие ${onlyInMaster.length} датчиков:\n`);
        
        onlyInMaster.forEach(sensor => {
          const name = sensor.title || '(без названия)';
          console.log(`   device.temperature_ext.push('${sensor.id}'); // ${name}`);
        });
        console.log();
      }
    }
  }
  
  // Зачем: Дополнительные проверки
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📋 ДОПОЛНИТЕЛЬНЫЕ ПРОВЕРКИ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Зачем: Датчики без master
  const orphanSensors = temperatureSensors.filter(s => !s.master);
  if (orphanSensors.length > 0) {
    console.log(`⚠️  Датчики без master (${orphanSensors.length}):\n`);
    orphanSensors.forEach(s => {
      const status = s.ready ? '🟢' : '🔴';
      const temp = s.temperature ? `${s.temperature}°C` : '—';
      console.log(`   • ${s.id}`);
      console.log(`     ${status} ${s.title} - ${temp}`);
    });
    console.log();
  } else {
    console.log('✅ Датчиков без master не обнаружено\n');
  }
  
  // Зачем: Датчики с некорректным master (не S3/S4)
  const sensorsWithInvalidMaster = temperatureSensors.filter(s => {
    if (!s.master) return false;
    return !masterModules.find(m => m.id === s.master);
  });
  
  if (sensorsWithInvalidMaster.length > 0) {
    console.log(`⚠️  Датчики с некорректным master (${sensorsWithInvalidMaster.length}):\n`);
    sensorsWithInvalidMaster.forEach(s => {
      const status = s.ready ? '🟢' : '🔴';
      const temp = s.temperature ? `${s.temperature}°C` : '—';
      console.log(`   • ${s.id}`);
      console.log(`     ${status} ${s.title} - ${temp}`);
      console.log(`     master: ${s.master} (не является S3/S4)`);
    });
    console.log();
  } else {
    console.log('✅ Датчиков с некорректным master не обнаружено\n');
  }
  
  await db.close();
  
  // Зачем: Возвращаем код выхода (0 = ок, 1 = есть проблемы)
  if (totalIssues > 0 || orphanSensors.length > 0 || sensorsWithInvalidMaster.length > 0) {
    process.exit(1);
  }
}

checkS3S4TemperatureSensors().catch(console.error);
