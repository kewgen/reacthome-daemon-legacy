#!/bin/bash
# Запуск теста OpenSearch на Raspberry Pi
# Использование: ./scripts/system/run-opensearch-test-on-pi.sh [--date YYYY-MM-DD]

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

# Парсинг аргументов
DATE_ARG=""
if [ "$1" = "--date" ] && [ -n "$2" ]; then
    DATE_ARG="--date $2"
fi

echo "============================================="
echo "Запуск теста OpenSearch на Raspberry Pi"
echo "============================================="
echo "Хост: $HOST"
echo "Пользователь: $USER"
echo "Дата: ${DATE_ARG:-сегодня}"
echo ""

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << EXPECT_EOF
#!/usr/bin/expect -f
set timeout 300
set host [lindex \$argv 0]
set user [lindex \$argv 1]
set pass [lindex \$argv 2]
set cmd [lindex \$argv 3]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \$user@\$host "\$cmd"
expect {
    "*assword:" {
        send "\$pass\r"
        exp_continue
    }
    "yes/no" {
        send "yes\r"
        exp_continue
    }
    "*\$ " {
        exp_continue
    }
    eof {
        catch wait result
        exit [lindex \$result 3]
    }
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    local cmd="$1"
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$cmd" 2>&1 | grep -v "spawn" | grep -v "password:" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

# Переменные окружения для теста
OPENSEARCH_URL="${OPENSEARCH_URL:-https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200}"
OPENSEARCH_USER="${OPENSEARCH_USER:-admin}"
OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-Stinger1945}"

echo "📋 Проверка наличия теста..."
TEST_EXISTS=$(run_on_pi "cd $PROJECT_DIR && test -f tests/integration/test_event_logging_compatibility.js && head -1 tests/integration/test_event_logging_compatibility.js | grep -q '#!/usr/bin/env node' && echo EXISTS || echo NOT_FOUND")
if echo "$TEST_EXISTS" | grep -q "NOT_FOUND"; then
    echo "⚠️  Тест не найден или повреждён, удаляю старый и создаю новый..."
    run_on_pi "cd $PROJECT_DIR && mkdir -p tests/integration && rm -f tests/integration/test_event_logging_compatibility.js"
    
    # Скачиваем тест из git напрямую на Pi
    echo "📥 Скачивание теста из git на Pi..."
    run_on_pi "cd $PROJECT_DIR && git fetch origin websocket-logger:websocket-logger 2>/dev/null || true && git show websocket-logger:tests/integration/test_event_logging_compatibility.js > tests/integration/test_event_logging_compatibility.js 2>&1 && chmod +x tests/integration/test_event_logging_compatibility.js && echo 'Test downloaded' || echo 'Failed to download'"
    
    # Исправляем fetch для работы без node-fetch
    echo "🔧 Исправление fetch в тесте..."
    run_on_pi "cd $PROJECT_DIR && cat > /tmp/fix-fetch.js << 'EOF'
const fs = require('fs');
const content = fs.readFileSync('tests/integration/test_event_logging_compatibility.js', 'utf8');
const fixed = content.replace(
  /const fetch = require\\('node-fetch'\\);\\nconst https = require\\('https'\\);/, 
  \`// Используем встроенный fetch для Node.js 18+ или node-fetch для старых версий
let fetch;
const https = require('https');
try {
  if (globalThis.fetch) {
    fetch = async (url, options = {}) => {
      if (options.agent) {
        return new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const req = https.request({
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            agent: options.agent
          }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: res.statusMessage,
                json: async () => JSON.parse(data),
                text: async () => data
              });
            });
          });
          req.on('error', reject);
          if (options.body) {
            req.write(options.body);
          }
          req.end();
        });
      } else {
        return globalThis.fetch(url, options);
      }
    };
  } else {
    fetch = require('node-fetch');
  }
} catch (e) {
  fetch = async (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request({
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        agent: options.agent
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            json: async () => JSON.parse(data),
            text: async () => data
          });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  };
}
const https = require('https');
\`);
fs.writeFileSync('tests/integration/test_event_logging_compatibility.js', fixed);
EOF
node /tmp/fix-fetch.js" || echo "Исправление fetch пропущено"
fi

echo "🚀 Запуск теста..."
run_on_pi "cd $PROJECT_DIR && OPENSEARCH_URL='$OPENSEARCH_URL' OPENSEARCH_USER='$OPENSEARCH_USER' OPENSEARCH_PASSWORD='$OPENSEARCH_PASSWORD' node tests/integration/test_event_logging_compatibility.js $DATE_ARG"

rm -f "$TMP_EXPECT"

echo ""
echo "✅ Тест завершен"
echo "============================================="
