#!/bin/bash
# Исправление конфигурации OpenSearch в ecosystem.config.js на Raspberry Pi
# Использование: ./scripts/system/fix-opensearch-config-on-pi.sh

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

# Проверяем наличие переменных OpenSearch в .env
OPENSEARCH_URL="${OPENSEARCH_URL:-https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200}"
OPENSEARCH_USER="${OPENSEARCH_USER:-}"
OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-}"
OPENSEARCH_CA_CERT="${OPENSEARCH_CA_CERT:-~/.opensearch/root.crt}"

if [ -z "$OPENSEARCH_USER" ] || [ -z "$OPENSEARCH_PASSWORD" ]; then
    echo "⚠️  Внимание: OPENSEARCH_USER или OPENSEARCH_PASSWORD не установлены в .env"
    echo "   События не будут отправляться в OpenSearch без аутентификации"
    echo ""
    read -p "Продолжить без аутентификации? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
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

echo "Исправление конфигурации OpenSearch"
echo "===================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Обновляем ecosystem.config.js
echo "=== 1. Обновление ecosystem.config.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'ecosystem.config.js';
let content = fs.readFileSync(file, 'utf8');

const opensearchUrl = '$OPENSEARCH_URL';
const opensearchUser = '$OPENSEARCH_USER';
const opensearchPassword = '$OPENSEARCH_PASSWORD';
const opensearchCaCert = '$OPENSEARCH_CA_CERT';

// Находим секцию events
const eventLoggerPattern = /(events[^}]*env:\s*\{)([^}]*)(\})/s;
if (eventLoggerPattern.test(content)) {
    content = content.replace(eventLoggerPattern, (match, before, env, after) => {
        // Удаляем старые переменные OpenSearch
        let newEnv = env
            .replace(/OPENSEARCH_URL:\s*[^,}]+/g, '')
            .replace(/OPENSEARCH_USER:\s*[^,}]+/g, '')
            .replace(/OPENSEARCH_PASSWORD:\s*[^,}]+/g, '')
            .replace(/OPENSEARCH_CA_CERT:\s*[^,}]+/g, '')
            .replace(/,\s*,/g, ',')
            .replace(/^\s*,/, '')
            .replace(/,\s*$/, '');
        
        // Добавляем новые переменные
        if (newEnv.trim() && !newEnv.trim().endsWith(',')) {
            newEnv += ',';
        }
        newEnv += \`
        OPENSEARCH_URL: '\${opensearchUrl}',
        OPENSEARCH_USER: '\${opensearchUser}',
        OPENSEARCH_PASSWORD: '\${opensearchPassword}',
        OPENSEARCH_CA_CERT: '\${opensearchCaCert}'\`;
        
        return before + newEnv + after;
    });
    console.log('✅ Переменные OpenSearch обновлены');
} else {
    console.log('⚠️  Секция events не найдена');
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл сохранён');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при обновлении ecosystem.config.js"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Конфигурация обновлена"
echo ""

# 2. Проверяем изменения
echo "=== 2. Проверка изменений ==="
CONFIG_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep events' ecosystem.config.js | grep -A 10 'env:' | head -12")
echo "$CONFIG_CHECK"
echo ""

# 3. Перезапускаем event-logger
echo "=== 3. Перезапуск event-logger ==="
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

# 4. Ждём и проверяем
echo "=== 4. Ожидание запуска (30 секунд) ==="
sleep 30

echo "=== 5. Проверка статуса ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger || echo 'NOT_FOUND'")
echo "$STATUS"
echo ""

echo "=== 6. Проверка логов OpenSearch ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
    
    if echo "$LOGS" | grep -qiE "opensearch.*sent|opensearch.*success|index.*created"; then
        echo ""
        echo "✅ События отправляются в OpenSearch!"
    elif echo "$LOGS" | grep -qiE "opensearch.*error|EAI_AGAIN|ETIMEDOUT|401|Unauthorized"; then
        echo ""
        echo "⚠️  Есть ошибки OpenSearch в логах"
    fi
else
    echo "⚠️  Логи недоступны"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "===================================="
echo "✅ Исправление завершено"
echo "===================================="
echo ""
echo "⚠️  ВАЖНО: Если OPENSEARCH_USER и OPENSEARCH_PASSWORD не установлены,"
echo "   события не будут отправляться в OpenSearch!"
echo "   Установите их в .env и перезапустите скрипт."

