#!/bin/bash
# Скрипт для перезапуска демона на Raspberry Pi
# Использование: ./scripts/system/restart-daemon-on-pi.sh

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
  "*yes/no" {
    send "yes\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | grep -v "Connection to.*closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "Перезапуск демона на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Директория: $PROJECT_DIR"
echo ""

# Проверяем текущий статус
echo "=== 1. Текущий статус демона ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe daemon 2>/dev/null | grep -E 'status|uptime' | head -2 || echo 'Демон не найден'")
echo "$STATUS"
echo ""

# Перезапускаем демон
echo "=== 2. Перезапуск демона ==="
RESTART_RESULT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1")
echo "$RESTART_RESULT"
echo ""

# Ждём немного для запуска
echo "=== 3. Ожидание запуска (5 секунд) ==="
sleep 5

# Проверяем новый статус
echo "=== 4. Новый статус демона ==="
NEW_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe daemon 2>/dev/null | grep -E 'status|uptime|restarts' | head -3 || echo 'Демон не найден'")
echo "$NEW_STATUS"
echo ""

# Проверяем WebSocket порт
echo "=== 5. Проверка WebSocket порта ==="
PORT_CHECK=$(run_on_pi "netstat -tuln 2>/dev/null | grep ':3000' || ss -tuln 2>/dev/null | grep ':3000' || echo 'Порт 3000 не найден'")
echo "$PORT_CHECK"
echo ""

# Проверяем последние логи
echo "=== 6. Последние логи демона (ошибки) ==="
ERROR_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --err --lines 10 --nostream 2>&1 | tail -10 || echo 'Логи недоступны'")
if [ -n "$ERROR_LOG" ] && [ "$ERROR_LOG" != "Логи недоступны" ]; then
    echo "$ERROR_LOG"
else
    echo "✅ Нет ошибок (или логи недоступны)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Перезапуск завершён"
echo "=========================================="
