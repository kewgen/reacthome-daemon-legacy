#!/bin/bash
# Скрипт для перезапуска демона и проверки логов
# Использование: ./scripts/system/restart-daemon-and-check.sh

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
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

# Создаём временный expect скрипт для SSH
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

# Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed"
}

echo "=========================================="
echo "Перезапуск демона и проверка логов"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo ""

echo "=== 1. Статус PM2 перед перезапуском ==="
run_on_pi "pm2 status"
echo ""

echo "=== 2. Перезапуск демона ==="
RESTART_OUTPUT=$(run_on_pi "pm2 restart daemon 2>&1")
echo "$RESTART_OUTPUT"
echo ""

echo "Ожидание 5 секунд для полного запуска..."
sleep 5

echo "=== 3. Статус PM2 после перезапуска ==="
run_on_pi "pm2 status"
echo ""

echo "=== 4. Последние логи демона (50 строк) ==="
DAEMON_LOG=$(run_on_pi "pm2 logs daemon --lines 50 --nostream 2>&1 | tail -55")
echo "$DAEMON_LOG" | head -60
echo ""

echo "=== 5. Поиск ошибок и предупреждений ==="
ERRORS=$(run_on_pi "pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE '(error|warn|fail|exception|assist|ru\\.js|sqlite|morpholog)' | tail -20" || echo "Ошибок не найдено")
if [ -n "$ERRORS" ] && [ "$ERRORS" != "Ошибок не найдено" ]; then
    echo "Найдены ошибки/предупреждения:"
    echo "$ERRORS"
else
    echo "✅ Критических ошибок не найдено"
fi
echo ""

echo "=== 6. Проверка WebSocket порта ==="
PORT_CHECK=$(run_on_pi "netstat -tuln | grep ':3000' || ss -tuln | grep ':3000' || echo 'Порт 3000 не найден'")
echo "$PORT_CHECK"
echo ""

echo "=== 7. Проверка работы assist (ru.js) ==="
ASSIST_CHECK=$(run_on_pi "pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE '\\[ASSIST\\]' | tail -10" || echo "Сообщений от ASSIST не найдено")
if [ -n "$ASSIST_CHECK" ] && [ "$ASSIST_CHECK" != "Сообщений от ASSIST не найдено" ]; then
    echo "$ASSIST_CHECK"
else
    echo "✅ Нет сообщений от ASSIST (это нормально, если assist не используется)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
