#!/bin/bash
# Прямое исправление строки 637 - финальная версия
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

echo "🔧 Прямое исправление строки 637"
echo ""

echo "📋 Показываем строки 635-640:"
run_on_pi "cd $PROJECT_DIR && sed -n '635,640p' event-logger.js"
echo ""

echo "🔧 Исправление через sed..."
# Исправляем строку 637 - заменяем всё содержимое на правильное
run_on_pi "cd $PROJECT_DIR && sed -i '637s/.*/    });/' event-logger.js"
echo "✅ Строка 637 исправлена"
echo ""

echo "🔧 Исправление строки 676 (console.log -> log)..."
run_on_pi "cd $PROJECT_DIR && sed -i '676s/console\.log/log/' event-logger.js"
echo "✅ Строка 676 исправлена"
echo ""

echo "🧪 Проверка синтаксиса..."
SYNTAX=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX"
    echo ""
    echo "Показываем строки 635-640 после исправления:"
    run_on_pi "cd $PROJECT_DIR && sed -n '635,640p' event-logger.js"
else
    echo "✅ Синтаксис исправлен!"
    echo ""
    echo "🔄 Перезапуск event-logger..."
    run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
    sleep 1
    run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events 2>&1" | head -5
    echo ""
    sleep 5
    STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
    echo "📊 Статус: $STATUS"
    if echo "$STATUS" | grep -q "online"; then
        echo ""
        echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
        echo ""
        LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 10 --nostream 2>&1 | tail -10")
        echo "📋 Последние логи:"
        echo "$LOGS"
    else
        echo ""
        echo "⚠️  Event-logger всё ещё не запущен"
        ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --err --lines 5 --nostream 2>&1 | tail -5")
        echo "❌ Ошибки:"
        echo "$ERRORS"
    fi
fi

rm -f "$TMP_EXPECT"

