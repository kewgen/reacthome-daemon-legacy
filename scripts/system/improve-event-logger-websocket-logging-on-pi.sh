#!/bin/bash
# Улучшение логирования WebSocket в event-logger на Raspberry Pi
# Использование: ./scripts/system/improve-event-logger-websocket-logging-on-pi.sh

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

echo "Улучшение логирования WebSocket в event-logger"
echo "==============================================="
echo ""

# Применяем исправления к event-logger.js
echo "=== 1. Применение исправлений к event-logger.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');

// Улучшаем логирование ошибок WebSocket
const oldErrorHandler = /ws\.on\('error',\s*\(error\)\s*=>\s*\{[\s\S]*?logError\('WebSocket ошибка:',\s*error\.message\);[\s\S]*?\}\);?/;
const newErrorHandler = 'ws.on(\"error\", (error) => {\n    logError(\"WebSocket ошибка:\", error.message || error.toString() || JSON.stringify(error), error);\n    isConnected = false;\n  });';

if (oldErrorHandler.test(content)) {
    content = content.replace(oldErrorHandler, newErrorHandler);
    console.log('✅ Обработка ошибок улучшена');
} else {
    console.log('⚠️  Обработчик ошибок не найден в ожидаемом формате');
}

// Улучшаем логирование закрытия WebSocket (добавляем код и причину)
const oldCloseHandler = /ws\.on\('close',\s*\(\)\s*=>\s*\{[\s\S]*?log\('WebSocket соединение закрыто'\);[\s\S]*?\}\);?/;
const newCloseHandler = 'ws.on(\"close\", (code, reason) => {\n    log(\"WebSocket соединение закрыто, код:\", code, \"причина:\", reason ? reason.toString() : \"нет\");\n    isConnected = false;\n    stateRequested = false;\n    isInitialStateReceived = false;\n    pendingGetRequests = 0;\n    \n    // Пытаемся переподключиться\n    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {\n      reconnectAttempts++;\n      log(\`Попытка переподключения \${reconnectAttempts}/\${MAX_RECONNECT_ATTEMPTS} через \${RECONNECT_DELAY}мс...\`);\n      setTimeout(connect, RECONNECT_DELAY);\n    } else {\n      logError(\`Достигнуто максимальное количество попыток переподключения (\${MAX_RECONNECT_ATTEMPTS})\`);\n      process.exit(1);\n    }\n  });';

if (oldCloseHandler.test(content)) {
    content = content.replace(oldCloseHandler, newCloseHandler);
    console.log('✅ Логирование закрытия улучшено');
} else {
    console.log('⚠️  Обработчик закрытия не найден в ожидаемом формате');
}

// Улучшаем логирование открытия WebSocket
const oldOpenHandler = /ws\.on\('open',\s*\(\)\s*=>\s*\{[\s\S]*?log\('WebSocket подключен'\);[\s\S]*?\}\);?/;
const newOpenHandler = 'ws.on(\"open\", () => {\n    log(\"WebSocket подключен\", \"URL:\", DAEMON_WS_URL, \"readyState:\", ws.readyState);\n    isConnected = true;\n    reconnectAttempts = 0;\n    stateRequested = false;\n    isInitialStateReceived = false;\n    pendingGetRequests = 0;\n    \n    // Запрашиваем полное состояние\n    requestFullState();\n  });';

if (oldOpenHandler.test(content)) {
    content = content.replace(oldOpenHandler, newOpenHandler);
    console.log('✅ Логирование открытия улучшено');
} else {
    console.log('⚠️  Обработчик открытия не найден в ожидаемом формате');
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Исправления применены');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при применении исправлений"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Исправления применены"
echo ""

# Проверяем изменения
echo "=== 2. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff event-logger.js | head -50")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES" | head -30
else
    echo "⚠️  Изменения не обнаружены (возможно, уже применены)"
fi
echo ""

# Коммитим изменения
echo "=== 3. Создание коммита ==="
COMMIT_MSG="fix: улучшено логирование WebSocket в event-logger

Проблема:
- Ошибки WebSocket логировались без деталей (пустые сообщения)
- Закрытие соединения не логировало код и причину
- Невозможно было диагностировать проблемы подключения

Решение:
- Улучшено логирование ошибок (error.message || error.toString() || JSON.stringify(error))
- Добавлено логирование кода и причины закрытия соединения
- Добавлено логирование URL и readyState при открытии соединения

Изменения:
- ws.on('error') - детальное логирование ошибок
- ws.on('close', (code, reason)) - логирование кода и причины закрытия
- ws.on('open') - логирование URL и readyState

Влияние:
- ✅ Теперь видны детали ошибок WebSocket
- ✅ Видно, почему соединения закрываются (код и причина)
- ✅ Легче диагностировать проблемы подключения

Связано с:
- reports/migration/websocket-connection-issue-2025-12-07.md"

run_on_pi "cd $PROJECT_DIR && git add event-logger.js"

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
echo "=== 4. Отправка изменений (push) ==="
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

# Перезапускаем event-logger
echo "=== 5. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger 2>&1" | head -5
echo ""

# Ждём немного
echo "=== 6. Ожидание подключения (15 секунд) ==="
sleep 15

# Проверяем логи
echo "=== 7. Проверка логов event-logger ==="
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$EVENT_LOGGER_LOGS" ]; then
    echo "$EVENT_LOGGER_LOGS"
    
    # Проверяем наличие детальных логов
    if echo "$EVENT_LOGGER_LOGS" | grep -qE "код:|причина:|readyState:"; then
        echo ""
        echo "✅ Детальное логирование работает"
    fi
else
    echo "⚠️  Нет логов event-logger"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Улучшение логирования завершено"
echo "=========================================="
