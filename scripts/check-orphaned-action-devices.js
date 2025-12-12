#!/usr/bin/env node

// Зачем: Скрипт для поиска "потерянных" устройств - записей типа ACTION_*, которые
// должны быть действиями в скриптах, а не отдельными устройствами

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
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

// Зачем: Типы ACTION_* которые должны быть действиями, а не устройствами
const ACTION_TYPES = [
  'ACTION_ON',
  'ACTION_OFF',
  'ACTION_SET',
  'ACTION_TOGGLE',
  'ACTION_ENABLE',
  'ACTION_DISABLE',
  'ACTION_DOPPLER_HANDLE',
  'ACTION_SCRIPT_RUN',
  'ACTION_TIMER_START',
  'ACTION_TIMER_STOP',
];

async function checkOrphanedActionDevices() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  
  try {
    log(colors.cyan + colors.bright, '\n═══════════════════════════════════════');
    log(colors.cyan + colors.bright, '🔍 Поиск "потерянных" ACTION устройств');
    log(colors.cyan + colors.bright, '═══════════════════════════════════════\n');
    
    const orphanedActions = [];
    const actionsByType = {};
    
    // Зачем: Собираем все устройства с типом ACTION_*
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      if (ACTION_TYPES.includes(value.type)) {
        orphanedActions.push({
          id: key,
          type: value.type,
          title: value.title || value.code || '—',
          online: value.online,
          ready: value.ready,
          payload: value.payload,
          script: value.script,
          delay: value.delay,
        });
        
        if (!actionsByType[value.type]) {
          actionsByType[value.type] = 0;
        }
        actionsByType[value.type]++;
      }
    }
    
    log(colors.blue, `📊 Найдено "потерянных" ACTION устройств: ${orphanedActions.length}\n`);
    
    if (orphanedActions.length === 0) {
      log(colors.green, '✅ "Потерянных" ACTION устройств не найдено!');
      return;
    }
    
    // Зачем: Статистика по типам
    console.log('Распределение по типам:');
    Object.entries(actionsByType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    console.log();
    
    // Зачем: Показываем первые 10 устройств для примера
    console.log('─────────────────────────────────────');
    log(colors.yellow, '⚠️  Примеры "потерянных" ACTION устройств (первые 10):');
    console.log('─────────────────────────────────────\n');
    
    for (let i = 0; i < Math.min(orphanedActions.length, 10); i++) {
      const action = orphanedActions[i];
      console.log(`[${i + 1}] ID: ${action.id}`);
      console.log(`   Тип: ${action.type}`);
      console.log(`   Название: ${action.title}`);
      console.log(`   Онлайн: ${action.online ? '🟢' : '🔴'}`);
      console.log(`   Готов: ${action.ready ? '✅' : '⚠️'}`);
      
      if (action.script) {
        const script = await db.get(action.script).catch(() => null);
        if (script) {
          console.log(`   Скрипт: ${script.title || script.code || action.script}`);
        } else {
          console.log(`   Скрипт: ${action.script} (не найден)`);
        }
      }
      
      if (action.payload && action.payload.id) {
        console.log(`   Целевое устройство: ${action.payload.id.substring(0, 17)}...`);
      }
      
      console.log();
    }
    
    if (orphanedActions.length > 10) {
      console.log(`... и еще ${orphanedActions.length - 10} устройств\n`);
    }
    
    // Зачем: Проверяем, используются ли эти ACTION в скриптах
    console.log('═══════════════════════════════════════');
    log(colors.cyan, '🔍 Проверка использования в скриптах');
    console.log('═══════════════════════════════════════\n');
    
    const orphanedIds = new Set(orphanedActions.map(a => a.id));
    const usedInScripts = new Map();
    
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      if (value.type === 'script' && value.action && Array.isArray(value.action)) {
        for (const actionId of value.action) {
          if (orphanedIds.has(actionId)) {
            if (!usedInScripts.has(actionId)) {
              usedInScripts.set(actionId, []);
            }
            usedInScripts.get(actionId).push({
              scriptId: key,
              scriptTitle: value.title || value.code || key.substring(0, 8) + '...',
            });
          }
        }
      }
    }
    
    const usedCount = usedInScripts.size;
    const unusedCount = orphanedActions.length - usedCount;
    
    log(colors.blue, `Используются в скриптах: ${usedCount}`);
    log(unusedCount > 0 ? colors.red : colors.green, `НЕ используются: ${unusedCount}\n`);
    
    if (usedCount > 0) {
      console.log('Примеры использования (первые 5):');
      let shown = 0;
      for (const [actionId, scripts] of usedInScripts) {
        if (shown >= 5) break;
        const action = orphanedActions.find(a => a.id === actionId);
        console.log(`  ${action.type} (${actionId.substring(0, 8)}...)`);
        scripts.slice(0, 2).forEach(s => {
          console.log(`    → Скрипт: ${s.scriptTitle}`);
        });
        if (scripts.length > 2) {
          console.log(`    ... и еще ${scripts.length - 2} скриптов`);
        }
        shown++;
      }
      console.log();
    }
    
    // Зачем: Анализ и рекомендации
    console.log('═══════════════════════════════════════');
    log(colors.cyan + colors.bright, '💡 АНАЛИЗ И РЕКОМЕНДАЦИИ');
    console.log('═══════════════════════════════════════\n');
    
    log(colors.yellow, '⚠️  ПРОБЛЕМА:');
    console.log(`Найдено ${orphanedActions.length} записей с типом ACTION_*`);
    console.log('Эти записи должны быть действиями ВНУТРИ скриптов,');
    console.log('а НЕ отдельными устройствами в базе данных.\n');
    
    log(colors.cyan, '📝 ЧТО ЭТО ТАКОЕ:');
    console.log('ACTION_* типы - это действия, выполняемые скриптами:');
    console.log('  • ACTION_ON/OFF - включение/выключение устройства');
    console.log('  • ACTION_SET - установка значения');
    console.log('  • ACTION_DOPPLER_HANDLE - обработка допплера');
    console.log('  • ACTION_ENABLE/DISABLE - включение/отключение');
    console.log('  • и т.д.\n');
    
    log(colors.cyan, '🏗️  ПРАВИЛЬНАЯ СТРУКТУРА:');
    console.log('Скрипт:');
    console.log('{');
    console.log('  "type": "script",');
    console.log('  "title": "start heat душ",');
    console.log('  "action": [');
    console.log('    "action-uuid-1",  // ← ID записи ACTION_* в БД');
    console.log('    "action-uuid-2"');
    console.log('  ]');
    console.log('}\n');
    
    console.log('Действие:');
    console.log('{');
    console.log('  "id": "action-uuid-1",');
    console.log('  "type": "ACTION_ON",');
    console.log('  "script": "script-uuid",');
    console.log('  "payload": { "id": "device-uuid" }');
    console.log('}\n');
    
    log(colors.yellow, '⚠️  ПОЧЕМУ ЭТО ПРОБЛЕМА:');
    console.log('1. ACTION_* записи показываются как устройства в monitor.js');
    console.log('2. Они всегда offline и not ready (не физические устройства)');
    console.log('3. Загромождают список устройств');
    console.log('4. Могут вызывать путаницу\n');
    
    log(colors.green, '✅ РЕШЕНИЕ:');
    console.log('Вариант 1: Не отображать ACTION_* как устройства');
    console.log('  → Добавить фильтр в monitor.js');
    console.log('  → Скрыть их из списка устройств\n');
    
    console.log('Вариант 2: Удалить неиспользуемые ACTION_*');
    console.log(`  → ${unusedCount} действий НЕ используются в скриптах`);
    console.log('  → Их можно безопасно удалить\n');
    
    console.log('Вариант 3: Оставить как есть');
    console.log('  → ACTION_* являются частью архитектуры');
    console.log('  → Используются скриптами для выполнения действий');
    console.log('  → Просто не показывать их пользователю\n');
    
    log(colors.cyan, '🔧 РЕКОМЕНДУЕМЫЕ ДЕЙСТВИЯ:');
    console.log('1. Добавить фильтр в monitor.js:');
    console.log('   → Не показывать устройства с типом ACTION_*\n');
    
    console.log('2. (Опционально) Удалить неиспользуемые ACTION_*:');
    if (unusedCount > 0) {
      log(colors.yellow, `   → ${unusedCount} действий можно удалить`);
    } else {
      log(colors.green, `   → Все ACTION_* используются в скриптах`);
    }
    console.log();
    
    console.log('3. Документировать архитектуру ACTION_*:');
    console.log('   → Объяснить, что это действия, а не устройства');
    console.log('   → Описать правильную структуру скриптов\n');
    
  } catch (error) {
    log(colors.red, '❌ Ошибка:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Зачем: Запуск проверки
checkOrphanedActionDevices().catch(error => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
