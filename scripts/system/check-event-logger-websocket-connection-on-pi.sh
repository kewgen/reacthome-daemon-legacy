#!/bin/bash
# Проверка подключения event-logger к WebSocket и событий в OpenSearch
# Использование: ./scripts/system/check-event-logger-websocket-connection-on-pi.sh

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
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Статус event-logger
echo "=== 1. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger || echo 'NOT_FOUND'")
echo "$STATUS"
echo ""

# 2. Поиск логов подключения к WebSocket
echo "=== 2. Логи подключения к WebSocket (последние 30) ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 100 --nostream 2>&1 | grep -iE 'подключен|connected|open|WebSocket.*192.168.88.4|ws://192.168.88.4|ws://localhost' | tail -30")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
else
    echo "⚠️  Логи подключения не найдены"
fi
echo ""

# 3. Проверка подключений от event-logger в логах демона
echo "=== 3. Подключения от event-logger в логах демона ==="
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 200 --nostream 2>&1 | grep -iE 'websocket.*новое подключение|websocket.*connection' | tail -20")
if [ -n "$DAEMON_LOGS" ]; then
    echo "$DAEMON_LOGS"
    
    # Проверяем подключения с localhost (::1)
    LOCALHOST_CONN=$(echo "$DAEMON_LOGS" | grep -c "::1" || echo "0")
    if [ "$LOCALHOST_CONN" -gt "0" ]; then
        echo ""
        echo "✅ Найдено подключений с localhost (::1): $LOCALHOST_CONN"
    fi
    
    # Проверяем подключения с IP адреса
    IP_CONN=$(echo "$DAEMON_LOGS" | grep -c "192.168.88" || echo "0")
    if [ "$IP_CONN" -gt "0" ]; then
        echo "✅ Найдено подключений с IP адреса: $IP_CONN"
    fi
else
    echo "⚠️  Логи подключений не найдены"
fi
echo ""

# 4. Активные подключения к порту 3000
echo "=== 4. Активные подключения к порту 3000 ==="
CONNECTIONS=$(run_on_pi "netstat -an 2>&1 | grep ':3000' | grep ESTABLISHED || ss -an 2>&1 | grep ':3000' | grep ESTAB || echo 'Нет активных подключений'")
echo "$CONNECTIONS"
echo ""

# 5. Проверка обработки событий в event-logger
echo "=== 5. Обработка событий в event-logger (последние 10) ==="
EVENT_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 50 --nostream 2>&1 | grep -iE 'буфер|событие|event|ACTION_SET' | tail -10")
if [ -n "$EVENT_LOGS" ]; then
    echo "$EVENT_LOGS"
else
    echo "⚠️  Логи обработки событий не найдены"
fi
echo ""

# 6. Проверка OpenSearch (если есть скрипт)
echo "=== 6. Проверка OpenSearch ==="
if run_on_pi "cd $PROJECT_DIR && test -f scripts/check-opensearch-events.js" | grep -q "exists\|true"; then
    OPENSEARCH_CHECK=$(run_on_pi "cd $PROJECT_DIR && node scripts/check-opensearch-events.js 2>&1 | head -20")
    echo "$OPENSEARCH_CHECK"
else
    echo "⚠️  Скрипт проверки OpenSearch не найден"
    echo "Проверяем логи OpenSearch в event-logger..."
    OPENSEARCH_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 100 --nostream 2>&1 | grep -iE 'opensearch|elastic|индекс|index|отправлено|sent' | tail -10")
    if [ -n "$OPENSEARCH_LOGS" ]; then
        echo "$OPENSEARCH_LOGS"
    else
        echo "⚠️  Логи OpenSearch не найдены"
    fi
fi
echo ""

# 7. Проверка переменной окружения DAEMON_WS_URL
echo "=== 7. Переменная окружения DAEMON_WS_URL ==="
ENV_CHECK=$(run_on_pi "cd $PROJECT_DIR && pm2 env 17 2>&1 | grep DAEMON_WS_URL || echo 'Переменная не найдена'")
echo "$ENV_CHECK"
echo ""

rm -f "$TMP_EXPECT"

echo "=============================================="
echo "✅ Проверка завершена"
echo "=============================================="
