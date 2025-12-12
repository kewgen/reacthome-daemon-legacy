#!/bin/bash
# Полное исправление синтаксических ошибок в event-logger.js
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
echo "🔧 Полное исправление синтаксиса"
echo "=========================================="
echo ""

# Показываем проблемные строки
echo "=== Проблемные строки (635-642) ==="
run_on_pi "cd $PROJECT_DIR && sed -n '635,642p' event-logger.js"
echo ""

echo "=== Исправление через Node.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

console.log('Исправление незакрытых строк...');

// Ищем и исправляем все проблемные места
let fixed = false;

// Строка 637 (индекс 636) - убираем лишние символы
if (lines[636]) {
  const original = lines[636];
  // Убираем все варианты: });`); или });`);` или подобное
  lines[636] = lines[636]
    .replace(/\`\);$/g, '')
    .replace(/\`\`/g, '\`')
    .replace(/\);\);$/g, ');');
  
  if (original !== lines[636]) {
    console.log('Исправлена строка 637');
    console.log('Было:', original);
    console.log('Стало:', lines[636]);
    fixed = true;
  }
}

// Строка 638 (индекс 637) - должна быть просто });
if (lines[637] && lines[637].trim() !== '});') {
  const original = lines[637];
  // Если содержит лишнее, оставляем только });
  if (lines[637].includes('});')) {
    lines[637] = '    });';
    console.log('Исправлена строка 638');
    fixed = true;
  }
}

// Проверяем строку 671 (индекс 670) - должна быть log, не console.log
if (lines[669] && lines[669].includes('console.log')) {
  lines[669] = lines[669].replace('console.log', 'log');
  console.log('Исправлена строка 671: console.log -> log');
  fixed = true;
}

if (fixed) {
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('\\n✅ Файл сохранён');
} else {
  console.log('Изменений не требуется');
}
NODE
"

echo ""
echo "=== Проверка синтаксиса ==="
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX"
    echo ""
    echo "Пробуем найти незакрытую строку..."
    run_on_pi "cd $PROJECT_DIR && node << 'NODE'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

let inString = false;
let stringChar = '';
let stringStart = -1;

for (let i = 630; i < 675; i++) {
  if (lines[i]) {
    const line = lines[i];
    let quoteCount = 0;
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
    
    // Подсчитываем кавычки для диагностики
    const backticks = (line.match(/\`/g) || []).length;
    if (backticks > 0) {
      console.log(\`Строка \${i+1}: \${backticks} обратных кавычек - \${line.substring(0, 60)}\`);
    }
  }
}

if (inString) {
  console.log('\\n❌ Незакрытая строка начинается на строке:', stringStart);
  console.log('Тип кавычек:', stringChar);
  console.log('\\nКонтекст:');
  for (let i = Math.max(0, stringStart - 3); i < Math.min(stringStart + 5, lines.length); i++) {
    console.log(\`\${i+1}: \${lines[i]}\`);
  }
  
  // Пытаемся исправить - добавляем закрывающую кавычку
  if (stringStart <= 640) {
    for (let i = stringStart - 1; i < Math.min(stringStart + 3, 675); i++) {
      if (lines[i] && lines[i].includes('});') && !lines[i].includes('\`');')) {
        lines[i] = lines[i].replace('});', '\`});');
        console.log('\\n✅ Добавлена закрывающая кавычка на строке', (i+1));
        break;
      }
    }
    content = lines.join('\\n');
    fs.writeFileSync(file, content, 'utf8');
  }
} else {
  console.log('\\n✅ Все строки закрыты');
}
NODE
"
    
    # Проверяем снова
    SYNTAX2=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
    if echo "$SYNTAX2" | grep -q "SyntaxError"; then
        echo "❌ Ошибка всё ещё осталась:"
        echo "$SYNTAX2"
    else
        echo "✅ Синтаксис исправлен!"
    fi
else
    echo "✅ Синтаксис корректен!"
fi
echo ""

# Перезапуск через ecosystem.config.js
if echo "$SYNTAX" | grep -q -v "SyntaxError" || echo "$SYNTAX2" 2>/dev/null | grep -q -v "SyntaxError"; then
    echo "=== Перезапуск через ecosystem.config.js ==="
    run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
    run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events 2>&1" | head -5
    echo ""
    
    sleep 4
    echo "=== Финальный статус ==="
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
    echo "$STATUS"
    echo ""
    
    if echo "$STATUS" | grep -q "online"; then
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
        echo ""
        LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 5 --nostream 2>&1 | tail -5")
        echo "Последние логи:"
        echo "$LOGS"
    fi
fi

rm -f "$TMP_EXPECT"

