#!/usr/bin/env node

// Скрипт для проверки содержимого LevelDB на малинке
const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');

async function checkDB() {
  try {
    console.log('Открываем БД:', DB_PATH);
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    const stats = {
      total: 0,
      types: {},
      sites: [],
      projects: [],
      devices: [],
      scripts: [],
      other: []
    };
    
    for await (const [key, value] of db.iterator()) {
      stats.total++;
      
      if (!value || typeof value !== 'object') {
        stats.other.push({ key, type: typeof value });
        continue;
      }
      
      const type = value.type;
      if (!stats.types[type]) {
        stats.types[type] = 0;
      }
      stats.types[type]++;
      
      // Собираем информацию о важных объектах
      if (type === 'site' || type === 'SITE') {
        stats.sites.push({ key, title: value.title || value.code, ...value });
      } else if (type === 'project' || type === 'PROJECT') {
        stats.projects.push({ key, title: value.title || value.code, ...value });
      } else if (type && typeof type === 'number') {
        // Устройство (type - число)
        const device = {
          key,
          type,
          online: value.online,
          hasSite: !!value.site,
          site: value.site,
          hasProject: !!value.project,
          project: value.project,
          hasParent: !!value.parent,
          parent: value.parent
        };
        stats.devices.push(device);
      } else if (type === 'script' || type === 'SCRIPT') {
        stats.scripts.push({ key, title: value.title });
      }
    }
    
    console.log('\n=== Статистика БД ===');
    console.log('Всего записей:', stats.total);
    console.log('\nРаспределение по типам:');
    for (const [type, count] of Object.entries(stats.types).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
    
    console.log('\n=== Локации (SITE) ===');
    console.log('Количество:', stats.sites.length);
    if (stats.sites.length > 0) {
      stats.sites.forEach(site => {
        console.log(`  - ${site.key}: ${site.title || site.code || 'без названия'}`);
      });
    } else {
      console.log('  ❌ Локации не найдены!');
    }
    
    console.log('\n=== Проекты (PROJECT) ===');
    console.log('Количество:', stats.projects.length);
    if (stats.projects.length > 0) {
      stats.projects.forEach(project => {
        console.log(`  - ${project.key}: ${project.title || project.code || 'без названия'}`);
      });
    } else {
      console.log('  ⚠️  Проекты не найдены');
    }
    
    console.log('\n=== Устройства ===');
    console.log('Всего устройств:', stats.devices.length);
    const devicesWithSite = stats.devices.filter(d => d.hasSite);
    const devicesWithoutSite = stats.devices.filter(d => !d.hasSite);
    console.log(`  С привязкой к site: ${devicesWithSite.length}`);
    console.log(`  ❌ Без привязки к site: ${devicesWithoutSite.length}`);
    
    if (devicesWithoutSite.length > 0) {
      console.log('\nПримеры устройств без привязки (первые 5):');
      devicesWithoutSite.slice(0, 5).forEach(dev => {
        console.log(`  - ${dev.key} (type: ${dev.type}, online: ${dev.online}, project: ${dev.project || 'нет'}, parent: ${dev.parent || 'нет'})`);
      });
    }
    
    console.log('\n=== Скрипты ===');
    console.log('Количество:', stats.scripts.length);
    
    await db.close();
    
    // Выводим заключение
    console.log('\n=== ❌ ПРОБЛЕМА ===');
    if (stats.sites.length === 0) {
      console.log('Локации (SITE) не найдены в БД!');
      console.log('Устройства не могут быть привязаны к локациям.');
    }
    if (devicesWithoutSite.length > 0) {
      console.log(`${devicesWithoutSite.length} устройств не имеют привязки к site!`);
      console.log('Эти устройства будут отображаться с site=null в логах.');
    }
    
  } catch (error) {
    console.error('Ошибка:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

checkDB();
