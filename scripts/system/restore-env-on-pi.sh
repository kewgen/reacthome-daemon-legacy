#!/bin/bash

#
# Восстановление файла .env на Raspberry Pi
#
# Использование:
#   ./scripts/system/restore-env-on-pi.sh
#

# Подтягиваем локальный .env, чтобы взять OPENSEARCH_* с дев‑машины
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    # shellcheck disable=SC1090
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🔧 Восстановление файла .env на Raspberry Pi ($HOST)"
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
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

echo "=========================================="
echo "1. Проверка существования .env"
echo "=========================================="
echo ""

ENV_EXISTS=$(run_on_pi "cd $PROJECT_DIR && test -f .env && echo 'exists' || echo 'not_exists'")
if [ "$ENV_EXISTS" = "exists" ]; then
    echo "⚠️  Файл .env уже существует"
    echo ""
    echo "Текущее содержимое (первые 10 строк, без паролей):"
    run_on_pi "cd $PROJECT_DIR && head -10 .env | sed 's/PASSWORD=.*/PASSWORD=***/' | sed 's/PASS=.*/PASS=***/'"
    echo ""
    read -p "Перезаписать? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Отменено"
        rm -f "$TMP_EXPECT"
        exit 0
    fi
fi
echo ""

echo "=========================================="
echo "2. Поиск резервной копии .env"
echo "=========================================="
echo ""

BACKUP_FOUND=$(run_on_pi "cd $PROJECT_DIR && find . -name '.env.backup' -o -name '.env.bak' -o -name '.env.*' 2>/dev/null | head -5")
if [ -n "$BACKUP_FOUND" ]; then
    echo "📋 Найдены резервные копии:"
    echo "$BACKUP_FOUND"
    echo ""
    read -p "Восстановить из резервной копии? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        BACKUP_FILE=$(echo "$BACKUP_FOUND" | head -1)
        run_on_pi "cd $PROJECT_DIR && cp '$BACKUP_FILE' .env && echo 'Восстановлено из $BACKUP_FILE'"
        echo ""
        echo "✅ Файл .env восстановлен из резервной копии"
        rm -f "$TMP_EXPECT"
        exit 0
    fi
fi
echo ""

echo "=========================================="
echo "3. Создание нового .env файла"
echo "=========================================="
echo ""

# Берём OpenSearch-настройки из локального .env, если они заданы
LOCAL_OPENSEARCH_ENABLED="${OPENSEARCH_ENABLED:-true}"
LOCAL_OPENSEARCH_URL="${OPENSEARCH_URL:-https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200}"
LOCAL_OPENSEARCH_USER="${OPENSEARCH_USER:-admin}"
LOCAL_OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-}"
LOCAL_OPENSEARCH_INDEX_PREFIX="${OPENSEARCH_INDEX_PREFIX:-reacthome-events}"
LOCAL_OPENSEARCH_CA_CERT="${OPENSEARCH_CA_CERT:-~/.opensearch/root.crt}"

# Создаём шаблон .env уже с реальными OPENSEARCH_* из локальной машины
ENV_CONTENT="# Переменные окружения для ReactHome Daemon
# ВАЖНО: Этот файл содержит секреты, не коммитьте его в git!

# Event Logging
EVENT_LOGGING_ENABLED=true

# WebSocket для event-logger
DAEMON_WS_URL=ws://localhost:3000

# OpenSearch настройки
OPENSEARCH_ENABLED=${LOCAL_OPENSEARCH_ENABLED}
OPENSEARCH_URL=${LOCAL_OPENSEARCH_URL}
OPENSEARCH_USER=${LOCAL_OPENSEARCH_USER}
OPENSEARCH_PASSWORD=${LOCAL_OPENSEARCH_PASSWORD}
OPENSEARCH_INDEX_PREFIX=${LOCAL_OPENSEARCH_INDEX_PREFIX}
OPENSEARCH_CA_CERT=${LOCAL_OPENSEARCH_CA_CERT}

# Node.js окружение
NODE_ENV=production
"

echo "Создаю файл .env с шаблоном..."
echo ""

# Сохраняем шаблон во временный файл
TMP_ENV=$(mktemp)
echo "$ENV_CONTENT" > "$TMP_ENV"

# Копируем на малинку
TMP_SCP_EXPECT=$(mktemp)
cat > "$TMP_SCP_EXPECT" << 'SCP_EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 30
set user [lindex $argv 0]
set pass [lindex $argv 1]
set host [lindex $argv 2]
set src [lindex $argv 3]
set dst [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$src" "$user@$host:$dst"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
SCP_EXPECT_EOF
chmod +x "$TMP_SCP_EXPECT"

"$TMP_SCP_EXPECT" "$USER" "$PASS" "$HOST" "$TMP_ENV" "$PROJECT_DIR/.env" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

if [ $? -eq 0 ]; then
    echo "✅ Файл .env создан на малинке"
else
    echo "❌ Ошибка создания файла .env"
    rm -f "$TMP_ENV" "$TMP_SCP_EXPECT" "$TMP_EXPECT"
    exit 1
fi
echo ""

echo "=========================================="
echo "4. Проверка созданного файла"
echo "=========================================="
echo ""

run_on_pi "cd $PROJECT_DIR && ls -lh .env && echo '' && echo 'Содержимое (первые 10 строк):' && head -10 .env | sed 's/PASSWORD=.*/PASSWORD=***/' | sed 's/PASS=.*/PASS=***/'"
echo ""

echo "⚠️  ВАЖНО:"
echo "   • Файл .env создан с шаблоном"
echo "   • Нужно заполнить OPENSEARCH_PASSWORD вручную"
echo "   • Проверьте все остальные значения"
echo ""

rm -f "$TMP_ENV" "$TMP_SCP_EXPECT" "$TMP_EXPECT"

echo "✅ Восстановление завершено"
echo ""

