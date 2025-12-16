#!/bin/bash

#
# Добавление самомониторинга памяти в event-logger.js
#
# При потреблении памяти > 400MB - логирует проблему и выключается
#
# Использование:
#   ./scripts/system/add-memory-self-monitoring-to-event-logger.sh
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
FILE="event-logger.js"
MEMORY_LIMIT_MB="${MEMORY_LIMIT_MB:-400}"  # Лимит памяти в MB
CHECK_INTERVAL_SEC="${CHECK_INTERVAL_SEC:-60}"  # Интервал проверки в секундах

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "🔧 Добавление самомониторинга памяти в event-logger.js"
echo "📊 Лимит памяти: ${MEMORY_LIMIT_MB}MB"
echo "⏱️  Интервал проверки: ${CHECK_INTERVAL_SEC} секунд"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

# Создаём скрипт для добавления самомониторинга
MONITORING_CODE=$(cat << 'MONITORING_EOF'
// ============================================================================
// Самомониторинг памяти
// ============================================================================

// Конфигурация самомониторинга
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '400', 10); // Лимит памяти в MB
const MEMORY_CHECK_INTERVAL_MS = parseInt(process.env.MEMORY_CHECK_INTERVAL_MS || '60000', 10); // Интервал проверки в мс (по умолчанию 60 сек)

// Функция проверки памяти
const checkMemoryUsage = () => {
  const memUsage = process.memoryUsage();
  const rssMB = memUsage.rss / 1024 / 1024; // RSS в MB
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024; // Heap Used в MB
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024; // Heap Total в MB
  
  // Логируем текущее потребление памяти (каждые 5 минут)
  if (Math.random() < 0.1) { // Примерно 10% проверок логируются
    log(`[Memory Monitor] RSS: ${rssMB.toFixed(2)}MB, Heap Used: ${heapUsedMB.toFixed(2)}MB, Heap Total: ${heapTotalMB.toFixed(2)}MB`);
  }
  
  // Проверка превышения лимита
  if (rssMB > MEMORY_LIMIT_MB) {
    const errorMsg = `[Memory Monitor] CRITICAL: Потребление памяти превысило лимит! RSS: ${rssMB.toFixed(2)}MB (лимит: ${MEMORY_LIMIT_MB}MB), Heap Used: ${heapUsedMB.toFixed(2)}MB, Heap Total: ${heapTotalMB.toFixed(2)}MB`;
    logError(errorMsg);
    
    // Дополнительная информация о кэшах
    logError(`[Memory Monitor] Размеры кэшей: deviceState=${deviceState.size}, deviceNameCache=${deviceNameCache.size}, actuatorStateCache=${actuatorStateCache.size}, traceIdCache=${traceIdCache.size}`);
    
    // Дополнительная информация о процессе
    logError(`[Memory Monitor] External: ${(memUsage.external / 1024 / 1024).toFixed(2)}MB, Array Buffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(2)}MB`);
    
    // Закрываем WebSocket соединение
    if (ws && ws.readyState === WebSocket.OPEN) {
      logError('[Memory Monitor] Закрываем WebSocket соединение...');
      ws.close();
    }
    
    // Очищаем интервалы
    if (bufferFlushInterval) {
      clearInterval(bufferFlushInterval);
      bufferFlushInterval = null;
    }
    
    // Даём время на логирование и очистку
    setTimeout(() => {
      logError('[Memory Monitor] Завершаем процесс для предотвращения утечки памяти');
      process.exit(1); // Код выхода 1 указывает на проблему с памятью
    }, 2000); // 2 секунды на завершение
  }
};

// Запуск периодической проверки памяти
let memoryCheckInterval = null;

const startMemoryMonitoring = () => {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }
  
  log(`[Memory Monitor] Запуск самомониторинга памяти (лимит: ${MEMORY_LIMIT_MB}MB, интервал: ${MEMORY_CHECK_INTERVAL_MS / 1000}с)`);
  
  // Первая проверка сразу
  checkMemoryUsage();
  
  // Периодическая проверка
  memoryCheckInterval = setInterval(checkMemoryUsage, MEMORY_CHECK_INTERVAL_MS);
};

const stopMemoryMonitoring = () => {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
    log('[Memory Monitor] Остановлен самомониторинг памяти');
  }
};

// Запускаем мониторинг при старте
startMemoryMonitoring();

// Останавливаем мониторинг при завершении процесса
process.on('exit', () => {
  stopMemoryMonitoring();
});

process.on('SIGINT', () => {
  stopMemoryMonitoring();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopMemoryMonitoring();
  process.exit(0);
});
MONITORING_EOF
)

# Создаём Python скрипт для вставки кода
INSERT_SCRIPT=$(cat << 'PYTHON_EOF'
import sys
import re

file_path = sys.argv[1]
monitoring_code = sys.argv[2]

# Читаем файл
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Ищем место для вставки - после определения констант и перед функцией cleanupCaches
# Проверяем, не добавлен ли уже мониторинг
if 'Самомониторинг памяти' in content or 'checkMemoryUsage' in content:
    print("⚠️  Самомониторинг памяти уже добавлен в файл")
    sys.exit(1)

# Ищем место для вставки - перед process.on('SIGINT') или перед connect()
# Это обычно в конце файла перед запуском
patterns = [
    r"process\.on\s*\(\s*['\"]SIGINT['\"]",  # Перед process.on('SIGINT')
    r"process\.on\s*\(\s*['\"]SIGTERM['\"]",  # Перед process.on('SIGTERM')
    r"connect\s*\(\s*\)\s*;",  # Перед connect()
    r"//\s*Запуск",  # Перед комментарием "Запуск"
]

insert_pos = None
for pattern in patterns:
    match = re.search(pattern, content)
    if match:
        insert_pos = match.start()
        break

if insert_pos is None:
    # Если не нашли, ищем перед последними строками (connect() обычно в конце)
    lines = content.split('\n')
    for i in range(len(lines) - 1, max(0, len(lines) - 10), -1):
        if 'connect()' in lines[i] or 'Запуск' in lines[i]:
            # Находим позицию начала этой строки
            insert_pos = len('\n'.join(lines[:i]))
            break

if insert_pos is None:
    # Последняя попытка - вставляем перед последними 5 строками
    lines = content.split('\n')
    insert_pos = len('\n'.join(lines[:-5]))

if insert_pos is not None:
    # Вставляем код
    new_content = content[:insert_pos] + '\n\n' + monitoring_code + '\n\n' + content[insert_pos:]
    
    # Записываем обратно
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("✅ Самомониторинг памяти добавлен")
else:
    print("❌ Не найдено место для вставки кода")
    sys.exit(1)
PYTHON_EOF
)

# Копируем скрипты на малинку
TMP_EXPECT_SCP=$(mktemp)
cat > "$TMP_EXPECT_SCP" << 'EXPECT_SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $local_file $user@$host:$remote_file
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_SCP_EOF
chmod +x "$TMP_EXPECT_SCP"

# Создаём временные файлы
TMP_MONITORING=$(mktemp)
TMP_INSERT=$(mktemp)
echo "$MONITORING_CODE" > "$TMP_MONITORING"
echo "$INSERT_SCRIPT" > "$TMP_INSERT"

echo "📥 Копирование скриптов на малинку..."
"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/add-memory-monitoring.py" "$TMP_INSERT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/monitoring-code.js" "$TMP_MONITORING" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo ""
echo "🔧 Применение изменений..."

# Создаём бэкап
run_on_pi "cd $PROJECT_DIR && cp $FILE ${FILE}.backup-before-memory-monitoring-\$(date +%Y%m%d_%H%M%S) && echo '✅ Бэкап создан'"

# Запускаем Python скрипт для вставки кода
RESULT=$(run_on_pi "cd $PROJECT_DIR && python3 /tmp/add-memory-monitoring.py $FILE \"\$(cat /tmp/monitoring-code.js)\" 2>&1")

echo "$RESULT"

if echo "$RESULT" | grep -q "✅"; then
    echo ""
    echo "🔍 Проверка синтаксиса перед перезапуском..."
    SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c $FILE 2>&1; echo 'EXIT:'\$?")
    if echo "$SYNTAX_CHECK" | grep -q "EXIT:0"; then
        echo "✅ Синтаксис корректен"
        
        echo ""
        echo "📋 Проверка добавленного кода..."
        run_on_pi "cd $PROJECT_DIR && grep -A 3 'Самомониторинг памяти' $FILE | head -5"
        
        echo ""
        echo "🔄 Перезапуск event-logger..."
        run_on_pi "cd $PROJECT_DIR && pm2 restart events"
        
        echo ""
        echo "⏳ Ожидание 5 секунд для проверки..."
        sleep 5
        
        echo ""
        echo "📊 Статус процесса:"
        run_on_pi "cd $PROJECT_DIR && pm2 list | grep events"
        
        echo ""
        echo "📋 Проверка логов (последние 10 строк):"
        run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 10 --nostream 2>&1 | tail -15"
    else
        echo "❌ Ошибка синтаксиса:"
        echo "$SYNTAX_CHECK" | grep -v "EXIT:" | head -10
        echo ""
        echo "🔄 Восстановление из бэкапа..."
        run_on_pi "cd $PROJECT_DIR && cp ${FILE}.backup-before-memory-monitoring-* $FILE 2>/dev/null && echo '✅ Восстановлено' || echo '⚠️  Бэкап не найден'"
    fi
else
    echo "❌ Не удалось добавить самомониторинг"
fi

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$TMP_MONITORING" "$TMP_INSERT"

echo ""
echo "=========================================="
echo "✅ Готово"
echo "=========================================="
echo ""
echo "Настройка через переменные окружения:"
echo "  MEMORY_LIMIT_MB=400              # Лимит памяти в MB (по умолчанию 400)"
echo "  MEMORY_CHECK_INTERVAL_MS=60000   # Интервал проверки в мс (по умолчанию 60 сек)"
echo ""
echo "Пример в ecosystem.config.js:"
echo "  env: {"
echo "    MEMORY_LIMIT_MB: 400,"
echo "    MEMORY_CHECK_INTERVAL_MS: 60000"
echo "  }"
echo ""

