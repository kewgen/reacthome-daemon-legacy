#!/bin/bash
# Полный цикл: получение, исправление, тестирование, загрузка обратно
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then source "$PROJECT_ROOT/.env"; fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXP'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect { "*assword:" { send "$pass\r"; exp_continue } eof }
EXP
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "🔄 Полный цикл: исправление и тестирование"
echo "=========================================="
echo ""

# 1. Получаем файл с Pi
echo "📥 Шаг 1: Получение event-logger.js с Raspberry Pi..."
run_on_pi "cd $PROJECT_DIR && cat event-logger.js" > "$PROJECT_ROOT/event-logger-from-pi.js" 2>/dev/null || {
    echo "❌ Ошибка получения файла"
    rm -f "$TMP_EXPECT"
    exit 1
}

if [ -f "$PROJECT_ROOT/event-logger-from-pi.js" ]; then
    LINES=$(wc -l < "$PROJECT_ROOT/event-logger-from-pi.js")
    echo "✅ Файл получен: $LINES строк"
else
    echo "❌ Файл не получен"
    rm -f "$TMP_EXPECT"
    exit 1
fi
echo ""

# 2. Исправляем синтаксис
echo "🔧 Шаг 2: Исправление синтаксических ошибок..."
if command -v node >/dev/null 2>&1; then
    node "$PROJECT_ROOT/fix-syntax.js" "$PROJECT_ROOT/event-logger-from-pi.js" 2>&1
    FIX_RESULT=$?
    if [ $FIX_RESULT -eq 0 ]; then
        echo "✅ Синтаксис исправлен!"
    else
        echo "❌ Ошибка при исправлении"
    fi
else
    echo "⚠️  Node.js не найден локально, исправление будет выполнено на Pi"
fi
echo ""

# 3. Инструкции для тестирования
echo "🧪 Шаг 3: Инструкции для локального тестирования"
echo "─".repeat(80)
echo ""
echo "📋 ДЛЯ ТЕСТИРОВАНИЯ ВЫПОЛНИТЕ:"
echo ""
echo "1️⃣  В терминале 1 - запустите тестовый WebSocket сервер:"
echo "   cd $PROJECT_ROOT"
echo "   node test-ws-server.js"
echo ""
echo "2️⃣  В терминале 2 - запустите исправленный event-logger:"
echo "   cd $PROJECT_ROOT"
echo "   DAEMON_WS_URL=ws://localhost:3000 node event-logger-from-pi.js"
echo ""
echo "3️⃣  Проверьте подключение и работу"
echo ""
echo "4️⃣  Если всё работает - загрузите обратно на Pi:"
echo "   ./scripts/system/upload-fixed-event-logger.sh"
echo ""
echo "─".repeat(80)
echo ""

rm -f "$TMP_EXPECT"
