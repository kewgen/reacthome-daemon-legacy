#!/bin/bash

#
# Проверка git remote репозитория на Raspberry Pi
#
# Использование:
#   ./scripts/system/check-git-remote-on-pi.sh
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

echo "🔍 Проверка git remote на Raspberry Pi ($HOST)"
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
echo "1. Git remote репозитории"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git remote -v"
echo ""

echo "=========================================="
echo "2. Текущая ветка"
echo "=========================================="
echo ""
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "Текущая ветка: $CURRENT_BRANCH"
echo ""

echo "=========================================="
echo "3. Отслеживание веток"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git branch -vv"
echo ""

echo "=========================================="
echo "4. Последний коммит"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git log --oneline -1"
echo ""

echo "=========================================="
echo "5. Статус репозитория"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git status --short"
echo ""

# Очистка
rm -f "$TMP_EXPECT"

echo "✅ Проверка завершена"













