#!/bin/bash

###############################################################################
# Скрипт для запуска мониторинга изменений БД на малинке
# Использование: ./scripts/monitor-db-changes-on-pi.sh [интервал_секунд]
# Зачем: Запускает мониторинг изменений БД на малинке и выводит изменения в реальном времени
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

INTERVAL_SEC="${1:-5}"
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
REMOTE_PROJECT_DIR="/home/pi/reacthome-daemon"

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
echo "║   Запуск мониторинга изменений БД на малинке                 ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Интервал проверки: ${INTERVAL_SEC} секунд"
echo ""

# Останавливаем демон для доступа к БД
echo "🛑 Остановка демона для доступа к БД..."
run_on_pi "pm2 stop daemon" > /dev/null 2>&1 || true
sleep 2

# Копируем скрипт мониторинга на малинку
echo "📋 Копирование скрипта мониторинга на малинку..."
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$PROJECT_DIR/scripts/monitor-db-changes.js" $USER@$HOST:/tmp/monitor-db-changes.js
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
EOF

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при копировании скрипта"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Скрипт скопирован"
echo ""
echo "🔄 Запуск мониторинга..."
echo "   Нажмите Ctrl+C для остановки"
echo ""

# Запускаем мониторинг
run_on_pi "cd $REMOTE_PROJECT_DIR && NODE_PATH=./node_modules node /tmp/monitor-db-changes.js var/db $INTERVAL_SEC"

# После завершения перезапускаем демон
echo ""
echo "🔄 Перезапуск демона..."
run_on_pi "pm2 restart daemon" > /dev/null 2>&1 || true
sleep 2

# Очистка
rm -f "$TMP_EXPECT"
run_on_pi "rm -f /tmp/monitor-db-changes.js" 2>/dev/null || true

echo "✅ Готово"












