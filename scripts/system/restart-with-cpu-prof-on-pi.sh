#!/bin/bash

#
# Перезапуск процесса с флагом --cpu-prof для детального профилирования CPU
# После перезапуска процесс будет создавать .cpuprofile файлы автоматически
#
# Использование:
#   ./scripts/system/restart-with-cpu-prof-on-pi.sh [process_name] [prof_dir]
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

echo "🔄 Перезапуск процесса $PROCESS_NAME с CPU профилированием"
echo "📁 Директория для профилей: $PROF_DIR"
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

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

# Проверяем процесс
echo "🔍 Проверка процесса $PROCESS_NAME..."
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep $PROCESS_NAME")
if [ -z "$STATUS" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Процесс найден"
echo ""

# Создаём директорию для профилей
echo "📁 Создание директории для профилей..."
run_on_pi "mkdir -p $PROF_DIR"

# Перезапускаем процесс с флагом --cpu-prof
echo "🔄 Перезапуск процесса с флагом --cpu-prof..."
echo "   Это включит автоматическое создание .cpuprofile файлов"
echo ""

run_on_pi "cd $PROJECT_DIR && pm2 restart $PROCESS_NAME --update-env --node-args='--cpu-prof --cpu-prof-dir=$PROF_DIR'"

echo ""
echo "⏳ Ожидание запуска процесса..."
sleep 3

# Проверяем статус
echo "📊 Статус процесса:"
run_on_pi "cd $PROJECT_DIR && pm2 info $PROCESS_NAME | head -20"

echo ""
echo "✅ Процесс перезапущен с CPU профилированием"
echo ""
echo "📝 Важно:"
echo "   • Процесс теперь создаёт .cpuprofile файлы в $PROF_DIR"
echo "   • Файлы создаются автоматически при завершении процесса или вручную"
echo "   • Для остановки профилирования перезапустите без флага:"
echo "     pm2 restart $PROCESS_NAME"
echo ""
echo "📥 Для скачивания профилей используйте:"
echo "   ./scripts/system/download-cpu-profiles-from-pi.sh $PROCESS_NAME"
echo ""

rm -f "$TMP_EXPECT"

