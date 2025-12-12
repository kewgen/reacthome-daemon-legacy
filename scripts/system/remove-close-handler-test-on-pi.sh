#!/bin/bash
# Тест: убрать обработчик close из WebSocket сервера
# Использование: ./scripts/system/remove-close-handler-test-on-pi.sh

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

echo "Тест: убрать обработчик close из WebSocket сервера"
echo "=================================================="
echo ""

# Убираем обработчик close (как в main ветке)
echo "=== 1. Удаление обработчика close ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'src/websocket/server.js';
let content = fs.readFileSync(file, 'utf8');

// Убираем обработчик socket.on('close')
const closeHandlerPattern = /socket\.on\(\"close\",\s*\(code,\s*reason\)\s*=>\s*\{[\s\S]*?\}\);?\s*/;
if (closeHandlerPattern.test(content)) {
    content = content.replace(closeHandlerPattern, '');
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Обработчик close удалён');
} else {
    console.log('⚠️  Обработчик close не найден');
}
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при удалении обработчика"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Обработчик удалён"
echo ""

# Проверяем изменения
echo "=== 2. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff src/websocket/server.js | head -30")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменения не обнаружены"
fi
echo ""

# Перезапускаем демон
echo "=== 3. Перезапуск демона ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1" | head -5
echo ""

# Ждём
echo "=== 4. Ожидание запуска (5 секунд) ==="
sleep 5

# Перезапускаем event-logger
echo "=== 5. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events 2>&1" | head -5
echo ""

# Ждём и проверяем логи
echo "=== 6. Ожидание подключения (20 секунд) ==="
sleep 20

echo "=== 7. Проверка логов ==="
echo "--- Логи демона (WebSocket) ---"
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 30 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -15")
if [ -n "$DAEMON_LOGS" ]; then
    echo "$DAEMON_LOGS"
else
    echo "Нет логов WebSocket"
fi
echo ""

echo "--- Логи event-logger ---"
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 20 --nostream 2>&1 | tail -20")
if [ -n "$EVENT_LOGGER_LOGS" ]; then
    echo "$EVENT_LOGGER_LOGS"
    
    # Проверяем успешное подключение
    if echo "$EVENT_LOGGER_LOGS" | grep -qiE "подключен|connected|open"; then
        echo ""
        echo "✅ Event-logger подключился!"
    fi
    
    # Проверяем ошибки
    if echo "$EVENT_LOGGER_LOGS" | grep -qiE "ошибк|error"; then
        echo ""
        echo "⚠️  Есть ошибки в логах"
    fi
else
    echo "Нет логов event-logger"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Тест завершён"
echo "=========================================="
echo ""
echo "Если event-logger подключился, значит проблема была в обработчике close."
echo "Если не подключился, проблема в другом месте."
