#!/bin/bash

#
# Остановка event-logger на Raspberry Pi
#
# Использование:
#   ./scripts/system/stop-event-logger-on-pi.sh
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🛑 Остановка event-logger на Raspberry Pi ($HOST)"
echo ""

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
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

echo "=========================================="
echo "1. Статус перед остановкой"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 list | grep -E 'events|event-logger' || echo 'Процесс не найден'"
echo ""

echo "=========================================="
echo "2. Остановка event-logger"
echo "=========================================="
echo ""

# Останавливаем процесс events
run_on_pi "cd $PROJECT_DIR && pm2 stop events 2>&1 || echo 'Процесс не найден'"
echo ""

sleep 2

echo "=========================================="
echo "3. Статус после остановки"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 list"
echo ""

echo "=========================================="
echo "4. Удаление процесса из PM2 (опционально)"
echo "=========================================="
echo ""
read -p "Удалить процесс из PM2? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1 || echo 'Процесс не найден'"
    echo ""
    echo "Статус после удаления:"
    run_on_pi "cd $PROJECT_DIR && pm2 list"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Остановка завершена"
echo "=========================================="
echo ""



