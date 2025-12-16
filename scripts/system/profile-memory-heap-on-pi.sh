#!/bin/bash

#
# Профилирование heap памяти через Node.js Inspector
#
# Использование:
#   ./scripts/system/profile-memory-heap-on-pi.sh [process_name]
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-events}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "📊 Профилирование heap памяти процесса: $PROCESS_NAME"
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

# Проверяем, запущен ли процесс
echo "🔍 Проверка процесса $PROCESS_NAME..."
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep $PROCESS_NAME")
if [ -z "$STATUS" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Процесс найден"
echo ""

# Создаём скрипт для получения heap snapshot
HEAP_SCRIPT=$(cat << 'HEAP_SCRIPT_EOF'
const v8 = require('v8');
const fs = require('fs');
const { performance } = require('perf_hooks');

const outputFile = process.argv[2] || '/tmp/heap-snapshot.json';

console.log('📊 Текущая статистика памяти:');
const memUsage = process.memoryUsage();
console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`);
console.log(`  External: ${(memUsage.external / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Array Buffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(2)}MB`);

console.log('\n📈 Heap Statistics:');
const heapStats = v8.getHeapStatistics();
console.log(`  Total Heap Size: ${(heapStats.total_heap_size / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Used Heap Size: ${(heapStats.used_heap_size / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Heap Size Limit: ${(heapStats.heap_size_limit / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Total Available Size: ${(heapStats.total_available_size / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Total Physical Size: ${(heapStats.total_physical_size / 1024 / 1024).toFixed(2)}MB`);
console.log(`  Number of Native Contexts: ${heapStats.number_of_native_contexts}`);
console.log(`  Number of Detached Contexts: ${heapStats.number_of_detached_contexts}`);

// Сохраняем детальную информацию
const profile = {
  timestamp: new Date().toISOString(),
  memoryUsage: {
    rss: memUsage.rss,
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    external: memUsage.external,
    arrayBuffers: memUsage.arrayBuffers
  },
  heapStatistics: heapStats
};

fs.writeFileSync(outputFile, JSON.stringify(profile, null, 2));
console.log(`\n✅ Профиль сохранён в ${outputFile}`);
HEAP_SCRIPT_EOF
)

# Копируем скрипт на малинку
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

TMP_SCRIPT=$(mktemp)
echo "$HEAP_SCRIPT" > "$TMP_SCRIPT"
OUTPUT_FILE="/tmp/heap-profile-${PROCESS_NAME}-$(date +%Y%m%d_%H%M%S).json"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/profile-heap.js" "$TMP_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "🚀 Запуск профилирования heap..."
run_on_pi "cd $PROJECT_DIR && node /tmp/profile-heap.js $OUTPUT_FILE"

echo ""
echo "📥 Скачивание результатов..."
"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "$OUTPUT_FILE" "/tmp/$(basename $OUTPUT_FILE)" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

LOCAL_OUTPUT="/tmp/heap-profile-${PROCESS_NAME}-$(date +%Y%m%d_%H%M%S).json"
if [ -f "/tmp/$(basename $OUTPUT_FILE)" ]; then
    mv "/tmp/$(basename $OUTPUT_FILE)" "$LOCAL_OUTPUT"
    echo "✅ Результаты сохранены в: $LOCAL_OUTPUT"
else
    echo "⚠️  Не удалось скачать результаты"
fi

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$TMP_SCRIPT"

echo ""
echo "=========================================="
echo "✅ Профилирование heap завершено"
echo "=========================================="
echo ""

