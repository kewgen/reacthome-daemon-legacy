#!/bin/bash
# Исправление контекста вокруг строки 670
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

echo "Проверка контекста вокруг строки 670..."

# Показываем контекст
echo "=== Контекст (строки 660-680) ==="
run_on_pi "cd $PROJECT_DIR && sed -n '660,680p' event-logger.js"
echo ""

echo "Исправление..."
run_on_pi "cd $PROJECT_DIR && node << 'EOF'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Проверяем контекст вокруг строки 670
console.log('Проверка контекста:');
for (let i = 665; i <= 675; i++) {
  if (lines[i]) {
    console.log(\`Строка \${i+1}: \${lines[i].substring(0, 80)}\`);
  }
}

// Ищем незакрытые функции/блоки перед строкой 670
let openBraces = 0;
let openParens = 0;
let inString = false;
let stringChar = '';

for (let i = 0; i < 670; i++) {
  if (lines[i]) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (!inString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '(') openParens++;
        if (char === ')') openParens--;
        if (char === '\"' || char === '\\'' || char === '\`') {
          inString = true;
          stringChar = char;
        }
      } else {
        if (char === stringChar && line[j-1] !== '\\\\') {
          inString = false;
          stringChar = '';
        }
      }
    }
  }
}

console.log('Открытые фигурные скобки:', openBraces);
console.log('Открытые круглые скобки:', openParens);
console.log('В строке:', inString);

// Если проблема в строке 670, возможно перед ней незакрытая функция
// Проверяем строки 665-669
if (lines[669] && lines[669].includes('log') && lines[669].includes('Подключение')) {
  // Проверяем предыдущую строку
  if (lines[668] && !lines[668].trim().endsWith(';') && !lines[668].trim().endsWith('{') && !lines[668].trim().endsWith('}')) {
    console.log('⚠️  Предыдущая строка не заканчивается точкой с запятой');
    console.log('Строка 669:', lines[668]);
  }
  
  // Возможно проблема в том, что log не определён или не импортирован
  // Проверяем, есть ли определение log выше
  let logDefined = false;
  for (let i = 0; i < 670; i++) {
    if (lines[i] && (lines[i].includes('function log') || lines[i].includes('const log') || lines[i].includes('let log') || lines[i].includes('var log'))) {
      logDefined = true;
      break;
    }
  }
  
  if (!logDefined) {
    console.log('⚠️  Функция log не найдена выше строки 670');
  }
  
  // Попробуем заменить на console.log для проверки
  const originalLine = lines[669];
  lines[669] = lines[669].replace(/^(\s*)log\(/, '\$1console.log(');
  console.log('Заменено log на console.log для проверки');
  console.log('Было:', originalLine);
  console.log('Стало:', lines[669]);
  
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Файл обновлён');
}

EOF
"

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX"
    echo ""
    echo "Пробуем другой подход - проверяем определение log..."
else
    echo "✅ Синтаксис корректен!"
    echo "Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -3
    sleep 3
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
fi

rm -f "$TMP_EXPECT"
