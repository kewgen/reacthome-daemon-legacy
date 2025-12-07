#!/bin/bash
# Добавление лог-маркера в начало выполнения event-logger
# Использование: ./scripts/system/add-restart-marker-at-start-on-pi.sh

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

echo "Добавление лог-маркера в начало выполнения"
echo "==========================================="
echo ""

# Добавляем маркер сразу после определения функций log/logError
echo "=== 1. Добавление маркера после определения log/logError ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');

// Удаляем старые маркеры
content = content.replace(/\/\/ === EVENT-LOGGER ПЕРЕЗАПУСК ===[\s\S]*?\n/g, '');
content = content.replace(/log\(\"=== EVENT-LOGGER ПЕРЕЗАПУСК ===\"[\s\S]*?\);?\n/g, '');

// Находим место после определения logError и добавляем маркер
const logErrorPattern = /(const logError = \(message, \.\.\.args\) => \{[\s\S]*?console\.error\(`\[\$\{timestamp\}\] \[event-logger\] ERROR: \$\{message\}`, \.\.\.args\);[\s\S]*?\}\);)/;
const marker = '\n\n// === EVENT-LOGGER ПЕРЕЗАПУСК ===\nlog(\"=== EVENT-LOGGER ПЕРЕЗАПУСК ===\", new Date().toISOString());\n';

if (logErrorPattern.test(content)) {
    content = content.replace(logErrorPattern, (match) => {
        return match + marker;
    });
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Маркер добавлен после функции logError');
} else {
    // Если не нашли logError, ищем log
    const logPattern = /(const log = \(message, \.\.\.args\) => \{[\s\S]*?console\.log\(`\[\$\{timestamp\}\] \[event-logger\] \$\{message\}`, \.\.\.args\);[\s\S]*?\}\);)/;
    if (logPattern.test(content)) {
        content = content.replace(logPattern, (match) => {
            return match + marker;
        });
        fs.writeFileSync(file, content, 'utf8');
        console.log('✅ Маркер добавлен после функции log');
    } else {
        console.log('⚠️  Функции log/logError не найдены, добавляем в конец require');
        // Добавляем после последнего require
        const lastRequire = /(const opensearch = require\(['\"]\.\/src\/logging\/opensearch['\"]\);)/;
        if (lastRequire.test(content)) {
            content = content.replace(lastRequire, (match) => {
                return match + marker;
            });
            fs.writeFileSync(file, content, 'utf8');
            console.log('✅ Маркер добавлен после require opensearch');
        }
    }
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

# Перезапускаем event-logger
echo "=== 2. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger --update-env 2>&1" | head -5
echo ""

# Ждём и проверяем логи
echo "=== 3. Ожидание запуска (30 секунд) ==="
sleep 30

echo "=== 4. Проверка логов event-logger ==="
EVENT_LOGGER_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$EVENT_LOGGER_LOGS" ]; then
    echo "$EVENT_LOGGER_LOGS"
    
    # Проверяем наличие маркера
    if echo "$EVENT_LOGGER_LOGS" | grep -q "EVENT-LOGGER ПЕРЕЗАПУСК"; then
        echo ""
        echo "✅ Маркер перезапуска найден в логах!"
    else
        echo ""
        echo "⚠️  Маркер перезапуска не найден"
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
echo "✅ Добавление маркера завершено"
echo "=========================================="
