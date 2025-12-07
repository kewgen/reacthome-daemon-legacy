#!/bin/bash
# Проверка событий в OpenSearch на Raspberry Pi
# Использование: ./scripts/system/check-opensearch-events-on-pi.sh

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

echo "Проверка событий в OpenSearch"
echo "=============================="
echo ""

# 1. Проверяем статус event-logger
echo "=== 1. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 describe reacthome-event-logger 2>&1 | grep -E 'status|uptime|restarts' | head -3")
echo "$STATUS"
echo ""

# 2. Проверяем логи event-logger на успешную отправку в OpenSearch
echo "=== 2. Логи отправки в OpenSearch (последние 30) ==="
OPENSEARCH_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 100 --nostream 2>&1 | grep -iE 'opensearch|отправк|success|успешн|bulk' | tail -30")
if [ -n "$OPENSEARCH_LOGS" ]; then
    echo "$OPENSEARCH_LOGS"
    
    # Проверяем успешные отправки
    SUCCESS_COUNT=$(echo "$OPENSEARCH_LOGS" | grep -iE 'успешн|success|bulk.*ok' | wc -l | tr -d ' ')
    if [ "$SUCCESS_COUNT" -gt 0 ]; then
        echo ""
        echo "✅ Найдено успешных отправок: $SUCCESS_COUNT"
    fi
    
    # Проверяем ошибки
    ERROR_COUNT=$(echo "$OPENSEARCH_LOGS" | grep -iE 'ошибк|error|failed|timeout' | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo "⚠️  Найдено ошибок: $ERROR_COUNT"
    fi
else
    echo "⚠️  Нет логов OpenSearch"
fi
echo ""

# 3. Проверяем WebSocket соединение
echo "=== 3. Статус WebSocket соединения ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 50 --nostream 2>&1 | grep -iE 'websocket|подключен|connected|open' | tail -10")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
    
    if echo "$WS_LOGS" | grep -qiE "подключен|connected|open"; then
        echo ""
        echo "✅ WebSocket подключен"
    else
        echo ""
        echo "⚠️  WebSocket не подключен или нет логов"
    fi
else
    echo "⚠️  Нет логов WebSocket"
fi
echo ""

# 4. Проверяем обработку событий
echo "=== 4. Обработка событий (последние 20) ==="
EVENT_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 100 --nostream 2>&1 | grep -iE 'событи|event|ACTION_SET|обработк' | tail -20")
if [ -n "$EVENT_LOGS" ]; then
    echo "$EVENT_LOGS"
    
    EVENT_COUNT=$(echo "$EVENT_LOGS" | grep -iE 'событи|event' | wc -l | tr -d ' ')
    if [ "$EVENT_COUNT" -gt 0 ]; then
        echo ""
        echo "✅ Найдено событий в логах: $EVENT_COUNT"
    fi
else
    echo "⚠️  Нет логов обработки событий"
fi
echo ""

# 5. Проверяем наличие скрипта проверки OpenSearch
echo "=== 5. Проверка скрипта check-opensearch-events.js ==="
if run_on_pi "cd $PROJECT_DIR && test -f scripts/check-opensearch-events.js && echo 'yes' || echo 'no'" | grep -q "yes"; then
    echo "✅ Скрипт существует"
    echo ""
    echo "Запуск проверки событий в OpenSearch..."
    OPENSEARCH_CHECK=$(run_on_pi "cd $PROJECT_DIR && node scripts/check-opensearch-events.js 2>&1 | tail -30")
    if [ -n "$OPENSEARCH_CHECK" ]; then
        echo "$OPENSEARCH_CHECK"
    else
        echo "⚠️  Скрипт не вернул результат"
    fi
else
    echo "⚠️  Скрипт не найден"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
