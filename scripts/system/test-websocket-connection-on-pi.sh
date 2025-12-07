#!/bin/bash
# Тест WebSocket подключения на Raspberry Pi
# Использование: ./scripts/system/test-websocket-connection-on-pi.sh

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Тест WebSocket подключения"
echo "=========================="
echo "Хост: ${USER}@${HOST}"
echo ""

# 1. Проверка порта
echo "=== 1. Проверка порта 3000 ==="
PORT_CHECK=$(run_on_pi "netstat -tuln 2>&1 | grep ':3000' || ss -tuln 2>&1 | grep ':3000' || lsof -i :3000 2>&1 | head -3")
if [ -n "$PORT_CHECK" ]; then
    echo "✅ Порт 3000 открыт:"
    echo "$PORT_CHECK"
else
    echo "❌ Порт 3000 не открыт"
fi
echo ""

# 2. Тест локального подключения (на Pi)
echo "=== 2. Тест локального подключения (ws://localhost:3000) ==="
LOCAL_TEST=$(run_on_pi "cd $PROJECT_DIR && timeout 5 node -e \"
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
let connected = false;
let messagesReceived = 0;

ws.on('open', () => {
  console.log('✅ Локальное подключение успешно');
  connected = true;
  // Отправляем тестовое сообщение
  ws.send(JSON.stringify({ type: 'test', message: 'hello' }));
  setTimeout(() => {
    ws.close();
    process.exit(connected ? 0 : 1);
  }, 2000);
});

ws.on('message', (data) => {
  messagesReceived++;
  console.log('✅ Получено сообщение:', data.toString().substring(0, 100));
});

ws.on('error', (err) => {
  console.log('❌ Ошибка локального подключения:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('ℹ️  Соединение закрыто, код:', code, 'причина:', reason ? reason.toString() : 'нет');
  console.log('ℹ️  Получено сообщений:', messagesReceived);
  process.exit(connected ? 0 : 1);
});

setTimeout(() => {
  console.log('❌ Таймаут подключения');
  process.exit(1);
}, 4000);
\" 2>&1")
echo "$LOCAL_TEST"
echo ""

# 3. Тест подключения по IP адресу
echo "=== 3. Тест подключения по IP (ws://192.168.88.4:3000) ==="
IP_TEST=$(run_on_pi "cd $PROJECT_DIR && timeout 5 node -e \"
const WebSocket = require('ws');
const ws = new WebSocket('ws://192.168.88.4:3000');
let connected = false;
let messagesReceived = 0;

ws.on('open', () => {
  console.log('✅ Подключение по IP успешно');
  connected = true;
  // Отправляем тестовое сообщение
  ws.send(JSON.stringify({ type: 'test', message: 'hello' }));
  setTimeout(() => {
    ws.close();
    process.exit(connected ? 0 : 1);
  }, 2000);
});

ws.on('message', (data) => {
  messagesReceived++;
  console.log('✅ Получено сообщение:', data.toString().substring(0, 100));
});

ws.on('error', (err) => {
  console.log('❌ Ошибка подключения по IP:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('ℹ️  Соединение закрыто, код:', code, 'причина:', reason ? reason.toString() : 'нет');
  console.log('ℹ️  Получено сообщений:', messagesReceived);
  process.exit(connected ? 0 : 1);
});

setTimeout(() => {
  console.log('❌ Таймаут подключения');
  process.exit(1);
}, 4000);
\" 2>&1")
echo "$IP_TEST"
echo ""

# 4. Проверка логов демона (WebSocket)
echo "=== 4. Логи демона (WebSocket, последние 10) ==="
WS_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -iE 'websocket|WEBSOCKET' | tail -10")
if [ -n "$WS_LOGS" ]; then
    echo "$WS_LOGS"
else
    echo "⚠️  Нет логов WebSocket"
fi
echo ""

# 5. Проверка активных подключений
echo "=== 5. Активные подключения к порту 3000 ==="
CONNECTIONS=$(run_on_pi "netstat -an 2>&1 | grep ':3000' | grep ESTABLISHED || ss -an 2>&1 | grep ':3000' | grep ESTAB || echo 'Нет активных подключений'")
echo "$CONNECTIONS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Тест завершён"
echo "=========================================="
