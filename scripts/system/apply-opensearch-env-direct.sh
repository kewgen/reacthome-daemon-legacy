#!/bin/bash
# Прямое применение переменных OpenSearch через PM2
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

echo "=========================================="
echo "🔧 Применение переменных OpenSearch"
echo "=========================================="
echo ""

# Получаем значения
OPENSEARCH_URL="${OPENSEARCH_URL:-https://rc1a-6p04qpvk99rvkuhd.mdb.yandexcloud.net:9200}"
OPENSEARCH_USER="${OPENSEARCH_USER:-admin}"
OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-}"
OPENSEARCH_INDEX_PREFIX="${OPENSEARCH_INDEX_PREFIX:-reacthome-events}"
OPENSEARCH_CA_CERT="~/.opensearch/root.crt"

if [ -z "$OPENSEARCH_PASSWORD" ]; then
    echo "❌ OPENSEARCH_PASSWORD не установлен"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "📋 Настройки:"
echo "   URL: $OPENSEARCH_URL"
echo "   User: $OPENSEARCH_USER"
echo "   Index: $OPENSEARCH_INDEX_PREFIX"
echo "   CA Cert: $OPENSEARCH_CA_CERT"
echo ""

# 1. Обновляем .env на Pi
echo "=== 1. Обновление .env ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
let content = '';
if (fs.existsSync('.env')) {
  content = fs.readFileSync('.env', 'utf8');
}
const lines = content.split('\\n');
const filtered = lines.filter(l => !l.match(/^\\s*OPENSEARCH_/));
const newLines = [
  ...filtered,
  '',
  '# OpenSearch',
  'OPENSEARCH_ENABLED=true',
  'OPENSEARCH_URL=$OPENSEARCH_URL',
  'OPENSEARCH_USER=$OPENSEARCH_USER',
  'OPENSEARCH_PASSWORD=$OPENSEARCH_PASSWORD',
  'OPENSEARCH_INDEX_PREFIX=$OPENSEARCH_INDEX_PREFIX',
  'OPENSEARCH_CA_CERT=$OPENSEARCH_CA_CERT'
];
fs.writeFileSync('.env', newLines.join('\\n'), 'utf8');
console.log('✅ .env обновлён');
NODE_SCRIPT
"
echo ""

# 2. Останавливаем event-logger
echo "=== 2. Остановка event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
sleep 2

# 3. Запускаем с переменными напрямую
echo "=== 3. Запуск event-logger с переменными ==="
run_on_pi "cd $PROJECT_DIR && pm2 start event-logger.js --name events \\
  --update-env \\
  --env OPENSEARCH_ENABLED=true \\
  --env OPENSEARCH_URL='$OPENSEARCH_URL' \\
  --env OPENSEARCH_USER='$OPENSEARCH_USER' \\
  --env OPENSEARCH_PASSWORD='$OPENSEARCH_PASSWORD' \\
  --env OPENSEARCH_INDEX_PREFIX='$OPENSEARCH_INDEX_PREFIX' \\
  --env OPENSEARCH_CA_CERT='$OPENSEARCH_CA_CERT' \\
  --log-date-format='YYYY-MM-DD HH:mm:ss Z' \\
  --merge-logs 2>&1" | head -10

run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ PM2 конфигурация сохранена"
echo ""

# 4. Ждём и проверяем
echo "=== 4. Ожидание (15 секунд) ==="
sleep 15

echo "=== 5. Проверка логов ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$LOGS" ]; then
    echo "$LOGS" | head -20
    if echo "$LOGS" | grep -qiE "OpenSearch включен: true|Используется CA сертификат|opensearch.*отправлено|индекс.*создан"; then
        echo ""
        echo "✅✅✅ УСПЕХ! OpenSearch настроен!"
    fi
fi

echo ""
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
echo "Статус: $STATUS"

rm -f "$TMP_EXPECT"
