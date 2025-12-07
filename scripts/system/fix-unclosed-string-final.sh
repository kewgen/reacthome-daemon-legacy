#!/bin/bash
# Финальное исправление незакрытой строки
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

echo "Поиск и исправление незакрытой строки..."

run_on_pi "cd $PROJECT_DIR && node << 'NODE'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Ищем незакрытую строку до строки 671
let inString = false;
let stringChar = '';
let stringStart = -1;

for (let i = 0; i < 671; i++) {
  if (lines[i]) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j-1] : '';
      
      if (!inString) {
        if ((char === '\"' || char === '\\'' || char === '\`') && prevChar !== '\\\\') {
          inString = true;
          stringChar = char;
          stringStart = i + 1;
        }
      } else {
        if (char === stringChar && prevChar !== '\\\\') {
          inString = false;
          stringChar = '';
          stringStart = -1;
        }
      }
    }
  }
}

if (inString) {
  console.log('Найдена незакрытая строка, началась на строке:', stringStart);
  console.log('Тип кавычек:', stringChar);
  
  // Показываем контекст
  console.log('\\nКонтекст (строки ' + (stringStart - 2) + ' - ' + (stringStart + 5) + '):');
  for (let i = Math.max(0, stringStart - 3); i < Math.min(stringStart + 5, lines.length); i++) {
    console.log((i+1) + ':', lines[i]);
  }
  
  // Исправляем: добавляем закрывающую кавычку перед проблемной строкой
  // Ищем строку, где должна быть закрывающая кавычка
  if (stringStart <= 640) {
    // Проблема в районе строк 637-640
    for (let i = stringStart - 1; i < Math.min(stringStart + 3, 671); i++) {
      if (lines[i] && (lines[i].includes('});') || lines[i].includes(');'))) {
        // Добавляем закрывающую кавычку перед );
        if (lines[i].includes('});') && !lines[i].includes('\`');')) {
          lines[i] = lines[i].replace('});', '\`});');
          console.log('Исправлена строка', (i+1) + ': добавлена закрывающая кавычка перед });');
          break;
        } else if (lines[i].includes(');') && !lines[i].match(/\`\);/)) {
          lines[i] = lines[i].replace(');', '\`);');
          console.log('Исправлена строка', (i+1) + ': добавлена закрывающая кавычка перед );');
          break;
        }
      }
    }
  }
  
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('\\n✅ Файл обновлён');
} else {
  console.log('Незакрытых строк не найдено до строки 671');
}

NODE
"

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX"
else
    echo "✅ Синтаксис исправлен!"
    echo "Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
    run_on_pi "cd $PROJECT_DIR && pm2 start event-logger.js --name reacthome-event-logger 2>&1" | head -3
    sleep 4
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
    fi
fi

rm -f "$TMP_EXPECT"
