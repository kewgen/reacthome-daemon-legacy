#!/bin/bash
# Исправление через отдельный Node.js скрипт
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
echo "🔧 Исправление через Node.js скрипт"
echo "=========================================="
echo ""

# Копируем скрипт на Pi
echo "=== 1. Копирование скрипта на Pi ==="
FIX_SCRIPT="$SCRIPT_DIR/fix-event-logger-syntax.js"
scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$FIX_SCRIPT" "${USER}@${HOST}:${PROJECT_DIR}/fix-syntax.js" 2>&1 | grep -v "Warning" || {
    echo "Ошибка копирования, создаём скрипт напрямую на Pi..."
    run_on_pi "cd $PROJECT_DIR && cat > fix-syntax.js << 'NODEJS'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

let fixed = false;
if (lines[636]) {
  const original = lines[636];
  lines[636] = '    });';
  if (original !== lines[636]) {
    console.log('Исправлена строка 637');
    fixed = true;
  }
}
if (lines[637] && lines[637].trim() !== '});') {
  lines[637] = '    });';
  console.log('Исправлена строка 638');
  fixed = true;
}
if (lines[669] && lines[669].includes('console.log')) {
  lines[669] = lines[669].replace('console.log', 'log');
  console.log('Исправлена строка 671');
  fixed = true;
}
if (fixed) {
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Файл сохранён');
}
NODEJS
"
}
echo ""

# Запускаем скрипт на Pi
echo "=== 2. Запуск скрипта исправления ==="
RESULT=$(run_on_pi "cd $PROJECT_DIR && node fix-syntax.js event-logger.js 2>&1")
echo "$RESULT"
echo ""

# Проверяем синтаксис
echo "=== 3. Проверка синтаксиса ==="
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка:"
    echo "$SYNTAX"
else
    echo "✅ Синтаксис исправлен!"
    echo ""
    echo "=== 4. Перезапуск event-logger ==="
    run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
    sleep 1
    run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events 2>&1" | head -5
    echo ""
    sleep 5
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
    echo "Статус: $STATUS"
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
    fi
fi

rm -f "$TMP_EXPECT"

