#!/bin/bash
# Переключение WebSocket на localhost и проверка
# Использование: ./scripts/system/switch-websocket-to-localhost-on-pi.sh

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

echo "Переключение WebSocket на localhost"
echo "===================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Обновляем ecosystem.config.js
echo "=== 1. Обновление ecosystem.config.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'ecosystem.config.js';
let content = fs.readFileSync(file, 'utf8');

// Заменяем DAEMON_WS_URL на localhost
content = content.replace(/DAEMON_WS_URL:\s*['\"][^'\"]*['\"]/g, \"DAEMON_WS_URL: 'ws://localhost:3000'\");

fs.writeFileSync(file, content, 'utf8');
console.log('✅ DAEMON_WS_URL изменён на ws://localhost:3000');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при обновлении ecosystem.config.js"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Конфигурация обновлена"
echo ""

# 2. Проверяем изменения
echo "=== 2. Проверка изменений ==="
CONFIG_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -A 1 'DAEMON_WS_URL' ecosystem.config.js")
echo "$CONFIG_CHECK"
echo ""

# 3. Перезапускаем event-logger
echo "=== 3. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
sleep 2

START_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events --update-env 2>&1")
echo "$START_OUT"
echo ""

# Сохраняем конфигурацию
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Конфигурация PM2 сохранена"
echo ""

# 4. Ждём и проверяем
echo "=== 4. Ожидание запуска (30 секунд) ==="
sleep 30

echo "=== 5. Проверка статуса ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger || echo 'NOT_FOUND'")
echo "$STATUS"
echo ""

# 5. Проверяем логи подключения
echo "=== 6. Проверка логов подключения ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
    
    if echo "$LOGS" | grep -q "localhost"; then
        echo ""
        echo "✅ Event-logger использует localhost"
    elif echo "$LOGS" | grep -q "192.168.88.4"; then
        echo ""
        echo "⚠️  Event-logger всё ещё использует IP адрес"
    fi
else
    echo "⚠️  Логи недоступны"
fi
echo ""

# 6. Проверяем подключение в логах демона
echo "=== 7. Подключения в логах демона ==="
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -E 'WEBSOCKET.*Новое подключение|WEBSOCKET.*New connection' | tail -5")
if [ -n "$DAEMON_LOGS" ]; then
    echo "$DAEMON_LOGS"
    
    LOCALHOST_CONN=$(echo "$DAEMON_LOGS" | grep -c "::1" || echo "0")
    if [ "$LOCALHOST_CONN" -gt "0" ]; then
        echo ""
        echo "✅ Найдено подключений с localhost (::1): $LOCALHOST_CONN"
    fi
else
    echo "⚠️  Логи подключений не найдены"
fi
echo ""

# 7. Проверяем активные подключения
echo "=== 8. Активные подключения к порту 3000 ==="
CONNECTIONS=$(run_on_pi "netstat -an 2>&1 | grep ':3000' | grep ESTABLISHED || ss -an 2>&1 | grep ':3000' | grep ESTAB || echo 'Нет активных подключений'")
echo "$CONNECTIONS"
echo ""

# 8. Проверяем обработку событий
echo "=== 9. Обработка событий (последние 10) ==="
EVENT_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 50 --nostream 2>&1 | grep -iE 'buffer|event|буфер|событие' | tail -10")
if [ -n "$EVENT_LOGS" ]; then
    echo "$EVENT_LOGS"
else
    echo "⚠️  Логи обработки событий не найдены"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "===================================="
echo "✅ Проверка завершена"
echo "===================================="
