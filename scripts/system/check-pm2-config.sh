#!/bin/bash
# Проверка конфигурации PM2 на Raspberry Pi
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

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "🔍 Проверка конфигурации PM2"
echo "=========================================="
echo ""

# 1. Проверка наличия ecosystem.config.js
echo "=== 1. Проверка наличия ecosystem.config.js ==="
FILE_EXISTS=$(run_on_pi "cd $PROJECT_DIR && test -f ecosystem.config.js && echo 'exists' || echo 'not found'")
echo "Файл: $FILE_EXISTS"
echo ""

if [ "$FILE_EXISTS" = "exists" ]; then
    # 2. Содержимое файла
    echo "=== 2. Содержимое ecosystem.config.js ==="
    CONTENT=$(run_on_pi "cd $PROJECT_DIR && cat ecosystem.config.js")
    echo "$CONTENT"
    echo ""
    
    # 3. Проверка конфигурации event-logger
    echo "=== 3. Конфигурация event-logger в PM2 ==="
    EVENT_LOGGER_CONFIG=$(run_on_pi "cd $PROJECT_DIR && grep events\|event-logger' ecosystem.config.js | head -25")
    if [ -n "$EVENT_LOGGER_CONFIG" ]; then
        echo "$EVENT_LOGGER_CONFIG"
    else
        echo "⚠️  Конфигурация event-logger не найдена"
    fi
    echo ""
    
    # 4. Переменные окружения для event-logger
    echo "=== 4. Переменные окружения для event-logger ==="
    ENV_VARS=$(run_on_pi "cd $PROJECT_DIR && grep -E 'DAEMON_WS_URL|OPENSEARCH|EVENT_LOGGING' ecosystem.config.js | head -10")
    if [ -n "$ENV_VARS" ]; then
        echo "$ENV_VARS"
    else
        echo "⚠️  Переменные окружения не найдены"
    fi
    echo ""
    
    # 5. Валидация конфигурации
    echo "=== 5. Валидация конфигурации PM2 ==="
    VALIDATION=$(run_on_pi "cd $PROJECT_DIR && pm2 ecosystem ecosystem.config.js 2>&1 | head -10")
    echo "$VALIDATION"
    echo ""
else
    echo "⚠️  Файл ecosystem.config.js не найден!"
    echo ""
    echo "=== Проверка, как запущен event-logger ==="
    PM2_LIST=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep events")
    echo "$PM2_LIST"
    echo ""
    
    # Проверяем, как запущен процесс
    echo "=== Информация о процессе event-logger ==="
    PROCESS_INFO=$(run_on_pi "cd $PROJECT_DIR && pm2 describe events 2>&1 | grep -E 'script path|interpreter|exec mode|node env' | head -5")
    echo "$PROCESS_INFO"
    echo ""
fi

# 6. Текущий статус PM2 процессов
echo "=== 6. Текущий статус PM2 процессов ==="
PM2_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list 2>&1")
echo "$PM2_STATUS"
echo ""

# 7. Рекомендации
echo "=========================================="
echo "📋 Рекомендации"
echo "=========================================="
if [ "$FILE_EXISTS" != "exists" ]; then
    echo "1. Создайте файл ecosystem.config.js для управления процессами через PM2"
    echo "2. Настройте переменные окружения (DAEMON_WS_URL, OPENSEARCH_*)"
    echo "3. Используйте 'pm2 start ecosystem.config.js' вместо прямого запуска"
fi
echo ""

rm -f "$TMP_EXPECT"

