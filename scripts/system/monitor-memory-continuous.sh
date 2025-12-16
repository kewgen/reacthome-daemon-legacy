#!/bin/bash

#
# Непрерывный мониторинг памяти процесса
#
# Использование:
#   ./scripts/system/monitor-memory-continuous.sh [process_name] [interval]
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-events}"
INTERVAL="${2:-5}"  # секунд

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "📊 Непрерывный мониторинг памяти процесса: $PROCESS_NAME"
echo "⏱️  Интервал: $INTERVAL секунд"
echo "Нажмите Ctrl+C для остановки"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 10
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

# Получаем PID процесса
PID=$(run_on_pi "cd $PROJECT_DIR && pm2 pid $PROCESS_NAME 2>/dev/null | head -1")
if [ -z "$PID" ] || [ "$PID" = "0" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Мониторинг процесса с PID: $PID"
echo ""
printf "%-10s %-12s %-12s %-12s %-12s\n" "Время" "RSS (MB)" "VmSize (MB)" "Heap Used" "Heap Total"
echo "------------------------------------------------------------------------"

trap "rm -f $TMP_EXPECT; exit" INT TERM

while true; do
    # Получаем информацию о памяти из /proc
    MEM_INFO=$(run_on_pi "cat /proc/$PID/status 2>/dev/null | grep -E 'VmRSS|VmSize' | awk '{print \$2}'")
    RSS_KB=$(echo "$MEM_INFO" | head -1)
    VMSIZE_KB=$(echo "$MEM_INFO" | tail -1)
    
    # Получаем heap информацию через Node.js (если доступно)
    HEAP_INFO=$(run_on_pi "cd $PROJECT_DIR && node -e 'console.log(JSON.stringify(process.memoryUsage()))' 2>/dev/null" || echo "{}")
    HEAP_USED=$(echo "$HEAP_INFO" | grep -o '"heapUsed":[0-9]*' | cut -d: -f2 || echo "0")
    HEAP_TOTAL=$(echo "$HEAP_INFO" | grep -o '"heapTotal":[0-9]*' | cut -d: -f2 || echo "0")
    
    RSS_MB=$(awk "BEGIN {printf \"%.2f\", $RSS_KB/1024}")
    VMSIZE_MB=$(awk "BEGIN {printf \"%.2f\", $VMSIZE_KB/1024}")
    HEAP_USED_MB=$(awk "BEGIN {printf \"%.2f\", $HEAP_USED/1024/1024}")
    HEAP_TOTAL_MB=$(awk "BEGIN {printf \"%.2f\", $HEAP_TOTAL/1024/1024}")
    
    TIMESTAMP=$(date +"%H:%M:%S")
    printf "%-10s %-12s %-12s %-12s %-12s\n" "$TIMESTAMP" "$RSS_MB" "$VMSIZE_MB" "$HEAP_USED_MB" "$HEAP_TOTAL_MB"
    
    sleep "$INTERVAL"
done

rm -f "$TMP_EXPECT"

