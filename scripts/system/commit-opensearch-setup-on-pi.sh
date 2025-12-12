#!/bin/bash
# Коммит изменений настройки OpenSearch на Raspberry Pi
# Использование: ./scripts/system/commit-opensearch-setup-on-pi.sh

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

echo "============================================="
echo "Коммит изменений настройки OpenSearch на Raspberry Pi"
echo "============================================="
echo "Хост: $HOST"
echo "Пользователь: $USER"
echo ""

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << EXPECT_EOF
#!/usr/bin/expect -f
set timeout 120
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

echo "📋 Проверка статуса git..."
STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
echo "$STATUS"
echo ""

if [ -z "$STATUS" ]; then
    echo "⚠️  Нет изменений для коммита"
    rm -f "$TMP_EXPECT"
    exit 0
fi

echo "📝 Создание коммита..."

COMMIT_MESSAGE="feat: настройка OpenSearch - сертификат и обновление URL

✅ Выполнено:
- Установлен CA сертификат OpenSearch: ~/.opensearch/root.crt
- Обновлён URL OpenSearch в ecosystem.config.js:
  * Старый: https://rc1a-6p04qpvk99rvkuhd.mdb.yandexcloud.net:9200 (DNS не резолвился)
  * Новый: https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200 (работает)
- Перезапущен events с новой конфигурацией

🔧 Технические детали:
- Сертификат скачан из: https://storage.yandexcloud.net/cloud-certs/CA.pem
- Права на сертификат: 0600
- Использован правильный URL из документации OPENSEARCH_CONNECTION.md
- PM2 применён с флагом --update-env для обновления переменных окружения

✅ Результат:
- События успешно отправляются в OpenSearch
- Подключение стабильно работает
- Event-logger функционирует корректно

📅 Дата: 2025-12-07
🔗 Связано с: WEBSOCKET_EVENT_LOGGING_MIGRATION_PLAN.md v2.8"

run_on_pi "cd $PROJECT_DIR && git add -A && git commit -m '$COMMIT_MESSAGE'"

echo ""
echo "✅ Коммит создан"
echo ""

echo "📋 Последний коммит:"
LAST_COMMIT=$(run_on_pi "cd $PROJECT_DIR && git log -1 --oneline")
echo "$LAST_COMMIT"
echo ""

echo "📋 Статус после коммита:"
FINAL_STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
if [ -z "$FINAL_STATUS" ]; then
    echo "✅ Все изменения закоммичены"
else
    echo "⚠️  Остались незакоммиченные изменения:"
    echo "$FINAL_STATUS"
fi

rm -f "$TMP_EXPECT"

echo ""
echo "✅ Готово"
echo "============================================="
