#!/bin/bash
# Проверка подключения к OpenSearch на Raspberry Pi
# Использование: ./scripts/system/check-opensearch-connection-on-pi.sh

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

echo "Проверка подключения к OpenSearch"
echo "=================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Проверка переменных окружения OpenSearch
echo "=== 1. Переменные окружения OpenSearch ==="
ENV_CHECK=$(run_on_pi "cd $PROJECT_DIR && pm2 env 19 2>&1 | grep -E 'OPENSEARCH|OPEN_SEARCH' || echo 'NOT_FOUND'")
if [ "$ENV_CHECK" != "NOT_FOUND" ]; then
    echo "$ENV_CHECK"
else
    echo "⚠️  Переменные окружения не найдены"
fi
echo ""

# 2. Проверка DNS
echo "=== 2. Проверка DNS ==="
DNS_CHECK=$(run_on_pi "nslookup c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net 2>&1 | head -10 || host c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net 2>&1 | head -5")
echo "$DNS_CHECK"
echo ""

# 3. Проверка сетевого подключения
echo "=== 3. Проверка сетевого подключения ==="
PING_CHECK=$(run_on_pi "ping -c 3 8.8.8.8 2>&1 | tail -3 || echo 'Ping недоступен'")
echo "$PING_CHECK"
echo ""

# 4. Проверка подключения к OpenSearch
echo "=== 4. Тест подключения к OpenSearch ==="
OPENSEARCH_TEST=$(run_on_pi "cd $PROJECT_DIR && timeout 10 node -e \"
const https = require('https');
const url = 'https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200';
const options = {
  hostname: 'c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net',
  port: 9200,
  path: '/',
  method: 'GET',
  timeout: 5000,
  rejectUnauthorized: false
};

const req = https.request(options, (res) => {
  console.log('✅ Подключение успешно, статус:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Ответ:', data.substring(0, 200));
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.log('❌ Ошибка подключения:', err.message);
  console.log('Код ошибки:', err.code);
  process.exit(1);
});

req.on('timeout', () => {
  console.log('❌ Таймаут подключения');
  req.destroy();
  process.exit(1);
});

req.end();
setTimeout(() => {
  console.log('❌ Таймаут запроса');
  req.destroy();
  process.exit(1);
}, 8000);
\" 2>&1")
echo "$OPENSEARCH_TEST"
echo ""

# 5. Проверка логов event-logger на предмет ошибок OpenSearch
echo "=== 5. Ошибки OpenSearch в логах event-logger (последние 10) ==="
OPENSEARCH_ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 200 --nostream 2>&1 | grep -iE 'opensearch|elastic|EAI_AGAIN|ETIMEDOUT|getaddrinfo' | tail -10")
if [ -n "$OPENSEARCH_ERRORS" ]; then
    echo "$OPENSEARCH_ERRORS"
else
    echo "⚠️  Ошибки OpenSearch не найдены в логах"
fi
echo ""

# 6. Проверка успешных отправок в OpenSearch
echo "=== 6. Успешные отправки в OpenSearch (последние 10) ==="
OPENSEARCH_SUCCESS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 200 --nostream 2>&1 | grep -iE 'sent|success|index.*created' | tail -10")
if [ -n "$OPENSEARCH_SUCCESS" ]; then
    echo "$OPENSEARCH_SUCCESS"
else
    echo "⚠️  Успешные отправки не найдены в логах"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=================================="
echo "✅ Проверка завершена"
echo "=================================="
