#!/bin/bash
# Применение исправлений WebSocket сервера на Raspberry Pi
# Использование: ./scripts/system/apply-websocket-fix-on-pi.sh

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
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
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
echo "Применение исправлений WebSocket на Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Копируем исправленный файл
echo "=== 1. Копирование исправленного server.js ==="
scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$PROJECT_ROOT/src/websocket/server.js" "${USER}@${HOST}:${PROJECT_DIR}/src/websocket/server.js" 2>&1 | grep -v "Warning" || {
    echo "❌ Ошибка при копировании файла"
    rm -f "$TMP_EXPECT"
    exit 1
}
echo "✅ Файл скопирован"
echo ""

# 2. Проверяем, что файл скопирован
echo "=== 2. Проверка файла на Pi ==="
FILE_CHECK=$(run_on_pi "cd $PROJECT_DIR && ls -lh src/websocket/server.js 2>&1")
echo "$FILE_CHECK"
echo ""

# 3. Перезапускаем демон
echo "=== 3. Перезапуск демона ==="
RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1")
echo "$RESTART_OUT"
echo ""

# 4. Проверяем статус
echo "=== 4. Статус демона ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status daemon 2>&1")
echo "$STATUS"
echo ""

# 5. Проверяем логи (первые 20 строк)
echo "=== 5. Логи WebSocket (последние 20 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 20 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -10")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
else
    echo "⚠️  Нет логов WebSocket (возможно, демон только что перезапустился)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправления применены"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Проверьте логи: pm2 logs daemon --lines 50 | grep -i websocket"
echo "2. Проверьте подключение event-logger"
echo "3. Ищите в логах: '[WEBSOCKET] Новое подключение: ... IP: ::1'"
