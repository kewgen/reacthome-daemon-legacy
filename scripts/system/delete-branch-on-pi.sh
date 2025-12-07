#!/bin/bash

#
# Удаление ветки из remote на Raspberry Pi
#
# Использование:
#   ./scripts/system/delete-branch-on-pi.sh <branch-name>
#
# Пример:
#   ./scripts/system/delete-branch-on-pi.sh websocket-logger
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$1" ]; then
    echo "❌ Ошибка: не указано имя ветки"
    echo "   Использование: $0 <branch-name>"
    exit 1
fi

BRANCH_NAME="$1"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🗑️  Удаление ветки '$BRANCH_NAME' из remote на Raspberry Pi ($HOST)"
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

echo "Проверка существования ветки в remote..."
REMOTE_BRANCHES=$(run_on_pi "cd $PROJECT_DIR && git ls-remote --heads origin 2>&1")
if echo "$REMOTE_BRANCHES" | grep -q "refs/heads/$BRANCH_NAME"; then
    echo "✅ Ветка '$BRANCH_NAME' найдена в remote"
    echo ""
    echo "Удаление ветки..."
    RESULT=$(run_on_pi "cd $PROJECT_DIR && git push origin --delete $BRANCH_NAME 2>&1")
    echo "$RESULT"
    
    # Проверяем результат
    if echo "$RESULT" | grep -q "deleted\|deleted:"; then
        echo ""
        echo "✅ Ветка '$BRANCH_NAME' успешно удалена из remote"
    else
        echo ""
        echo "⚠️  Возможна ошибка при удалении. Проверьте вывод выше."
    fi
else
    echo "⚠️  Ветка '$BRANCH_NAME' не найдена в remote"
    echo ""
    echo "Доступные ветки в remote:"
    echo "$REMOTE_BRANCHES" | grep "refs/heads/" | sed 's/.*refs\/heads\///' || echo "  (не удалось получить список)"
fi

rm -f "$TMP_EXPECT"

echo ""
echo "=========================================="
echo "✅ Операция завершена"
echo "=========================================="
