#!/bin/bash
# Скрипт для запуска event-logger на Raspberry Pi
# Использование: ./scripts/system/start-event-logger-on-pi.sh

set -e

# Загружаем переменные из .env
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

# Создаём временный expect скрипт
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
echo "Запуск event-logger на Raspberry Pi"
echo "=========================================="
echo ""

# Проверяем WebSocket порт
echo "=== 1. Проверка WebSocket порта ==="
PORT_CHECK=$(run_on_pi "netstat -tuln 2>/dev/null | grep ':3000' || ss -tuln 2>/dev/null | grep ':3000' || echo 'Порт 3000 не найден'")
echo "$PORT_CHECK"
echo ""

# Проверяем статус event-logger
echo "=== 2. Текущий статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe reacthome-event-logger 2>/dev/null | grep -E 'status|uptime|restarts' | head -3 || echo 'event-logger не запущен'")
echo "$STATUS"
echo ""

# Запускаем event-logger
echo "=== 3. Запуск event-logger ==="
START_RESULT=$(run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger 2>&1 || pm2 restart reacthome-event-logger 2>&1")
echo "$START_RESULT"
echo ""

# Ждём немного
echo "=== 4. Ожидание запуска (5 секунд) ==="
sleep 5

# Проверяем новый статус
echo "=== 5. Новый статус event-logger ==="
NEW_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe reacthome-event-logger 2>/dev/null | grep -E 'status|uptime|restarts' | head -3 || echo 'event-logger не найден'")
echo "$NEW_STATUS"
echo ""

# Проверяем логи
echo "=== 6. Последние логи event-logger (вывод) ==="
OUT_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 15 --nostream 2>&1 | tail -15 || tail -15 var/log/event-logger-out.log 2>/dev/null || echo 'Логи недоступны'")
if [ -n "$OUT_LOG" ] && [ "$OUT_LOG" != "Логи недоступны" ]; then
    echo "$OUT_LOG"
else
    echo "Логи недоступны"
fi
echo ""

echo "=== 7. Последние логи event-logger (ошибки) ==="
ERR_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --err --lines 10 --nostream 2>&1 | tail -10 || tail -10 var/log/event-logger-error.log 2>/dev/null || echo 'Логи ошибок недоступны'")
if [ -n "$ERR_LOG" ] && [ "$ERR_LOG" != "Логи ошибок недоступны" ]; then
    echo "$ERR_LOG"
else
    echo "✅ Нет ошибок (или логи недоступны)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
