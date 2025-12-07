#!/bin/bash
# Загрузка исправленного event-logger.js обратно на Pi
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
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $local_file $user@$host:$remote_file
expect { "*assword:" { send "$pass\r"; exp_continue } eof }
EXP
chmod +x "$TMP_EXPECT"

if [ ! -f "$PROJECT_ROOT/event-logger-from-pi.js" ]; then
    echo "❌ Файл event-logger-from-pi.js не найден"
    echo "   Сначала исправьте файл локально"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "📤 Загрузка исправленного event-logger.js на Raspberry Pi..."
"$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$PROJECT_DIR/event-logger.js" "$PROJECT_ROOT/event-logger-from-pi.js" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" || {
    echo "Ошибка загрузки, используем альтернативный метод..."
    run_on_pi() {
        "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
    }
    run_on_pi "cd $PROJECT_DIR && cat > event-logger.js" < "$PROJECT_ROOT/event-logger-from-pi.js"
}

echo "✅ Файл загружен"
echo ""
echo "🔄 Перезапуск event-logger на Pi..."
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

rm -f "$TMP_EXPECT"
