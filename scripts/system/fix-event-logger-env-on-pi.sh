#!/bin/bash
# Исправление переменных окружения event-logger на Raspberry Pi
# Использование: ./scripts/system/fix-event-logger-env-on-pi.sh

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Исправление переменных окружения event-logger"
echo "=============================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# Получаем IP адрес Pi
echo "=== 1. Получение IP адреса Pi ==="
PI_IP=$(run_on_pi "hostname -I 2>&1 | awk '{print \$1}'" | head -1 | tr -d ' \r\n')
if [ -z "$PI_IP" ]; then
    PI_IP="192.168.88.4"
fi
echo "IP адрес Pi: $PI_IP"
echo ""

# Удаляем старый процесс
echo "=== 2. Удаление старого процесса ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Процесс удалён"
echo ""

# Ждём
sleep 2

# Запускаем через ecosystem.config.js с явным указанием переменных
echo "=== 3. Запуск event-logger через ecosystem.config.js ==="
START_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger --update-env 2>&1")
echo "$START_OUT"
echo ""

# Проверяем, что процесс запущен
sleep 3
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger || echo 'NOT_FOUND'")
echo "=== 4. Статус event-logger ==="
echo "$STATUS"
echo ""

# Проверяем переменные окружения через pm2 env
echo "=== 5. Проверка переменных окружения ==="
EVENT_LOGGER_ID=$(run_on_pi "cd $PROJECT_DIR && pm2 jlist | node -e \"const data = JSON.parse(require('fs').readFileSync(0, 'utf-8')); const app = data.find(a => a.name === 'reacthome-event-logger'); console.log(app ? app.pm_id : 'NOT_FOUND');\"")
if [ "$EVENT_LOGGER_ID" != "NOT_FOUND" ] && [ -n "$EVENT_LOGGER_ID" ]; then
    ENV_CHECK=$(run_on_pi "cd $PROJECT_DIR && pm2 env $EVENT_LOGGER_ID 2>&1 | grep DAEMON_WS_URL || echo 'NOT_FOUND'")
    echo "DAEMON_WS_URL: $ENV_CHECK"
    
    if echo "$ENV_CHECK" | grep -q "$PI_IP"; then
        echo "✅ IP адрес найден в переменных окружения"
    else
        echo "⚠️  IP адрес не найден, используется: $ENV_CHECK"
    fi
else
    echo "⚠️  Не удалось получить ID процесса"
fi
echo ""

# Ждём и проверяем логи
echo "=== 6. Ожидание подключения (30 секунд) ==="
sleep 30

echo "=== 7. Проверка логов подключения ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 20 --nostream 2>&1 | tail -20")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
    
    if echo "$LOGS" | grep -q "$PI_IP"; then
        echo ""
        echo "✅ Event-logger использует IP адрес!"
    elif echo "$LOGS" | grep -q "localhost"; then
        echo ""
        echo "⚠️  Event-logger всё ещё использует localhost"
    fi
else
    echo "⚠️  Логи недоступны"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=============================================="
echo "✅ Исправление завершено"
echo "=============================================="
