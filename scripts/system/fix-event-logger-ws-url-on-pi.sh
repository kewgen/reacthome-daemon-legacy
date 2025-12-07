#!/bin/bash
# Исправление URL WebSocket в event-logger: localhost -> IP адрес
# Использование: ./scripts/system/fix-event-logger-ws-url-on-pi.sh

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

echo "Исправление URL WebSocket в event-logger"
echo "========================================"
echo ""

# Получаем IP адрес Pi
echo "=== 1. Получение IP адреса Pi ==="
PI_IP=$(run_on_pi "hostname -I 2>&1 | awk '{print \$1}'" | head -1 | tr -d ' \r\n')
if [ -z "$PI_IP" ]; then
    echo "❌ Не удалось получить IP адрес"
    rm -f "$TMP_EXPECT"
    exit 1
fi
echo "IP адрес Pi: $PI_IP"
echo ""

# Проверяем текущий URL
echo "=== 2. Проверка текущего URL ==="
CURRENT_URL=$(run_on_pi "cd $PROJECT_DIR && grep 'DAEMON_WS_URL' event-logger.js | head -1")
echo "Текущий URL: $CURRENT_URL"
echo ""

# Проверяем ecosystem.config.js
echo "=== 3. Проверка ecosystem.config.js ==="
ECOSYSTEM_WS_URL=$(run_on_pi "cd $PROJECT_DIR && grep -A 2 'DAEMON_WS_URL' ecosystem.config.js 2>&1 | head -3")
if [ -n "$ECOSYSTEM_WS_URL" ]; then
    echo "В ecosystem.config.js:"
    echo "$ECOSYSTEM_WS_URL"
else
    echo "⚠️  DAEMON_WS_URL не найден в ecosystem.config.js"
fi
echo ""

# Обновляем ecosystem.config.js
echo "=== 4. Обновление ecosystem.config.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'ecosystem.config.js';
let content = fs.readFileSync(file, 'utf8');

const piIP = '$PI_IP';
const newUrl = 'ws://' + piIP + ':3000';

// Проверяем, есть ли уже DAEMON_WS_URL
if (content.includes('DAEMON_WS_URL')) {
    // Заменяем существующий
    content = content.replace(/DAEMON_WS_URL:\s*['\"][^'\"]*['\"]/g, 'DAEMON_WS_URL: \"' + newUrl + '\"');
    console.log('✅ Обновлён существующий DAEMON_WS_URL');
} else {
    // Добавляем в env секцию reacthome-event-logger
    const envPattern = /(reacthome-event-logger[^}]*env:\s*\{)([^}]*)(\})/s;
    if (envPattern.test(content)) {
        content = content.replace(envPattern, (match, before, env, after) => {
            if (env.trim() && !env.trim().endsWith(',')) {
                env += ',';
            }
            return before + env + '\n        DAEMON_WS_URL: \"' + newUrl + '\",' + after;
        });
        console.log('✅ Добавлен DAEMON_WS_URL в env');
    } else {
        console.log('⚠️  Не удалось найти секцию env для reacthome-event-logger');
    }
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл обновлён, новый URL:', newUrl);
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при обновлении ecosystem.config.js"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ ecosystem.config.js обновлён"
echo ""

# Проверяем изменения
echo "=== 5. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff ecosystem.config.js | head -20")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменения не обнаружены"
fi
echo ""

# Коммитим изменения
echo "=== 6. Создание коммита ==="
COMMIT_MSG="fix: использование IP адреса вместо localhost для WebSocket в event-logger

Проблема:
- Event-logger использовал ws://localhost:3000
- localhost может не разрешаться корректно
- Соединение закрывалось сразу после установления

Решение:
- Использование IP адреса Pi вместо localhost
- URL изменён на ws://<IP>:3000

Изменения:
- ecosystem.config.js: DAEMON_WS_URL установлен в IP адрес Pi

Влияние:
- ✅ Более надёжное подключение к WebSocket серверу
- ✅ Избежание проблем с разрешением localhost

Связано с:
- reports/migration/websocket-connection-analysis-final-2025-12-07.md"

run_on_pi "cd $PROJECT_DIR && git add ecosystem.config.js"

COMMIT_RESULT=$(run_on_pi "cd $PROJECT_DIR && git commit -m \"$COMMIT_MSG\" 2>&1")

if echo "$COMMIT_RESULT" | grep -q "nothing to commit"; then
    echo "⚠️  Нет изменений для коммита"
elif echo "$COMMIT_RESULT" | grep -q "error\|Error\|ERROR"; then
    echo "❌ Ошибка при создании коммита:"
    echo "$COMMIT_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Коммит создан"
    echo "$COMMIT_RESULT" | head -3
fi
echo ""

# Пушим изменения
echo "=== 7. Отправка изменений (push) ==="
PUSH_RESULT=$(run_on_pi "cd $PROJECT_DIR && git push origin websocket-logger 2>&1")

if echo "$PUSH_RESULT" | grep -q "error\|Error\|ERROR\|fatal"; then
    echo "❌ Ошибка при отправке изменений:"
    echo "$PUSH_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Изменения отправлены"
    echo "$PUSH_RESULT" | head -5
fi
echo ""

# Перезапускаем event-logger с новым URL
echo "=== 8. Перезапуск event-logger с новым URL ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger 2>&1" | head -5
echo ""

# Ждём и проверяем логи
echo "=== 9. Ожидание подключения (20 секунд) ==="
sleep 20

echo "=== 10. Проверка логов event-logger ==="
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 20 --nostream 2>&1 | tail -20")
if [ -n "$EVENT_LOGGER_LOGS" ]; then
    echo "$EVENT_LOGGER_LOGS"
    
    # Проверяем успешное подключение
    if echo "$EVENT_LOGGER_LOGS" | grep -qiE "подключен|connected|open"; then
        echo ""
        echo "✅ Event-logger подключился!"
    fi
    
    # Проверяем URL
    if echo "$EVENT_LOGGER_LOGS" | grep -q "$PI_IP"; then
        echo "✅ Используется IP адрес: $PI_IP"
    fi
else
    echo "Нет логов event-logger"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="
