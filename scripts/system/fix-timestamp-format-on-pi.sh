#!/bin/bash

#
# Исправление формата timestamp в event-logger на Raspberry Pi
#
# Проблема: timestamp отправляется как число (Date.now()), 
# но OpenSearch ожидает дату в формате ISO 8601
#
# Решение: заменить Date.now() на new Date().toISOString()
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
EVENT_LOGGER_FILE="event-logger-clean.js"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🔧 Исправление формата timestamp в event-logger на Raspberry Pi ($HOST)"
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

# Создаём скрипт для исправления
FIX_SCRIPT=$(mktemp)
cat > "$FIX_SCRIPT" << 'SCRIPT_EOF'
#!/bin/bash
cd "$PROJECT_DIR" || exit 1

FILE="$EVENT_LOGGER_FILE"
BACKUP="${FILE}.backup.$(date +%Y%m%d_%H%M%S)"

echo "📋 Проверка файла $FILE..."

if [ ! -f "$FILE" ]; then
    echo "❌ Файл $FILE не найден"
    exit 1
fi

# Создаём бэкап
cp "$FILE" "$BACKUP"
echo "✅ Создан бэкап: $BACKUP"

# Исправляем timestamp в событиях (но не в кэше)
# Заменяем только timestamp: Date.now() в объектах событий
sed -i.tmp 's/timestamp: Date\.now(),/timestamp: new Date().toISOString(),/g' "$FILE"

# Проверяем результат
CHANGES=$(grep -c "timestamp: new Date().toISOString()" "$FILE" || echo "0")
echo "✅ Исправлено мест: $CHANGES"

if [ "$CHANGES" -eq "0" ]; then
    echo "⚠️  Изменения не найдены, возможно уже исправлено"
    rm -f "$BACKUP"
else
    echo "✅ Исправление применено"
    rm -f "${FILE}.tmp"
fi

SCRIPT_EOF

# Копируем скрипт на малинку
echo "📤 Копирование скрипта на Raspberry Pi..."
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

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/fix-timestamp.sh" "$FIX_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "✅ Скрипт скопирован"
echo ""

# Запускаем скрипт на малинке
echo "🚀 Применение исправления..."
echo ""

run_on_pi "cd $PROJECT_DIR && chmod +x /tmp/fix-timestamp.sh && PROJECT_DIR='$PROJECT_DIR' EVENT_LOGGER_FILE='$EVENT_LOGGER_FILE' bash /tmp/fix-timestamp.sh && rm -f /tmp/fix-timestamp.sh"

echo ""
echo "🔄 Перезапуск event-logger..."
run_on_pi "cd $PROJECT_DIR && pm2 restart events"

echo ""
echo "⏳ Ожидание 3 секунды для проверки логов..."
sleep 3

echo ""
echo "📋 Проверка логов на ошибки timestamp..."
run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 20 --nostream 2>&1 | tail -25 | grep -iE 'timestamp|error' || echo '✅ Ошибок не найдено'"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$FIX_SCRIPT"

echo ""
echo "=========================================="
echo "✅ Исправление формата timestamp завершено"
echo "=========================================="
echo ""
