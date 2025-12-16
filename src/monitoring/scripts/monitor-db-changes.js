#!/usr/bin/env node

/**
 * Скрипт для мониторинга изменений в LevelDB
 * Использование: 
 *   node monitor-db-changes.js [путь_к_бд] [интервал_секунд] [--filter removed|added|modified|all]
 *   node monitor-db-changes.js --filter removed  # Показывать только удаления
 * Зачем: Отслеживает изменения в БД и выводит их в реальном времени
 */

const { Level } = require('level');
const fs = require('fs');
const path = require('path');

// Парсим аргументы командной строки
const args = process.argv.slice(2);
let dbPathArg = null;
let intervalArg = null;
let filterArg = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--filter' || args[i] === '-f') {
    filterArg = args[i + 1];
    i++;
  } else if (!isNaN(parseInt(args[i], 10))) {
    intervalArg = parseInt(args[i], 10);
  } else if (!args[i].startsWith('-')) {
    dbPathArg = args[i];
  }
}

const DB_PATH = process.env.DB_PATH || dbPathArg || '/home/pi/reacthome-daemon/var/db';
const INTERVAL_SEC = intervalArg || parseInt(process.env.INTERVAL_SEC || '5', 10);
const FILTER = filterArg || process.env.FILTER || 'all'; // all, added, removed, modified
const SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || path.join(__dirname, '../var/db-snapshot.json');

// Создаём директорию для снимков если её нет
const snapshotDir = path.dirname(SNAPSHOT_FILE);
if (!fs.existsSync(snapshotDir)) {
  fs.mkdirSync(snapshotDir, { recursive: true });
}

// Загружаем предыдущий снимок БД
function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const data = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`⚠️  Ошибка загрузки снимка: ${error.message}`);
  }
  return {};
}

// Сохраняем снимок БД
function saveSnapshot(snapshot) {
  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (error) {
    console.error(`⚠️  Ошибка сохранения снимка: ${error.message}`);
  }
}

// Получаем текущее состояние БД
async function getCurrentSnapshot(db) {
  const snapshot = {};
  
  for await (const [key, value] of db.iterator()) {
    snapshot[key] = {
      value: value,
      timestamp: Date.now()
    };
  }
  
  return snapshot;
}

// Сравниваем два снимка и находим изменения
function compareSnapshots(oldSnapshot, newSnapshot) {
  const changes = {
    added: [],
    removed: [],
    modified: [],
    unchanged: 0
  };
  
  const allKeys = new Set([...Object.keys(oldSnapshot), ...Object.keys(newSnapshot)]);
  
  for (const key of allKeys) {
    const old = oldSnapshot[key];
    const new_ = newSnapshot[key];
    
    if (!old && new_) {
      // Добавлена новая запись
      changes.added.push({
        key: key,
        value: new_.value,
        type: typeof new_.value === 'object' && new_.value.type !== undefined 
          ? (typeof new_.value.type === 'number' ? `device_${new_.value.type}` : new_.value.type)
          : typeof new_.value
      });
    } else if (old && !new_) {
      // Удалена запись
      changes.removed.push({
        key: key,
        oldValue: old.value,
        type: typeof old.value === 'object' && old.value.type !== undefined
          ? (typeof old.value.type === 'number' ? `device_${old.value.type}` : old.value.type)
          : typeof old.value
      });
    } else if (old && new_) {
      // Проверяем, изменилась ли запись
      const oldStr = JSON.stringify(old.value);
      const newStr = JSON.stringify(new_.value);
      
      if (oldStr !== newStr) {
        // Находим изменённые поля
        const changedFields = [];
        if (typeof old.value === 'object' && typeof new_.value === 'object') {
          const allFields = new Set([...Object.keys(old.value), ...Object.keys(new_.value)]);
          for (const field of allFields) {
            if (JSON.stringify(old.value[field]) !== JSON.stringify(new_.value[field])) {
              changedFields.push({
                field: field,
                oldValue: old.value[field],
                newValue: new_.value[field]
              });
            }
          }
        }
        
        changes.modified.push({
          key: key,
          changedFields: changedFields,
          type: typeof new_.value === 'object' && new_.value.type !== undefined
            ? (typeof new_.value.type === 'number' ? `device_${new_.value.type}` : new_.value.type)
            : typeof new_.value
        });
      } else {
        changes.unchanged++;
      }
    }
  }
  
  return changes;
}

// Форматируем вывод изменений
function formatChanges(changes, timestamp) {
  // Для фильтра removed используем простой формат: одна строка = время + ID устройства
  if (FILTER === 'removed' || FILTER === 'deleted') {
    if (changes.removed.length === 0) {
      return null; // Нет удалений
    }
    
    const timeStr = new Date(timestamp).toLocaleString('ru-RU');
    const lines = [];
    
    // Простой формат: время + пробел + ID устройства (одна строка на удаление)
    changes.removed.forEach(change => {
      lines.push(`${timeStr} ${change.key}`);
    });
    
    return lines.join('\n');
  }
  
  // Для остальных режимов используем детальный формат
  const lines = [];
  const timeStr = new Date(timestamp).toLocaleString('ru-RU');
  
  // Фильтруем изменения в зависимости от параметра FILTER
  let filteredChanges = { ...changes };
  
  if (FILTER === 'added') {
    if (changes.added.length === 0) {
      return null; // Нет добавлений
    }
    filteredChanges = {
      added: changes.added,
      removed: [],
      modified: [],
      unchanged: 0
    };
  } else if (FILTER === 'modified') {
    if (changes.modified.length === 0) {
      return null; // Нет изменений
    }
    filteredChanges = {
      added: [],
      removed: [],
      modified: changes.modified,
      unchanged: 0
    };
  }
  
  if (filteredChanges.added.length === 0 && filteredChanges.removed.length === 0 && filteredChanges.modified.length === 0) {
    return null; // Нет изменений после фильтрации
  }
  
  lines.push(`\n╔═══════════════════════════════════════════════════════════════╗`);
  lines.push(`║   Изменения в БД: ${timeStr.padEnd(43)} ║`);
  lines.push(`╚═══════════════════════════════════════════════════════════════╝`);
  
  if (filteredChanges.added.length > 0) {
    lines.push(`\n➕ Добавлено записей: ${filteredChanges.added.length}`);
    filteredChanges.added.slice(0, 10).forEach(change => {
      const preview = typeof change.value === 'object' 
        ? JSON.stringify(change.value).substring(0, 100)
        : String(change.value).substring(0, 100);
      lines.push(`   • ${change.key} [${change.type}]`);
      if (preview.length > 0) {
        lines.push(`     ${preview}${preview.length >= 100 ? '...' : ''}`);
      }
    });
    if (filteredChanges.added.length > 10) {
      lines.push(`   ... и ещё ${filteredChanges.added.length - 10} записей`);
    }
  }
  
  if (filteredChanges.removed.length > 0) {
    lines.push(`\n➖ Удалено записей: ${filteredChanges.removed.length}`);
    filteredChanges.removed.slice(0, 10).forEach(change => {
      lines.push(`   • ${change.key} [${change.type}]`);
    });
    if (filteredChanges.removed.length > 10) {
      lines.push(`   ... и ещё ${filteredChanges.removed.length - 10} записей`);
    }
  }
  
  if (filteredChanges.modified.length > 0) {
    lines.push(`\n🔄 Изменено записей: ${filteredChanges.modified.length}`);
    filteredChanges.modified.slice(0, 10).forEach(change => {
      lines.push(`   • ${change.key} [${change.type}]`);
      change.changedFields.slice(0, 5).forEach(field => {
        const oldPreview = typeof field.oldValue === 'object'
          ? JSON.stringify(field.oldValue).substring(0, 50)
          : String(field.oldValue).substring(0, 50);
        const newPreview = typeof field.newValue === 'object'
          ? JSON.stringify(field.newValue).substring(0, 50)
          : String(field.newValue).substring(0, 50);
        lines.push(`     - ${field.field}: ${oldPreview} → ${newPreview}`);
      });
      if (change.changedFields.length > 5) {
        lines.push(`     ... и ещё ${change.changedFields.length - 5} полей`);
      }
    });
    if (filteredChanges.modified.length > 10) {
      lines.push(`   ... и ещё ${filteredChanges.modified.length - 10} записей`);
    }
  }
  
  if (FILTER === 'all') {
    lines.push(`\n📊 Статистика: добавлено: ${changes.added.length}, удалено: ${changes.removed.length}, изменено: ${changes.modified.length}, без изменений: ${changes.unchanged}`);
  } else {
    lines.push(`\n📊 Статистика: ${FILTER === 'removed' ? 'удалено' : FILTER === 'added' ? 'добавлено' : 'изменено'}: ${filteredChanges[FILTER === 'removed' ? 'removed' : FILTER === 'added' ? 'added' : 'modified'].length}`);
  }
  
  return lines.join('\n');
}

// Основная функция мониторинга
async function monitorDB() {
  let db;
  let oldSnapshot = loadSnapshot();
  
  console.error('╔═══════════════════════════════════════════════════════════════╗');
  console.error('║   Мониторинг изменений БД                                     ║');
  console.error('╚═══════════════════════════════════════════════════════════════╝');
  console.error('');
  console.error(`📊 БД: ${DB_PATH}`);
  console.error(`⏱️  Интервал проверки: ${INTERVAL_SEC} секунд`);
  console.error(`📁 Файл снимка: ${SNAPSHOT_FILE}`);
  if (FILTER !== 'all') {
    console.error(`🔍 Фильтр: показывать только ${FILTER === 'removed' ? 'удаления' : FILTER === 'added' ? 'добавления' : 'изменения'}`);
  }
  console.error('');
  
  if (Object.keys(oldSnapshot).length > 0) {
    console.error(`✅ Загружен предыдущий снимок: ${Object.keys(oldSnapshot).length} записей`);
  } else {
    console.error(`ℹ️  Предыдущий снимок не найден, создаём начальный снимок...`);
  }
  console.error('');
  
  try {
    db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    // Создаём начальный снимок если его нет
    if (Object.keys(oldSnapshot).length === 0) {
      console.error('📸 Создание начального снимка БД...');
      oldSnapshot = await getCurrentSnapshot(db);
      saveSnapshot(oldSnapshot);
      console.error(`✅ Создан начальный снимок: ${Object.keys(oldSnapshot).length} записей`);
      console.error('');
    }
    
    // Основной цикл мониторинга
    setInterval(async () => {
      try {
        const newSnapshot = await getCurrentSnapshot(db);
        const changes = compareSnapshots(oldSnapshot, newSnapshot);
        
        const output = formatChanges(changes, Date.now());
        if (output) {
          // Выводим только удаления в stdout (консоль)
          console.log(output);
        }
        // В фильтрованном режиме не выводим сообщения об отсутствии изменений
        
        // Сохраняем новый снимок
        oldSnapshot = newSnapshot;
        saveSnapshot(oldSnapshot);
        
      } catch (error) {
        console.error(`\n❌ Ошибка при проверке БД: ${error.message}`);
        console.error(error.stack);
      }
    }, INTERVAL_SEC * 1000);
    
    // Первая проверка сразу
    const newSnapshot = await getCurrentSnapshot(db);
    const changes = compareSnapshots(oldSnapshot, newSnapshot);
    const output = formatChanges(changes, Date.now());
    if (output) {
      console.log(output);
    }
    oldSnapshot = newSnapshot;
    saveSnapshot(oldSnapshot);
    
    if (FILTER === 'all') {
      console.error(`\n🔄 Мониторинг запущен. Нажмите Ctrl+C для остановки.\n`);
    } else {
      // В фильтрованном режиме выводим информацию о фильтре только в stderr
      console.error(`\n🔄 Мониторинг запущен (фильтр: ${FILTER}). Показываются только ${FILTER === 'removed' ? 'удаления' : FILTER === 'added' ? 'добавления' : 'изменения'}.\n`);
    }
    
  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    console.error(error.stack);
    if (db) {
      await db.close().catch(() => {});
    }
    process.exit(1);
  }
  
  // Обработка сигналов для корректного завершения
  process.on('SIGINT', async () => {
    console.error('\n\n🛑 Остановка мониторинга...');
    if (db) {
      await db.close().catch(() => {});
    }
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.error('\n\n🛑 Остановка мониторинга...');
    if (db) {
      await db.close().catch(() => {});
    }
    process.exit(0);
  });
}

monitorDB();

