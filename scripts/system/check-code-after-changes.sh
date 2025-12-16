#!/bin/bash

#
# Проверка кода линтером после внесения изменений
#
# Использование:
#   ./scripts/system/check-code-after-changes.sh [файл]
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

FILE="${1:-event-logger.js}"

echo "🔍 Проверка кода после изменений: $FILE"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

echo "=========================================="
echo "1. Проверка синтаксиса Node.js"
echo "=========================================="
echo ""

SYNTAX_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && node -c $FILE 2>&1; echo 'EXIT_CODE:'\$?")

if echo "$SYNTAX_OUTPUT" | grep -q "EXIT_CODE:0"; then
    echo "✅ Синтаксис корректен"
    SYNTAX_OUTPUT=$(echo "$SYNTAX_OUTPUT" | grep -v "EXIT_CODE")
else
    echo "❌ Ошибка синтаксиса:"
    echo "$SYNTAX_OUTPUT" | grep -v "EXIT_CODE" | head -10
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo ""
echo "=========================================="
echo "2. Проверка базовых проблем кода"
echo "=========================================="
echo ""

# Проверка на неиспользуемые переменные (базовая проверка)
UNUSED_VARS=$(run_on_pi "cd $PROJECT_DIR && node -e \"
const fs = require('fs');
const code = fs.readFileSync('$FILE', 'utf8');
const issues = [];
const consoleLogs = (code.match(/console\\.log/g) || []).length;
if (consoleLogs > 50) {
  issues.push('⚠️  Много console.log: ' + consoleLogs);
}
if (code.includes('TODO') || code.includes('FIXME')) {
  issues.push('⚠️  Найдены TODO/FIXME комментарии');
}
if (code.includes('debugger')) {
  issues.push('❌ Найден debugger statement');
}
if (issues.length > 0) {
  issues.forEach(i => console.log(i));
} else {
  console.log('✅ Базовые проверки пройдены');
}
\" 2>&1" | tail -1)

echo "$UNUSED_VARS"

echo ""
echo "=========================================="
echo "3. Проверка структуры кода"
echo "=========================================="
echo ""

# Проверка на незакрытые скобки, фигурные скобки и т.д.
BRACKET_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -e \"
const fs = require('fs');
const code = fs.readFileSync('$FILE', 'utf8');
let openBrace = 0, closeBrace = 0;
let openParen = 0, closeParen = 0;
let open = 0, close = 0;

for (const char of code) {
  if (char === '{') openBrace++;
  if (char === '}') closeBrace++;
  if (char === '[') openParen++;
  if (char === ']') closeParen++;
  if (char === '(') open++;
  if (char === ')') close++;
}

const issues = [];
if (openBrace !== closeBrace) {
  issues.push('❌ Несбалансированные фигурные скобки: {' + openBrace + ' vs }' + closeBrace);
}
if (openParen !== closeParen) {
  issues.push('❌ Несбалансированные квадратные скобки: [' + openParen + ' vs ]' + closeParen);
}
if (open !== close) {
  issues.push('❌ Несбалансированные круглые скобки: (' + open + ' vs )' + close);
}

if (issues.length > 0) {
  issues.forEach(i => console.log(i));
} else {
  console.log('✅ Структура кода корректна');
}
\" 2>&1" | tail -1)

echo "$BRACKET_CHECK"

echo ""
echo "=========================================="
echo "4. Статистика кода"
echo "=========================================="
echo ""

STATS=$(run_on_pi "cd $PROJECT_DIR && node -e \"
const fs = require('fs');
const code = fs.readFileSync('$FILE', 'utf8');
const lines = code.split('\\n').length;
const functions = (code.match(/function\\s+\\w+|const\\s+\\w+\\s*=\\s*\\(|const\\s+\\w+\\s*=\\s*async\\s*\\(/g) || []).length;
const maps = (code.match(/new Map\\(\\)/g) || []).length;
const arrays = (code.match(/new Array\\(\\)|\\[\\]/g) || []).length;
console.log('Строк кода: ' + lines);
console.log('Функций: ' + functions);
console.log('Maps: ' + maps);
console.log('Arrays: ' + arrays);
\" 2>&1" | grep -E "^Строк|^Функций|^Maps|^Arrays" || echo "Статистика недоступна")

echo "$STATS"

rm -f "$TMP_EXPECT"

echo ""
echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
echo ""
