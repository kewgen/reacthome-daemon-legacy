#!/bin/bash

###############################################################################
# Скрипт для проверки сетевой доступности устройства
# Использование: ./scripts/ping-device-on-pi.sh <IP_ADDRESS>
# Зачем: Проверяет, доступно ли устройство по сети
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

IP_ADDRESS="${1:-172.16.0.5}"
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"

if [ -z "$PASS" ]; then
  echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
  exit 1
fi

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 30
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>&1 | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   Проверка сетевой доступности устройства                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "IP адрес: $IP_ADDRESS"
echo ""

echo "📡 Проверка доступности устройства..."
run_on_pi "ping -c 3 -W 2 $IP_ADDRESS 2>&1"

echo ""
echo "🔍 Проверка ARP таблицы..."
run_on_pi "arp -a | grep $IP_ADDRESS || echo 'Устройство не найдено в ARP таблице'"

# Очистка
rm -f "$TMP_EXPECT"
















