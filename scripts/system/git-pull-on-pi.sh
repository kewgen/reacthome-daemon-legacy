#!/bin/bash

#
# Выполнение git pull на Raspberry Pi
#
# Использование:
#   ./scripts/system/git-pull-on-pi.sh [branch_name]
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
BRANCH="${1:-}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🔄 Выполнение git pull на Raspberry Pi ($HOST)"
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
echo "1. Текущая ветка"
echo "=========================================="
echo ""
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "Текущая ветка: $CURRENT_BRANCH"
echo ""

if [ -n "$BRANCH" ] && [ "$BRANCH" != "$CURRENT_BRANCH" ]; then
    echo "=========================================="
    echo "2. Переключение на ветку $BRANCH"
    echo "=========================================="
    echo ""
    run_on_pi "cd $PROJECT_DIR && git checkout $BRANCH"
    echo ""
fi

echo "=========================================="
echo "3. Статус перед pull"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git status --short | head -20"
echo ""

echo "=========================================="
echo "4. Выполнение git pull"
echo "=========================================="
echo ""
PULL_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git pull 2>&1")
echo "$PULL_OUTPUT"
echo ""

echo "=========================================="
echo "5. Статус после pull"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git status --short | head -20"
echo ""

echo "=========================================="
echo "6. Последние коммиты"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git log --oneline -5"
echo ""

rm -f "$TMP_EXPECT"

echo "✅ Git pull завершён"
echo ""

