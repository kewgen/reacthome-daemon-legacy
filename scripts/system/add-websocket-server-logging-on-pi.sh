#!/bin/bash
# Скрипт для добавления логирования в WebSocket сервер на Raspberry Pi
# Использование: ./scripts/system/add-websocket-server-logging-on-pi.sh

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
echo "Добавление логирования в WebSocket сервер"
echo "=========================================="
echo ""

# Проверяем ветку
echo "=== 1. Проверка ветки ==="
BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d ' \r\n')
echo "Ветка: $BRANCH"
echo ""

# Применяем улучшение
echo "=== 2. Применение логирования ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'src/websocket/server.js';
let content = fs.readFileSync(file, 'utf8');

// Проверяем, есть ли уже логирование
if (content.includes('console.log(\`[WebSocket] Новое подключение')) {
    console.log('✅ Логирование уже добавлено');
    process.exit(0);
}

// Добавляем логирование подключений и закрытий
const oldConnection = /server\.on\(\"connection\",\s*\(socket\)\s*=>\s*\{/;
const newConnection = 'server.on(\"connection\", (socket, req) => {' +
    '    const session = uuid();' +
    '    const clientIP = req.socket.remoteAddress || req.headers[\"x-forwarded-for\"] || \"unknown\";' +
    '    console.log(\"[WebSocket] Новое подключение:\", session, \"IP:\", clientIP);' +
    '    ' +
    '    socket.on(\"close\", (code, reason) => {' +
    '      console.log(\"[WebSocket] Соединение закрыто:\", session, \"код:\", code, \"причина:\", reason ? reason.toString() : \"нет\");' +
    '      peers.delete(session);' +
    '      deleteSession(session);' +
    '    });' +
    '    ' +
    '    socket.on(\"error\", (error) => {' +
    '      console.error(\"[WebSocket] Ошибка соединения\", session + \":\", error.message || error);' +
    '    });';

if (oldConnection.test(content)) {
    content = content.replace(oldConnection, newConnection);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Логирование добавлено');
} else {
    console.error('❌ Не удалось найти паттерн для замены');
    process.exit(1);
}
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при применении логирования"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Логирование применено"
echo ""

# Проверяем изменения
echo "=== 3. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff src/websocket/server.js | head -30")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменения не обнаружены"
fi
echo ""

# Коммитим изменения
echo "=== 4. Создание коммита ==="
COMMIT_MSG="feat: добавлено логирование подключений и закрытий в WebSocket сервер

Проблема:
- Event-logger не может установить стабильное соединение
- Соединение закрывается сразу после установки
- Нет информации о причинах закрытия соединения

Решение:
- Добавлено логирование новых подключений (IP адрес клиента)
- Добавлено логирование закрытия соединений (код и причина)
- Добавлено логирование ошибок соединения
- Добавлена очистка peers и sessions при закрытии

Изменения:
- server.on('connection', (socket) => server.on('connection', (socket, req))
- Добавлен обработчик socket.on('close')
- Добавлен обработчик socket.on('error')
- Добавлено логирование IP адреса клиента

Влияние:
- ✅ Теперь видно, когда и откуда подключаются клиенты
- ✅ Видно, почему соединения закрываются
- ✅ Легче диагностировать проблемы подключения

Связано с:
- reports/migration/websocket-connection-analysis-2025-12-07.md"

run_on_pi "cd $PROJECT_DIR && git add src/websocket/server.js"

COMMIT_RESULT=$(run_on_pi "cd $PROJECT_DIR && git commit -m \"$COMMIT_MSG\" 2>&1")

if echo "$COMMIT_RESULT" | grep -q "nothing to commit"; then
    echo "⚠️  Нет изменений для коммита"
elif echo "$COMMIT_RESULT" | grep -q "error\|Error\|ERROR"; then
    echo "❌ Ошибка при создании коммита:"
    echo "$COMMIT_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Коммит создан"
    echo "$COMMIT_RESULT" | head -3
fi
echo ""

# Пушим изменения
echo "=== 5. Отправка изменений (push) ==="
PUSH_RESULT=$(run_on_pi "cd $PROJECT_DIR && git push origin websocket-logger 2>&1")

if echo "$PUSH_RESULT" | grep -q "error\|Error\|ERROR\|fatal"; then
    echo "❌ Ошибка при отправке изменений:"
    echo "$PUSH_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Изменения отправлены"
    echo "$PUSH_RESULT" | head -5
fi
echo ""

# Перезапускаем демон
echo "=== 6. Перезапуск демона ==="
RESTART_RESULT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1")
echo "$RESTART_RESULT" | head -10
echo ""

# Ждём немного
echo "=== 7. Ожидание запуска (5 секунд) ==="
sleep 5

# Проверяем логи демона
echo "=== 8. Проверка логов демона (WebSocket) ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 20 --nostream 2>&1 | grep -i websocket | tail -10")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
else
    echo "Нет логов WebSocket (или они ещё не появились)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Логирование добавлено, закоммичено и отправлено"
echo "=========================================="
