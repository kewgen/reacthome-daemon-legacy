#!/bin/bash
# Скрипт переключения ветки на Raspberry Pi
# Использование: ./scripts/system/switch-pi-branch.sh [branch_name]

set -e

# Загружаем переменные из .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
BRANCH="${1:-websocket-logger}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

# Создаём временный expect скрипт для SSH
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed"
}

echo "=========================================="
echo "Переключение ветки на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Ветка: ${BRANCH}"
echo ""

echo "=== Текущая ветка ==="
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "Текущая ветка: $CURRENT_BRANCH"
echo ""

if [ "$CURRENT_BRANCH" = "$BRANCH" ]; then
    echo "✅ Уже на ветке $BRANCH"
else
    echo "=== Обновление информации о remote ==="
    run_on_pi "cd $PROJECT_DIR && git fetch origin"
    echo ""
    
    echo "=== Переключение на ветку $BRANCH ==="
    # Проверяем наличие ветки локально
    LOCAL_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git show-ref --verify --quiet refs/heads/$BRANCH && echo 'yes' || echo 'no'")
    
    if [ "$LOCAL_BRANCH" = "yes" ]; then
        echo "Локальная ветка $BRANCH существует, переключаюсь..."
        SWITCH_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git checkout $BRANCH 2>&1")
    else
        # Проверяем наличие на remote
        REMOTE_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git show-ref --verify --quiet refs/remotes/origin/$BRANCH && echo 'yes' || echo 'no'")
        
        if [ "$REMOTE_BRANCH" = "yes" ]; then
            echo "Ветка $BRANCH найдена на remote, создаю локальную..."
            SWITCH_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git checkout -b $BRANCH origin/$BRANCH 2>&1")
        else
            echo "Ветка $BRANCH не найдена на remote, создаю локальную ветку от текущей..."
            SWITCH_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git checkout -b $BRANCH 2>&1")
        fi
    fi
    echo "$SWITCH_OUTPUT"
    echo ""
    
    # Пытаемся получить изменения с remote, если ветка существует там
    REMOTE_BRANCH_CHECK=$(run_on_pi "cd $PROJECT_DIR && git show-ref --verify --quiet refs/remotes/origin/$BRANCH && echo 'yes' || echo 'no'")
    if [ "$REMOTE_BRANCH_CHECK" = "yes" ]; then
        echo "=== Получение последних изменений ==="
        PULL_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git pull origin $BRANCH 2>&1 || echo 'Pull не выполнен'")
        echo "$PULL_OUTPUT"
        echo ""
    else
        echo "=== Ветка существует только локально, pull не требуется ==="
        echo ""
    fi
    
    echo "=== Проверка финальной ветки ==="
    FINAL_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
    echo "Текущая ветка: $FINAL_BRANCH"
    
    # Убираем лишние пробелы и переводы строк
    FINAL_BRANCH=$(echo "$FINAL_BRANCH" | tr -d '[:space:]')
    BRANCH_CHECK=$(echo "$BRANCH" | tr -d '[:space:]')
    
    if [ "$FINAL_BRANCH" = "$BRANCH_CHECK" ]; then
        echo "✅ Успешно переключено на ветку $BRANCH"
    else
        echo "⚠️  Текущая ветка: '$FINAL_BRANCH', ожидалась: '$BRANCH'"
        echo "   Проверьте вручную: git branch --show-current"
    fi
fi

echo ""
echo "=== Статус репозитория ==="
run_on_pi "cd $PROJECT_DIR && git status --short | head -10"

rm -f "$TMP_EXPECT"

echo ""
echo "=========================================="
echo "✅ Готово"
echo "=========================================="
