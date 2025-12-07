#!/bin/bash
# Скрипт для проверки состояния миграции на Raspberry Pi
# Использование: ./scripts/system/check-migration-status-on-pi.sh

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
echo "Проверка состояния миграции на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Директория: $PROJECT_DIR"
echo ""

echo "=== 1. Git ветка ==="
BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current 2>/dev/null || echo 'неизвестно'")
echo "Текущая ветка: $BRANCH"
if [ "$BRANCH" = "websocket-logger" ]; then
    echo "✅ Ветка корректна"
else
    echo "⚠️  Ветка должна быть websocket-logger"
fi
echo ""

echo "=== 2. Ключевые файлы миграции ==="
run_on_pi "cd $PROJECT_DIR && echo 'event-logger.js:' && ls -lh event-logger.js 2>/dev/null | awk '{print \$9, \$5}' || echo '❌ Не найден'"
run_on_pi "cd $PROJECT_DIR && echo 'ecosystem.config.js:' && ls -lh ecosystem.config.js 2>/dev/null | awk '{print \$9, \$5}' || echo '❌ Не найден'"
run_on_pi "cd $PROJECT_DIR && echo 'Модули логирования:' && ls -lh src/logging/*.js 2>/dev/null | wc -l | xargs echo 'файлов:' || echo '❌ Папка не найдена'"
echo ""

echo "=== 3. PM2 процессы ==="
run_on_pi "cd $PROJECT_DIR && pm2 list | grep -E 'daemon|event-logger' || echo 'Процессы не найдены'"
echo ""

echo "=== 4. Статус event-logger ==="
EVENT_LOGGER_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe event-logger 2>/dev/null | grep -E 'status|uptime|restarts' | head -5 || echo 'event-logger не запущен'")
echo "$EVENT_LOGGER_STATUS"
echo ""

echo "=== 5. Переменные окружения ==="
ENV_CHECK=$(run_on_pi "cd $PROJECT_DIR && cat .env 2>/dev/null | grep -E 'EVENT_LOGGING_ENABLED|OPENSEARCH_INDEX_PREFIX|DAEMON_WS_URL' | head -5 || echo 'Переменные не найдены'")
echo "$ENV_CHECK"
echo ""

echo "=== 6. Последние логи event-logger (ошибки) ==="
ERROR_LOG=$(run_on_pi "cd $PROJECT_DIR && tail -20 var/log/event-logger-error.log 2>/dev/null | tail -10 || echo 'Лог ошибок не найден'")
if [ -n "$ERROR_LOG" ] && [ "$ERROR_LOG" != "Лог ошибок не найден" ]; then
    echo "$ERROR_LOG"
else
    echo "✅ Нет ошибок (или лог недоступен)"
fi
echo ""

echo "=== 7. Последние логи event-logger (вывод) ==="
OUT_LOG=$(run_on_pi "cd $PROJECT_DIR && tail -20 var/log/event-logger-out.log 2>/dev/null | tail -10 || echo 'Лог вывода не найден'")
if [ -n "$OUT_LOG" ] && [ "$OUT_LOG" != "Лог вывода не найден" ]; then
    echo "$OUT_LOG"
else
    echo "Лог вывода недоступен"
fi
echo ""

echo "=== 8. Проверка ACTION_SCRIPT_RUN в service.js ==="
SCRIPT_RUN_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -A 15 'case ACTION_SCRIPT_RUN:' src/controllers/service.js 2>/dev/null | grep -q 'contextStore.run' && echo '✅ Исправление применено' || echo '❌ Исправление НЕ применено'")
echo "$SCRIPT_RUN_CHECK"
echo ""

echo "=== 9. WebSocket порт демона ==="
PORT_CHECK=$(run_on_pi "netstat -tuln 2>/dev/null | grep ':3000' || ss -tuln 2>/dev/null | grep ':3000' || echo 'Порт 3000 не найден'")
echo "$PORT_CHECK"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
