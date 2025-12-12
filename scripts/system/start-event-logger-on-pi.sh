#!/bin/bash
# Запуск event-logger на Raspberry Pi
# Использование: ./scripts/system/start-event-logger-on-pi.sh

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "Запуск event-logger на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Проверяем, существует ли файл event-logger.js
echo "=== 1. Проверка файла event-logger.js ==="
FILE_CHECK=$(run_on_pi "cd $PROJECT_DIR && ls -lh event-logger.js 2>&1")
echo "$FILE_CHECK"
echo ""

if echo "$FILE_CHECK" | grep -q "No such file"; then
    echo "❌ Файл event-logger.js не найден!"
    rm -f "$TMP_EXPECT"
    exit 1
fi

# 2. Проверяем текущий статус
echo "=== 2. Текущий статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger || echo 'NOT_FOUND'")
echo "$STATUS"
echo ""

# 3. Если уже запущен, перезапускаем
if echo "$STATUS" | grep -q "online\|errored\|stopped"; then
    echo "=== 3. Перезапуск существующего event-logger ==="
    RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart events 2>&1")
    echo "$RESTART_OUT"
else
    # 4. Запускаем event-logger
    echo "=== 3. Запуск event-logger ==="
    START_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 start event-logger.js --name events --log-date-format 'YYYY-MM-DD HH:mm:ss Z' --merge-logs 2>&1")
    echo "$START_OUT"
fi
echo ""

# 5. Сохраняем конфигурацию PM2
echo "=== 4. Сохранение конфигурации PM2 ==="
SAVE_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1")
echo "$SAVE_OUT"
echo ""

# 6. Проверяем статус
echo "=== 5. Статус event-logger ==="
FINAL_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status | grep event-logger || echo 'NOT_FOUND'")
echo "$FINAL_STATUS"
echo ""

# 7. Показываем логи (первые 20 строк)
echo "=== 6. Логи event-logger (последние 20 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 20 --nostream 2>&1 | tail -20")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
else
    echo "⚠️  Логи недоступны (возможно, процесс только что запустился)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Event-logger запущен"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Проверьте логи: pm2 logs events --lines 50"
echo "2. Проверьте подключение к WebSocket"
echo "3. Проверьте отправку событий в OpenSearch"
