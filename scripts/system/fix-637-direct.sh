#!/bin/bash
# Прямое исправление строки 637
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

echo "Показываем строки 635-642:"
run_on_pi "cd $PROJECT_DIR && sed -n '635,642p' event-logger.js"
echo ""

echo "Исправление строки 637..."
# Убираем все варианты лишних символов на строке 637
run_on_pi "cd $PROJECT_DIR && sed -i '637s/.*\`);.*/    });/' event-logger.js"
run_on_pi "cd $PROJECT_DIR && sed -i '637s/});\`);/});/' event-logger.js"
run_on_pi "cd $PROJECT_DIR && sed -i '637s/\`\`/\`/g' event-logger.js"
echo "Исправлено"
echo ""

echo "Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка:"
    echo "$SYNTAX"
    echo ""
    echo "Показываем строку 637 после исправления:"
    run_on_pi "cd $PROJECT_DIR && sed -n '637p' event-logger.js"
else
    echo "✅ Синтаксис исправлен!"
    echo ""
    echo "Перезапуск через ecosystem.config.js..."
    run_on_pi "cd $PROJECT_DIR && pm2 delete reacthome-event-logger 2>&1" > /dev/null
    sleep 1
    run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only reacthome-event-logger 2>&1" | head -5
    echo ""
    sleep 4
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
    echo "Статус: $STATUS"
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
    fi
fi

rm -f "$TMP_EXPECT"
