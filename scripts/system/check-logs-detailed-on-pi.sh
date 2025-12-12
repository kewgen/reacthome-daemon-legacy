#!/bin/bash

#
# Детальная проверка логов на Raspberry Pi
#
# Использование:
#   ./scripts/system/check-logs-detailed-on-pi.sh
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

echo "🔍 Детальная проверка логов на Raspberry Pi ($HOST)"
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
echo "2. Последние 100 строк логов демона"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | tail -105"
echo ""

echo "=========================================="
echo "3. Последние 100 строк логов event-logger"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 100 --nostream 2>&1 | tail -105"
echo ""

echo "=========================================="
echo "4. Статистика ошибок в демоне"
echo "=========================================="
echo ""
ERROR_COUNT=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 1000 --nostream 2>&1 | grep -ciE 'error|fatal|exception'")
SQLITE_ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 1000 --nostream 2>&1 | grep -ci 'SqliteError'")
LEVELDB_ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 1000 --nostream 2>&1 | grep -ciE 'LevelDB|leveldb|Cannot open database'")

echo "Всего ошибок (последние 1000 строк): $ERROR_COUNT"
echo "SQLite ошибок: $SQLITE_ERRORS"
echo "LevelDB ошибок: $LEVELDB_ERRORS"
echo ""

echo "=========================================="
echo "5. Уникальные ошибки демона"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 1000 --nostream 2>&1 | grep -iE 'error|fatal|exception' | sed 's/.*error/ERROR/i' | sort | uniq -c | sort -rn | head -10"
echo ""

echo "=========================================="
echo "6. Ошибки event-logger"
echo "=========================================="
echo ""
WS_ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 1000 --nostream 2>&1 | grep -ciE 'WebSocket|ERROR'")
OPENSEARCH_ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 1000 --nostream 2>&1 | grep -ciE 'opensearch.*error|EAI_AGAIN|ETIMEDOUT'")

echo "WebSocket ошибок: $WS_ERRORS"
echo "OpenSearch ошибок: $OPENSEARCH_ERRORS"
echo ""

echo "=========================================="
echo "7. Последние успешные операции"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 200 --nostream 2>&1 | grep -iE 'success|загружено|запущен|started' | tail -5"
echo ""

echo "=========================================="
echo "8. Размеры и статистика файлов логов"
echo "=========================================="
echo ""
echo "PM2 логи:"
run_on_pi "ls -lh ~/.pm2/logs/*.log 2>/dev/null | awk '{print \$5, \$9}'"
echo ""
echo "Логи приложения:"
run_on_pi "cd $PROJECT_DIR && find var/log -type f -exec ls -lh {} \; 2>/dev/null | awk '{print \$5, \$9}'"
echo ""

echo "=========================================="
echo "9. Проверка WebSocket демона"
echo "=========================================="
echo ""
WS_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -iE 'websocket|ws.*start|ws.*listen' | tail -3")
if [ -n "$WS_STATUS" ]; then
    echo "$WS_STATUS"
else
    echo "⚠️  Сообщений о WebSocket не найдено"
fi
echo ""

echo "=========================================="
echo "10. Проверка загрузки LevelDB"
echo "=========================================="
echo ""
DB_LOAD=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE 'DAEMON_LOAD|LevelDB|загружено.*записей' | tail -5")
if [ -n "$DB_LOAD" ]; then
    echo "$DB_LOAD"
else
    echo "⚠️  Сообщений о загрузке БД не найдено"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
echo ""



