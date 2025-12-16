#!/bin/bash

#
# Скачивание CPU профилей с малинки
#
# Использование:
#   ./scripts/system/download-cpu-profiles-from-pi.sh [process_name] [prof_dir]
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-daemon}"
PROF_DIR="${2:-/tmp/cpu-profiles}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "📥 Скачивание CPU профилей для процесса: $PROCESS_NAME"
echo "📁 Директория на малинке: $PROF_DIR"
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

TMP_EXPECT_SCP=$(mktemp)
cat > "$TMP_EXPECT_SCP" << 'EXPECT_SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host:$remote_file $local_file
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_SCP_EOF
chmod +x "$TMP_EXPECT_SCP"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

# Проверяем наличие профилей
echo "🔍 Поиск CPU профилей..."
PROFILES=$(run_on_pi "ls -1t $PROF_DIR/*.cpuprofile 2>/dev/null | head -10")
if [ -z "$PROFILES" ]; then
    echo "⚠️  CPU профили не найдены в $PROF_DIR"
    echo ""
    echo "Проверьте:"
    echo "  1. Процесс запущен с флагом --cpu-prof?"
    echo "  2. Профили созданы? (они создаются при завершении процесса или вручную)"
    echo ""
    echo "Для создания профиля вручную:"
    echo "  kill -USR2 \$(pm2 pid $PROCESS_NAME)"
    rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP"
    exit 1
fi

echo "✅ Найдены профили:"
echo "$PROFILES" | while read -r profile; do
    echo "   📊 $(basename $profile)"
done
echo ""

# Создаём локальную директорию
LOCAL_OUTPUT_DIR="./reports/cpu-profiles"
mkdir -p "$LOCAL_OUTPUT_DIR"

# Скачиваем профили
echo "📥 Скачивание профилей..."
DOWNLOADED=0
echo "$PROFILES" | while read -r profile; do
    if [ -n "$profile" ]; then
        FILENAME=$(basename "$profile")
        LOCAL_FILE="${LOCAL_OUTPUT_DIR}/${FILENAME}"
        
        "$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "$profile" "$LOCAL_FILE" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
        
        if [ -f "$LOCAL_FILE" ]; then
            echo "   ✅ $FILENAME"
            DOWNLOADED=$((DOWNLOADED + 1))
        else
            echo "   ❌ $FILENAME (ошибка скачивания)"
        fi
    fi
done

echo ""
echo "✅ Профили скачаны в: $LOCAL_OUTPUT_DIR"
echo ""
echo "📊 Для анализа профилей:"
echo "   1. Откройте Chrome: chrome://inspect"
echo "   2. Нажмите 'Open dedicated DevTools for Node'"
echo "   3. Перейдите во вкладку 'Performance'"
echo "   4. Нажмите 'Load profile' и выберите .cpuprofile файл"
echo ""

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP"


