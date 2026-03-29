#!/bin/bash

###############################################################################
# Скрипт для проверки логов устройства на малинке
# Использование: ./scripts/check-device-logs-on-pi.sh <MAC_ADDRESS>
# Зачем: Проверяет логи демона для конкретного устройства
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

MAC_ADDRESS="${1:-60:66:13:b4:aa:df}"
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
LINES="${2:-50}"

if [ -z "$PASS" ]; then
  echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
  exit 1
fi

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
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
echo "║   Проверка логов устройства                                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "MAC адрес: $MAC_ADDRESS"
echo ""

# Нормализуем MAC адрес для поиска (убираем двоеточия)
MAC_SEARCH=$(echo "$MAC_ADDRESS" | tr ':' ' ' | awk '{print $1$2$3$4$5$6}')

echo "📋 Поиск упоминаний устройства в логах демона..."
echo ""

# Проверяем логи демона
echo "=== Последние $LINES строк логов демона ==="
run_on_pi "pm2 logs daemon --lines $LINES --nostream 2>&1 | grep -i '$MAC_ADDRESS\|$MAC_SEARCH' | tail -20"

echo ""
echo "=== Проверка ошибок ==="
run_on_pi "pm2 logs daemon --err --lines 100 --nostream 2>&1 | grep -i '$MAC_ADDRESS\|$MAC_SEARCH\|error\|offline' | tail -10"

echo ""
echo "=== Статус демона ==="
run_on_pi "pm2 list | grep daemon"

# Очистка
rm -f "$TMP_EXPECT"
















