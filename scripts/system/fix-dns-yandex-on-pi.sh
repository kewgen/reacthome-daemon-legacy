#!/bin/bash
# Настройка DNS Яндекса на Raspberry Pi для разрешения доменов Yandex Cloud
# Использование: ./scripts/system/fix-dns-yandex-on-pi.sh

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
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "🔧 Настройка DNS Яндекса на малинке"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# DNS серверы Яндекса
YANDEX_DNS_PRIMARY="77.88.8.8"
YANDEX_DNS_SECONDARY="77.88.8.1"

echo "DNS серверы Яндекса:"
echo "  Primary:   $YANDEX_DNS_PRIMARY"
echo "  Secondary: $YANDEX_DNS_SECONDARY"
echo ""

# 1. Проверка текущего DNS
echo "=== 1. Проверка текущего DNS ==="
CURRENT_DNS=$(run_on_pi "cat /etc/resolv.conf 2>/dev/null | grep nameserver || echo 'DNS не настроен'")
echo "Текущий DNS:"
echo "$CURRENT_DNS"
echo ""

# 2. Проверка разрешения домена OpenSearch
echo "=== 2. Проверка разрешения домена OpenSearch ==="
OPENSEARCH_DOMAIN="rc1a-6p04qpvk99rvkuhd.mdb.yandexcloud.net"
DNS_TEST=$(run_on_pi "nslookup $OPENSEARCH_DOMAIN $YANDEX_DNS_PRIMARY 2>&1 | head -10 || host $OPENSEARCH_DOMAIN $YANDEX_DNS_PRIMARY 2>&1 | head -5")
if echo "$DNS_TEST" | grep -qiE "Address|has address"; then
    echo "✅ Домен разрешается через DNS Яндекса:"
    echo "$DNS_TEST" | grep -iE "Address|has address" | head -3
else
    echo "⚠️  Домен не разрешается через DNS Яндекса"
    echo "$DNS_TEST"
fi
echo ""

# 3. Настройка DNS через dhcpcd (рекомендуется для Raspberry Pi)
echo "=== 3. Настройка DNS через dhcpcd ==="
echo "Проверка наличия dhcpcd.conf..."

DHCPCD_CHECK=$(run_on_pi "test -f /etc/dhcpcd.conf && echo 'exists' || echo 'not_found'")
if [ "$DHCPCD_CHECK" = "exists" ]; then
    echo "✅ Файл /etc/dhcpcd.conf найден"
    
    # Проверяем, не настроен ли уже DNS Яндекса
    YANDEX_DNS_EXISTS=$(run_on_pi "grep -q '77.88.8.8' /etc/dhcpcd.conf && echo 'exists' || echo 'not_found'")
    
    if [ "$YANDEX_DNS_EXISTS" = "exists" ]; then
        echo "✅ DNS Яндекса уже настроен в dhcpcd.conf"
    else
        echo "📝 Добавление DNS Яндекса в dhcpcd.conf..."
        
        # Создаем команду для добавления DNS
        run_on_pi "sudo bash -c 'echo \"\" >> /etc/dhcpcd.conf && echo \"# Yandex DNS для разрешения доменов Yandex Cloud\" >> /etc/dhcpcd.conf && echo \"static domain_name_servers=$YANDEX_DNS_PRIMARY $YANDEX_DNS_SECONDARY\" >> /etc/dhcpcd.conf'"
        
        echo "✅ DNS Яндекса добавлен в dhcpcd.conf"
        echo ""
        
        echo "=== 4. Перезапуск dhcpcd ==="
        run_on_pi "sudo systemctl restart dhcpcd 2>&1 || sudo service dhcpcd restart 2>&1"
        echo "✅ dhcpcd перезапущен"
        echo ""
        
        echo "Ожидание применения настроек (5 секунд)..."
        sleep 5
    fi
else
    echo "⚠️  Файл /etc/dhcpcd.conf не найден"
    echo "Попробуем настроить через systemd-resolved или resolv.conf"
    
    # Альтернативный способ через systemd-resolved
    SYSTEMD_RESOLVED=$(run_on_pi "systemctl is-active systemd-resolved 2>&1 || echo 'inactive'")
    if [ "$SYSTEMD_RESOLVED" = "active" ]; then
        echo "✅ systemd-resolved активен, настраиваем через него..."
        run_on_pi "sudo bash -c 'echo \"DNS=$YANDEX_DNS_PRIMARY $YANDEX_DNS_SECONDARY\" >> /etc/systemd/resolved.conf'"
        run_on_pi "sudo systemctl restart systemd-resolved"
        echo "✅ DNS настроен через systemd-resolved"
    else
        echo "⚠️  systemd-resolved не активен, используем resolv.conf (временное решение)"
        run_on_pi "sudo bash -c 'echo \"nameserver $YANDEX_DNS_PRIMARY\" > /etc/resolv.conf && echo \"nameserver $YANDEX_DNS_SECONDARY\" >> /etc/resolv.conf'"
        echo "✅ DNS настроен в resolv.conf (может быть перезаписан при перезагрузке)"
    fi
fi

echo ""

# 5. Проверка примененных настроек
echo "=== 5. Проверка примененных настроек ==="
NEW_DNS=$(run_on_pi "cat /etc/resolv.conf 2>/dev/null | grep nameserver || echo 'DNS не найден'")
echo "Новый DNS:"
echo "$NEW_DNS"
echo ""

# 6. Тест разрешения домена
echo "=== 6. Тест разрешения домена OpenSearch ==="
sleep 2
DNS_RESULT=$(run_on_pi "nslookup $OPENSEARCH_DOMAIN 2>&1 | head -10 || host $OPENSEARCH_DOMAIN 2>&1 | head -5")
if echo "$DNS_RESULT" | grep -qiE "Address|has address|62\\.84\\.118"; then
    echo "✅✅✅ УСПЕХ! Домен разрешается:"
    echo "$DNS_RESULT" | grep -iE "Address|has address" | head -3
    DNS_WORKS=true
else
    echo "⚠️  Домен всё ещё не разрешается:"
    echo "$DNS_RESULT"
    DNS_WORKS=false
fi
echo ""

# 7. Проверка подключения к OpenSearch
if [ "$DNS_WORKS" = "true" ]; then
    echo "=== 7. Тест подключения к OpenSearch ==="
    OPENSEARCH_TEST=$(run_on_pi "timeout 5 curl -s -u admin:Stinger1945 -k https://$OPENSEARCH_DOMAIN:9200 2>&1 | head -3 || echo 'Timeout or error'")
    if echo "$OPENSEARCH_TEST" | grep -qiE "cluster_name|name"; then
        echo "✅✅✅ OpenSearch доступен!"
        echo "$OPENSEARCH_TEST"
    else
        echo "⚠️  OpenSearch недоступен или ошибка авторизации"
        echo "$OPENSEARCH_TEST"
    fi
    echo ""
fi

# 8. Перезапуск event-logger для применения изменений
echo "=== 8. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart events 2>&1 > /dev/null"
echo "✅ Event-logger перезапущен"
echo ""

sleep 5

# 9. Проверка логов event-logger
echo "=== 9. Проверка логов event-logger ==="
RECENT_LOGS=$(run_on_pi "pm2 logs events --lines 20 --nostream 2>&1 | tail -20")
if echo "$RECENT_LOGS" | grep -qiE "opensearch.*success|Recovered.*events|индекс.*создан"; then
    echo "✅✅✅ События отправляются в OpenSearch!"
    echo "$RECENT_LOGS" | grep -iE "opensearch|success|Recovered|индекс" | tail -5
elif echo "$RECENT_LOGS" | grep -qiE "ENOTFOUND|getaddrinfo"; then
    echo "⚠️  Всё ещё есть ошибки DNS:"
    echo "$RECENT_LOGS" | grep -iE "ENOTFOUND|getaddrinfo" | tail -3
else
    echo "ℹ️  Логи:"
    echo "$RECENT_LOGS" | tail -10
fi

rm -f "$TMP_EXPECT"

echo ""
echo "=========================================="
echo "✅ Настройка DNS завершена"
echo "=========================================="
echo ""
echo "📋 Рекомендации:"
echo "  • Если DNS не работает, проверьте настройки роутера"
echo "  • Для постоянного решения настройте DNS на роутере MikroTik"
echo "  • Проверьте логи: pm2 logs events"
echo ""
