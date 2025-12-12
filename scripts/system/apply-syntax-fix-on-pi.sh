#!/bin/bash
# Применение исправления синтаксиса на Pi через Node.js
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

echo "🔧 Применение исправления синтаксиса на Pi..."
echo ""

# Создаём простой скрипт исправления на Pi
run_on_pi "cd $PROJECT_DIR && cat > fix-now.js << 'FIX'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

console.log('🔍 Поиск проблемных строк...');

// Строка 637 (индекс 636) - заменяем на правильную
if (lines[636]) {
  const original = lines[636];
  lines[636] = '    });';
  console.log('✅ Исправлена строка 637');
  console.log('   Было:', original);
  console.log('   Стало:', lines[636]);
}

// Строка 676 (индекс 675) - заменяем console.log на log
if (lines[675] && lines[675].includes('console.log')) {
  const original = lines[675];
  lines[675] = lines[675].replace('console.log', 'log');
  console.log('✅ Исправлена строка 676');
  console.log('   Было:', original);
  console.log('   Стало:', lines[675]);
}

content = lines.join('\\n');
fs.writeFileSync(file, content, 'utf8');
console.log('💾 Файл сохранён');
FIX
"

echo "Запуск исправления..."
RESULT=$(run_on_pi "cd $PROJECT_DIR && node fix-now.js 2>&1")
echo "$RESULT"
echo ""

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка:"
    echo "$SYNTAX"
else
    echo "✅ Синтаксис исправлен!"
    echo ""
    echo "🔄 Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
    sleep 1
    run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events 2>&1" | head -5
    sleep 5
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
    echo "Статус: $STATUS"
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
    fi
fi

rm -f "$TMP_EXPECT"

