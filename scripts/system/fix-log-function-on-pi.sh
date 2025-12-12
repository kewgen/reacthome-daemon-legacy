#!/bin/bash
# Замена log() на console.log() в event-logger.js на Raspberry Pi
# Использование: ./scripts/system/fix-log-function-on-pi.sh

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
echo "Замена log() на console.log() в event-logger.js"
echo "=========================================="
echo ""

# Заменяем все вызовы log( на console.log( в проблемной области
echo "=== 1. Замена log() на console.log() ==="
FIX_OUT=$(run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

let fixed = false;

// Заменяем log( на console.log( в строках 670-680
for (let i = 669; i < Math.min(680, lines.length); i++) {
  if (lines[i] && lines[i].includes('log(\`') && !lines[i].includes('console.log')) {
    const original = lines[i];
    lines[i] = lines[i].replace(/^(\s*)log\(/g, '\$1console.log(');
    if (original !== lines[i]) {
      console.log(\`✅ Исправлена строка \${i + 1}\`);
      fixed = true;
    }
  }
}

if (fixed) {
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Файл сохранён');
} else {
  console.log('⚠️  Изменений не требуется (возможно, уже исправлено)');
}
NODE_SCRIPT
")
echo "$FIX_OUT"
echo ""

# Проверяем синтаксис
echo "=== 2. Проверка синтаксиса ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX_CHECK" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX_CHECK"
    echo ""
    echo "Показываем строки 674-680:"
    run_on_pi "cd $PROJECT_DIR && sed -n '674,680p' event-logger.js"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Синтаксис исправлен!"
fi
echo ""

# Перезапускаем event-logger
echo "=== 3. Перезапуск event-logger ==="
RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart events 2>&1")
echo "$RESTART_OUT"
echo ""

# Проверяем статус
echo "=== 4. Статус event-logger ==="
sleep 3
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status | grep event-logger")
echo "$STATUS"
echo ""

# Показываем логи
echo "=== 5. Логи event-logger (последние 15 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 15 --nostream 2>&1 | tail -15")
echo "$LOGS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="

