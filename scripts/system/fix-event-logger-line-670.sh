#!/bin/bash
# Исправление строки 670 в event-logger.js
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

echo "Исправление строки 670..."

run_on_pi "cd $PROJECT_DIR && node << 'EOF'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Строка 670 (индекс 669)
if (lines[669] && lines[669].includes('Подключение к демону')) {
  console.log('Найдена проблемная строка:', lines[669]);
  // Заменяем на правильную версию
  lines[669] = 'log(\`Подключение к демону: \${DAEMON_WS_URL}\`);';
  console.log('Исправлено на:', lines[669]);
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Файл сохранён');
} else {
  console.log('Строка 670 не содержит ожидаемый текст');
  console.log('Строка 670:', lines[669]);
}
EOF
"

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка:"
    echo "$SYNTAX"
else
    echo "✅ Синтаксис корректен!"
    echo "Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -3
    sleep 2
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
fi

rm -f "$TMP_EXPECT"
