#!/bin/bash
# Полное исправление строки 637 и связанных проблем
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
set timeout 120
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

echo "Показываем проблемные строки:"
run_on_pi "cd $PROJECT_DIR && sed -n '635,642p' event-logger.js"
echo ""

echo "Исправление через Node.js..."
run_on_pi "cd $PROJECT_DIR && node << 'NODE'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

console.log('Проверка строк 635-642:');
for (let i = 634; i < 642; i++) {
  if (lines[i]) {
    console.log(\`\${i+1}: \${lines[i]}\`);
  }
}

// Исправляем строку 637 (индекс 636)
if (lines[636]) {
  const original = lines[636];
  // Убираем все варианты лишних символов
  lines[636] = lines[636]
    .replace(/\`\);$/g, '')
    .replace(/\);$/g, ');')
    .replace(/\`\`/g, '\`');
  if (original !== lines[636]) {
    console.log('Исправлена строка 637:');
    console.log('Было:', original);
    console.log('Стало:', lines[636]);
  }
}

// Проверяем строку 638 (индекс 637)
if (lines[637] && lines[637].includes('});')) {
  // Если строка содержит только });, это правильно
  if (lines[637].trim() === '});') {
    console.log('Строка 638 корректна');
  } else {
    // Убираем лишнее
    lines[637] = '    });';
    console.log('Исправлена строка 638');
  }
}

content = lines.join('\\n');
fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл сохранён');
NODE
"

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка:"
    echo "$SYNTAX"
    echo ""
    echo "Показываем строки 635-642 ещё раз:"
    run_on_pi "cd $PROJECT_DIR && sed -n '635,642p' event-logger.js | cat -A"
else
    echo "✅ Синтаксис исправлен!"
    echo "Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -3
    sleep 4
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
        LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 5 --nostream 2>&1 | tail -5")
        echo "Логи:"
        echo "$LOGS"
    fi
fi

rm -f "$TMP_EXPECT"
