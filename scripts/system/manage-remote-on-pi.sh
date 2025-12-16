#!/bin/bash

#
# Управление git remote на Raspberry Pi
#
# Использование:
#   ./scripts/system/manage-remote-on-pi.sh [команда] [параметры]
#
# Команды:
#   status      - Показать текущий статус remote
#   switch      - Переключить origin (sourcecraft|github)
#   add         - Добавить remote
#   remove     - Удалить remote
#   test        - Протестировать подключение к remote
#
# Зачем: Универсальная утилита для управления git remote на малинке
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

# Параметры remote
SOURCECRAFT_REPO="ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git"
GITHUB_REPO="git@github.com:gev/reacthome-daemon-legacy.git"

COMMAND="${1:-status}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

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

case "$COMMAND" in
    status)
        echo "📊 Статус git remote на Raspberry Pi ($HOST)"
        echo ""
        
        echo "=========================================="
        echo "1. Remote репозитории"
        echo "=========================================="
        echo ""
        run_on_pi "cd $PROJECT_DIR && git remote -v"
        echo ""
        
        echo "=========================================="
        echo "2. Текущая ветка"
        echo "=========================================="
        echo ""
        CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
        echo "Ветка: $CURRENT_BRANCH"
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
        echo "5. Статус рабочей директории"
        echo "=========================================="
        echo ""
        STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
        if [ -z "$STATUS" ]; then
            echo "✅ Рабочая директория чистая"
        else
            echo "$STATUS" | head -10
        fi
        ;;
        
    switch)
        TARGET="${2:-}"
        if [ -z "$TARGET" ]; then
            echo "❌ Ошибка: не указан целевой remote"
            echo "Использование: ./scripts/system/manage-remote-on-pi.sh switch [sourcecraft|github]"
            rm -f "$TMP_EXPECT"
            exit 1
        fi
        
        if [ "$TARGET" != "sourcecraft" ] && [ "$TARGET" != "github" ]; then
            echo "❌ Ошибка: неверный remote. Используйте 'sourcecraft' или 'github'"
            rm -f "$TMP_EXPECT"
            exit 1
        fi
        
        echo "🔄 Переключение origin на $TARGET"
        echo ""
        
        if [ "$TARGET" = "sourcecraft" ]; then
            NEW_URL="$SOURCECRAFT_REPO"
        else
            NEW_URL="$GITHUB_REPO"
        fi
        
        # Удаляем старый origin
        run_on_pi "cd $PROJECT_DIR && git remote remove origin 2>/dev/null || true"
        
        # Добавляем новый origin
        run_on_pi "cd $PROJECT_DIR && git remote add origin $NEW_URL"
        
        echo "✅ Origin переключен на $TARGET"
        echo ""
        run_on_pi "cd $PROJECT_DIR && git remote -v"
        ;;
        
    add)
        REMOTE_NAME="${2:-}"
        REMOTE_URL="${3:-}"
        
        if [ -z "$REMOTE_NAME" ] || [ -z "$REMOTE_URL" ]; then
            echo "❌ Ошибка: не указаны имя и URL remote"
            echo "Использование: ./scripts/system/manage-remote-on-pi.sh add <имя> <url>"
            echo ""
            echo "Примеры:"
            echo "  ./scripts/system/manage-remote-on-pi.sh add sourcecraft $SOURCECRAFT_REPO"
            echo "  ./scripts/system/manage-remote-on-pi.sh add github $GITHUB_REPO"
            rm -f "$TMP_EXPECT"
            exit 1
        fi
        
        echo "➕ Добавление remote '$REMOTE_NAME'"
        echo ""
        run_on_pi "cd $PROJECT_DIR && git remote add $REMOTE_NAME $REMOTE_URL"
        echo "✅ Remote '$REMOTE_NAME' добавлен"
        echo ""
        run_on_pi "cd $PROJECT_DIR && git remote -v"
        ;;
        
    remove)
        REMOTE_NAME="${2:-}"
        
        if [ -z "$REMOTE_NAME" ]; then
            echo "❌ Ошибка: не указано имя remote"
            echo "Использование: ./scripts/system/manage-remote-on-pi.sh remove <имя>"
            rm -f "$TMP_EXPECT"
            exit 1
        fi
        
        echo "➖ Удаление remote '$REMOTE_NAME'"
        echo ""
        run_on_pi "cd $PROJECT_DIR && git remote remove $REMOTE_NAME"
        echo "✅ Remote '$REMOTE_NAME' удалён"
        echo ""
        run_on_pi "cd $PROJECT_DIR && git remote -v"
        ;;
        
    test)
        REMOTE_NAME="${2:-origin}"
        
        echo "🧪 Тестирование подключения к remote '$REMOTE_NAME'"
        echo ""
        
        REMOTE_URL=$(run_on_pi "cd $PROJECT_DIR && git remote get-url $REMOTE_NAME 2>/dev/null")
        
        if [ -z "$REMOTE_URL" ]; then
            echo "❌ Remote '$REMOTE_NAME' не найден"
            rm -f "$TMP_EXPECT"
            exit 1
        fi
        
        echo "URL: $REMOTE_URL"
        echo ""
        echo "Выполнение git fetch..."
        run_on_pi "cd $PROJECT_DIR && git fetch $REMOTE_NAME 2>&1 | head -10"
        echo ""
        
        if [ $? -eq 0 ]; then
            echo "✅ Подключение к '$REMOTE_NAME' успешно"
        else
            echo "❌ Ошибка при подключении к '$REMOTE_NAME'"
        fi
        ;;
        
    *)
        echo "❌ Неизвестная команда: $COMMAND"
        echo ""
        echo "Использование: ./scripts/system/manage-remote-on-pi.sh [команда] [параметры]"
        echo ""
        echo "Команды:"
        echo "  status                    - Показать текущий статус remote"
        echo "  switch [sourcecraft|github] - Переключить origin"
        echo "  add <имя> <url>           - Добавить remote"
        echo "  remove <имя>              - Удалить remote"
        echo "  test [имя]                - Протестировать подключение (по умолчанию origin)"
        echo ""
        echo "Примеры:"
        echo "  ./scripts/system/manage-remote-on-pi.sh status"
        echo "  ./scripts/system/manage-remote-on-pi.sh switch sourcecraft"
        echo "  ./scripts/system/manage-remote-on-pi.sh add sourcecraft $SOURCECRAFT_REPO"
        echo "  ./scripts/system/manage-remote-on-pi.sh test origin"
        rm -f "$TMP_EXPECT"
        exit 1
        ;;
esac

# Очистка
rm -f "$TMP_EXPECT"

echo ""
echo "✅ Команда выполнена"













