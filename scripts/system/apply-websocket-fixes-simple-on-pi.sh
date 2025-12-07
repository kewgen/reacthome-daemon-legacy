#!/bin/bash
# Применение исправлений WebSocket на Raspberry Pi (упрощённая версия)
# Использование: ./scripts/system/apply-websocket-fixes-simple-on-pi.sh

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

echo "Применение исправлений WebSocket"
echo "================================"
echo ""

# Создаём правильную версию server.js
echo "=== 1. Применение исправлений к server.js ==="
run_on_pi "cd $PROJECT_DIR && cat > src/websocket/server.js << 'EOF'
const { Server } = require(\"ws\");
const uuid = require(\"uuid\").v4;
const { deleteSession } = require(\"../notification\");
const { peers } = require(\"./peer\");
const handle = require(\"./handle\");
const { terminals } = require(\"../terminal\");

const port = 3000;

module.exports = () => {
  try {
    console.log(\`[WEBSOCKET] Запуск WebSocket сервера на порту \${port}...\`);
    const server = new Server({ port });
    
    server.on(\"listening\", () => {
      console.log(\`[WEBSOCKET] ✅ WebSocket сервер запущен на порту \${port}\`);
    });
    
    server.on(\"error\", (error) => {
      console.error(\`[WEBSOCKET] ❌ Ошибка WebSocket сервера:\`, error.message);
      if (error.code === \"EADDRINUSE\") {
        console.error(\`[WEBSOCKET] ❌ Порт \${port} уже занят!\`);
      }
    });
    
    server.on(\"connection\", (socket, req) => {
      const session = uuid();
      const clientIP = req.socket.remoteAddress || req.headers[\"x-forwarded-for\"] || \"unknown\";
      console.log(\`[WEBSOCKET] Новое подключение:\`, session, \"IP:\", clientIP);
      
      socket.on(\"close\", (code, reason) => {
        console.log(\`[WEBSOCKET] Соединение закрыто:\`, session, \"код:\", code, \"причина:\", reason ? reason.toString() : \"нет\");
        peers.delete(session);
        deleteSession(session);
      });
      
      socket.on(\"error\", (error) => {
        console.error(\`[WEBSOCKET] Ошибка соединения\`, session + \":\", error.message || error);
      });
      
      socket.on(\"message\", (message) => {
        handle(session, message);
      });
      
      peers.set(session, {
        session,
        online: true,
        state: \"active\",
        timestamp: Date.now(),
        send(message, cb) {
          socket.send(JSON.stringify(message), cb);
        },
      });
    });
  } catch (error) {
    console.error(\`[WEBSOCKET] ❌ Критическая ошибка при запуске WebSocket:\`, error.message);
    console.error(\`[WEBSOCKET] Stack:\`, error.stack);
  }
};
EOF
"

echo "✅ Файл обновлён"
echo ""

# Коммитим изменения
echo "=== 2. Создание коммита ==="
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

run_on_pi "cd $PROJECT_DIR && git add src/websocket/server.js && git commit -m \"$COMMIT_MSG\" 2>&1" | head -5
echo ""

# Пушим изменения
echo "=== 3. Отправка изменений ==="
run_on_pi "cd $PROJECT_DIR && git push origin websocket-logger 2>&1" | head -5
echo ""

# Перезапускаем демон
echo "=== 4. Перезапуск демона ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1" | head -5
echo ""

# Ждём и проверяем логи
echo "=== 5. Ожидание и проверка логов (10 секунд) ==="
sleep 10

echo "=== 6. Логи демона (WebSocket) ==="
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 30 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -15"
echo ""

rm -f "$TMP_EXPECT"

echo "✅ Готово"
