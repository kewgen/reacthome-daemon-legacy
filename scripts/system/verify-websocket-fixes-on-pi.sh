#!/bin/bash
# Проверка работы исправлений WebSocket перед коммитом
# Использование: ./scripts/system/verify-websocket-fixes-on-pi.sh

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

echo "Проверка работы исправлений WebSocket"
echo "======================================"
echo ""

# 1. Проверяем код
echo "=== 1. Проверка кода server.js ==="
HAS_LISTENING=$(run_on_pi "cd $PROJECT_DIR && grep -q 'server.on(\"listening\"' src/websocket/server.js && echo 'yes' || echo 'no'")
HAS_ERROR_HANDLER=$(run_on_pi "cd $PROJECT_DIR && grep -q 'server.on(\"error\"' src/websocket/server.js && echo 'yes' || echo 'no'")
HAS_CLOSE_CODE=$(run_on_pi "cd $PROJECT_DIR && grep -q 'socket.on(\"close\", (code, reason)' src/websocket/server.js && echo 'yes' || echo 'no'")

echo "Обработка listening: $HAS_LISTENING"
echo "Обработка error: $HAS_ERROR_HANDLER"
echo "Логирование close с кодом: $HAS_CLOSE_CODE"
echo ""

if [ "$HAS_LISTENING" != "yes" ] || [ "$HAS_ERROR_HANDLER" != "yes" ] || [ "$HAS_CLOSE_CODE" != "yes" ]; then
    echo "❌ Не все исправления применены!"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Все исправления применены в коде"
echo ""

# 2. Проверяем логи демона
echo "=== 2. Проверка логов демона (WebSocket) ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -20")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
    
    # Проверяем наличие успешного запуска
    if echo "$WS_LOGS" | grep -q "WebSocket сервер запущен"; then
        echo ""
        echo "✅ WebSocket сервер успешно запущен"
    else
        echo ""
        echo "⚠️  Нет сообщения о успешном запуске"
    fi
    
    # Проверяем наличие логов закрытия
    if echo "$WS_LOGS" | grep -q "Соединение закрыто"; then
        echo "✅ Есть логи закрытия соединений"
        CLOSE_LOGS=$(echo "$WS_LOGS" | grep "Соединение закрыто" | tail -3)
        echo "Последние закрытия:"
        echo "$CLOSE_LOGS"
    else
        echo "⚠️  Нет логов закрытия соединений (возможно, соединения не закрываются)"
    fi
else
    echo "⚠️  Нет логов WebSocket"
fi
echo ""

# 3. Запускаем event-logger для теста
echo "=== 3. Запуск event-logger для теста ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events 2>&1" | head -5
echo ""

# 4. Ждём и проверяем логи
echo "=== 4. Ожидание подключения (15 секунд) ==="
sleep 15

echo "=== 5. Логи демона после подключения event-logger ==="
RECENT_WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -15")
if [ -n "$RECENT_WS_LOGS" ]; then
    echo "$RECENT_WS_LOGS"
    
    # Проверяем подключение
    if echo "$RECENT_WS_LOGS" | grep -q "Новое подключение"; then
        echo ""
        echo "✅ Event-logger подключился"
    fi
    
    # Проверяем закрытие
    if echo "$RECENT_WS_LOGS" | grep -q "Соединение закрыто.*код:"; then
        echo "✅ Есть логи закрытия с кодом"
        CLOSE_WITH_CODE=$(echo "$RECENT_WS_LOGS" | grep "Соединение закрыто.*код:" | tail -2)
        echo "Закрытия с кодом:"
        echo "$CLOSE_WITH_CODE"
    fi
else
    echo "⚠️  Нет новых логов WebSocket"
fi
echo ""

echo "=== 6. Логи event-logger ==="
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 20 --nostream 2>&1 | tail -20")
echo "$EVENT_LOGGER_LOGS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
