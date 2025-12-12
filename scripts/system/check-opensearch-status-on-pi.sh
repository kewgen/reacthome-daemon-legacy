#!/bin/bash
# Проверка статуса OpenSearch на Raspberry Pi
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
echo "📊 Проверка статуса OpenSearch на Pi"
echo "=========================================="
echo ""

# 1. Статус процесса
echo "=== 1. Статус PM2 процесса ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
echo "$STATUS"
echo ""

# 2. Переменные окружения
echo "=== 2. Переменные окружения OpenSearch ==="
ENV_VARS=$(run_on_pi "cd $PROJECT_DIR && pm2 env events 2>&1 | grep -E 'OPENSEARCH|DAEMON_WS' | head -10")
if [ -n "$ENV_VARS" ]; then
    echo "$ENV_VARS" | sed 's/PASSWORD=.*/PASSWORD=***/'
else
    echo "⚠️  Переменные окружения не найдены"
fi
echo ""

# 3. Последние успешные отправки
echo "=== 3. Последние успешные отправки в OpenSearch ==="
SUCCESS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 300 --nostream 2>&1 | grep -iE 'отправлено|sent.*success|индекс.*создан|bulk.*success|events.*sent' | tail -10")
if [ -n "$SUCCESS_LOGS" ]; then
    echo "✅ Найдены успешные отправки:"
    echo "$SUCCESS_LOGS"
else
    echo "⚠️  Успешные отправки не найдены в последних 300 строках логов"
fi
echo ""

# 4. Последние ошибки
echo "=== 4. Последние ошибки OpenSearch ==="
ERROR_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 100 --nostream 2>&1 | grep -iE 'opensearch.*error|opensearch.*ошибка|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|certificate' | tail -10")
if [ -n "$ERROR_LOGS" ]; then
    echo "⚠️  Найдены ошибки:"
    echo "$ERROR_LOGS"
else
    echo "✅ Ошибок не найдено в последних 100 строках"
fi
echo ""

# 5. Использование сертификата
echo "=== 5. Использование сертификата ==="
CERT_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 200 --nostream 2>&1 | grep -iE 'сертификат|certificate|CA.*сертификат|используется.*сертификат' | tail -5")
if [ -n "$CERT_LOGS" ]; then
    echo "$CERT_LOGS"
    if echo "$CERT_LOGS" | grep -qi "используется.*сертификат"; then
        echo "✅ Сертификат используется"
    elif echo "$CERT_LOGS" | grep -qi "не найден\|not found"; then
        echo "⚠️  Сертификат не найден"
    fi
else
    echo "ℹ️  Информация о сертификате не найдена в логах"
fi
echo ""

# 6. URL OpenSearch
echo "=== 6. URL OpenSearch в логах ==="
URL_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 100 --nostream 2>&1 | grep -oE 'https://[^/]+:9200' | sort -u | tail -3")
if [ -n "$URL_LOGS" ]; then
    echo "Найденные URL:"
    echo "$URL_LOGS"
    if echo "$URL_LOGS" | grep -q "c-c9q1p4fggl654fni7le4"; then
        echo "✅ Используется правильный URL"
    else
        echo "⚠️  Используется старый или неправильный URL"
    fi
else
    echo "ℹ️  URL не найден в логах"
fi
echo ""

# 7. Итоговая оценка
echo "=== 7. Итоговая оценка ==="
if [ -n "$SUCCESS_LOGS" ]; then
    echo "✅ OpenSearch работает - найдены успешные отправки"
elif [ -z "$ERROR_LOGS" ]; then
    echo "ℹ️  Нет информации о работе OpenSearch в последних логах"
else
    echo "⚠️  Есть проблемы с OpenSearch - найдены ошибки"
fi

rm -f "$TMP_EXPECT"
