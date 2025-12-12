#!/bin/bash
# Принудительный перезапуск event-logger с правильным IP адресом
# Использование: ./scripts/system/force-restart-event-logger-with-ip-on-pi.sh

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Принудительный перезапуск event-logger с IP адресом"
echo "==================================================="
echo ""

# Получаем IP адрес Pi
PI_IP=$(run_on_pi "hostname -I 2>&1 | awk '{print \$1}'" | head -1 | tr -d ' \r\n')
echo "IP адрес Pi: $PI_IP"
echo ""

# Проверяем ecosystem.config.js
echo "=== 1. Проверка ecosystem.config.js ==="
WS_URL=$(run_on_pi "cd $PROJECT_DIR && grep DAEMON_WS_URL ecosystem.config.js | head -1")
echo "Текущий URL: $WS_URL"
echo ""

# Убеждаемся, что URL правильный
echo "=== 2. Обновление URL в ecosystem.config.js (если нужно) ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'ecosystem.config.js';
let content = fs.readFileSync(file, 'utf8');

const piIP = '$PI_IP';
const newUrl = 'ws://' + piIP + ':3000';

// Заменяем URL
content = content.replace(/DAEMON_WS_URL:\s*['\"][^'\"]*['\"]/g, 'DAEMON_WS_URL: \"' + newUrl + '\"');

fs.writeFileSync(file, content, 'utf8');
console.log('✅ URL обновлён:', newUrl);
NODE_SCRIPT
"
echo ""

# Полностью удаляем процесс и перезапускаем
echo "=== 3. Полное удаление процесса ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Процесс удалён"
echo ""

# Ждём немного
sleep 2

# Запускаем заново
echo "=== 4. Запуск event-logger с обновлённым конфигом ==="
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events --update-env 2>&1" | head -5
echo ""

# Сохраняем конфигурацию PM2
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Конфигурация сохранена"
echo ""

# Проверяем переменные окружения
echo "=== 5. Проверка переменных окружения ==="
ENV_CHECK=$(run_on_pi "cd $PROJECT_DIR && pm2 describe events 2>&1 | grep -A 20 'env:' | head -25")
if [ -n "$ENV_CHECK" ]; then
    echo "$ENV_CHECK"
    
    if echo "$ENV_CHECK" | grep -q "192.168.88.4"; then
        echo ""
        echo "✅ IP адрес найден в переменных окружения"
    else
        echo ""
        echo "⚠️  IP адрес не найден в переменных окружения"
    fi
else
    echo "⚠️  Не удалось получить переменные окружения"
fi
echo ""

# Ждём и проверяем логи
echo "=== 6. Ожидание запуска (40 секунд) ==="
sleep 40

echo "=== 7. Проверка свежих логов ==="
FRESH_LOGS=$(run_on_pi "cd $PROJECT_DIR && tail -20 var/log/event-logger-out.log 2>&1")
if [ -n "$FRESH_LOGS" ]; then
    echo "$FRESH_LOGS"
    
    # Проверяем маркер
    if echo "$FRESH_LOGS" | grep -q "EVENT-LOGGER ПЕРЕЗАПУСК"; then
        echo ""
        echo "✅ Маркер перезапуска найден!"
    fi
    
    # Проверяем URL
    if echo "$FRESH_LOGS" | grep -q "192.168.88.4"; then
        echo "✅ Используется IP адрес: 192.168.88.4"
    elif echo "$FRESH_LOGS" | grep -q "localhost"; then
        echo "⚠️  Всё ещё используется localhost"
    fi
    
    # Проверяем подключение
    if echo "$FRESH_LOGS" | grep -qiE "подключен|connected|open"; then
        echo "✅ Event-logger подключился!"
    fi
else
    echo "Нет логов"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Перезапуск завершён"
echo "=========================================="
