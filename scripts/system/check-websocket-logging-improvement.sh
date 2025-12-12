#!/bin/bash
# Проверка применения улучшения логирования WebSocket
# Использование: ./scripts/system/check-websocket-logging-improvement.sh

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

echo "Проверка применения улучшения логирования"
echo "=========================================="
echo ""

echo "=== 1. Проверка кода event-logger.js ==="
WS_ERROR_CODE=$(run_on_pi "cd $PROJECT_DIR && grep -A 2 \"ws.on('error'\" event-logger.js | head -3")
echo "$WS_ERROR_CODE"
echo ""

if echo "$WS_ERROR_CODE" | grep -q "error.toString()"; then
    echo "✅ Улучшение применено в коде"
else
    echo "❌ Улучшение НЕ применено"
fi
echo ""

echo "=== 2. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe events 2>&1 | grep -E 'status|uptime|restarts' | head -3")
echo "$STATUS"
echo ""

echo "=== 3. Последние логи (после улучшения) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 10 --nostream 2>&1 | tail -10")
echo "$LOGS"
echo ""

rm -f "$TMP_EXPECT"
