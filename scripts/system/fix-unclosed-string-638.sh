#!/bin/bash
# Исправление незакрытой строки на строке 638
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

echo "Проверка строки 638 и контекста..."

# Показываем контекст
echo "=== Контекст (строки 635-645) ==="
run_on_pi "cd $PROJECT_DIR && sed -n '635,645p' event-logger.js"
echo ""

echo "Исправление..."
run_on_pi "cd $PROJECT_DIR && node << 'EOF'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Показываем проблемную область
console.log('Проблемная область (строки 635-645):');
for (let i = 634; i < 645; i++) {
  if (lines[i]) {
    console.log(\`\${i+1}: \${lines[i]}\`);
  }
}

// Строка 638 (индекс 637) начинается с обратной кавычки
// Нужно найти, где она должна закрываться
if (lines[637] && lines[637].includes('\`')) {
  console.log('\\nНайдена строка 638 с обратной кавычкой:');
  console.log(lines[637]);
  
  // Ищем, где должна быть закрывающая кавычка
  // Проверяем следующие строки
  let foundClose = false;
  for (let i = 638; i < 670; i++) {
    if (lines[i] && lines[i].includes('\`')) {
      console.log(\`Найдена обратная кавычка на строке \${i+1}: \${lines[i]}\`);
      // Проверяем, это закрывающая или открывающая
      const beforeQuote = lines[i].substring(0, lines[i].indexOf('\`'));
      const afterQuote = lines[i].substring(lines[i].indexOf('\`') + 1);
      
      // Если после кавычки идёт ); или }, то это закрывающая
      if (afterQuote.trim().startsWith(');') || afterQuote.trim().startsWith('}') || afterQuote.trim().startsWith(',')) {
        console.log('Это закрывающая кавычка');
        foundClose = true;
        break;
      }
    }
  }
  
  if (!foundClose) {
    console.log('\\n⚠️  Закрывающая кавычка не найдена!');
    console.log('Нужно добавить закрывающую кавычку.');
    
    // Проверяем строку 638 - возможно, там должна быть закрывающая кавычка
    // Или нужно добавить её
    if (lines[637].endsWith(';') || lines[637].endsWith(')')) {
      // Попробуем найти место для закрывающей кавычки
      // Если строка заканчивается на );, возможно нужно добавить \` перед );
      const lastQuoteIndex = lines[637].lastIndexOf('\`');
      if (lastQuoteIndex === -1 || lastQuoteIndex < lines[637].length - 5) {
        // Нет закрывающей кавычки, добавляем
        if (lines[637].endsWith(');')) {
          lines[637] = lines[637].replace(');', '\`);');
          console.log('Добавлена закрывающая кавычка перед );');
        } else if (lines[637].endsWith(')')) {
          lines[637] = lines[637].replace(')', '\`)');
          console.log('Добавлена закрывающая кавычка перед )');
        }
      }
    }
    
    // Если строка 638 - это многострочная шаблонная строка, проверяем следующую строку
    if (lines[638] && !lines[638].includes('\`')) {
      // Следующая строка не содержит кавычку - возможно, нужно добавить закрывающую на строке 638
      // Но сначала проверяем, что строка 638 не является продолжением
      if (!lines[638].trim().startsWith('${') && !lines[638].trim().startsWith('}')) {
        // Это не продолжение шаблонной строки, возможно нужно закрыть на предыдущей строке
        console.log('Строка 639 не является продолжением, проверяем строку 638');
      }
    }
  }
  
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('\\n✅ Файл обновлён');
}

EOF
"

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка:"
    echo "$SYNTAX"
    echo ""
    echo "Показываем строку 638 полностью:"
    run_on_pi "cd $PROJECT_DIR && sed -n '638p' event-logger.js | cat -A"
else
    echo "✅ Синтаксис корректен!"
    echo "Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -3
    sleep 3
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
fi

rm -f "$TMP_EXPECT"
