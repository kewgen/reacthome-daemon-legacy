#!/bin/bash
# Скрипт для проверки логов event-logger
# Использование: ./scripts/system/check-event-logger-logs.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Логи event-logger (последние 40 строк)"
echo "======================================"
echo ""

# Логи вывода
echo "=== Вывод ==="
OUT_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 40 --nostream 2>&1 | tail -40")
echo "$OUT_LOG"
echo ""

# Логи ошибок
echo "=== Ошибки ==="
ERR_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --err --lines 20 --nostream 2>&1 | tail -20")
echo "$ERR_LOG"
echo ""

rm -f "$TMP_EXPECT"
