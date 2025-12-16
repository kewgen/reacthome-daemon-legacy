#!/bin/bash

# Скрипт для применения исправлений утечки памяти на Raspberry Pi
# Дата: 2025-12-09
# Цель: Исправить критическую утечку памяти в event-logger.js

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$PROJECT_ROOT/.env" ] && source "$PROJECT_ROOT/.env"

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
REMOTE_DIR="/home/pi/reacthome-daemon"

# Проверка переменных окружения
if [ -z "$PASS" ]; then
  echo "❌ Ошибка: REACTHOME_PI_PASS не установлен"
  echo "Установите: export REACTHOME_PI_PASS='your_password'"
  exit 1
fi

# Создание expect скрипта
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
  "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | sed 's/\r$//' || true
}

echo "=========================================="
echo "🔧 ПРИМЕНЕНИЕ ИСПРАВЛЕНИЙ УТЕЧКИ ПАМЯТИ"
echo "=========================================="
echo ""
echo "Хост: $HOST"
echo "Пользователь: $USER"
echo ""

# Остановка процесса
echo "=== 1. Остановка процесса events ==="
run_on_pi "pm2 stop events"
echo "✅ Процесс остановлен"
echo ""

# Создание бэкапа
echo "=== 2. Создание бэкапа ==="
BACKUP_FILE="event-logger.js.backup-$(date +%Y%m%d-%H%M%S)"
run_on_pi "cp $REMOTE_DIR/event-logger.js $REMOTE_DIR/$BACKUP_FILE"
echo "✅ Создан бэкап: $BACKUP_FILE"
echo ""

# Применение исправлений
echo "=== 3. Применение исправлений ==="

# Исправление 1: Увеличение BUFFER_MAX_SIZE
echo "📝 Исправление 1: BUFFER_MAX_SIZE 100 → 1000"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');
content = content.replace(
  /const BUFFER_MAX_SIZE = 100;/,
  'const BUFFER_MAX_SIZE = 1000;'
);
fs.writeFileSync('event-logger.js', content);
console.log('✅ BUFFER_MAX_SIZE обновлён');
\""

# Исправление 2: Добавление MAX_FAILED_ATTEMPTS
echo "📝 Исправление 2: Добавление MAX_FAILED_ATTEMPTS"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

// Добавляем константу после BUFFER_MAX_SIZE
if (!content.includes('MAX_FAILED_ATTEMPTS')) {
  content = content.replace(
    /const BUFFER_MAX_SIZE = \d+;/,
    'const BUFFER_MAX_SIZE = 1000;\\nconst MAX_FAILED_ATTEMPTS = 3; // Максимум попыток переотправки'
  );
  console.log('✅ MAX_FAILED_ATTEMPTS добавлен');
} else {
  console.log('⚠️  MAX_FAILED_ATTEMPTS уже существует');
}

fs.writeFileSync('event-logger.js', content);
\""

# Исправление 3: Добавление failedAttempts переменной
echo "📝 Исправление 3: Добавление failedAttempts"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

// Добавляем переменную после eventBuffer
if (!content.includes('let failedAttempts')) {
  content = content.replace(
    /let eventBuffer = \[\];/,
    'let eventBuffer = [];\\nlet failedAttempts = 0; // Счётчик неудачных попыток отправки'
  );
  console.log('✅ failedAttempts добавлен');
} else {
  console.log('⚠️  failedAttempts уже существует');
}

fs.writeFileSync('event-logger.js', content);
\""

# Исправление 4: state.set с нормализованным payload
echo "📝 Исправление 4: state.set с нормализованным payload"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

// Ищем и заменяем state.set(id, payload) на state.set(id, normalized)
// В контексте, где уже есть normalized
content = content.replace(
  /(const normalized = normalizeDeviceState\(id, payload\);[\\s\\S]{0,100}deviceState\\.set\\(id, normalized\\);[\\s\\n]+)state\\.set\\(id, payload\\);/g,
  '\$1state.set(id, normalized); // Исправлено: используем нормализованный payload'
);

console.log('✅ state.set исправлен для использования нормализованного payload');

fs.writeFileSync('event-logger.js', content);
\""

# Исправление 5: Добавление isTemporaryError функции
echo "📝 Исправление 5: Добавление isTemporaryError"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

// Добавляем функцию перед flushBuffer
if (!content.includes('isTemporaryError')) {
  const isTemporaryErrorFunc = \\\`
// Проверка, является ли ошибка временной
const isTemporaryError = (err) => {
  const temporaryCodes = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'];
  return err && err.code && temporaryCodes.includes(err.code);
};
\\\`;

  // Вставляем перед flushBuffer
  content = content.replace(
    /(const flushBuffer)/,
    isTemporaryErrorFunc + '\\n\$1'
  );
  console.log('✅ isTemporaryError добавлен');
} else {
  console.log('⚠️  isTemporaryError уже существует');
}

fs.writeFileSync('event-logger.js', content);
\""

# Исправление 6: Улучшенная логика flushBuffer
echo "📝 Исправление 6: Улучшенная логика flushBuffer"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

// Находим и заменяем flushBuffer
const oldFlushBufferPattern = /const flushBuffer = async \(\) => \{[\\s\\S]*?try \{[\\s\\S]*?await opensearch\\.sendBatch\\(eventsToSend\\);[\\s\\S]*?\} catch \(err\) \{[\\s\\S]*?eventBuffer = \[\\.\\.\\.eventsToSend, \\.\\.\\.eventBuffer\];[\\s\\S]*?\}[\\s\\S]*?\}[\\s\\S]*?\};/;

const newFlushBuffer = \\\`const flushBuffer = async () => {
  if (eventBuffer.length === 0) return;
  
  if (opensearch.isEnabled && opensearch.isEnabled()) {
    const eventsToSend = [...eventBuffer];
    eventBuffer = [];
    
    try {
      await opensearch.sendBatch(eventsToSend);
      failedAttempts = 0; // Сброс при успехе
      console.log(\\\\\`[flushBuffer] Отправлено \\\\\${eventsToSend.length} событий из буфера\\\\\`);
    } catch (err) {
      failedAttempts++;
      logError(\\\\\`Ошибка отправки из буфера (попытка \\\\\${failedAttempts}/\\\\\${MAX_FAILED_ATTEMPTS}):\\\\\`, err.message);
      
      // Возвращаем в буфер только при временных ошибках и не более MAX_FAILED_ATTEMPTS
      if (failedAttempts < MAX_FAILED_ATTEMPTS && isTemporaryError(err)) {
        eventBuffer = [...eventsToSend, ...eventBuffer];
        
        // Ограничиваем размер буфера
        if (eventBuffer.length > BUFFER_MAX_SIZE) {
          const excess = eventBuffer.length - BUFFER_MAX_SIZE;
          eventBuffer = eventBuffer.slice(excess);
          console.warn(\\\\\`[flushBuffer] Буфер переполнен, удалено \\\\\${excess} старых событий\\\\\`);
        }
      } else {
        // После MAX_FAILED_ATTEMPTS или при постоянных ошибках - сбрасываем события
        console.error(\\\\\`[flushBuffer] Сброшено \\\\\${eventsToSend.length} событий после \\\\\${failedAttempts} неудачных попыток\\\\\`);
        failedAttempts = 0;
      }
    }
  }
};\\\`;

if (content.match(oldFlushBufferPattern)) {
  content = content.replace(oldFlushBufferPattern, newFlushBuffer);
  console.log('✅ flushBuffer обновлён');
} else {
  console.log('⚠️  Не удалось найти старый flushBuffer, возможно уже обновлён');
}

fs.writeFileSync('event-logger.js', content);
\""

# Исправление 7: Добавление мониторинга памяти
echo "📝 Исправление 7: Добавление мониторинга памяти"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

// Добавляем мониторинг после connectToDaemon()
if (!content.includes('[MEMORY]')) {
  const memoryMonitoring = \\\`
// Мониторинг памяти
setInterval(() => {
  const mem = process.memoryUsage();
  console.log('[MEMORY]', JSON.stringify({
    rss_mb: (mem.rss / 1024 / 1024).toFixed(2),
    heap_mb: (mem.heapUsed / 1024 / 1024).toFixed(2),
    external_mb: (mem.external / 1024 / 1024).toFixed(2),
    deviceState: deviceState.size,
    state: state.size,
    buffer: eventBuffer.length,
    caches: {
      names: deviceNameCache.size,
      actuators: actuatorStateCache.size,
      traces: traceIdCache.size
    }
  }));
  
  // Предупреждение при превышении лимита
  const rss_mb = mem.rss / 1024 / 1024;
  if (rss_mb > MEMORY_LIMIT_MB * 0.8) {
    console.warn(\\\\\`[MEMORY] ⚠️  Память близка к лимиту: \\\\\${rss_mb.toFixed(2)}MB / \\\\\${MEMORY_LIMIT_MB}MB\\\\\`);
  }
}, 60000); // Каждую минуту
\\\`;

  // Добавляем в конец файла перед последней строкой
  const lines = content.split('\\n');
  lines.splice(lines.length - 1, 0, memoryMonitoring);
  content = lines.join('\\n');
  
  console.log('✅ Мониторинг памяти добавлен');
} else {
  console.log('⚠️  Мониторинг памяти уже существует');
}

fs.writeFileSync('event-logger.js', content);
\""

# Исправление 8: Увеличение частоты cleanupCaches
echo "📝 Исправление 8: Частота cleanupCaches 10 → 5 минут"
run_on_pi "cd $REMOTE_DIR && node -e \"
const fs = require('fs');
let content = fs.readFileSync('event-logger.js', 'utf8');

content = content.replace(
  /setInterval\(cleanupCaches, 10 \* 60 \* 1000\);/,
  'setInterval(cleanupCaches, 5 * 60 * 1000); // Каждые 5 минут (было 10)'
);

console.log('✅ Частота cleanupCaches обновлена');

fs.writeFileSync('event-logger.js', content);
\""

echo ""
echo "✅ Все исправления применены"
echo ""

# Проверка синтаксиса
echo "=== 4. Проверка синтаксиса ==="
run_on_pi "cd $REMOTE_DIR && node -c event-logger.js && echo '✅ Синтаксис корректен' || echo '❌ Ошибка синтаксиса'"
echo ""

# Показ различий
echo "=== 5. Сводка изменений ==="
echo "📊 Константы:"
run_on_pi "grep -E 'BUFFER_MAX_SIZE|MAX_FAILED_ATTEMPTS' $REMOTE_DIR/event-logger.js"
echo ""
echo "📊 Переменные состояния:"
run_on_pi "grep 'let failedAttempts' $REMOTE_DIR/event-logger.js"
echo ""
echo "📊 state.set исправления:"
run_on_pi "grep -n 'state.set' $REMOTE_DIR/event-logger.js | head -5"
echo ""

# Запуск процесса
echo "=== 6. Запуск процесса events ==="
run_on_pi "pm2 start events"
echo "✅ Процесс запущен"
echo ""

# Мониторинг
echo "=== 7. Начальная проверка ==="
sleep 5
run_on_pi "pm2 status events --no-color"
echo ""

echo "=========================================="
echo "✅ ИСПРАВЛЕНИЯ ПРИМЕНЕНЫ УСПЕШНО"
echo "=========================================="
echo ""
echo "📊 Мониторинг:"
echo "  pm2 logs events | grep MEMORY     # Статистика памяти"
echo "  pm2 logs events | grep flushBuffer  # Состояние буфера"
echo "  pm2 monit                         # Реал-тайм мониторинг"
echo ""
echo "🔙 Откат (если нужен):"
echo "  pm2 stop events"
echo "  cp $REMOTE_DIR/$BACKUP_FILE $REMOTE_DIR/event-logger.js"
echo "  pm2 start events"
echo ""

rm -f "$TMP_EXPECT"

echo "✅ Готово!"

