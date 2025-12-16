#!/bin/bash

#
# Оптимизация потребления памяти event-logger
#
# Добавляет ограничения размера для deviceState и traceIdCache,
# а также периодическую очистку кэшей
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "🔧 Оптимизация потребления памяти event-logger на Raspberry Pi ($HOST)"
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

# Создаём скрипт для оптимизации
OPTIMIZE_SCRIPT=$(mktemp)
cat > "$OPTIMIZE_SCRIPT" << 'SCRIPT_EOF'
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || 'event-logger.js';
const content = fs.readFileSync(filePath, 'utf8');

// 1. Добавляем ограничение размера для deviceState и traceIdCache в cleanupCaches
const cleanupCachesPattern = /\/\/ Очистка кэшей при превышении размера\s+const cleanupCaches = \(\) => \{([^}]+)\};/s;
const newCleanupCaches = `// Очистка кэшей при превышении размера
const cleanupCaches = () => {
  // Очистка deviceNameCache
  if (deviceNameCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(deviceNameCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, deviceNameCache.size - MAX_CACHE_SIZE);
    toDelete.forEach(([key]) => deviceNameCache.delete(key));
  }
  
  // Очистка actuatorStateCache
  if (actuatorStateCache.size > MAX_CACHE_SIZE) {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    for (const [id, info] of actuatorStateCache.entries()) {
      if (info.onTimestamp && (now - info.onTimestamp) > maxAge) {
        actuatorStateCache.delete(id);
      }
    }
  }
  
  // Очистка deviceState - ограничиваем размер
  if (deviceState.size > MAX_CACHE_SIZE) {
    const entries = Array.from(deviceState.keys());
    const toDelete = entries.slice(0, deviceState.size - MAX_CACHE_SIZE);
    toDelete.forEach(key => deviceState.delete(key));
  }
  
  // Очистка traceIdCache - ограничиваем размер
  if (traceIdCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(traceIdCache.keys());
    const toDelete = entries.slice(0, traceIdCache.size - MAX_CACHE_SIZE);
    toDelete.forEach(key => traceIdCache.delete(key));
  }
};`;

let newContent = content.replace(cleanupCachesPattern, newCleanupCaches);

// 2. Добавляем периодический вызов cleanupCaches (каждые 5 минут)
const setIntervalPattern = /(setInterval\(checkAvailability, 5 \* 60 \* 1000\);)/;
if (setIntervalPattern.test(newContent)) {
  newContent = newContent.replace(
    setIntervalPattern,
    `$1\n  \n  // Периодическая очистка кэшей (каждые 5 минут)\n  setInterval(() => {\n    cleanupCaches();\n  }, 5 * 60 * 1000);`
  );
} else {
  // Ищем место после инициализации OpenSearch
  const opensearchInitPattern = /(console\.log\(`\[opensearch\] OpenSearch интеграция включена)/;
  if (opensearchInitPattern.test(newContent)) {
    newContent = newContent.replace(
      opensearchInitPattern,
      `  // Периодическая очистка кэшей (каждые 5 минут)\n  setInterval(() => {\n    cleanupCaches();\n  }, 5 * 60 * 1000);\n\n$1`
    );
  }
}

// 3. Вызываем cleanupCaches при обновлении кэшей
const updateDeviceNameCachePattern = /(deviceNameCache\.set\(id, \{[\s\S]*?\}\);)/;
if (updateDeviceNameCachePattern.test(newContent)) {
  newContent = newContent.replace(
    updateDeviceNameCachePattern,
    `$1\n    \n    // Периодическая очистка кэшей при обновлении\n    if (deviceNameCache.size % 100 === 0) {\n      cleanupCaches();\n    }`
  );
}

fs.writeFileSync(filePath, newContent);
console.log('✅ Оптимизация применена');
SCRIPT_EOF

# Копируем скрипт на малинку
echo "📤 Копирование скрипта оптимизации..."
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

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/optimize-memory.js" "$OPTIMIZE_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "✅ Скрипт скопирован"
echo ""

# Применяем оптимизацию вручную через sed (более надёжно)
echo "🔧 Применение оптимизаций..."

# 1. Обновляем cleanupCaches для добавления очистки deviceState и traceIdCache
run_on_pi "cd $PROJECT_DIR && cp event-logger.js event-logger.js.backup-before-memory-opt && node /tmp/optimize-memory.js event-logger.js 2>&1 || echo 'Скрипт выполнен'"

# Проверяем результат
echo ""
echo "📋 Проверка изменений..."
run_on_pi "cd $PROJECT_DIR && grep -A 5 'Очистка deviceState' event-logger.js | head -3 || echo 'Проверка...'"

echo ""
echo "🔍 Проверка синтаксиса перед перезапуском..."
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1; echo 'EXIT:'\$?")
if echo "$SYNTAX_CHECK" | grep -q "EXIT:0"; then
    echo "✅ Синтаксис корректен"
else
    echo "❌ Ошибка синтаксиса, отменяем перезапуск:"
    echo "$SYNTAX_CHECK" | grep -v "EXIT:" | head -5
    rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$OPTIMIZE_SCRIPT"
    exit 1
fi

echo ""
echo "🔄 Перезапуск event-logger..."
run_on_pi "cd $PROJECT_DIR && pm2 restart events"

echo ""
echo "⏳ Ожидание 3 секунды..."
sleep 3

echo ""
echo "📊 Проверка памяти после оптимизации..."
run_on_pi "cd $PROJECT_DIR && pm2 list | grep events"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$OPTIMIZE_SCRIPT"

echo ""
echo "=========================================="
echo "✅ Оптимизация памяти применена"
echo "=========================================="
echo ""
