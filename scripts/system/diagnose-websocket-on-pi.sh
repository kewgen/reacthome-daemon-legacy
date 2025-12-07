#!/bin/bash
# Скрипт для диагностики WebSocket подключения на Raspberry Pi
# Использование: ./scripts/system/diagnose-websocket-on-pi.sh

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
echo "Диагностика WebSocket подключения"
echo "=========================================="
echo ""

# 1. Проверка порта
echo "=== 1. Проверка порта 3000 ==="
PORT_CHECK=$(run_on_pi "netstat -tuln 2>/dev/null | grep ':3000' || ss -tuln 2>/dev/null | grep ':3000' || echo 'Порт 3000 не найден'")
echo "$PORT_CHECK"
echo ""

# 2. Проверка статуса демона
echo "=== 2. Статус демона ==="
DAEMON_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe daemon 2>/dev/null | grep -E 'status|uptime|pid' | head -3")
echo "$DAEMON_STATUS"
echo ""

# 3. Проверка логов демона на WebSocket
echo "=== 3. Логи демона (WebSocket) ==="
WS_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -iE 'websocket|3000|server|start' | tail -10 || echo 'Логи не найдены'")
if [ -n "$WS_LOG" ] && [ "$WS_LOG" != "Логи не найдены" ]; then
    echo "$WS_LOG"
else
    echo "Нет упоминаний WebSocket в логах"
fi
echo ""

# 4. Проверка ошибок демона
echo "=== 4. Ошибки демона ==="
DAEMON_ERR=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --err --lines 20 --nostream 2>&1 | tail -10 || echo 'Логи ошибок не найдены'")
if [ -n "$DAEMON_ERR" ] && [ "$DAEMON_ERR" != "Логи ошибок не найдены" ]; then
    echo "$DAEMON_ERR"
else
    echo "✅ Нет ошибок (или логи недоступны)"
fi
echo ""

# 5. Проверка конфигурации event-logger
echo "=== 5. Конфигурация event-logger ==="
EVENT_LOGGER_ENV=$(run_on_pi "cd $PROJECT_DIR && cat .env 2>/dev/null | grep -E 'DAEMON_WS_URL|OPENSEARCH' | head -5 || echo 'Переменные не найдены'")
echo "$EVENT_LOGGER_ENV"
echo ""

# 6. Проверка ecosystem.config.js
echo "=== 6. Конфигурация PM2 (ecosystem.config.js) ==="
ECOSYSTEM_WS=$(run_on_pi "cd $PROJECT_DIR && cat ecosystem.config.js 2>/dev/null | grep -A 2 'DAEMON_WS_URL' | head -3 || echo 'Конфигурация не найдена'")
echo "$ECOSYSTEM_WS"
echo ""

# 7. Тест подключения через Node.js
echo "=== 7. Тест WebSocket подключения ==="
WS_TEST=$(run_on_pi "cd $PROJECT_DIR && node -e \"
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => {
  console.log('✅ WebSocket подключение успешно');
  ws.close();
  process.exit(0);
});
ws.on('error', (err) => {
  console.log('❌ WebSocket ошибка:', err.message);
  process.exit(1);
});
setTimeout(() => {
  console.log('⏱️  Таймаут подключения');
  process.exit(1);
}, 5000);
\" 2>&1")
echo "$WS_TEST"
echo ""

# 8. Проверка процесса демона
echo "=== 8. Процесс демона ==="
DAEMON_PROC=$(run_on_pi "ps aux | grep -E 'daemon\.js|node.*daemon' | grep -v grep | head -2 || echo 'Процесс не найден'")
echo "$DAEMON_PROC"
echo ""

# 9. Проверка сетевых соединений демона
echo "=== 9. Сетевые соединения демона ==="
DAEMON_NET=$(run_on_pi "netstat -tulnp 2>/dev/null | grep ':3000' || ss -tulnp 2>/dev/null | grep ':3000' || echo 'Соединения не найдены'")
echo "$DAEMON_NET"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Диагностика завершена"
echo "=========================================="
