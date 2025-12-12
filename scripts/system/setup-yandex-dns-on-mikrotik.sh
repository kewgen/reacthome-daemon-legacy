#!/bin/bash
# Настройка DNS Яндекса на роутере MikroTik
# Использование: ./scripts/system/setup-yandex-dns-on-mikrotik.sh [ROUTER_IP] [USERNAME] [PASSWORD]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Параметры подключения к MikroTik
ROUTER_IP="${1:-192.168.88.1}"
ROUTER_USER="${2:-admin}"
ROUTER_PASS="${3:-}"

# DNS серверы Яндекса
YANDEX_DNS_PRIMARY="77.88.8.8"
YANDEX_DNS_SECONDARY="77.88.8.1"

# Если пароль не указан, запрашиваем
if [ -z "$ROUTER_PASS" ]; then
    echo "Введите пароль для MikroTik (${ROUTER_USER}@${ROUTER_IP}):"
    read -s ROUTER_PASS
    echo ""
fi

echo "=========================================="
echo "🔧 Настройка DNS Яндекса на MikroTik"
echo "=========================================="
echo "Роутер: ${ROUTER_USER}@${ROUTER_IP}"
echo "DNS серверы Яндекса:"
echo "  Primary:   $YANDEX_DNS_PRIMARY"
echo "  Secondary: $YANDEX_DNS_SECONDARY"
echo ""

# Проверка доступности роутера
echo "=== 1. Проверка доступности роутера ==="
if ping -c 1 -W 2 "$ROUTER_IP" > /dev/null 2>&1; then
    echo "✅ Роутер доступен: $ROUTER_IP"
else
    echo "❌ Роутер недоступен: $ROUTER_IP"
    echo "Проверьте IP адрес и доступность роутера"
    exit 1
fi
echo ""

# Проверка наличия sshpass или expect
if command -v sshpass > /dev/null 2>&1; then
    USE_SSHPASS=true
elif command -v expect > /dev/null 2>&1; then
    USE_SSHPASS=false
else
    echo "❌ Ошибка: требуется sshpass или expect"
    echo "Установите: brew install sshpass (macOS) или apt-get install sshpass (Linux)"
    exit 1
fi

# Функция для выполнения команд на MikroTik
run_on_mikrotik() {
    local cmd="$1"
    
    if [ "$USE_SSHPASS" = true ]; then
        sshpass -p "$ROUTER_PASS" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            -o ConnectTimeout=5 \
            "${ROUTER_USER}@${ROUTER_IP}" "$cmd" 2>/dev/null || return 1
    else
        expect << EOF
set timeout 10
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 ${ROUTER_USER}@${ROUTER_IP} "$cmd"
expect {
    "*assword:" { send "$ROUTER_PASS\r"; exp_continue }
    eof
}
EOF
    fi
}

# 2. Проверка текущих DNS настроек
echo "=== 2. Проверка текущих DNS настроек ==="
CURRENT_DNS=$(run_on_mikrotik "/ip dns print" 2>&1 | grep -E "servers|allow-remote" || echo "")
if [ -n "$CURRENT_DNS" ]; then
    echo "Текущие настройки DNS:"
    echo "$CURRENT_DNS"
else
    echo "⚠️  Не удалось получить текущие настройки DNS"
fi
echo ""

# 3. Настройка DNS серверов Яндекса
echo "=== 3. Настройка DNS серверов Яндекса ==="
echo "Устанавливаем DNS серверы: $YANDEX_DNS_PRIMARY, $YANDEX_DNS_SECONDARY"

DNS_SET_RESULT=$(run_on_mikrotik "/ip dns set servers=${YANDEX_DNS_PRIMARY},${YANDEX_DNS_SECONDARY}" 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ DNS серверы установлены"
else
    echo "❌ Ошибка установки DNS серверов"
    echo "$DNS_SET_RESULT"
    exit 1
fi
echo ""

# 4. Включение разрешения DNS запросов (если нужно)
echo "=== 4. Настройка разрешения DNS запросов ==="
ALLOW_REMOTE=$(run_on_mikrotik "/ip dns print" 2>&1 | grep -oE "allow-remote: (yes|no)" || echo "")
if echo "$ALLOW_REMOTE" | grep -q "allow-remote: no"; then
    echo "Включаем allow-remote для DNS..."
    run_on_mikrotik "/ip dns set allow-remote=yes" 2>&1 > /dev/null
    echo "✅ allow-remote включен"
else
    echo "ℹ️  allow-remote уже настроен"
fi
echo ""

# 5. Очистка DNS кэша
echo "=== 5. Очистка DNS кэша ==="
CACHE_FLUSH=$(run_on_mikrotik "/ip dns cache flush" 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ DNS кэш очищен"
else
    echo "⚠️  Не удалось очистить кэш (это нормально)"
fi
echo ""

# 6. Проверка примененных настроек
echo "=== 6. Проверка примененных настроек ==="
NEW_DNS=$(run_on_mikrotik "/ip dns print" 2>&1 | grep -E "servers|allow-remote" || echo "")
if [ -n "$NEW_DNS" ]; then
    echo "Новые настройки DNS:"
    echo "$NEW_DNS"
    
    if echo "$NEW_DNS" | grep -q "$YANDEX_DNS_PRIMARY"; then
        echo "✅ DNS Яндекса успешно настроен!"
    else
        echo "⚠️  DNS серверы не найдены в настройках"
    fi
else
    echo "⚠️  Не удалось получить новые настройки"
fi
echo ""

# 7. Тест разрешения домена OpenSearch
echo "=== 7. Тест разрешения домена OpenSearch ==="
OPENSEARCH_DOMAIN="rc1a-6p04qpvk99rvkuhd.mdb.yandexcloud.net"
DNS_TEST=$(run_on_mikrotik "/ip dns print detail" 2>&1 | head -5)
echo "Проверка DNS настроек:"
echo "$DNS_TEST"
echo ""

# Тест через resolve
RESOLVE_TEST=$(run_on_mikrotik "/ip dns print detail" 2>&1)
echo "Для проверки разрешения домена выполните на роутере:"
echo "  /ip dns cache print"
echo "  /resolve ${OPENSEARCH_DOMAIN}"
echo ""

# 8. Сохранение конфигурации
echo "=== 8. Сохранение конфигурации ==="
SAVE_RESULT=$(run_on_mikrotik "/system backup save name=dns-yandex-backup" 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ Резервная копия создана: dns-yandex-backup.backup"
else
    echo "⚠️  Не удалось создать резервную копию (это нормально)"
fi

# Сохранение конфигурации
SAVE_CONFIG=$(run_on_mikrotik "/system backup save" 2>&1)
echo "ℹ️  Для сохранения конфигурации выполните на роутере:"
echo "  /system backup save"
echo ""

echo "=========================================="
echo "✅ Настройка DNS завершена"
echo "=========================================="
echo ""
echo "📋 Следующие шаги:"
echo ""
echo "1. Проверьте DNS на малинке:"
echo "   ssh pi@192.168.88.4 'cat /etc/resolv.conf'"
echo "   Должно быть: nameserver 77.88.8.8"
echo ""
echo "2. Перезапустите event-logger:"
echo "   ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 restart events'"
echo ""
echo "3. Проверьте логи:"
echo "   ssh pi@192.168.88.4 'pm2 logs events --lines 30'"
echo ""
echo "4. Проверьте разрешение домена на роутере:"
echo "   ssh ${ROUTER_USER}@${ROUTER_IP} '/resolve ${OPENSEARCH_DOMAIN}'"
echo ""
