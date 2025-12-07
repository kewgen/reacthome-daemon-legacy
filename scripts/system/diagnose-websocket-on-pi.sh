#!/bin/bash
# Диагностика проблем WebSocket на Raspberry Pi
# Использование: ./scripts/system/diagnose-websocket-on-pi.sh

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
echo "🔍 Диагностика WebSocket на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Проект: ${PROJECT_DIR}"
echo ""

# 1. Проверка доступности хоста
echo "=== 1. Проверка доступности хоста ==="
if ping -c 1 -W 2 "${HOST}" >/dev/null 2>&1; then
    echo "✅ Хост доступен"
else
    echo "❌ Хост недоступен"
    rm -f "$TMP_EXPECT"
    exit 1
fi
echo ""

# 2. Проверка порта 3000
echo "=== 2. Проверка порта 3000 ==="
PORT_CHECK=$(run_on_pi "netstat -tuln 2>&1 | grep ':3000' || ss -tuln 2>&1 | grep ':3000' || lsof -i :3000 2>&1 | head -5")
if [ -n "$PORT_CHECK" ]; then
    echo "✅ Порт 3000 открыт:"
    echo "$PORT_CHECK"
else
    echo "❌ Порт 3000 не открыт или не слушается"
fi
echo ""

# 3. Статус PM2 процессов
echo "=== 3. Статус PM2 процессов ==="
PM2_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list 2>&1")
echo "$PM2_STATUS"
echo ""

# 4. Проверка демона
echo "=== 4. Детальная информация о демоне ==="
DAEMON_INFO=$(run_on_pi "cd $PROJECT_DIR && pm2 describe daemon 2>&1")
echo "$DAEMON_INFO"
echo ""

# 5. Проверка файла server.js
echo "=== 5. Проверка файла server.js ==="
FILE_INFO=$(run_on_pi "cd $PROJECT_DIR && ls -lh src/websocket/server.js 2>&1 && echo '---' && head -20 src/websocket/server.js 2>&1")
echo "$FILE_INFO"
echo ""

# 6. Проверка логирования в server.js
echo "=== 6. Проверка логирования в server.js ==="
LOGGING_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -c 'WEBSOCKET.*DEBUG' src/websocket/server.js 2>&1 || echo '0'")
echo "Найдено строк с DEBUG логированием: $LOGGING_CHECK"
if [ "$LOGGING_CHECK" = "0" ]; then
    echo "⚠️  Расширенное логирование не настроено"
    echo "   Запустите: ./scripts/system/setup-websocket-logging-on-pi.sh"
fi
echo ""

# 7. Последние логи WebSocket
echo "=== 7. Последние логи WebSocket (50 строк) ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 200 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -50")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
else
    echo "⚠️  Нет логов WebSocket"
fi
echo ""

# 8. Ошибки в логах
echo "=== 8. Ошибки в логах демона (последние 20) ==="
ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 200 --nostream --err 2>&1 | tail -20")
if [ -n "$ERRORS" ]; then
    echo "$ERRORS"
else
    echo "✅ Ошибок не найдено"
fi
echo ""

# 9. Проверка версии Node.js
echo "=== 9. Версия Node.js ==="
NODE_VERSION=$(run_on_pi "node --version 2>&1")
echo "Node.js: $NODE_VERSION"
echo ""

# 10. Проверка версии ws
echo "=== 10. Версия библиотеки ws ==="
WS_VERSION=$(run_on_pi "cd $PROJECT_DIR && npm list ws 2>&1 | head -3")
echo "$WS_VERSION"
echo ""

# 11. Проверка подключений к порту 3000
echo "=== 11. Активные подключения к порту 3000 ==="
CONNECTIONS=$(run_on_pi "netstat -an 2>&1 | grep ':3000' | grep ESTABLISHED || ss -an 2>&1 | grep ':3000' | grep ESTAB || echo 'Нет активных подключений'")
echo "$CONNECTIONS"
echo ""

# 12. Тест подключения с Pi
echo "=== 12. Тест локального подключения на Pi ==="
LOCAL_TEST=$(run_on_pi "cd $PROJECT_DIR && timeout 3 node -e \"
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => {
  console.log('✅ Локальное подключение успешно');
  ws.close();
  process.exit(0);
});
ws.on('error', (err) => {
  console.log('❌ Ошибка локального подключения:', err.message);
  process.exit(1);
});
setTimeout(() => {
  console.log('❌ Таймаут подключения');
  process.exit(1);
}, 2000);
\" 2>&1" || echo "Тест не выполнен")
echo "$LOCAL_TEST"
echo ""

# 13. Проверка event-logger (если есть)
echo "=== 13. Проверка event-logger (если запущен) ==="
EVENT_LOGGER=$(run_on_pi "cd $PROJECT_DIR && pm2 describe reacthome-event-logger 2>&1 | head -10 || echo 'event-logger не запущен'")
echo "$EVENT_LOGGER"
echo ""

if echo "$EVENT_LOGGER" | grep -q "online"; then
    echo "Логи event-logger (последние 20 строк):"
    EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 50 --nostream 2>&1 | tail -20")
    echo "$EVENT_LOGGER_LOGS"
    echo ""
fi

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Диагностика завершена"
echo "=========================================="
echo ""
echo "Рекомендации:"
echo "1. Если порт 3000 не открыт - проверьте, запущен ли демон"
echo "2. Если нет логов WebSocket - настройте логирование: ./scripts/system/setup-websocket-logging-on-pi.sh"
echo "3. Если есть ошибки - проверьте логи: ssh ${USER}@${HOST} 'cd ${PROJECT_DIR} && pm2 logs daemon --lines 100'"
echo "4. Запустите тест: node tests/websocket/test-websocket-connection.js ws://${HOST}:3000"
