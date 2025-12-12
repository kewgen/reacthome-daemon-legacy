#!/bin/bash
# Принудительный перезапуск event-logger
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
set timeout 30
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect { "*assword:" { send "$pass\r"; exp_continue } timeout { exit 1 } eof }
EXP
chmod +x "$TMP_EXPECT"

run_on_pi() {
    timeout 15 "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Перезапуск event-logger..."
run_on_pi "cd $PROJECT_DIR && pm2 restart events 2>&1" | head -5

sleep 3

echo "Статус:"
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
echo "$STATUS"

rm -f "$TMP_EXPECT"

