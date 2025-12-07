#!/bin/bash
# Простая проверка подключения event-logger к WebSocket
# Использование: ./scripts/system/check-websocket-connection-simple-on-pi.sh

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
set timeout 120
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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Проверка подключения event-logger к WebSocket"
echo "=============================================="
echo ""

# 1. Статус
echo "=== 1. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger")
echo "$STATUS"
echo ""

# 2. Свежие логи (последние 30 строк)
echo "=== 2. Свежие логи event-logger (последние 30) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 30 --nostream 2>&1 | tail -30")
echo "$LOGS"
echo ""

# 3. Поиск подключения в логах
echo "=== 3. Поиск логов подключения ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 200 --nostream 2>&1 | grep -i 'подключ\|connect\|open\|192.168.88.4' | tail -10")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
else
    echo "⚠️  Логи подключения не найдены"
fi
echo ""

# 4. Подключения в логах демона
echo "=== 4. Последние подключения в логах демона ==="
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep 'WEBSOCKET.*Новое подключение' | tail -10")
if [ -n "$DAEMON_LOGS" ]; then
    echo "$DAEMON_LOGS"
else
    echo "⚠️  Логи подключений не найдены"
fi
echo ""

# 5. Активные подключения
echo "=== 5. Активные подключения к порту 3000 ==="
CONNECTIONS=$(run_on_pi "netstat -an 2>&1 | grep ':3000' | grep ESTABLISHED || ss -an 2>&1 | grep ':3000' | grep ESTAB || echo 'Нет активных подключений'")
echo "$CONNECTIONS"
echo ""

rm -f "$TMP_EXPECT"

echo "=============================================="
echo "✅ Проверка завершена"
echo "=============================================="
