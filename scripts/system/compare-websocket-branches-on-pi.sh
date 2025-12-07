#!/bin/bash
# Сравнительный анализ WebSocket в ветках main и websocket-logger на Raspberry Pi
# Использование: ./scripts/system/compare-websocket-branches-on-pi.sh

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
set timeout 120
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

echo "Сравнительный анализ WebSocket в ветках main и websocket-logger"
echo "================================================================"
echo ""

# Текущая ветка
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d ' \r\n')
echo "Текущая ветка: $CURRENT_BRANCH"
echo ""

# 1. Сравнение server.js
echo "=== 1. Сравнение src/websocket/server.js ==="
echo ""
echo "--- MAIN ветка ---"
MAIN_SERVER=$(run_on_pi "cd $PROJECT_DIR && git show origin/main:src/websocket/server.js 2>&1 | head -30")
echo "$MAIN_SERVER"
echo ""

echo "--- WEBSOCKET-LOGGER ветка (origin) ---"
WS_LOGGER_SERVER=$(run_on_pi "cd $PROJECT_DIR && git show origin/websocket-logger:src/websocket/server.js 2>&1 | head -30")
echo "$WS_LOGGER_SERVER"
echo ""

echo "--- Текущий файл на Pi (если в websocket-logger) ---"
if [ "$CURRENT_BRANCH" = "websocket-logger" ]; then
    CURRENT_SERVER=$(run_on_pi "cd $PROJECT_DIR && cat src/websocket/server.js 2>&1 | head -50")
    echo "$CURRENT_SERVER"
else
    echo "Ветка не websocket-logger, пропускаем"
fi
echo ""

# 2. Проверка различий в других файлах
echo "=== 2. Различия в WebSocket модулях ==="
DIFF_FILES=$(run_on_pi "cd $PROJECT_DIR && git diff origin/main origin/websocket-logger --name-only 2>&1 | grep -E 'websocket|websocket' | head -10")
if [ -n "$DIFF_FILES" ]; then
    echo "Файлы с различиями:"
    echo "$DIFF_FILES"
else
    echo "Нет различий в файлах WebSocket"
fi
echo ""

# 3. Проверка логов в main (если можно переключиться)
echo "=== 3. Проверка работы WebSocket в main ==="
echo "Текущий статус демона:"
DAEMON_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe daemon 2>&1 | grep -E 'status|uptime|restarts' | head -3")
echo "$DAEMON_STATUS"
echo ""

echo "Логи демона (WebSocket, последние 20):"
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -20")
if [ -n "$DAEMON_LOGS" ]; then
    echo "$DAEMON_LOGS"
else
    echo "Нет логов WebSocket"
fi
echo ""

# 4. Проверка порта 3000
echo "=== 4. Проверка порта 3000 ==="
PORT_CHECK=$(run_on_pi "cd $PROJECT_DIR && netstat -tuln 2>&1 | grep 3000 || lsof -i :3000 2>&1 | head -5")
if [ -n "$PORT_CHECK" ]; then
    echo "$PORT_CHECK"
else
    echo "Порт 3000 не найден"
fi
echo ""

# 5. Проверка различий в handle.js и других модулях
echo "=== 5. Проверка различий в handle.js ==="
MAIN_HANDLE=$(run_on_pi "cd $PROJECT_DIR && git show origin/main:src/websocket/handle.js 2>&1 | head -30")
WS_LOGGER_HANDLE=$(run_on_pi "cd $PROJECT_DIR && git show origin/websocket-logger:src/websocket/handle.js 2>&1 | head -30")

if [ "$MAIN_HANDLE" != "$WS_LOGGER_HANDLE" ]; then
    echo "⚠️  Есть различия в handle.js"
    echo ""
    echo "--- MAIN ---"
    echo "$MAIN_HANDLE" | head -15
    echo ""
    echo "--- WEBSOCKET-LOGGER ---"
    echo "$WS_LOGGER_HANDLE" | head -15
else
    echo "✅ handle.js идентичен"
fi
echo ""

# 6. Проверка различий в gate.js
echo "=== 6. Проверка различий в gate.js ==="
MAIN_GATE=$(run_on_pi "cd $PROJECT_DIR && git show origin/main:src/websocket/gate.js 2>&1 | head -30")
WS_LOGGER_GATE=$(run_on_pi "cd $PROJECT_DIR && git show origin/websocket-logger:src/websocket/gate.js 2>&1 | head -30")

if [ "$MAIN_GATE" != "$WS_LOGGER_GATE" ]; then
    echo "⚠️  Есть различия в gate.js"
    echo ""
    echo "--- MAIN ---"
    echo "$MAIN_GATE" | head -15
    echo ""
    echo "--- WEBSOCKET-LOGGER ---"
    echo "$WS_LOGGER_GATE" | head -15
else
    echo "✅ gate.js идентичен"
fi
echo ""

# 7. Проверка package.json (зависимости)
echo "=== 7. Проверка зависимостей (ws) ==="
WS_VERSION_MAIN=$(run_on_pi "cd $PROJECT_DIR && git show origin/main:package.json 2>&1 | grep -A 2 '\"ws\"' | head -3")
WS_VERSION_WS_LOGGER=$(run_on_pi "cd $PROJECT_DIR && git show origin/websocket-logger:package.json 2>&1 | grep -A 2 '\"ws\"' | head -3")

echo "--- MAIN ---"
echo "$WS_VERSION_MAIN"
echo ""
echo "--- WEBSOCKET-LOGGER ---"
echo "$WS_VERSION_WS_LOGGER"
echo ""

# 8. Проверка установленных зависимостей
echo "=== 8. Установленные зависимости (ws) ==="
INSTALLED_WS=$(run_on_pi "cd $PROJECT_DIR && npm list ws 2>&1 | head -3")
echo "$INSTALLED_WS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Сравнительный анализ завершён"
echo "=========================================="
