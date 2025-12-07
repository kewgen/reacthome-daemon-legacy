#!/bin/bash
# Скрипт для улучшения логирования WebSocket ошибок в event-logger на Raspberry Pi
# Использование: ./scripts/system/improve-websocket-logging-on-pi.sh

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

echo "=========================================="
echo "Улучшение логирования WebSocket в event-logger"
echo "=========================================="
echo ""

# Проверяем ветку
echo "=== 1. Проверка ветки ==="
BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d ' \r\n')
echo "Ветка: $BRANCH"

if [ "$BRANCH" != "websocket-logger" ]; then
    echo "⚠️  Переключение на ветку websocket-logger..."
    run_on_pi "cd $PROJECT_DIR && git checkout websocket-logger 2>&1"
fi
echo ""

# Применяем улучшение логирования
echo "=== 2. Применение улучшения логирования ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');

// Улучшаем логирование ошибок WebSocket
// Заменяем: logError('WebSocket ошибка:', error.message);
// На: logError('WebSocket ошибка:', error.message || error.toString() || JSON.stringify(error), error);

const oldPattern = /logError\('WebSocket ошибка:',\s*error\.message\);/g;
const newCode = \"logError('WebSocket ошибка:', error.message || error.toString() || JSON.stringify(error), error);\";

if (content.includes('logError(\"WebSocket ошибка:\", error.message || error.toString()')) {
    console.log('✅ Улучшение уже применено');
    process.exit(0);
}

content = content.replace(oldPattern, newCode);

// Также улучшаем логирование при подключении
const connectPattern = /log\(`Подключение к \$\{DAEMON_WS_URL\}\.\.\.`\);/;
if (connectPattern.test(content)) {
    // Добавляем логирование состояния перед подключением
    const beforeConnect = 'log(`Подключение к ${DAEMON_WS_URL}...`);';
    const afterConnect = 'log(`Подключение к ${DAEMON_WS_URL}... (readyState: ${ws ? ws.readyState : \"null\"})`);';
    content = content.replace(beforeConnect, afterConnect);
}

// Добавляем логирование при открытии соединения
const openPattern = /ws\.on\('open',\s*\(\)\s*=>\s*\{/;
if (openPattern.test(content)) {
    const openHandler = content.match(/ws\.on\('open',\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*log\('WebSocket подключен'\);/);
    if (openHandler) {
        content = content.replace(
            /log\('WebSocket подключен'\);/,
            \"log('WebSocket подключен', 'URL:', DAEMON_WS_URL, 'readyState:', ws.readyState);\"
        );
    }
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Улучшение логирования применено');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при применении улучшения"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Улучшение применено"
echo ""

# Проверяем изменения
echo "=== 3. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff event-logger.js | head -30")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменения не обнаружены"
fi
echo ""

# Коммитим изменения
echo "=== 4. Создание коммита ==="
COMMIT_MSG="fix: улучшено логирование ошибок WebSocket в event-logger

Проблема:
- Ошибки WebSocket логировались как пустые строки
- error.message был undefined или пустым
- Невозможно было диагностировать проблему подключения

Решение:
- Добавлено логирование полного объекта error
- Добавлено fallback: error.message || error.toString() || JSON.stringify(error)
- Добавлено логирование URL и readyState при подключении
- Улучшено логирование при открытии соединения

Изменения:
- logError('WebSocket ошибка:', error.message) → logError('WebSocket ошибка:', error.message || error.toString() || JSON.stringify(error), error)
- Добавлено логирование readyState при подключении
- Добавлено логирование URL и readyState при открытии соединения

Влияние:
- ✅ Теперь видны детальные ошибки WebSocket
- ✅ Легче диагностировать проблемы подключения
- ✅ Можно увидеть состояние соединения

Связано с:
- reports/migration/websocket-issue-summary-2025-12-07.md"

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
echo "=== 5. Отправка изменений (push) ==="
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
echo "=== 6. Перезапуск event-logger ==="
RESTART_RESULT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1")
echo "$RESTART_RESULT" | head -10
echo ""

# Ждём немного
echo "=== 7. Ожидание запуска (5 секунд) ==="
sleep 5

# Проверяем логи
echo "=== 8. Проверка логов event-logger ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 15 --nostream 2>&1 | tail -15")
echo "$LOGS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Улучшение логирования применено, закоммичено и отправлено"
echo "=========================================="
