#!/bin/bash

#
# Переключение git remote репозитория на Raspberry Pi
#
# Использование:
#   ./scripts/system/switch-remote-on-pi.sh [sourcecraft|github]
#
# Зачем: Позволяет переключаться между SourceCraft и GitHub как основным remote
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

# Параметры remote
SOURCECRAFT_REPO="ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git"
GITHUB_REPO="git@github.com:gev/reacthome-daemon-legacy.git"

# Определяем целевой remote
TARGET="${1:-}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

if [ -z "$TARGET" ]; then
    echo "❌ Ошибка: не указан целевой remote"
    echo ""
    echo "Использование:"
    echo "  ./scripts/system/switch-remote-on-pi.sh [sourcecraft|github]"
    echo ""
    echo "Примеры:"
    echo "  ./scripts/system/switch-remote-on-pi.sh sourcecraft  # Переключить на SourceCraft"
    echo "  ./scripts/system/switch-remote-on-pi.sh github        # Переключить на GitHub"
    exit 1
fi

if [ "$TARGET" != "sourcecraft" ] && [ "$TARGET" != "github" ]; then
    echo "❌ Ошибка: неверный remote. Используйте 'sourcecraft' или 'github'"
    exit 1
fi

echo "🔄 Переключение git remote на Raspberry Pi ($HOST)"
echo "Целевой remote: $TARGET"
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
echo "1. Текущие remote репозитории"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git remote -v"
echo ""

echo "=========================================="
echo "2. Добавление remote (если нужно)"
echo "=========================================="
echo ""

# Проверяем наличие remote
HAS_SOURCECRAFT=$(run_on_pi "cd $PROJECT_DIR && git remote get-url sourcecraft 2>/dev/null || echo 'not-found'")
HAS_GITHUB=$(run_on_pi "cd $PROJECT_DIR && git remote get-url github 2>/dev/null || echo 'not-found'")

if [ "$HAS_SOURCECRAFT" = "not-found" ]; then
    echo "Добавление remote 'sourcecraft'..."
    run_on_pi "cd $PROJECT_DIR && git remote add sourcecraft $SOURCECRAFT_REPO"
    echo "✅ Remote 'sourcecraft' добавлен"
else
    echo "✅ Remote 'sourcecraft' уже существует"
fi

if [ "$HAS_GITHUB" = "not-found" ]; then
    echo "Добавление remote 'github'..."
    run_on_pi "cd $PROJECT_DIR && git remote add github $GITHUB_REPO"
    echo "✅ Remote 'github' добавлен"
else
    echo "✅ Remote 'github' уже существует"
fi
echo ""

echo "=========================================="
echo "3. Переключение origin на $TARGET"
echo "=========================================="
echo ""

if [ "$TARGET" = "sourcecraft" ]; then
    NEW_URL="$SOURCECRAFT_REPO"
    OTHER_REMOTE="github"
else
    NEW_URL="$GITHUB_REPO"
    OTHER_REMOTE="sourcecraft"
fi

# Удаляем старый origin если он существует
run_on_pi "cd $PROJECT_DIR && git remote remove origin 2>/dev/null || true"

# Устанавливаем новый origin
run_on_pi "cd $PROJECT_DIR && git remote add origin $NEW_URL"

# Обновляем URL если remote уже был
run_on_pi "cd $PROJECT_DIR && git remote set-url origin $NEW_URL"

echo "✅ Origin переключен на $TARGET"
echo ""

echo "=========================================="
echo "4. Проверка результата"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git remote -v"
echo ""

echo "=========================================="
echo "5. Обновление отслеживания веток"
echo "=========================================="
echo ""

CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "Текущая ветка: $CURRENT_BRANCH"

# Обновляем отслеживание для текущей ветки
run_on_pi "cd $PROJECT_DIR && git fetch origin 2>&1 | head -5"
run_on_pi "cd $PROJECT_DIR && git branch --set-upstream-to=origin/$CURRENT_BRANCH $CURRENT_BRANCH 2>/dev/null || echo 'Ветка не отслеживается'"

echo ""

# Очистка
rm -f "$TMP_EXPECT"

echo "✅ Переключение завершено"
echo ""
echo "📝 Текущая конфигурация:"
echo "   - origin → $TARGET ($NEW_URL)"
echo "   - $OTHER_REMOTE → доступен как отдельный remote"
echo ""
echo "💡 Использование:"
echo "   git push origin <branch>     # Push в $TARGET"
echo "   git pull origin <branch>       # Pull из $TARGET"
echo "   git fetch $OTHER_REMOTE       # Fetch из другого remote"













