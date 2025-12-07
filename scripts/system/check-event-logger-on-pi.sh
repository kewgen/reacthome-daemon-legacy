#!/bin/bash
# Проверка event-logger на Raspberry Pi
# Использование: ./scripts/system/check-event-logger-on-pi.sh

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

echo "=========================================="
echo "🔍 Проверка event-logger на Raspberry Pi"
echo "=========================================="
echo ""

# 1. Статус event-logger
echo "=== 1. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe reacthome-event-logger 2>&1")
echo "$STATUS"
echo ""

# 2. Логи event-logger (последние 50 строк)
echo "=== 2. Логи event-logger (последние 50 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 50 --nostream 2>&1 | tail -50")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
else
    echo "⚠️  Нет логов"
fi
echo ""

# 3. Ошибки event-logger
echo "=== 3. Ошибки event-logger (последние 30 строк) ==="
ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --err --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$ERRORS" ]; then
    echo "$ERRORS"
else
    echo "⚠️  Нет ошибок в логах"
fi
echo ""

# 4. Проверка файла event-logger.js
echo "=== 4. Проверка файла event-logger.js ==="
FILE_EXISTS=$(run_on_pi "cd $PROJECT_DIR && test -f event-logger.js && echo 'exists' || echo 'not found'")
echo "Файл: $FILE_EXISTS"
if [ "$FILE_EXISTS" = "exists" ]; then
    FILE_SIZE=$(run_on_pi "cd $PROJECT_DIR && ls -lh event-logger.js | awk '{print \$5}'")
    echo "Размер: $FILE_SIZE"
    
    # Проверка URL WebSocket
    echo ""
    echo "=== 5. URL WebSocket в event-logger.js ==="
    WS_URL=$(run_on_pi "cd $PROJECT_DIR && grep -E 'DAEMON_WS_URL|ws://|WebSocket.*connect' event-logger.js | head -5")
    echo "$WS_URL"
fi
echo ""

# 6. Проверка ecosystem.config.js
echo "=== 6. Конфигурация в ecosystem.config.js ==="
if run_on_pi "cd $PROJECT_DIR && test -f ecosystem.config.js" | grep -q "exists\|true"; then
    ECOSYSTEM_WS=$(run_on_pi "cd $PROJECT_DIR && grep -A 3 'DAEMON_WS_URL' ecosystem.config.js | head -5")
    echo "$ECOSYSTEM_WS"
else
    echo "⚠️  Файл ecosystem.config.js не найден"
fi
echo ""

# 7. Попытка запуска event-logger вручную для проверки
echo "=== 7. Тест запуска event-logger (первые 10 строк вывода) ==="
TEST_RUN=$(run_on_pi "cd $PROJECT_DIR && timeout 5 node event-logger.js 2>&1 | head -10" || echo "Таймаут или ошибка")
echo "$TEST_RUN"
echo ""

# 8. Проверка подключений от event-logger в логах демона
echo "=== 8. Подключения от event-logger в логах демона ==="
EVENT_LOGGER_CONNECTIONS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 200 --nostream 2>&1 | grep -iE '::1|localhost|event.*logger|reacthome-event' | tail -10")
if [ -n "$EVENT_LOGGER_CONNECTIONS" ]; then
    echo "$EVENT_LOGGER_CONNECTIONS"
else
    echo "⚠️  Нет явных упоминаний event-logger в логах"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
