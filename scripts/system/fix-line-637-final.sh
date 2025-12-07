#!/bin/bash
# Финальное исправление строки 637
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
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Показываем строки 635-640:"
run_on_pi "cd $PROJECT_DIR && sed -n '635,640p' event-logger.js"
echo ""

echo "Исправление..."
run_on_pi "cd $PROJECT_DIR && node << 'ENDOFNODE'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Строка 637 (индекс 636) - проблема здесь
console.log('Строка 637:', lines[636]);
console.log('Строка 638:', lines[637]);

// Проблема: строка 637 начинается с обратной кавычки, но не закрыта
// Строка 638 содержит });`); - это означает, что нужно закрыть кавычку перед });
if (lines[636] && lines[636].trim().startsWith('\`')) {
  // Проверяем, закрыта ли кавычка на этой строке
  const quoteCount = (lines[636].match(/\`/g) || []).length;
  console.log('Количество обратных кавычек на строке 637:', quoteCount);
  
  if (quoteCount === 1) {
    // Только одна кавычка - незакрытая строка
    // Нужно добавить закрывающую кавычку перед концом строки или на следующей
    if (lines[637] && lines[637].includes('});')) {
      // Закрывающая кавычка должна быть перед });
      lines[637] = lines[637].replace('});', '\`});');
      console.log('Добавлена закрывающая кавычка перед }); на строке 638');
    } else {
      // Добавляем в конец строки 637
      if (lines[636].trim().endsWith(';') || lines[636].trim().endsWith(')')) {
        lines[636] = lines[636].replace(/;?\s*$/, '\`;');
        console.log('Добавлена закрывающая кавычка в конец строки 637');
      }
    }
  }
}

content = lines.join('\\n');
fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл обновлён');

ENDOFNODE
"

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX"
else
    echo "✅ Синтаксис исправлен!"
    echo "Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -3
    sleep 3
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
    
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ EVENT-LOGGER ЗАПУЩЕН УСПЕШНО! ✅✅✅"
        echo ""
        echo "Проверяем логи..."
        sleep 2
        LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 5 --nostream 2>&1 | tail -5")
        echo "$LOGS"
    fi
fi

rm -f "$TMP_EXPECT"
