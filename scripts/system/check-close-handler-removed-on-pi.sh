#!/bin/bash
# Проверка удаления обработчика close на Raspberry Pi
# Использование: ./scripts/system/check-close-handler-removed-on-pi.sh

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Проверка удаления обработчика close"
echo "===================================="
echo ""

# Проверяем наличие обработчика close
echo "=== 1. Проверка обработчика close ==="
CLOSE_COUNT=$(run_on_pi "cd $PROJECT_DIR && grep -c 'socket.on.*close' src/websocket/server.js 2>&1 || echo '0'")
echo "Найдено обработчиков close: $CLOSE_COUNT"

if [ "$CLOSE_COUNT" = "0" ]; then
    echo "✅ Обработчик close удалён"
else
    echo "⚠️  Обработчик close всё ещё присутствует"
    echo ""
    echo "Содержимое:"
    run_on_pi "cd $PROJECT_DIR && grep -A 5 'socket.on.*close' src/websocket/server.js" | head -10
fi
echo ""

# Проверяем логи демона на предмет закрытия соединений
echo "=== 2. Логи демона (WebSocket, последние 20) ==="
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -20")
if [ -n "$DAEMON_LOGS" ]; then
    echo "$DAEMON_LOGS"
    
    # Проверяем наличие логов закрытия
    CLOSE_LOGS=$(echo "$DAEMON_LOGS" | grep -i "закрыто\|close" | wc -l | tr -d ' ')
    if [ "$CLOSE_LOGS" -gt 0 ]; then
        echo ""
        echo "⚠️  Найдено логов закрытия: $CLOSE_LOGS"
        echo "Это означает, что обработчик close всё ещё работает или это старые логи"
    fi
else
    echo "Нет логов WebSocket"
fi
echo ""

# Проверяем свежие логи event-logger
echo "=== 3. Свежие логи event-logger (последние 10) ==="
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 10 --nostream 2>&1 | tail -10")
if [ -n "$EVENT_LOGGER_LOGS" ]; then
    echo "$EVENT_LOGGER_LOGS"
    
    # Проверяем подключение
    if echo "$EVENT_LOGGER_LOGS" | grep -qiE "подключен|connected|open"; then
        echo ""
        echo "✅ Event-logger подключился!"
    fi
    
    # Проверяем закрытие
    if echo "$EVENT_LOGGER_LOGS" | grep -qiE "закрыто|close"; then
        echo ""
        echo "⚠️  Соединение закрывается"
    fi
else
    echo "Нет логов event-logger"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
