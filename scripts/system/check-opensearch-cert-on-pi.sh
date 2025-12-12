#!/bin/bash
# Проверка сертификата OpenSearch на Raspberry Pi
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
echo "🔍 Проверка сертификата OpenSearch на Pi"
echo "=========================================="
echo ""

# 1. Проверка наличия сертификата
echo "=== 1. Проверка файла сертификата ==="
CERT_CHECK=$(run_on_pi "ls -la ~/.opensearch/root.crt 2>&1")
if echo "$CERT_CHECK" | grep -q "No such file"; then
    echo "❌ Сертификат НЕ НАЙДЕН: ~/.opensearch/root.crt"
    echo ""
    echo "📋 Информация:"
    echo "   • Путь к сертификату должен быть: ~/.opensearch/root.crt"
    echo "   • Сертификат нужен для подключения к Yandex Cloud OpenSearch"
    echo "   • Без сертификата HTTPS подключение будет отклонено"
    echo ""
    echo "💡 РЕШЕНИЕ:"
    echo "   1. Скачайте CA сертификат из Yandex Cloud"
    echo "   2. Создайте директорию: mkdir -p ~/.opensearch"
    echo "   3. Скопируйте сертификат: cp root.crt ~/.opensearch/root.crt"
    echo "   4. Установите права: chmod 644 ~/.opensearch/root.crt"
else
    echo "✅ Сертификат найден:"
    echo "$CERT_CHECK"
    echo ""
    # Проверка содержимого
    CERT_CONTENT=$(run_on_pi "head -3 ~/.opensearch/root.crt 2>&1")
    if echo "$CERT_CONTENT" | grep -q "BEGIN CERTIFICATE"; then
        echo "✅ Сертификат валидный (содержит BEGIN CERTIFICATE)"
    else
        echo "⚠️  Внимание: сертификат может быть повреждён"
        echo "   Первые строки: $CERT_CONTENT"
    fi
fi
echo ""

# 2. Проверка конфигурации в ecosystem.config.js
echo "=== 2. Проверка конфигурации в ecosystem.config.js ==="
CONFIG_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -E 'OPENSEARCH_CA_CERT|OPENSEARCH_URL' ecosystem.config.js 2>&1 | head -5")
if [ -n "$CONFIG_CHECK" ]; then
    echo "📋 Конфигурация OpenSearch:"
    echo "$CONFIG_CHECK"
    if echo "$CONFIG_CHECK" | grep -q "OPENSEARCH_CA_CERT"; then
        CERT_PATH=$(echo "$CONFIG_CHECK" | grep "OPENSEARCH_CA_CERT" | sed "s/.*OPENSEARCH_CA_CERT.*['\"]\([^'\"]*\)['\"].*/\1/" | head -1)
        echo "   Путь к сертификату в конфиге: $CERT_PATH"
    fi
else
    echo "⚠️  Конфигурация OpenSearch не найдена в ecosystem.config.js"
fi
echo ""

# 3. Проверка переменных окружения
echo "=== 3. Проверка переменных окружения ==="
ENV_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -E 'OPENSEARCH|CA_CERT' .env 2>&1 | head -10")
if [ -n "$ENV_CHECK" ]; then
    echo "📋 Переменные окружения:"
    echo "$ENV_CHECK" | sed 's/PASSWORD=.*/PASSWORD=***/'
    if echo "$ENV_CHECK" | grep -q "OPENSEARCH_ENABLED=true"; then
        echo "✅ OpenSearch включен"
    else
        echo "⚠️  OpenSearch отключен или не настроен"
    fi
else
    echo "⚠️  Переменные OpenSearch не найдены в .env"
fi
echo ""

# 4. Проверка логов на ошибки сертификата
echo "=== 4. Проверка логов на ошибки сертификата ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 50 --nostream 2>&1 | tail -30")
if echo "$LOGS" | grep -qiE "certificate|SSL|TLS|UNABLE_TO_VERIFY|CERT|self.signed"; then
    echo "⚠️  Найдены ошибки, связанные с сертификатом:"
    echo "$LOGS" | grep -iE "certificate|SSL|TLS|UNABLE_TO_VERIFY|CERT|self.signed" | head -5
elif echo "$LOGS" | grep -qiE "opensearch.*отправлено|opensearch.*success|индекс.*создан"; then
    echo "✅ События успешно отправляются в OpenSearch (сертификат работает)"
else
    echo "ℹ️  В логах нет информации о сертификате или OpenSearch отключен"
fi
echo ""

# 5. Итоговая рекомендация
echo "=== 5. Итоговая рекомендация ==="
if echo "$CERT_CHECK" | grep -q "No such file"; then
    echo "❌ СЕРТИФИКАТ НЕ УСТАНОВЛЕН"
    echo ""
    echo "📋 ДЕЙСТВИЯ:"
    echo "   1. Получите CA сертификат от Yandex Cloud"
    echo "   2. Загрузите на Pi: scp root.crt pi@192.168.88.4:~/.opensearch/root.crt"
    echo "   3. Или используйте скрипт: ./scripts/system/install-opensearch-cert-on-pi.sh"
    echo "   4. Перезапустите event-logger: pm2 restart events"
else
    echo "✅ Сертификат установлен"
    if echo "$LOGS" | grep -qiE "opensearch.*отправлено|opensearch.*success"; then
        echo "✅ OpenSearch работает корректно"
    else
        echo "⚠️  Проверьте логи на наличие других ошибок"
    fi
fi

rm -f "$TMP_EXPECT"

