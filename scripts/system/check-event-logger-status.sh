#!/bin/bash
# Скрипт проверки статуса event-logger на Raspberry Pi
# Использование: ./scripts/system/check-event-logger-status.sh

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
echo "Проверка статуса event-logger на Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo ""

echo "=== 1. Проверка файлов ==="
run_on_pi "cd $PROJECT_DIR && echo 'Файлы:' && ls -lh event-logger.js ecosystem.config.js 2>/dev/null | awk '{print \$9, \$5}' || echo 'Файлы не найдены'"
run_on_pi "cd $PROJECT_DIR && echo 'Модули логирования:' && ls -lh src/logging/*.js 2>/dev/null | awk '{print \$9, \$5}' || echo 'Модули не найдены'"
echo ""

echo "=== 2. PM2 статус ==="
run_on_pi "cd $PROJECT_DIR && pm2 status"
echo ""

echo "=== 3. Проверка переменных OpenSearch ==="
OPENSEARCH_CONFIG=$(run_on_pi "cd $PROJECT_DIR && cat .env 2>/dev/null | grep OPENSEARCH || echo 'Не найдено'")
if [ -n "$OPENSEARCH_CONFIG" ] && [ "$OPENSEARCH_CONFIG" != "Не найдено" ]; then
    echo "$OPENSEARCH_CONFIG" | head -5
else
    echo "⚠️  Переменные OpenSearch не настроены в .env"
fi
echo ""

echo "=== 4. Детальные логи ошибок event-logger ==="
ERROR_LOG=$(run_on_pi "cd $PROJECT_DIR && tail -30 var/log/event-logger-error.log 2>/dev/null | tail -20 || echo 'Лог ошибок не найден'")
echo "$ERROR_LOG"
echo ""

echo "=== 5. Последние строки логов event-logger ==="
OUT_LOG=$(run_on_pi "cd $PROJECT_DIR && tail -30 var/log/event-logger-out.log 2>/dev/null | tail -20 || echo 'Лог вывода не найден'")
echo "$OUT_LOG"
echo ""

echo "=== 6. Проверка WebSocket порта демона ==="
PORT_CHECK=$(run_on_pi "netstat -tuln | grep ':3000' || ss -tuln | grep ':3000' || echo 'Порт 3000 не найден'")
echo "$PORT_CHECK"
echo ""

echo "=== 7. Логи демона (WebSocket) ==="
DAEMON_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 15 --nostream 2>&1 | grep -i 'websocket\\|3000\\|error' | tail -10 || echo 'Логи демона не найдены'")
if [ -n "$DAEMON_LOG" ] && [ "$DAEMON_LOG" != "Логи демона не найдены" ]; then
    echo "$DAEMON_LOG"
else
    echo "Нет ошибок WebSocket в логах демона (или логи недоступны)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
