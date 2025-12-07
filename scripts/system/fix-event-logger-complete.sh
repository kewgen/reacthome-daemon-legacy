#!/bin/bash
# Полное исправление синтаксических ошибок в event-logger.js
# Использование: ./scripts/system/fix-event-logger-complete.sh

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
echo "Полное исправление event-logger.js"
echo "=========================================="
echo ""

# 1. Создаём резервную копию
echo "=== 1. Создание резервной копии ==="
BACKUP=$(run_on_pi "cd $PROJECT_DIR && cp event-logger.js event-logger.js.backup.$(date +%Y%m%d_%H%M%S) && echo 'Backup created'")
echo "$BACKUP"
echo ""

# 2. Показываем проблемные строки
echo "=== 2. Проблемные строки (670-680) ==="
PROBLEM_LINES=$(run_on_pi "cd $PROJECT_DIR && sed -n '670,680p' event-logger.js")
echo "$PROBLEM_LINES"
echo ""

# 3. Исправляем все вызовы log() на console.log() через Node.js
echo "=== 3. Замена всех log() на console.log() ==="
FIX_OUT=$(run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

let fixed = false;
let fixedLines = [];

// Проходим по всем строкам и заменяем log( на console.log(
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Ищем строки с log(, но не console.log( и не уже заменённые
  if (line.includes('log(') && !line.includes('console.log(') && !line.trim().startsWith('//')) {
    // Заменяем log( на console.log( с сохранением отступов
    const match = line.match(/^(\s*)(.*?)(log\()(.*)$/);
    if (match) {
      const indent = match[1];
      const before = match[2];
      const after = match[4];
      const newLine = indent + before + 'console.log(' + after;
      lines[i] = newLine;
      fixedLines.push(i + 1);
      fixed = true;
    }
  }
}

if (fixed) {
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Исправлено строк: ' + fixedLines.length);
  console.log('Строки: ' + fixedLines.join(', '));
} else {
  console.log('⚠️  Изменений не требуется');
}
NODE_SCRIPT
")
echo "$FIX_OUT"
echo ""

# 4. Проверяем синтаксис
echo "=== 4. Проверка синтаксиса ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX_CHECK" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX_CHECK"
    echo ""
    echo "Показываем проблемные строки с номерами:"
    run_on_pi "cd $PROJECT_DIR && sed -n '670,680p' event-logger.js | nl -v 670"
    echo ""
    echo "Пробуем альтернативный подход - проверяем кодировку..."
    
    # Проверяем, нет ли проблем с кодировкой
    ENCODING_CHECK=$(run_on_pi "cd $PROJECT_DIR && file -bi event-logger.js")
    echo "Кодировка файла: $ENCODING_CHECK"
    
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Синтаксис исправлен!"
fi
echo ""

# 5. Перезапускаем event-logger
echo "=== 5. Перезапуск event-logger ==="
RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1")
echo "$RESTART_OUT"
echo ""

# 6. Ждём немного и проверяем статус
echo "=== 6. Проверка статуса (через 3 секунды) ==="
sleep 3
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status | grep event-logger")
echo "$STATUS"
echo ""

# 7. Показываем логи
echo "=== 7. Логи event-logger (последние 20 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 20 --nostream 2>&1 | tail -20")
echo "$LOGS"
echo ""

# 8. Проверяем, нет ли ошибок
if echo "$LOGS" | grep -q "SyntaxError\|Error\|errored"; then
    echo "⚠️  В логах есть ошибки!"
else
    if echo "$STATUS" | grep -q "online"; then
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
    fi
fi

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="
