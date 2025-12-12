#!/bin/bash

#
# Проверка логов на Raspberry Pi
#
# Использование:
#   ./scripts/system/check-logs-on-pi.sh
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

echo "🔍 Проверка логов на Raspberry Pi ($HOST)"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
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
echo "1. Статус PM2 процессов"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 list"
echo ""

echo "=========================================="
echo "2. Последние логи демона (50 строк)"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | tail -55"
echo ""

echo "=========================================="
echo "3. Последние логи event-logger (50 строк)"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 50 --nostream 2>&1 | tail -55"
echo ""

echo "=========================================="
echo "4. Критические ошибки в логах демона"
echo "=========================================="
echo ""
ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 500 --nostream 2>&1 | grep -iE 'error|fatal|exception|fail' | tail -20")
if [ -n "$ERRORS" ]; then
    echo "$ERRORS"
else
    echo "✅ Критических ошибок не найдено"
fi
echo ""

echo "=========================================="
echo "5. Критические ошибки в логах event-logger"
echo "=========================================="
echo ""
ERRORS_LOGGER=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 500 --nostream 2>&1 | grep -iE 'error|fatal|exception|fail' | tail -20")
if [ -n "$ERRORS_LOGGER" ]; then
    echo "$ERRORS_LOGGER"
else
    echo "✅ Критических ошибок не найдено"
fi
echo ""

echo "=========================================="
echo "6. Размеры файлов логов PM2"
echo "=========================================="
echo ""
run_on_pi "ls -lh ~/.pm2/logs/*.log 2>/dev/null | awk '{print \$5, \$9}' | head -20"
echo ""

echo "=========================================="
echo "7. Размеры логов приложения"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && find var/log -type f -exec ls -lh {} \; 2>/dev/null | awk '{print \$5, \$9}' | head -20"
echo ""

echo "=========================================="
echo "8. Статистика логов демона"
echo "=========================================="
echo ""
TOTAL_LINES=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 10000 --nostream 2>&1 | wc -l")
ERROR_COUNT=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 10000 --nostream 2>&1 | grep -iE 'error|fatal|exception' | wc -l")
WARN_COUNT=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 10000 --nostream 2>&1 | grep -iE 'warn|warning' | wc -l")

echo "Всего строк в последних логах: $TOTAL_LINES"
echo "Ошибок: $ERROR_COUNT"
echo "Предупреждений: $WARN_COUNT"
echo ""

echo "=========================================="
echo "9. Последние предупреждения"
echo "=========================================="
echo ""
WARNINGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 500 --nostream 2>&1 | grep -iE 'warn|warning' | tail -10")
if [ -n "$WARNINGS" ]; then
    echo "$WARNINGS"
else
    echo "⚠️  Предупреждений не найдено"
fi
echo ""

echo "=========================================="
echo "10. Проверка записи событий"
echo "=========================================="
echo ""
EVENT_LOG=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE 'event-log|opensearch' | tail -10")
if [ -n "$EVENT_LOG" ]; then
    echo "$EVENT_LOG"
else
    echo "ℹ️  Сообщений о записи событий не найдено"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка логов завершена"
echo "=========================================="
echo ""

