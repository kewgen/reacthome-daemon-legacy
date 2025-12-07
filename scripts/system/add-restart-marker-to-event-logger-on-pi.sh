#!/bin/bash
# Добавление лог-маркера о перезапуске в event-logger на Raspberry Pi
# Использование: ./scripts/system/add-restart-marker-to-event-logger-on-pi.sh

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

echo "Добавление лог-маркера о перезапуске в event-logger"
echo "===================================================="
echo ""

# Добавляем лог-маркер в начало event-logger.js
echo "=== 1. Добавление лог-маркера ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');

// Проверяем, есть ли уже маркер
if (content.includes('=== EVENT-LOGGER ПЕРЕЗАПУСК ===')) {
    console.log('⚠️  Маркер уже присутствует');
} else {
    // Находим место после require и добавляем маркер
    const logMarker = '// === EVENT-LOGGER ПЕРЕЗАПУСК ===\n';
    const logCall = 'log(\"=== EVENT-LOGGER ПЕРЕЗАПУСК ===\", new Date().toISOString());\n';
    
    // Ищем место после определения функции log
    const logFunctionPattern = /(const log = \(message, \.\.\.args\) => \{[\s\S]*?console\.log\(`\[\$\{timestamp\}\] \[event-logger\] \$\{message\}`, \.\.\.args\);[\s\S]*?\}\);)/;
    
    if (logFunctionPattern.test(content)) {
        // Добавляем маркер сразу после определения log
        content = content.replace(logFunctionPattern, (match) => {
            return match + '\n' + logMarker + logCall;
        });
        console.log('✅ Маркер добавлен после функции log');
    } else {
        // Если не нашли функцию log, добавляем в начало после require
        const requirePattern = /(const opensearch = require\(['\"]\.\/src\/logging\/opensearch['\"]\);)/;
        if (requirePattern.test(content)) {
            content = content.replace(requirePattern, (match) => {
                return match + '\n\n' + logMarker + logCall;
            });
            console.log('✅ Маркер добавлен после require');
        } else {
            // Добавляем в самое начало файла
            content = logMarker + logCall + '\n' + content;
            console.log('✅ Маркер добавлен в начало файла');
        }
    }
    
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Файл обновлён');
}
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при добавлении маркера"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Маркер добавлен"
echo ""

# Проверяем изменения
echo "=== 2. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff event-logger.js | head -20")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменения не обнаружены (возможно, маркер уже был)"
fi
echo ""

# Коммитим изменения
echo "=== 3. Создание коммита ==="
COMMIT_MSG="feat: добавлен лог-маркер о перезапуске event-logger

Проблема:
- Невозможно определить момент перезапуска в логах
- Сложно отслеживать свежие логи после перезапуска

Решение:
- Добавлен лог-маркер '=== EVENT-LOGGER ПЕРЕЗАПУСК ===' с timestamp
- Маркер выводится при каждом запуске процесса

Изменения:
- event-logger.js: добавлен лог-маркер в начале выполнения

Влияние:
- ✅ Легко найти момент перезапуска в логах
- ✅ Можно отслеживать свежие логи после перезапуска"

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
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger --update-env 2>&1" | head -5
echo ""

# Ждём и проверяем логи
echo "=== 6. Ожидание запуска (10 секунд) ==="
sleep 10

echo "=== 7. Проверка логов event-logger ==="
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 20 --nostream 2>&1 | tail -20")
if [ -n "$EVENT_LOGGER_LOGS" ]; then
    echo "$EVENT_LOGGER_LOGS"
    
    # Проверяем наличие маркера
    if echo "$EVENT_LOGGER_LOGS" | grep -q "EVENT-LOGGER ПЕРЕЗАПУСК"; then
        echo ""
        echo "✅ Маркер перезапуска найден в логах!"
    else
        echo ""
        echo "⚠️  Маркер перезапуска не найден (возможно, процесс ещё не запустился)"
    fi
    
    # Проверяем подключение
    if echo "$EVENT_LOGGER_LOGS" | grep -qiE "подключен|connected|open|192.168.88.4"; then
        echo "✅ Event-logger пытается подключиться"
    fi
else
    echo "Нет логов event-logger"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Добавление маркера и перезапуск завершены"
echo "=========================================="
