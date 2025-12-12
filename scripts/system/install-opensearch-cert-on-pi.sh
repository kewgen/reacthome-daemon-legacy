#!/bin/bash
# Установка сертификата OpenSearch на Raspberry Pi
# Использование: ./scripts/system/install-opensearch-cert-on-pi.sh

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
echo "Установка сертификата OpenSearch на Raspberry Pi"
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
        set result \$expect_out(buffer)
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

echo "📥 Создание директории для сертификата..."
run_on_pi "mkdir -p ~/.opensearch" || true

echo "📥 Загрузка сертификата..."
run_on_pi "wget -q 'https://storage.yandexcloud.net/cloud-certs/CA.pem' --output-document ~/.opensearch/root.crt && chmod 0600 ~/.opensearch/root.crt && echo 'Certificate installed successfully' || echo 'Failed to install certificate'"

echo "✅ Проверка установки сертификата..."
CERT_CHECK=$(run_on_pi "test -f ~/.opensearch/root.crt && echo EXISTS || echo NOT_FOUND")
if echo "$CERT_CHECK" | grep -q "EXISTS"; then
    echo "✅ Сертификат установлен: ~/.opensearch/root.crt"
    run_on_pi "ls -la ~/.opensearch/root.crt"
else
    echo "❌ Сертификат не найден"
    exit 1
fi

rm -f "$TMP_EXPECT"

echo ""
echo "✅ Установка сертификата завершена"
echo "============================================="
