#!/bin/bash

#
# Миграция event-logger в daemon
# Останавливает отдельный процесс event-logger и перезапускает daemon с встроенным логированием
#
# Использование:
#   ./scripts/system/migrate-event-logger-to-daemon.sh
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

echo "🔄 Миграция event-logger в daemon на Raspberry Pi ($HOST)"
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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

echo "=========================================="
echo "1. Проверка текущего статуса PM2"
echo "=========================================="
echo ""
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status")
echo "$STATUS"
echo ""

# Проверяем, запущен ли event-logger
EVENT_LOGGER_RUNNING=$(echo "$STATUS" | grep events" && echo "yes" || echo "no")

if [ "$EVENT_LOGGER_RUNNING" = "no" ]; then
    echo "⚠️  Процесс events не найден в PM2"
    echo "   Возможно, он уже остановлен или не был запущен"
    echo ""
else
    echo "=========================================="
    echo "2. Остановка отдельного процесса event-logger"
    echo "=========================================="
    echo ""
    STOP_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 stop events 2>&1")
    echo "$STOP_OUT"
    echo ""
    
    echo "=========================================="
    echo "3. Удаление процесса event-logger из PM2"
    echo "=========================================="
    echo ""
    DELETE_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1")
    echo "$DELETE_OUT"
    echo ""
fi

echo "=========================================="
echo "4. Проверка наличия модулей логирования"
echo "=========================================="
echo ""
LOGGING_MODULE=$(run_on_pi "cd $PROJECT_DIR && test -f src/logging/event-log.js && echo 'exists' || echo 'not found'")
echo "Модуль src/logging/event-log.js: $LOGGING_MODULE"

if [ "$LOGGING_MODULE" = "not found" ]; then
    echo ""
    echo "⚠️  ВНИМАНИЕ: Модуль логирования не найден!"
    echo "   Логирование событий будет работать только если модули находятся на сервере"
    echo "   Проверьте наличие файлов:"
    echo "   - src/logging/event-log.js"
    echo "   - src/logging/opensearch.js"
    echo "   - src/logging/filters.js"
    echo ""
    read -p "Продолжить миграцию? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Миграция отменена"
        rm -f "$TMP_EXPECT"
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "5. Перезапуск daemon с встроенным логированием"
echo "=========================================="
echo ""
RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1")
echo "$RESTART_OUT"
echo ""

echo "=========================================="
echo "6. Ожидание запуска daemon (5 секунд)"
echo "=========================================="
echo ""
sleep 5

echo "=========================================="
echo "7. Проверка статуса PM2"
echo "=========================================="
echo ""
FINAL_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status")
echo "$FINAL_STATUS"
echo ""

echo "=========================================="
echo "8. Проверка логов daemon (последние 20 строк)"
echo "=========================================="
echo ""
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 20 --nostream 2>&1 | tail -20")
echo "$LOGS"
echo ""

# Проверяем, упоминается ли логирование в логах
if echo "$LOGS" | grep -q "логирование\|logging\|event-log"; then
    echo "✅ Логирование событий упоминается в логах daemon"
else
    echo "⚠️  Логирование событий не упоминается в логах"
    echo "   Возможно, модули логирования не загружены"
fi
echo ""

echo "=========================================="
echo "9. Сохранение конфигурации PM2"
echo "=========================================="
echo ""
SAVE_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1")
echo "$SAVE_OUT"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Миграция завершена"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Проверьте логи daemon: pm2 logs daemon --lines 50"
echo "2. Убедитесь, что события логируются (проверьте наличие сообщений о логировании)"
echo "3. Проверьте отправку событий в OpenSearch (если настроено)"
echo "4. Удалите файл event-logger.js, если он больше не нужен"
echo ""

