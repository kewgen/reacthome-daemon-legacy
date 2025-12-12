#!/bin/bash
# Обновление URL OpenSearch в ecosystem.config.js на Raspberry Pi
# Использование: ./scripts/system/update-opensearch-url-on-pi.sh

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

# Правильный URL из документации
CORRECT_URL="https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200"

echo "============================================="
echo "Обновление URL OpenSearch на Raspberry Pi"
echo "============================================="
echo "Хост: $HOST"
echo "Пользователь: $USER"
echo "Новый URL: $CORRECT_URL"
echo ""

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
    "password:" {
        send "$pass\r"
        exp_continue
    }
    "yes/no" {
        send "yes\r"
        exp_continue
    }
    eof
}
catch wait result
exit [lindex $result 3]
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    local cmd="$1"
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$cmd"
}

echo "📝 Обновление ecosystem.config.js..."
run_on_pi "cd $PROJECT_DIR && sed -i.bak 's|OPENSEARCH_URL:.*|OPENSEARCH_URL: \"$CORRECT_URL\",|g' ecosystem.config.js && echo 'Updated OPENSEARCH_URL' || echo 'Failed to update'"

echo "✅ Проверка обновления..."
URL_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -o 'OPENSEARCH_URL:.*' ecosystem.config.js | head -1")
echo "Текущий URL: $URL_CHECK"

echo "🔄 Перезапуск event-logger с новой конфигурацией..."
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>/dev/null || true"
run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events --update-env"

echo "✅ Проверка статуса event-logger..."
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events | grep events || echo 'NOT_FOUND'")
echo "$STATUS"

rm -f "$TMP_EXPECT"

echo ""
echo "✅ Обновление URL завершено"
echo "============================================="
