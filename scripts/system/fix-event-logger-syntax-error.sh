#!/bin/bash
# Исправление синтаксической ошибки в event-logger.js на Raspberry Pi
# Использование: ./scripts/system/fix-event-logger-syntax-error.sh

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

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "Исправление синтаксической ошибки event-logger"
echo "=========================================="
echo ""

# 1. Показываем проблемную строку
echo "=== 1. Проблемная строка 676 ==="
PROBLEM_LINE=$(run_on_pi "cd $PROJECT_DIR && sed -n '674,678p' event-logger.js")
echo "$PROBLEM_LINE"
echo ""

# 2. Исправляем синтаксическую ошибку
echo "=== 2. Исправление ошибки ==="
FIX_OUT=$(run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Исправляем строку 676 (индекс 675)
if (lines[675]) {
  const original = lines[675];
  // Проблема: возможно неправильные кавычки в шаблонной строке
  // Исправляем: log(\`Подключение к демону: \${DAEMON_WS_URL}\`);
  lines[675] = lines[675]
    .replace(/log\(`Подключение к демону:/, 'log(\`Подключение к демону:')
    .replace(/DAEMON_WS_URL`\)/, 'DAEMON_WS_URL\`);')
    .replace(/log\([^`]*Подключение/, 'log(\`Подключение к демону: \${DAEMON_WS_URL}\`);');
  
  if (original !== lines[675]) {
    console.log('✅ Исправлена строка 676');
    console.log('Было:', original);
    console.log('Стало:', lines[675]);
  } else {
    // Если замена не сработала, пробуем другой подход
    if (lines[675].includes('Подключение') && !lines[675].includes('\`')) {
      lines[675] = '  log(\`Подключение к демону: \${DAEMON_WS_URL}\`);';
      console.log('✅ Исправлена строка 676 (полная замена)');
    }
  }
}

content = lines.join('\\n');
fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл сохранён');
NODE_SCRIPT
")
echo "$FIX_OUT"
echo ""

# 3. Проверяем синтаксис
echo "=== 3. Проверка синтаксиса ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX_CHECK" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX_CHECK"
    echo ""
    echo "Показываем строки 674-678:"
    run_on_pi "cd $PROJECT_DIR && sed -n '674,678p' event-logger.js | cat -A"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Синтаксис исправлен!"
fi
echo ""

# 4. Перезапускаем event-logger
echo "=== 4. Перезапуск event-logger ==="
RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart events 2>&1")
echo "$RESTART_OUT"
echo ""

# 5. Проверяем статус
echo "=== 5. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status | grep event-logger")
echo "$STATUS"
echo ""

# 6. Показываем логи
echo "=== 6. Логи event-logger (последние 10 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 10 --nostream 2>&1 | tail -10")
echo "$LOGS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="

