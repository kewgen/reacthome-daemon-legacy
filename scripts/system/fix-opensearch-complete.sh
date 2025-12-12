#!/bin/bash
# Полное исправление OpenSearch на малинке
# 1. Загрузка модулей opensearch.js, event-log.js, filters.js
# 2. Настройка переменных окружения
# 3. Проверка результата

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "=========================================="
echo "🔧 Полное исправление OpenSearch на малинке"
echo "=========================================="
echo ""

# Функция для выполнения команд на малинке
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
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

# 1. Создание папки src/logging (если не существует)
echo "=== 1. Подготовка структуры папок ==="
run_on_pi "mkdir -p $PROJECT_DIR/src/logging"
echo "✅ Папка src/logging создана/существует"
echo ""

# 2. Загрузка файлов
echo "=== 2. Загрузка модулей на малинку ==="

echo "📤 Загрузка opensearch.js..."
if [ -f "$PROJECT_ROOT/pi-changes/src/logging/opensearch.js" ]; then
    sshpass -p "$PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        "$PROJECT_ROOT/pi-changes/src/logging/opensearch.js" \
        "$USER@$HOST:$PROJECT_DIR/src/logging/" 2>/dev/null || {
        echo "⚠️  sshpass не установлен, использую expect..."
        TMP_SCP=$(mktemp)
        cat > "$TMP_SCP" << 'SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set src [lindex $argv 3]
set dst [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $src $user@$host:$dst
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
SCP_EOF
        chmod +x "$TMP_SCP"
        "$TMP_SCP" "$HOST" "$USER" "$PASS" \
            "$PROJECT_ROOT/pi-changes/src/logging/opensearch.js" \
            "$PROJECT_DIR/src/logging/" 2>/dev/null
        rm -f "$TMP_SCP"
    }
    echo "✅ opensearch.js загружен"
else
    echo "❌ Файл opensearch.js не найден!"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "📤 Загрузка event-log.js..."
if [ -f "$PROJECT_ROOT/pi-changes/src/logging/event-log.js" ]; then
    sshpass -p "$PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        "$PROJECT_ROOT/pi-changes/src/logging/event-log.js" \
        "$USER@$HOST:$PROJECT_DIR/src/logging/" 2>/dev/null || {
        TMP_SCP=$(mktemp)
        cat > "$TMP_SCP" << 'SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set src [lindex $argv 3]
set dst [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $src $user@$host:$dst
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
SCP_EOF
        chmod +x "$TMP_SCP"
        "$TMP_SCP" "$HOST" "$USER" "$PASS" \
            "$PROJECT_ROOT/pi-changes/src/logging/event-log.js" \
            "$PROJECT_DIR/src/logging/" 2>/dev/null
        rm -f "$TMP_SCP"
    }
    echo "✅ event-log.js загружен"
else
    echo "⚠️  Файл event-log.js не найден, пропускаем"
fi

echo "📤 Загрузка filters.js..."
if [ -f "$PROJECT_ROOT/pi-changes/src/logging/filters.js" ]; then
    sshpass -p "$PASS" scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        "$PROJECT_ROOT/pi-changes/src/logging/filters.js" \
        "$USER@$HOST:$PROJECT_DIR/src/logging/" 2>/dev/null || {
        TMP_SCP=$(mktemp)
        cat > "$TMP_SCP" << 'SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set src [lindex $argv 3]
set dst [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $src $user@$host:$dst
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
SCP_EOF
        chmod +x "$TMP_SCP"
        "$TMP_SCP" "$HOST" "$USER" "$PASS" \
            "$PROJECT_ROOT/pi-changes/src/logging/filters.js" \
            "$PROJECT_DIR/src/logging/" 2>/dev/null
        rm -f "$TMP_SCP"
    }
    echo "✅ filters.js загружен"
else
    echo "⚠️  Файл filters.js не найден, пропускаем"
fi

echo ""

# 3. Проверка синтаксиса загруженных файлов
echo "=== 3. Проверка синтаксиса загруженных файлов ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c src/logging/opensearch.js 2>&1 && echo 'OK'")
if echo "$SYNTAX_CHECK" | grep -q "OK"; then
    echo "✅ opensearch.js: синтаксис корректен"
else
    echo "❌ opensearch.js: ошибка синтаксиса"
    echo "$SYNTAX_CHECK"
    rm -f "$TMP_EXPECT"
    exit 1
fi
echo ""

# 4. Проверка структуры папок
echo "=== 4. Проверка структуры src/logging ==="
FILES_LIST=$(run_on_pi "ls -la $PROJECT_DIR/src/logging/ 2>&1")
echo "$FILES_LIST"
if echo "$FILES_LIST" | grep -q "opensearch.js"; then
    echo "✅ opensearch.js присутствует"
else
    echo "❌ opensearch.js отсутствует!"
    rm -f "$TMP_EXPECT"
    exit 1
fi
echo ""

# 5. Настройка переменных окружения через существующий скрипт
echo "=== 5. Настройка переменных окружения ==="
echo "Запуск setup-opensearch-env-on-pi.sh..."
echo ""

rm -f "$TMP_EXPECT"

# Запускаем скрипт настройки переменных окружения
bash "$SCRIPT_DIR/setup-opensearch-env-on-pi.sh"

echo ""
echo "=========================================="
echo "✅ Исправление завершено!"
echo "=========================================="
echo ""
echo "📋 Для проверки используйте:"
echo "   ./scripts/system/check-opensearch-events-on-pi.sh"
echo "   pm2 logs events --lines 50"
echo ""
