#!/bin/bash
# Скачивание event-logger.js с Raspberry Pi
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
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host:$remote_file $local_file
expect { "*assword:" { send "$pass\r"; exp_continue } eof }
EXP
chmod +x "$TMP_EXPECT"

echo "Скачивание event-logger.js с Raspberry Pi..."
"$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$PROJECT_DIR/event-logger.js" "$PROJECT_ROOT/event-logger-from-pi.js" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" || true

if [ -f "$PROJECT_ROOT/event-logger-from-pi.js" ]; then
    LINES=$(wc -l < "$PROJECT_ROOT/event-logger-from-pi.js")
    echo "✅ Файл скачан: $LINES строк"
else
    echo "❌ Ошибка скачивания"
    rm -f "$TMP_EXPECT"
    exit 1
fi

rm -f "$TMP_EXPECT"
