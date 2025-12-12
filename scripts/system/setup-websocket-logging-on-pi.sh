#!/bin/bash
# Настройка расширенного логирования WebSocket на Raspberry Pi
# Использование: ./scripts/system/setup-websocket-logging-on-pi.sh

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
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
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
echo "Настройка логирования WebSocket на Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Проект: ${PROJECT_DIR}"
echo ""

# 1. Проверяем текущее состояние
echo "=== 1. Проверка текущего состояния ==="
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current 2>&1" | head -1 | tr -d ' \r\n')
echo "Текущая ветка: ${CURRENT_BRANCH}"
echo ""

# 2. Проверяем наличие файла server.js
echo "=== 2. Проверка файла server.js ==="
FILE_EXISTS=$(run_on_pi "cd $PROJECT_DIR && test -f src/websocket/server.js && echo 'exists' || echo 'not found'")
if [ "$FILE_EXISTS" != "exists" ]; then
    echo "❌ Файл src/websocket/server.js не найден!"
    rm -f "$TMP_EXPECT"
    exit 1
fi
echo "✅ Файл найден"
echo ""

# 3. Создаём резервную копию
echo "=== 3. Создание резервной копии ==="
BACKUP_FILE="src/websocket/server.js.backup.$(date +%Y%m%d_%H%M%S)"
run_on_pi "cd $PROJECT_DIR && cp src/websocket/server.js $BACKUP_FILE && echo 'Backup created: $BACKUP_FILE'"
echo "✅ Резервная копия создана"
echo ""

# 4. Улучшаем логирование в server.js
echo "=== 4. Улучшение логирования в server.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'src/websocket/server.js';
let content = fs.readFileSync(file, 'utf8');

// Проверяем, есть ли уже расширенное логирование
if (content.includes('[WEBSOCKET] DEBUG:')) {
    console.log('✅ Расширенное логирование уже настроено');
    process.exit(0);
}

// Добавляем логирование в обработчик connection
const connectionHandler = /server\.on\(\"connection\",\s*\(socket,\s*req\)\s*=>\s*\{/;
if (connectionHandler.test(content)) {
    // Улучшаем логирование подключения
    const oldConnection = /server\.on\(\"connection\",\s*\(socket,\s*req\)\s*=>\s*\{[\s\S]*?const session = uuid\(\);[\s\S]*?console\.log\(/;
    const newConnection = \`server.on(\"connection\", (socket, req) => {
      // КРИТИЧНО: Логируем ДО всего остального для диагностики
      console.log(\`[WEBSOCKET] DEBUG: Событие connection получено\`);
      console.log(\`[WEBSOCKET] DEBUG: req.socket?.remoteAddress = \${req.socket?.remoteAddress}\`);
      console.log(\`[WEBSOCKET] DEBUG: req.connection?.remoteAddress = \${req.connection?.remoteAddress}\`);
      console.log(\`[WEBSOCKET] DEBUG: req.socket?.remoteFamily = \${req.socket?.remoteFamily}\`);
      
      const session = uuid();
      const remoteAddress = req.socket?.remoteAddress 
        || req.connection?.remoteAddress
        || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || (req.socket?.remoteFamily === 'IPv6' ? '::1' : '127.0.0.1')
        || 'unknown';
      console.log(\`[WEBSOCKET] Новое подключение: \${session} IP: \${remoteAddress}\`);
\`;
    
    content = content.replace(oldConnection, newConnection);
}

// Улучшаем логирование сообщений
const messageHandler = /socket\.on\(\"message\",\s*\(message\)\s*=>\s*\{/;
if (messageHandler.test(content)) {
    const oldMessage = /socket\.on\(\"message\",\s*\(message\)\s*=>\s*\{[\s\S]*?handle\(session,\s*message\);[\s\S]*?\}\);?/;
    const newMessage = \`socket.on(\"message\", (message) => {
        try {
          console.log(\`[WEBSOCKET] DEBUG: Получено сообщение от \${session}:\`, message.toString().substring(0, 200));
          handle(session, message);
        } catch (error) {
          console.error(\`[WEBSOCKET] Ошибка при обработке сообщения от \${session}:\`, error.message);
          console.error(\`[WEBSOCKET] DEBUG: Stack:\`, error.stack);
        }
      });\`;
    
    if (oldMessage.test(content)) {
        content = content.replace(oldMessage, newMessage);
    }
}

// Улучшаем логирование ошибок
const errorHandler = /socket\.on\(\"error\",\s*\(error\)\s*=>\s*\{/;
if (errorHandler.test(content)) {
    const oldError = /socket\.on\(\"error\",\s*\(error\)\s*=>\s*\{[\s\S]*?console\.error\([\s\S]*?\}\);?/;
    const newError = \`socket.on(\"error\", (error) => {
        console.error(\`[WEBSOCKET] Ошибка сокета \${session} (\${remoteAddress}):\`, error.message || error.toString());
        console.error(\`[WEBSOCKET] DEBUG: socket error details:\`, {
          code: error.code,
          errno: error.errno,
          syscall: error.syscall,
          address: error.address,
          port: error.port,
          stack: error.stack
        });
      });\`;
    
    if (oldError.test(content)) {
        content = content.replace(oldError, newError);
    }
}

// Улучшаем логирование закрытия
const closeHandler = /socket\.on\(\"close\",\s*\(code,\s*reason\)\s*=>\s*\{/;
if (closeHandler.test(content)) {
    const oldClose = /socket\.on\(\"close\",\s*\(code,\s*reason\)\s*=>\s*\{[\s\S]*?\}\);?/;
    const newClose = \`socket.on(\"close\", (code, reason) => {
        const reasonStr = reason?.toString() || 'нет';
        const reasonBuf = reason instanceof Buffer ? reason.toString('utf8') : reasonStr;
        console.log(\`[WEBSOCKET] Соединение закрыто: \${session} (\${remoteAddress}) код: \${code} причина: \${reasonBuf}\`);
        console.log(\`[WEBSOCKET] DEBUG: close event - code=\${code}, reason=\${reasonBuf}, wasClean=\${socket.readyState === 3}\`);
        console.log(\`[WEBSOCKET] DEBUG: socket.readyState=\${socket.readyState}\`);
        deleteSession(session);
        peers.delete(session);
        terminals.delete(session);
      });\`;
    
    if (oldClose.test(content)) {
        content = content.replace(oldClose, newClose);
    }
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Логирование улучшено');
NODE_SCRIPT
"
echo ""

# 5. Проверяем изменения
echo "=== 5. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff src/websocket/server.js | head -30")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES"
else
    echo "⚠️  Изменений не обнаружено (возможно, логирование уже настроено)"
fi
echo ""

# 6. Перезапускаем демон
echo "=== 6. Перезапуск демона ==="
RESTART_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1")
echo "$RESTART_OUT"
echo ""

# 7. Проверяем статус
echo "=== 7. Статус демона ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status daemon 2>&1")
echo "$STATUS"
echo ""

# 8. Показываем последние логи
echo "=== 8. Последние логи WebSocket (20 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -20")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
else
    echo "⚠️  Нет логов WebSocket (возможно, демон только что перезапустился)"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Настройка логирования завершена"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Запустите тест: node tests/websocket/test-websocket-connection.js ws://${HOST}:3000"
echo "2. Проверьте логи: ssh ${USER}@${HOST} 'cd ${PROJECT_DIR} && pm2 logs daemon --lines 100 | grep WEBSOCKET'"
echo "3. Ищите в логах: '[WEBSOCKET] DEBUG:' для детальной диагностики"

