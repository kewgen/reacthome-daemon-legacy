#!/bin/bash

#
# Удаление избыточных отладочных логов из функции getHumanName в event-log.js
#
# Проблема: функция getHumanName выводит избыточную отладочную информацию,
# засоряя логи event-logger
#
# Решение: удалить все console.log внутри функции getHumanName
#

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

echo "🔧 Исправление избыточных логов getHumanName на Raspberry Pi ($HOST)"
echo ""

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "1. Создание резервной копии"
echo "=========================================="
BACKUP_RESULT=$(run_on_pi "cd $PROJECT_DIR/src/logging && cp event-log.js event-log.js.backup-\$(date +%Y%m%d-%H%M%S) && echo 'Резервная копия создана'")
echo "$BACKUP_RESULT"
echo ""

echo "=========================================="
echo "2. Удаление отладочных логов getHumanName"
echo "=========================================="
# Используем sed для удаления строк с console.log внутри getHumanName
# Стратегия: закомментировать строки с console.log, которые содержат [getHumanName]
FIX_RESULT=$(run_on_pi "cd $PROJECT_DIR/src/logging && sed -i 's/^\\(.*console\\.log.*\\[getHumanName\\].*\\)$/\\/\\/ \\1/' event-log.js && sed -i 's/^\\(.*console\\.log.*Результат без.*\\)$/\\/\\/ \\1/' event-log.js && sed -i 's/^\\(.*console\\.log.*Объект:.*\\)$/\\/\\/ \\1/' event-log.js && echo 'Логи закомментированы'")
echo "$FIX_RESULT"
echo ""

echo "=========================================="
echo "3. Проверка синтаксиса"
echo "=========================================="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c src/logging/event-log.js && echo '✅ Синтаксис корректен' || echo '❌ Ошибка синтаксиса'")
echo "$SYNTAX_CHECK"
echo ""

if echo "$SYNTAX_CHECK" | grep -q "❌"; then
    echo "=========================================="
    echo "ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ"
    echo "=========================================="
    RESTORE_RESULT=$(run_on_pi "cd $PROJECT_DIR/src/logging && ls -t event-log.js.backup-* | head -1 | xargs -I {} cp {} event-log.js && echo 'Файл восстановлен из резервной копии'")
    echo "$RESTORE_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "=========================================="
echo "4. Перезапуск events"
echo "=========================================="
RESTART_RESULT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart events && echo 'Процесс перезапущен'")
echo "$RESTART_RESULT"
echo ""

echo "=========================================="
echo "5. Проверка логов (первые 20 строк)"
echo "=========================================="
sleep 3
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 20 --nostream 2>&1 | tail -20")
echo "$LOGS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="
echo ""
echo "Проверьте логи, чтобы убедиться, что избыточные сообщения"
echo "[getHumanName] больше не появляются"
echo ""
