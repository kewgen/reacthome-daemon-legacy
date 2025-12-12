#!/bin/bash
# Настройка переменных окружения OpenSearch на Raspberry Pi
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then source "$PROJECT_ROOT/.env"; fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена в .env"
    exit 1
fi

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
echo "🔧 Настройка переменных OpenSearch на Pi"
echo "=========================================="
echo ""

# Получаем значения из локального .env или запрашиваем
OPENSEARCH_URL="${OPENSEARCH_URL:-https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200}"
OPENSEARCH_USER="${OPENSEARCH_USER:-}"
OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-}"
OPENSEARCH_INDEX_PREFIX="${OPENSEARCH_INDEX_PREFIX:-reacthome-events-test}"
OPENSEARCH_CA_CERT="${OPENSEARCH_CA_CERT:-~/.opensearch/root.crt}"

# Если переменные не заданы, запрашиваем
if [ -z "$OPENSEARCH_USER" ]; then
    echo "⚠️  OPENSEARCH_USER не установлен в .env"
    echo "   Используйте: export OPENSEARCH_USER='ваш_пользователь'"
    echo "   Или добавьте в .env: OPENSEARCH_USER=ваш_пользователь"
    echo ""
fi

if [ -z "$OPENSEARCH_PASSWORD" ]; then
    echo "⚠️  OPENSEARCH_PASSWORD не установлен в .env"
    echo "   Используйте: export OPENSEARCH_PASSWORD='ваш_пароль'"
    echo "   Или добавьте в .env: OPENSEARCH_PASSWORD=ваш_пароль"
    echo ""
fi

if [ -z "$OPENSEARCH_USER" ] || [ -z "$OPENSEARCH_PASSWORD" ]; then
    echo "❌ Необходимо установить OPENSEARCH_USER и OPENSEARCH_PASSWORD"
    echo "   Добавьте их в .env файл и запустите скрипт снова"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "📋 Настройки OpenSearch:"
echo "   URL: $OPENSEARCH_URL"
echo "   User: $OPENSEARCH_USER"
echo "   Password: ***"
echo "   Index Prefix: $OPENSEARCH_INDEX_PREFIX"
echo "   CA Cert: $OPENSEARCH_CA_CERT"
echo ""

# 1. Проверяем текущий .env
echo "=== 1. Проверка текущего .env ==="
CURRENT_ENV=$(run_on_pi "cd $PROJECT_DIR && cat .env 2>&1 | grep -E 'OPENSEARCH' || echo 'Нет переменных OpenSearch'")
if [ -n "$CURRENT_ENV" ] && [ "$CURRENT_ENV" != "Нет переменных OpenSearch" ]; then
    echo "📋 Текущие переменные OpenSearch:"
    echo "$CURRENT_ENV" | sed 's/PASSWORD=.*/PASSWORD=***/'
    echo ""
fi

# 2. Настраиваем переменные в .env
echo "=== 2. Настройка переменных в .env ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const os = require('os');

const opensearchUrl = '$OPENSEARCH_URL';
const opensearchUser = '$OPENSEARCH_USER';
const opensearchPassword = '$OPENSEARCH_PASSWORD';
const opensearchIndexPrefix = '$OPENSEARCH_INDEX_PREFIX';
const opensearchCaCert = '~/.opensearch/root.crt';

let content = '';
if (fs.existsSync('.env')) {
  content = fs.readFileSync('.env', 'utf8');
}

// Удаляем старые переменные OpenSearch
const lines = content.split('\\n');
const filteredLines = lines.filter(line => {
  return !line.match(/^\\s*OPENSEARCH_(ENABLED|URL|USER|PASSWORD|INDEX_PREFIX|CA_CERT)\\s*=/);
});

// Добавляем новые переменные
const newLines = [
  ...filteredLines,
  '',
  '# OpenSearch Configuration',
  'OPENSEARCH_ENABLED=true',
  \`OPENSEARCH_URL=\${opensearchUrl}\`,
  \`OPENSEARCH_USER=\${opensearchUser}\`,
  \`OPENSEARCH_PASSWORD=\${opensearchPassword}\`,
  \`OPENSEARCH_INDEX_PREFIX=\${opensearchIndexPrefix}\`,
  \`OPENSEARCH_CA_CERT=\${opensearchCaCert}\`
];

fs.writeFileSync('.env', newLines.join('\\n'), 'utf8');
console.log('✅ Переменные OpenSearch добавлены в .env');
NODE_SCRIPT
"

echo "✅ .env обновлён"
echo ""

# 3. Проверяем результат
echo "=== 3. Проверка настроенных переменных ==="
UPDATED_ENV=$(run_on_pi "cd $PROJECT_DIR && cat .env | grep -E 'OPENSEARCH'")
if [ -n "$UPDATED_ENV" ]; then
    echo "📋 Обновлённые переменные:"
    echo "$UPDATED_ENV" | sed 's/PASSWORD=.*/PASSWORD=***/'
    echo ""
else
    echo "⚠️  Переменные не найдены после обновления"
fi

# 4. Перезапускаем event-logger с новыми переменными
echo "=== 4. Перезапуск event-logger ==="
echo "Останавливаем event-logger..."
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
sleep 2

echo "Запускаем event-logger с новыми переменными..."
# Загружаем переменные из .env и запускаем
START_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 start event-logger.js --name events --update-env --env-file .env --interpreter node 2>&1")
echo "$START_OUT"
echo ""

# Сохраняем конфигурацию PM2
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Конфигурация PM2 сохранена"
echo ""

# 5. Ждём и проверяем логи
echo "=== 5. Ожидание запуска (10 секунд) ==="
sleep 10

echo "=== 6. Проверка логов OpenSearch ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 30 --nostream 2>&1 | tail -30")
if [ -n "$LOGS" ]; then
    echo "$LOGS" | head -20
    
    # Проверяем на успешные отправки
    if echo "$LOGS" | grep -qiE "opensearch.*отправлено|opensearch.*sent|opensearch.*success|индекс.*создан|bulk.*success|Используется CA сертификат"; then
        echo ""
        echo "✅✅✅ УСПЕХ! OpenSearch настроен и работает!"
        echo "   • Сертификат используется"
        echo "   • События отправляются в OpenSearch"
    elif echo "$LOGS" | grep -qiE "opensearch.*ошибка|opensearch.*error|EAI_AGAIN|ETIMEDOUT|401|Unauthorized|certificate|CA сертификат не найден"; then
        echo ""
        echo "⚠️  Есть ошибки OpenSearch в логах:"
        echo "$LOGS" | grep -iE "opensearch.*ошибка|opensearch.*error|EAI_AGAIN|ETIMEDOUT|401|Unauthorized|certificate|CA сертификат не найден" | tail -5
    elif echo "$LOGS" | grep -qiE "OpenSearch включен: true"; then
        echo ""
        echo "✅ OpenSearch включен, проверяем подключение..."
    else
        echo ""
        echo "ℹ️  OpenSearch может быть ещё не подключён, проверьте логи через несколько секунд"
    fi
else
    echo "⚠️  Логи недоступны"
fi
echo ""

# 6. Проверяем статус
echo "=== 7. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
echo "Статус: $STATUS"
if echo "$STATUS" | grep -q "online"; then
    echo ""
    echo "✅ Event-logger запущен и работает"
else
    echo ""
    echo "⚠️  Event-logger не запущен или имеет проблемы"
    ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --err --lines 5 --nostream 2>&1 | tail -5")
    if [ -n "$ERRORS" ]; then
        echo "Ошибки:"
        echo "$ERRORS"
    fi
fi

rm -f "$TMP_EXPECT"

echo ""
echo "=========================================="
echo "✅ Настройка завершена"
echo "=========================================="
echo ""
echo "📋 Для проверки используйте:"
echo "   ./scripts/system/check-opensearch-cert-on-pi.sh"
echo "   ./scripts/system/check-event-logger-on-pi.sh"

