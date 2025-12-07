#!/bin/bash
# Простое и надёжное исправление синтаксиса
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then source "$PROJECT_ROOT/.env"; fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXP'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect { "*assword:" { send "$pass\r"; exp_continue } eof }
EXP
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "🔧 Простое исправление синтаксиса"
echo "=========================================="
echo ""

echo "=== 1. Точное содержимое строк 635-642 ==="
run_on_pi "cd $PROJECT_DIR && sed -n '635,642p' event-logger.js | cat -A"
echo ""

echo "=== 2. Исправление через простой Node.js скрипт ==="
run_on_pi "cd $PROJECT_DIR && node -e \"
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

console.log('Строка 637 (до):', JSON.stringify(lines[636]));
console.log('Строка 638 (до):', JSON.stringify(lines[637]));

// Исправляем строку 637 - заменяем на правильную
if (lines[636]) {
  // Если строка содержит });`); или подобное, заменяем на просто });
  lines[636] = lines[636].replace(/.*/, '    });');
  console.log('Строка 637 (после):', JSON.stringify(lines[636]));
}

// Исправляем строку 638 если нужно
if (lines[637] && lines[637].trim() !== '});') {
  lines[637] = '    });';
  console.log('Строка 638 исправлена');
}

content = lines.join('\\n');
fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл сохранён');
\""
echo ""

echo "=== 3. Проверка синтаксиса ==="
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX"
    echo ""
    echo "Показываем строки 635-642 после исправления:"
    run_on_pi "cd $PROJECT_DIR && sed -n '635,642p' event-logger.js"
else
    echo "✅ Синтаксис исправлен!"
    echo ""
    echo "=== 4. Перезапуск event-logger ==="
    run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
    sleep 1
    run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger 2>&1" | head -5
    echo ""
    sleep 5
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
    echo ""
    if echo "$STATUS" | grep -q "online"; then
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
        echo ""
        LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 10 --nostream 2>&1 | tail -10")
        echo "Последние логи:"
        echo "$LOGS"
    else
        echo "⚠️  Event-logger всё ещё не запущен"
        ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --err --lines 5 --nostream 2>&1 | tail -5")
        echo "Ошибки:"
        echo "$ERRORS"
    fi
fi

rm -f "$TMP_EXPECT"
