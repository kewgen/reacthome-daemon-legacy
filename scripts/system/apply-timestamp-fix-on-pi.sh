#!/bin/bash

#
# Применение исправления формата timestamp на Raspberry Pi
#
# Копирует исправленный event-logger-clean.js на малинку и перезапускает процесс
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
LOCAL_FILE="event-logger-clean.js"
REMOTE_FILE="event-logger-clean.js"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

if [ ! -f "$LOCAL_FILE" ]; then
    echo "❌ Ошибка: файл $LOCAL_FILE не найден в текущей директории"
    echo "   Запустите скрипт из корня проекта"
    exit 1
fi

echo "🔧 Применение исправления формата timestamp на Raspberry Pi ($HOST)"
echo ""

# Создаём временный expect скрипт для scp
TMP_EXPECT_SCP=$(mktemp)
cat > "$TMP_EXPECT_SCP" << 'EXPECT_SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $local_file $user@$host:$remote_file
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_SCP_EOF
chmod +x "$TMP_EXPECT_SCP"

# Создаём временный expect скрипт для ssh
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

# Создаём бэкап на малинке
echo "📦 Создание бэкапа на малинке..."
run_on_pi "cd $PROJECT_DIR && cp $REMOTE_FILE ${REMOTE_FILE}.backup.\$(date +%Y%m%d_%H%M%S) && echo '✅ Бэкап создан'"

# Копируем исправленный файл
echo "📤 Копирование исправленного файла на Raspberry Pi..."
"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "${PROJECT_DIR}/${REMOTE_FILE}" "$LOCAL_FILE" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "✅ Файл скопирован"
echo ""

# Проверяем изменения
echo "🔍 Проверка исправлений..."
run_on_pi "cd $PROJECT_DIR && grep -c 'timestamp: new Date().toISOString()' $REMOTE_FILE || echo '0'"

echo ""
echo "🔍 Проверка синтаксиса перед перезапуском..."
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c $REMOTE_FILE 2>&1; echo 'EXIT:'\$?")
if echo "$SYNTAX_CHECK" | grep -q "EXIT:0"; then
    echo "✅ Синтаксис корректен"
else
    echo "❌ Ошибка синтаксиса, отменяем перезапуск:"
    echo "$SYNTAX_CHECK" | grep -v "EXIT:" | head -5
    rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP"
    exit 1
fi

echo ""
echo "🔄 Перезапуск event-logger..."
run_on_pi "cd $PROJECT_DIR && pm2 restart events"

echo ""
echo "⏳ Ожидание 5 секунд для проверки..."
sleep 5

echo ""
echo "📋 Проверка статуса процесса..."
run_on_pi "cd $PROJECT_DIR && pm2 list | grep events"

echo ""
echo "📋 Проверка последних логов (первые 10 строк)..."
run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 10 --nostream 2>&1 | tail -15"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP"

echo ""
echo "=========================================="
echo "✅ Исправление применено"
echo "=========================================="
echo ""
echo "⚠️  Проверьте логи на наличие ошибок timestamp"
echo "   Команда: pm2 logs events --lines 50"
echo ""
