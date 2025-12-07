#!/bin/bash

#
# Очистка файлов, git pull и перезапуск демона на Raspberry Pi
#
# Использование:
#   ./scripts/system/cleanup-and-restart-pi.sh
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

echo "🔧 Очистка, обновление и перезапуск демона на Raspberry Pi ($HOST)"
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

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

echo "=========================================="
echo "1. Поиск файлов, созданных за последние 8 часов"
echo "=========================================="
echo ""

# Находим файлы, созданные за последние 8 часов
FILES_TO_DELETE=$(run_on_pi "cd $PROJECT_DIR && find . -type f -newermt '8 hours ago' ! -path './.git/*' ! -path './node_modules/*' 2>/dev/null | head -50")

if [ -z "$FILES_TO_DELETE" ]; then
    echo "✅ Файлов, созданных за последние 8 часов, не найдено"
else
    echo "📋 Найдено файлов для удаления:"
    echo "$FILES_TO_DELETE" | while read -r file; do
        if [ -n "$file" ]; then
            echo "   - $file"
        fi
    done
    echo ""
    
    echo "🗑️  Удаление файлов..."
    echo "$FILES_TO_DELETE" | while read -r file; do
        if [ -n "$file" ]; then
            run_on_pi "cd $PROJECT_DIR && rm -f \"$file\" 2>&1 && echo 'Удалён: $file' || echo 'Ошибка удаления: $file'"
        fi
    done
    echo ""
    echo "✅ Файлы удалены"
fi
echo ""

echo "=========================================="
echo "2. Git pull"
echo "=========================================="
echo ""

echo "Текущая ветка:"
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "  $CURRENT_BRANCH"
echo ""

echo "Выполнение git pull..."
PULL_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git pull 2>&1")
echo "$PULL_OUTPUT"
echo ""

if echo "$PULL_OUTPUT" | grep -q "Already up to date"; then
    echo "✅ Репозиторий уже актуален"
elif echo "$PULL_OUTPUT" | grep -q "Updating\|Fast-forward\|Merge\|error"; then
    echo "✅ Репозиторий обновлён"
else
    echo "⚠️  Необычный результат git pull"
fi
echo ""

echo "=========================================="
echo "3. Перезапуск демона"
echo "=========================================="
echo ""

echo "3.1 Статус PM2 перед перезапуском:"
run_on_pi "cd $PROJECT_DIR && pm2 list | grep -E 'daemon|reacthome' || echo 'Процессы не найдены'"
echo ""

echo "3.2 Остановка демона..."
run_on_pi "cd $PROJECT_DIR && pm2 stop daemon 2>&1 || pm2 stop reacthome-daemon 2>&1 || echo 'Процесс не найден или уже остановлен'"
sleep 2
echo ""

echo "3.3 Запуск демона..."
run_on_pi "cd $PROJECT_DIR && pm2 start daemon 2>&1 || pm2 start ecosystem.config.js 2>&1 || pm2 restart daemon 2>&1"
sleep 3
echo ""

echo "3.4 Статус PM2 после перезапуска:"
run_on_pi "cd $PROJECT_DIR && pm2 list | grep -E 'daemon|reacthome' || echo 'Процессы не найдены'"
echo ""

echo "3.5 Последние логи (5 строк):"
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 5 --nostream 2>&1 | tail -5 || echo 'Логи недоступны'"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ ВСЕ ОПЕРАЦИИ ЗАВЕРШЕНЫ"
echo "=========================================="
echo ""

