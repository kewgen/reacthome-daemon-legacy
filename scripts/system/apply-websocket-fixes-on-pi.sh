#!/bin/bash
# Применение исправлений WebSocket на Raspberry Pi
# Использование: ./scripts/system/apply-websocket-fixes-on-pi.sh

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
echo "Применение исправлений WebSocket"
echo "=========================================="
echo ""

# Проверяем ветку
echo "=== 1. Проверка ветки ==="
BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d ' \r\n')
echo "Ветка: $BRANCH"
echo ""

# Применяем исправления к server.js
echo "=== 2. Применение исправлений к server.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'src/websocket/server.js';
let content = fs.readFileSync(file, 'utf8');

// Проверяем, есть ли уже обработка ошибок сервера
if (content.includes('server.on(\"listening\"') && content.includes('server.on(\"error\"')) {
    console.log('✅ Обработка ошибок сервера уже добавлена');
} else {
    // Добавляем обработку ошибок сервера
    const oldExport = /module\.exports\s*=\s*\(\)\s*=>\s*\{/;
    const newExport = 'module.exports = () => {\n  try {\n    console.log(\`[WEBSOCKET] Запуск WebSocket сервера на порту \${port}...\`);';
    
    content = content.replace(oldExport, newExport);
    
    // Добавляем обработчики событий сервера после создания
    const serverCreation = /const server = new Server\(\{ port \}\);/;
    const serverWithHandlers = 'const server = new Server({ port });\n    \n    server.on(\"listening\", () => {\n      console.log(\`[WEBSOCKET] ✅ WebSocket сервер запущен на порту \${port}\`);\n    });\n    \n    server.on(\"error\", (error) => {\n      console.error(\`[WEBSOCKET] ❌ Ошибка WebSocket сервера:\`, error.message);\n      if (error.code === \"EADDRINUSE\") {\n        console.error(\`[WEBSOCKET] ❌ Порт \${port} уже занят!\`);\n      }\n    });';
    
    content = content.replace(serverCreation, serverWithHandlers);
    
    // Закрываем try-catch в конце функции
    const oldClose = /  \}\);[\s]*\};/;
    const newClose = '  });\n  } catch (error) {\n    console.error(\`[WEBSOCKET] ❌ Критическая ошибка при запуске WebSocket:\`, error.message);\n    console.error(\`[WEBSOCKET] Stack:\`, error.stack);\n  }\n};';
    
    content = content.replace(oldClose, newClose);
    
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Обработка ошибок сервера добавлена');
}

// Улучшаем логирование закрытия соединения (добавляем код и причину)
if (content.includes('socket.on(\"close\", (code, reason)')) {
    console.log('✅ Логирование закрытия уже улучшено');
} else {
    const oldClose = /socket\.on\(\"close\",\s*\(\)\s*=>/;
    const newClose = 'socket.on(\"close\", (code, reason) =>';
    
    if (oldClose.test(content)) {
        content = content.replace(
            /socket\.on\(\"close\",\s*\(\)\s*=>\s*\{[\s\S]*?console\.log\(`\[WebSocket\] Соединение закрыто:/,
            'socket.on(\"close\", (code, reason) => {\n      console.log(\`[WebSocket] Соединение закрыто:\`, session, \"код:\", code, \"причина:\", reason ? reason.toString() : \"нет\");'
        );
        console.log('✅ Логирование закрытия улучшено');
    }
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Исправления применены');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при применении исправлений"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Исправления применены"
echo ""

# Проверяем изменения
echo "=== 3. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff src/websocket/server.js | head -40")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменения не обнаружены (возможно, уже применены)"
fi
echo ""

# Коммитим изменения
echo "=== 4. Создание коммита ==="
COMMIT_MSG="fix: добавлена обработка ошибок и улучшено логирование WebSocket сервера

Проблема:
- WebSocket сервер не логировал ошибки запуска
- Ошибка EADDRINUSE не перехватывалась
- Невозможно было диагностировать проблемы запуска
- Логирование закрытия соединений было неполным

Решение:
- Добавлена обработка ошибок при создании сервера (try-catch)
- Добавлено логирование успешного запуска (server.on('listening'))
- Добавлена обработка ошибок сервера (server.on('error'))
- Улучшено логирование закрытия соединений (код и причина)
- Добавлена проверка ошибки EADDRINUSE

Изменения:
- Обёртка создания сервера в try-catch
- server.on('listening') - логирование успешного запуска
- server.on('error') - обработка ошибок сервера
- socket.on('close', (code, reason)) - логирование кода и причины закрытия

Влияние:
- ✅ Теперь видны ошибки запуска WebSocket сервера
- ✅ Видно, когда сервер успешно запускается
- ✅ Видно, почему соединения закрываются (код и причина)
- ✅ Легче диагностировать проблемы подключения

Связано с:
- reports/migration/websocket-not-working-analysis.md"

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

# Проверяем логи
echo "=== 8. Проверка логов демона (WebSocket) ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 30 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -15")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
else
    echo "Нет логов WebSocket (или они ещё не появились)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправления применены, закоммичены и отправлены"
echo "=========================================="
