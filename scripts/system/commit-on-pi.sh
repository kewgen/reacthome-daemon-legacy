#!/bin/bash

#
# Создание коммита на Raspberry Pi с подробным описанием
#
# Использование:
#   ./scripts/system/commit-on-pi.sh [сообщение коммита]
#

# Загружаем переменные из .env, если файл существует
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS:-raspberry}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "📝 Создание коммита на Raspberry Pi ($HOST)"
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
echo "1. Проверка статуса Git"
echo "=========================================="
echo ""
STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
if [ -z "$STATUS" ]; then
    echo "✅ Нет изменений для коммита"
    rm -f "$TMP_EXPECT"
    exit 0
fi
echo "$STATUS"
echo ""

echo "=========================================="
echo "2. Текущая ветка"
echo "=========================================="
echo ""
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "Ветка: $CURRENT_BRANCH"
echo ""

echo "=========================================="
echo "3. Статистика изменений"
echo "=========================================="
echo ""
DIFF_STAT=$(run_on_pi "cd $PROJECT_DIR && git diff --stat HEAD")
echo "$DIFF_STAT"
echo ""

# Определяем тип изменений для сообщения коммита
CHANGED_FILES=$(run_on_pi "cd $PROJECT_DIR && git diff --name-only HEAD")
COMMIT_TYPE="feat"
COMMIT_SCOPE=""

if echo "$CHANGED_FILES" | grep -q "daemon.js\|create.js"; then
    COMMIT_TYPE="feat"
    COMMIT_SCOPE="event-logging"
    COMMIT_TITLE="интеграция event-logger в daemon"
elif echo "$CHANGED_FILES" | grep -q "ru.js"; then
    COMMIT_TYPE="fix"
    COMMIT_SCOPE="morphology"
    COMMIT_TITLE="безопасная инициализация морфологии"
elif echo "$CHANGED_FILES" | grep -q "event-logger\|ecosystem"; then
    COMMIT_TYPE="chore"
    COMMIT_SCOPE="event-logging"
    COMMIT_TITLE="обновление конфигурации event-logger"
else
    COMMIT_TYPE="chore"
    COMMIT_TITLE="обновление конфигурации"
fi

# Получаем детальную статистику
SHORT_STAT=$(run_on_pi "cd $PROJECT_DIR && git diff --shortstat HEAD")
DETAILED_STAT=$(run_on_pi "cd $PROJECT_DIR && git diff --stat HEAD")

# Создаём подробное сообщение коммита
COMMIT_MESSAGE="$COMMIT_TYPE($COMMIT_SCOPE): $COMMIT_TITLE

Изменённые файлы:
$(echo "$CHANGED_FILES" | while read file; do
    if [ -n "$file" ]; then
        echo "  - $file"
    fi
done)

Статистика:
$SHORT_STAT

Детали изменений:
$DETAILED_STAT
"

# Если передано сообщение коммита как аргумент, используем его
if [ -n "$1" ]; then
    COMMIT_MESSAGE="$1"
fi

echo "=========================================="
echo "4. Сообщение коммита"
echo "=========================================="
echo ""
echo "$COMMIT_MESSAGE" | head -50
echo "..."
echo ""

read -p "Продолжить создание коммита? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Коммит отменён"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "=========================================="
echo "5. Добавление файлов в индекс"
echo "=========================================="
echo ""
ADD_OUT=$(run_on_pi "cd $PROJECT_DIR && git add -A 2>&1")
echo "$ADD_OUT"
echo ""

echo "=========================================="
echo "6. Создание коммита"
echo "=========================================="
echo ""

# Сохраняем сообщение коммита локально
TMP_COMMIT_MSG=$(mktemp)
echo "$COMMIT_MESSAGE" > "$TMP_COMMIT_MSG"
echo "Сообщение коммита:"
cat "$TMP_COMMIT_MSG"
echo ""

# Копируем файл с сообщением на малинку и создаём коммит
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$TMP_COMMIT_MSG" $USER@$HOST:/tmp/commit-msg.txt
expect {
  "*assword:" {
    send "$PASS\r"
    exp_continue
  }
  eof
}
expect eof
EOF

COMMIT_OUT=$(run_on_pi "cd $PROJECT_DIR && git commit -F /tmp/commit-msg.txt 2>&1")
echo "$COMMIT_OUT"
echo ""

rm -f "$TMP_COMMIT_MSG"

echo "=========================================="
echo "7. Проверка созданного коммита"
echo "=========================================="
echo ""
COMMIT_INFO=$(run_on_pi "cd $PROJECT_DIR && git log --oneline -1 && echo '' && git log -1 --stat | head -30")
echo "$COMMIT_INFO"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Коммит создан"
echo "=========================================="
echo ""
echo "Для отправки на remote выполните:"
echo "  git push origin $CURRENT_BRANCH"
echo ""
