#!/bin/bash

#
# Применение логирования операций db.del() на Raspberry Pi
# Копирует обновлённый файл db.js на малинку и перезапускает демон
# Зачем: Добавляет логирование всех удалений из БД для отслеживания источника потери данных
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
LOCAL_FILE="src/db.js"
REMOTE_FILE="$PROJECT_DIR/src/db.js"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

if [ ! -f "$LOCAL_FILE" ]; then
    echo "❌ Ошибка: файл не найден: $LOCAL_FILE"
    exit 1
fi

echo "🔧 Применение логирования операций db.del()"
echo "   Файл: $LOCAL_FILE"
echo "   Хост: $HOST"
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
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

copy_to_pi() {
    local local_file="$1"
    local remote_file="$2"
    expect << EOF
set timeout 60
set local_file "$local_file"
set remote_file "$remote_file"
set user "$USER"
set host "$HOST"
set pass "$PASS"
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \$local_file \$user@\$host:\$remote_file
expect {
    "*assword:" {
        send "\$pass\r"
        exp_continue
    }
    eof
}
EOF
}

cleanup() {
    rm -f "$TMP_EXPECT"
}
trap cleanup EXIT

# Шаг 1: Копирование файла
echo "1. Копирование обновлённого файла на малинку..."
copy_to_pi "$LOCAL_FILE" "$REMOTE_FILE"
if [ $? -eq 0 ]; then
    echo "   ✅ Файл скопирован"
else
    echo "   ❌ Ошибка при копировании файла"
    exit 1
fi

# Шаг 2: Проверка файла на малинке
echo ""
echo "2. Проверка файла на малинке..."
FILE_EXISTS=$(run_on_pi "test -f $REMOTE_FILE && echo 'yes' || echo 'no'")
if [ "$FILE_EXISTS" = "yes" ]; then
    echo "   ✅ Файл существует"
else
    echo "   ❌ Файл не найден на малинке"
    exit 1
fi

# Шаг 3: Проверка синтаксиса на малинке
echo ""
echo "3. Проверка синтаксиса файла на малинке..."
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c src/db.js 2>&1")
if [ $? -eq 0 ]; then
    echo "   ✅ Синтаксис корректен"
else
    echo "   ❌ Ошибка синтаксиса:"
    echo "$SYNTAX_CHECK"
    exit 1
fi

# Шаг 4: Перезапуск демона
echo ""
echo "4. Перезапуск демона..."
run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1"
sleep 3

# Шаг 5: Проверка статуса
echo ""
echo "5. Проверка статуса демона..."
DAEMON_STATUS=$(run_on_pi "pm2 list | grep daemon")
echo "$DAEMON_STATUS"

# Шаг 6: Проверка логов на наличие логирования
echo ""
echo "6. Проверка логов на наличие логирования db.del()..."
LOGGING_CHECK=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 20 --nostream 2>&1 | grep -i 'DB DELETE' | head -3")
if [ -n "$LOGGING_CHECK" ]; then
    echo "   ✅ Логирование работает (найдены записи):"
    echo "$LOGGING_CHECK"
else
    echo "   ℹ️  Логирование настроено, но пока нет операций удаления"
    echo "   Все будущие операции db.del() будут логироваться"
fi

echo ""
echo "=========================================="
echo "✅ Логирование db.del() применено!"
echo "=========================================="
echo ""
echo "Теперь все операции удаления из БД будут логироваться"
echo "с указанием ключа и стека вызовов."
echo ""
echo "Для мониторинга используйте:"
echo "  pm2 logs daemon | grep 'DB DELETE'"
echo ""






