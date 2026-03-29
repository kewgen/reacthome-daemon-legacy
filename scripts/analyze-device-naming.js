#!/usr/bin/env node

/**
 * Анализ нейминга устройств: name, code, title
 * 
 * Зачем: Понять принципы использования полей name, code и title в устройствах ReactHome
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');

async function analyzeNaming() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║ АНАЛИЗ НЕЙМИНГА УСТРОЙСТВ (name, code, title)            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  
  const stats = {
    total: 0,
    withTitle: 0,
    withCode: 0,
    withName: 0,
    withAll: 0,
    withTitleOnly: 0,
    withCodeOnly: 0,
    withNameOnly: 0,
    withTitleAndCode: 0,
    empty: 0,
  };
  
  const examples = {
    withAll: [],
    withTitleOnly: [],
    withCodeOnly: [],
    withNameOnly: [],
    withTitleAndCode: [],
    empty: [],
  };
  
  try {
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      if (key.includes('/')) continue; // Зачем: Пропускаем каналы
      
      const type = value.type;
      if (!type) continue;
      
      stats.total++;
      
      const hasTitle = !!value.title;
      const hasCode = !!value.code;
      const hasName = !!value.name;
      
      if (hasTitle) stats.withTitle++;
      if (hasCode) stats.withCode++;
      if (hasName) stats.withName++;
      
      const device = {
        id: key.substring(0, 20) + (key.length > 20 ? '...' : ''),
        type: typeof type === 'number' ? `0x${type.toString(16)}` : type,
        title: value.title || null,
        code: value.code || null,
        name: value.name || null,
      };
      
      if (hasTitle && hasCode && hasName) {
        stats.withAll++;
        if (examples.withAll.length < 5) examples.withAll.push(device);
      } else if (hasTitle && hasCode && !hasName) {
        stats.withTitleAndCode++;
        if (examples.withTitleAndCode.length < 5) examples.withTitleAndCode.push(device);
      } else if (hasTitle && !hasCode && !hasName) {
        stats.withTitleOnly++;
        if (examples.withTitleOnly.length < 5) examples.withTitleOnly.push(device);
      } else if (!hasTitle && hasCode && !hasName) {
        stats.withCodeOnly++;
        if (examples.withCodeOnly.length < 5) examples.withCodeOnly.push(device);
      } else if (!hasTitle && !hasCode && hasName) {
        stats.withNameOnly++;
        if (examples.withNameOnly.length < 5) examples.withNameOnly.push(device);
      } else if (!hasTitle && !hasCode && !hasName) {
        stats.empty++;
        if (examples.empty.length < 5) examples.empty.push(device);
      }
    }
  } finally {
    await db.close();
  }
  
  // Зачем: Выводим статистику
  console.log('📊 СТАТИСТИКА:\n');
  console.log(`Всего устройств: ${stats.total}`);
  console.log(`  С title: ${stats.withTitle} (${(stats.withTitle / stats.total * 100).toFixed(1)}%)`);
  console.log(`  С code: ${stats.withCode} (${(stats.withCode / stats.total * 100).toFixed(1)}%)`);
  console.log(`  С name: ${stats.withName} (${(stats.withName / stats.total * 100).toFixed(1)}%)`);
  console.log('');
  
  console.log('📈 КОМБИНАЦИИ:\n');
  console.log(`  Все три поля (title + code + name): ${stats.withAll} (${(stats.withAll / stats.total * 100).toFixed(1)}%)`);
  console.log(`  title + code (БЕЗ name): ${stats.withTitleAndCode} (${(stats.withTitleAndCode / stats.total * 100).toFixed(1)}%)`);
  console.log(`  Только title: ${stats.withTitleOnly} (${(stats.withTitleOnly / stats.total * 100).toFixed(1)}%)`);
  console.log(`  Только code: ${stats.withCodeOnly} (${(stats.withCodeOnly / stats.total * 100).toFixed(1)}%)`);
  console.log(`  Только name: ${stats.withNameOnly} (${(stats.withNameOnly / stats.total * 100).toFixed(1)}%)`);
  console.log(`  Пустые (нет ни одного): ${stats.empty} (${(stats.empty / stats.total * 100).toFixed(1)}%)`);
  console.log('');
  
  // Зачем: Выводим примеры
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📝 ПРИМЕРЫ:\n');
  
  if (examples.withAll.length > 0) {
    console.log('✓ Все три поля (title + code + name):');
    examples.withAll.forEach(d => {
      console.log(`  ${d.type} | title: "${d.title}" | code: "${d.code}" | name: "${d.name}"`);
    });
    console.log('');
  }
  
  if (examples.withTitleAndCode.length > 0) {
    console.log('✓ title + code (БЕЗ name) - НАИБОЛЕЕ ЧАСТАЯ КОМБИНАЦИЯ:');
    examples.withTitleAndCode.forEach(d => {
      console.log(`  ${d.type} | title: "${d.title}" | code: "${d.code}"`);
    });
    console.log('');
  }
  
  if (examples.withTitleOnly.length > 0) {
    console.log('✓ Только title:');
    examples.withTitleOnly.forEach(d => {
      console.log(`  ${d.type} | title: "${d.title}"`);
    });
    console.log('');
  }
  
  if (examples.withCodeOnly.length > 0) {
    console.log('✓ Только code:');
    examples.withCodeOnly.forEach(d => {
      console.log(`  ${d.type} | code: "${d.code}"`);
    });
    console.log('');
  }
  
  if (examples.withNameOnly.length > 0) {
    console.log('✓ Только name:');
    examples.withNameOnly.forEach(d => {
      console.log(`  ${d.type} | name: "${d.name}"`);
    });
    console.log('');
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Зачем: Выводим выводы и принципы
  console.log('💡 ВЫВОДЫ И ПРИНЦИПЫ:\n');
  
  const titlePercent = (stats.withTitle / stats.total * 100).toFixed(1);
  const codePercent = (stats.withCode / stats.total * 100).toFixed(1);
  const namePercent = (stats.withName / stats.total * 100).toFixed(1);
  
  console.log(`1. title - основное поле (${titlePercent}% устройств)`);
  console.log('   Назначение: Человекочитаемое название устройства');
  console.log('   Пример: "Освещение", "R4", "Dim1", "TV Гостиная"');
  console.log('');
  
  console.log(`2. code - дополнительное поле (${codePercent}% устройств)`);
  console.log('   Назначение: Техническая метка / код устройства');
  console.log('   Пример: "4.D.L.2", "lamp2", "Р22", "6.D.L.3 Лоджия"');
  console.log('   Часто содержит: структурированный код (номер помещения.тип.индекс)');
  console.log('');
  
  console.log(`3. name - РЕДКОЕ поле (${namePercent}% устройств)`);
  console.log('   Назначение: УСТАРЕВШЕЕ или НЕИСПОЛЬЗУЕМОЕ поле');
  console.log('   Вывод: В ReactHome поле name практически не используется');
  console.log('   Рекомендация: Не полагаться на это поле, использовать title/code');
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('🎯 РЕКОМЕНДУЕМАЯ СТРАТЕГИЯ ОТОБРАЖЕНИЯ:\n');
  console.log('  Приоритет: code → title → name → id');
  console.log('  ');
  console.log('  Зачем code первым:');
  console.log('  - code содержит структурированную информацию');
  console.log('  - code уникален и информативен');
  console.log('  - code помогает быстро найти устройство');
  console.log('  ');
  console.log('  Если code пустой → используем title');
  console.log('  Если и title пустой → name (очень редко)');
  console.log('  Если все пусто → показываем id');
  console.log('');
}

analyzeNaming().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
