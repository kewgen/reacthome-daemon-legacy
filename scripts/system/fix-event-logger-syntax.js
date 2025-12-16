#!/usr/bin/env node
// Скрипт для исправления синтаксических ошибок в event-logger.js
const fs = require('fs');
const file = process.argv[2] || 'event-logger.js';

console.log('Исправление синтаксических ошибок в', file);
console.log('');

let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

console.log('Проверка строк 635-642:');
for (let i = 634; i < 642; i++) {
  if (lines[i]) {
    console.log(`${i+1}: ${lines[i]}`);
  }
}
console.log('');

let fixed = false;

// Строка 637 (индекс 636) - исправляем
if (lines[636]) {
  const original = lines[636];
  // Заменяем всю строку на правильную
  lines[636] = '    });';
  if (original !== lines[636]) {
    console.log('Исправлена строка 637:');
    console.log('  Было:', original);
    console.log('  Стало:', lines[636]);
    fixed = true;
  }
}

// Строка 638 (индекс 637) - должна быть просто });
if (lines[637] && lines[637].trim() !== '});') {
  const original = lines[637];
  lines[637] = '    });';
  console.log('Исправлена строка 638:');
  console.log('  Было:', original);
  console.log('  Стало:', lines[637]);
  fixed = true;
}

// Строка 671 (индекс 670) - должна быть log, не console.log
if (lines[669] && lines[669].includes('console.log')) {
  const original = lines[669];
  lines[669] = lines[669].replace('console.log', 'log');
  console.log('Исправлена строка 671:');
  console.log('  Было:', original);
  console.log('  Стало:', lines[669]);
  fixed = true;
}

if (fixed) {
  content = lines.join('\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('');
  console.log('✅ Файл сохранён');
  
  // Проверяем синтаксис
  try {
    require('vm').createScript(content);
    console.log('✅ Синтаксис корректен!');
    process.exit(0);
  } catch (e) {
    console.log('❌ Синтаксическая ошибка:', e.message);
    process.exit(1);
  }
} else {
  console.log('Изменений не требуется');
  process.exit(0);
}


