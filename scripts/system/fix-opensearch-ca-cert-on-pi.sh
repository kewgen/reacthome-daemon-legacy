#!/bin/bash
# Исправление пути к CA сертификату OpenSearch на Raspberry Pi
# Использование: ./scripts/system/fix-opensearch-ca-cert-on-pi.sh

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Исправление пути к CA сертификату OpenSearch"
echo "============================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Исправляем путь к CA сертификату
echo "=== 1. Исправление пути к CA сертификату ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
let content = fs.readFileSync('ecosystem.config.js', 'utf8');
content = content.replace(/OPENSEARCH_CA_CERT:\s*['\"][^'\"]*['\"]/g, \"OPENSEARCH_CA_CERT: '~/.opensearch/root.crt'\");
fs.writeFileSync('ecosystem.config.js', content, 'utf8');
console.log('✅ Путь к CA сертификату исправлен на ~/.opensearch/root.crt');
NODE_SCRIPT
"

echo "✅ Конфигурация обновлена"
echo ""

# 2. Перезапускаем event-logger
echo "=== 2. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
sleep 2

START_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events --update-env 2>&1")
echo "$START_OUT"
echo ""

# Сохраняем конфигурацию
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Конфигурация PM2 сохранена"
echo ""

# 3. Ждём и проверяем
echo "=== 3. Ожидание запуска (40 секунд) ==="
sleep 40

echo "=== 4. Проверка логов OpenSearch ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 100 --nostream 2>&1 | tail -50")
if [ -n "$LOGS" ]; then
    echo "$LOGS" | head -30
    
    # Проверяем на успешные отправки
    if echo "$LOGS" | grep -qiE "opensearch.*sent|opensearch.*success|index.*created|bulk.*success"; then
        echo ""
        echo "✅ События отправляются в OpenSearch!"
    elif echo "$LOGS" | grep -qiE "opensearch.*error|EAI_AGAIN|ETIMEDOUT|401|Unauthorized|certificate"; then
        echo ""
        echo "⚠️  Есть ошибки OpenSearch в логах"
        echo "$LOGS" | grep -iE "opensearch.*error|EAI_AGAIN|ETIMEDOUT|401|Unauthorized|certificate" | tail -10
    fi
else
    echo "⚠️  Логи недоступны"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "============================================="
echo "✅ Исправление завершено"
echo "============================================="

