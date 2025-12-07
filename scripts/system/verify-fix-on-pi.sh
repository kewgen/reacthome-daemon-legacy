#!/bin/bash
# Скрипт для проверки применения исправления ACTION_SCRIPT_RUN на Raspberry Pi
# Использование: ./scripts/system/verify-fix-on-pi.sh

set -e

# Загружаем переменные из .env
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

# Создаём временный expect скрипт
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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Проверка применения исправления ACTION_SCRIPT_RUN"
echo "=================================================="
echo ""

# Проверяем наличие contextStore в ACTION_SCRIPT_RUN
echo "=== Проверка кода ACTION_SCRIPT_RUN ==="
CHECK_RESULT=$(run_on_pi "cd $PROJECT_DIR && grep -A 20 'case ACTION_SCRIPT_RUN:' src/controllers/service.js | grep -E 'contextStore|scriptContext' | head -3")

if [ -n "$CHECK_RESULT" ]; then
    echo "✅ Исправление применено:"
    echo "$CHECK_RESULT"
else
    echo "❌ Исправление НЕ найдено"
    echo ""
    echo "Текущий код ACTION_SCRIPT_RUN:"
    run_on_pi "cd $PROJECT_DIR && grep -A 15 'case ACTION_SCRIPT_RUN:' src/controllers/service.js | head -16"
fi

echo ""
echo "=== Проверка ветки ==="
BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d ' \r\n')
echo "Ветка: $BRANCH"

echo ""
echo "=== Последний коммит ==="
LAST_COMMIT=$(run_on_pi "cd $PROJECT_DIR && git log -1 --oneline 2>/dev/null | head -1")
echo "$LAST_COMMIT"

rm -f "$TMP_EXPECT"
