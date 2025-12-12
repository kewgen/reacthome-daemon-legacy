#!/usr/bin/env node

/**
 * Анализ типов устройств из маппинга
 * Использование: node analyze-device-types.js [путь_к_маппингу]
 */

const fs = require('fs');
const path = require('path');

const MAPPING_FILE = process.argv[2] || './device-mapping.json';
const OUTPUT_FILE = './reports/device-types-statistics.md';

async function analyzeTypes() {
  try {
    console.error(`📊 Загружаю маппинг: ${MAPPING_FILE}`);
    const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    
    const types = {};
    Object.values(mapping).forEach(device => {
      const type = device.type || 'null';
      types[type] = (types[type] || 0) + 1;
    });
    
    const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
    
    let report = '# Статистика типов устройств\n\n';
    report += `**Дата анализа:** ${new Date().toISOString().split('T')[0]}\n\n`;
    report += `**Всего устройств:** ${Object.keys(mapping).length}\n`;
    report += `**Всего типов:** ${sorted.length}\n\n`;
    
    report += '## Типы устройств (отсортировано по количеству)\n\n';
    report += '| Количество | Тип |\n';
    report += '|------------|-----|\n';
    sorted.forEach(([type, count]) => {
      const typeDisplay = type === 'null' ? '*(null)*' : `\`${type}\``;
      report += `| ${count} | ${typeDisplay} |\n`;
    });
    
    report += '\n## Группировка по категориям\n\n';
    
    const categories = {
      'ACTION_* (действия)': sorted
        .filter(([t]) => t && t.startsWith('ACTION_'))
        .reduce((sum, [, c]) => sum + c, 0),
      'null (без типа)': types['null'] || 0,
      'script (скрипты)': types['script'] || 0,
      'timer (таймеры)': types['timer'] || 0,
      'schedule (расписания)': types['schedule'] || 0,
      'light_* (освещение)': sorted
        .filter(([t]) => t && t.startsWith('light_'))
        .reduce((sum, [, c]) => sum + c, 0),
      'socket_* (розетки)': sorted
        .filter(([t]) => t && t.startsWith('socket_'))
        .reduce((sum, [, c]) => sum + c, 0),
      'valve_* (клапаны)': sorted
        .filter(([t]) => t && t.startsWith('valve_'))
        .reduce((sum, [, c]) => sum + c, 0),
      'sensor_* (датчики)': sorted
        .filter(([t]) => t && (t.includes('sensor') || t.includes('stat') || t.includes('counter')))
        .reduce((sum, [, c]) => sum + c, 0),
      'Числовые (3, 4, 32, ...)': sorted
        .filter(([t]) => t && /^\d+$/.test(t))
        .reduce((sum, [, c]) => sum + c, 0),
      'Прочее': sorted
        .filter(([t]) => {
          return t && 
            !t.startsWith('ACTION_') && 
            !t.startsWith('light_') && 
            !t.startsWith('socket_') && 
            !t.startsWith('valve_') && 
            !/^\d+$/.test(t) && 
            t !== 'null' && 
            t !== 'script' && 
            t !== 'timer' && 
            t !== 'schedule' && 
            !t.includes('sensor') && 
            !t.includes('stat') && 
            !t.includes('counter');
        })
        .reduce((sum, [, c]) => sum + c, 0)
    };
    
    report += '| Категория | Количество |\n';
    report += '|-----------|------------|\n';
    Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        report += `| ${cat} | ${count} |\n`;
      });
    
    // Детализация ACTION_*
    report += '\n## Детализация ACTION_* типов\n\n';
    report += '| Количество | Тип |\n';
    report += '|------------|-----|\n';
    sorted
      .filter(([t]) => t && t.startsWith('ACTION_'))
      .forEach(([type, count]) => {
        report += `| ${count} | \`${type}\` |\n`;
      });
    
    // Детализация числовых типов
    const numericTypes = sorted.filter(([t]) => t && /^\d+$/.test(t));
    if (numericTypes.length > 0) {
      report += '\n## Детализация числовых типов\n\n';
      report += '| Количество | Тип |\n';
      report += '|------------|-----|\n';
      numericTypes.forEach(([type, count]) => {
        report += `| ${count} | \`${type}\` |\n`;
      });
    }
    
    // Сохраняем отчёт
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(OUTPUT_FILE, report);
    
    console.error(`✅ Отчёт сохранён в ${OUTPUT_FILE}`);
    console.error(`\n📊 Топ-10 типов:`);
    sorted.slice(0, 10).forEach(([type, count], idx) => {
      const typeDisplay = type === 'null' ? '(null)' : type;
      console.error(`   ${idx + 1}. ${typeDisplay}: ${count}`);
    });
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

analyzeTypes();
