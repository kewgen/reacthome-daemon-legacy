#!/bin/bash
# Исправление форматирования WebSocket сервера на Raspberry Pi
# Использование: ./scripts/system/fix-websocket-server-formatting-on-pi.sh

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

echo "Исправление форматирования WebSocket сервера"
echo "============================================="
echo ""

# Создаём правильную версию файла
run_on_pi "cd $PROJECT_DIR && cat > src/websocket/server.js << 'EOF'
const { Server } = require(\"ws\");
const uuid = require(\"uuid\").v4;
const { deleteSession } = require(\"../notification\");
const { peers } = require(\"./peer\");
const handle = require(\"./handle\");
const { terminals } = require(\"../terminal\");

const port = 3000;

module.exports = () => {
  const server = new Server({ port });
  server.on(\"connection\", (socket, req) => {
    const session = uuid();
    const clientIP = req.socket.remoteAddress || req.headers[\"x-forwarded-for\"] || \"unknown\";
    console.log(\"[WebSocket] Новое подключение:\", session, \"IP:\", clientIP);
    
    socket.on(\"close\", (code, reason) => {
      console.log(\"[WebSocket] Соединение закрыто:\", session, \"код:\", code, \"причина:\", reason ? reason.toString() : \"нет\");
      peers.delete(session);
      deleteSession(session);
    });
    
    socket.on(\"error\", (error) => {
      console.error(\"[WebSocket] Ошибка соединения\", session + \":\", error.message || error);
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
};
EOF
"

echo "✅ Файл исправлен"
echo ""

# Коммитим исправление
echo "=== Создание коммита ==="
run_on_pi "cd $PROJECT_DIR && git add src/websocket/server.js && git commit -m 'fix: исправлено форматирование и дублирование в WebSocket сервере' 2>&1" | head -5
echo ""

# Пушим изменения
echo "=== Отправка изменений ==="
run_on_pi "cd $PROJECT_DIR && git push origin websocket-logger 2>&1" | head -5
echo ""

# Перезапускаем демон
echo "=== Перезапуск демона ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1" | head -5
echo ""

rm -f "$TMP_EXPECT"

echo "✅ Готово"
