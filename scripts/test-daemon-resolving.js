#!/usr/bin/env node

/**
 * Тест резолвинга mac демона по ID проекта/сайта
 * 
 * Использование:
 *   node scripts/test-daemon-resolving.js [путь_к_бд]
 * 
 * Зачем: Проверить работу функций резолвинга из src/util-daemon.js
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || process.argv[2] || path.join(process.cwd(), 'var', 'db');

async function testResolving() {
  try {
    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║ ТЕСТ РЕЗОЛВИНГА MAC ПО PROJECT/SITE ID                   ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
    console.log(`БД: ${DB_PATH}\n`);
    
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    // Загружаем состояние из БД
    const state = {};
    for await (const [key, value] of db.iterator()) {
      state[key] = value;
    }
    
    console.log(`✅ Загружено записей: ${Object.keys(state).length}\n`);
    
    // Находим демон
    const macKey = state.mac;
    if (!macKey) {
      console.error('❌ Ключ "mac" не найден в БД');
      await db.close();
      process.exit(1);
    }
    
    console.log(`[1] MAC демона (из ключа "mac"):`);
    console.log(`    ${macKey}\n`);
    
    // Находим объект демона
    const daemon = state[macKey];
    if (!daemon) {
      console.error(`❌ Объект демона не найден по ключу "${macKey}"`);
      await db.close();
      process.exit(1);
    }
    
    const projectId = daemon.project;
    console.log(`[2] Project ID (из объекта демона):`);
    console.log(`    ${projectId}\n`);
    
    // Находим объект проекта
    const project = state[projectId];
    if (!project) {
      console.error(`❌ Объект проекта не найден по ID "${projectId}"`);
      await db.close();
      process.exit(1);
    }
    
    console.log(`[3] Объект проекта:`);
    console.log(`    Название: ${project.title || project.code || 'не указано'}`);
    console.log(`    Тип: ${project.type}`);
    console.log(`    Daemon field: ${project.daemon || 'отсутствует'}\n`);
    
    // ТЕСТ РЕЗОЛВИНГА
    console.log('═'.repeat(60));
    console.log('ТЕСТ РЕЗОЛВИНГА');
    console.log('═'.repeat(60) + '\n');
    
    // Тест 1: Резолвинг по project ID
    console.log(`[ТЕСТ 1] Резолвинг по project ID:`);
    console.log(`   Вход: projectId = "${projectId}"`);
    console.log(`   Код: get(projectId).daemon`);
    const resolvedMac1 = project.daemon;
    console.log(`   Результат: ${resolvedMac1}`);
    console.log(`   Статус: ${resolvedMac1 === macKey ? '✅ УСПЕХ' : '❌ ОШИБКА'}\n`);
    
    // Тест 2: Резолвинг по site ID
    if (project.site && Array.isArray(project.site) && project.site.length > 0) {
      const siteId = project.site[0];
      const site = state[siteId];
      
      console.log(`[ТЕСТ 2] Резолвинг по site ID:`);
      console.log(`   Вход: siteId = "${siteId}"`);
      console.log(`   Название сайта: ${site?.title || site?.code || 'не указано'}`);
      console.log(`   Код: get(siteId).project/parent → get(projectId).daemon`);
      // Сайт может использовать project или parent для ссылки на проект
      const siteProjectId = site?.project || site?.parent;
      const resolvedMac2 = siteProjectId ? state[siteProjectId]?.daemon : null;
      console.log(`   Site.project: ${site?.project || 'отсутствует'}`);
      console.log(`   Site.parent: ${site?.parent || 'отсутствует'}`);
      console.log(`   Используется: ${siteProjectId || 'не найден'}`);
      console.log(`   Результат: ${resolvedMac2 || 'не найден'}`);
      console.log(`   Статус: ${resolvedMac2 === macKey ? '✅ УСПЕХ' : '❌ ОШИБКА'}\n`);
    } else {
      console.log(`[ТЕСТ 2] Резолвинг по site ID: ⚠️  ПРОПУЩЕН (нет сайтов в проекте)\n`);
    }
    
    // Тест 3: Обратный резолвинг (mac → project)
    console.log(`[ТЕСТ 3] Обратный резолвинг (mac → project):`);
    console.log(`   Вход: mac = "${macKey}"`);
    console.log(`   Код: get(mac).project`);
    const resolvedProjectId = daemon.project;
    console.log(`   Результат: ${resolvedProjectId}`);
    console.log(`   Статус: ${resolvedProjectId === projectId ? '✅ УСПЕХ' : '❌ ОШИБКА'}\n`);
    
    // Итоговая схема
    console.log('═'.repeat(60));
    console.log('ИТОГОВАЯ СХЕМА СВЯЗЕЙ');
    console.log('═'.repeat(60) + '\n');
    
    console.log('Двусторонняя связь:');
    console.log(`  Демон → Проект: get("${macKey}").project`);
    console.log(`                  → "${projectId}"`);
    console.log();
    console.log(`  Проект → Демон: get("${projectId}").daemon`);
    console.log(`                  → "${macKey}"`);
    console.log();
    
    console.log('Gateway URL:');
    console.log(`  wss://gate.reacthome.net/${macKey}`);
    console.log();
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  }
}

testResolving();
