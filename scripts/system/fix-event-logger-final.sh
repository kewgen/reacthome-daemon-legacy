#!/bin/bash
# Финальное исправление синтаксических ошибок в event-logger.js
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
set timeout 120
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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "🔧 Финальное исправление event-logger.js"
echo "=========================================="
echo ""

# 1. Создаём резервную копию
echo "=== 1. Создание резервной копии ==="
BACKUP=$(run_on_pi "cd $PROJECT_DIR && cp event-logger.js event-logger.js.backup.final && echo 'Backup created'")
echo "$BACKUP"
echo ""

# 2. Исправляем строку 637 - убираем лишние символы
echo "=== 2. Исправление строки 637 ==="
run_on_pi "cd $PROJECT_DIR && sed -i '637s/});\`);/});/' event-logger.js && echo 'Строка 637 исправлена'"
echo ""

# 3. Возвращаем console.log обратно в log на строке 670
echo "=== 3. Исправление строки 670 ==="
run_on_pi "cd $PROJECT_DIR && sed -i '670s/console\.log/log/' event-logger.js && echo 'Строка 670 исправлена'"
echo ""

# 4. Проверяем синтаксис
echo "=== 4. Проверка синтаксиса ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX_CHECK" | grep -q "SyntaxError"; then
    echo "❌ Синтаксическая ошибка:"
    echo "$SYNTAX_CHECK"
    echo ""
    echo "Пробуем дополнительное исправление..."
    
    # Дополнительная проверка и исправление
    run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Проверяем все проблемные строки
let fixed = false;

// Строка 637
if (lines[636] && lines[636].includes('});\`);')) {
  lines[636] = lines[636].replace(/\`\);$/g, '');
  console.log('Исправлена строка 637');
  fixed = true;
}

// Строка 670
if (lines[669] && lines[669].includes('console.log')) {
  lines[669] = lines[669].replace('console.log', 'log');
  console.log('Исправлена строка 670');
  fixed = true;
}

if (fixed) {
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Файл обновлён');
}
NODE_SCRIPT
"
    
    # Проверяем снова
    SYNTAX_CHECK2=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
    if echo "$SYNTAX_CHECK2" | grep -q "SyntaxError"; then
        echo "❌ Ошибка осталась:"
        echo "$SYNTAX_CHECK2"
        rm -f "$TMP_EXPECT"
        exit 1
    else
        echo "✅ Синтаксис исправлен!"
    fi
else
    echo "✅ Синтаксис корректен!"
fi
echo ""

# 5. Перезапускаем event-logger
echo "=== 5. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -5
echo ""

# 6. Ждём и проверяем статус
echo "=== 6. Проверка статуса (ожидание 5 секунд) ==="
sleep 5
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1 | grep reacthome-event-logger")
echo "$STATUS"
echo ""

# 7. Проверяем логи
echo "=== 7. Последние логи event-logger ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 10 --nostream 2>&1 | tail -10")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
else
    echo "⚠️  Нет логов"
fi
echo ""

rm -f "$TMP_EXPECT"

# 8. Финальная проверка
if echo "$STATUS" | grep -q "online"; then
    echo "=========================================="
    echo "✅✅✅ УСПЕХ! EVENT-LOGGER ЗАПУЩЕН! ✅✅✅"
    echo "=========================================="
    echo ""
    echo "WebSocket на малинке работает!"
    echo "Event-logger исправлен и запущен!"
else
    echo "=========================================="
    echo "⚠️  Event-logger всё ещё не запущен"
    echo "=========================================="
    echo ""
    echo "Проверьте логи: ssh $USER@$HOST 'cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 50'"
fi
