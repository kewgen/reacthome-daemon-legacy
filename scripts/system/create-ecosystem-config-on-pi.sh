#!/bin/bash
# Создание правильной конфигурации ecosystem.config.js на Raspberry Pi
# Использование: ./scripts/system/create-ecosystem-config-on-pi.sh

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

echo "Создание конфигурации ecosystem.config.js"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo ""

# Получаем IP адрес Pi
echo "=== 1. Получение IP адреса Pi ==="
PI_IP=$(run_on_pi "hostname -I 2>&1 | awk '{print \$1}'" | head -1 | tr -d ' \r\n')
if [ -z "$PI_IP" ]; then
    PI_IP="192.168.88.4"
fi
echo "IP адрес Pi: $PI_IP"
echo ""

# Создаём правильную конфигурацию
echo "=== 2. Создание ecosystem.config.js ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'ecosystem.config.js';

const piIP = '$PI_IP';

const config = \`module.exports = {
  apps: [
    {
      name: 'daemon',
      script: 'daemon.js',
      cwd: '$PROJECT_DIR',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './var/log/daemon-error.log',
      out_file: './var/log/daemon-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000
    },
    {
      name: 'events',
      script: 'event-logger.js',
      cwd: '$PROJECT_DIR',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DAEMON_WS_URL: 'ws://\${piIP}:3000',
        OPENSEARCH_ENABLED: 'true',
        OPENSEARCH_INDEX_PREFIX: 'reacthome-events-test'
      },
      error_file: './var/log/event-logger-error.log',
      out_file: './var/log/event-logger-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000
    }
  ]
};
\`;

fs.writeFileSync(file, config, 'utf8');
console.log('✅ Файл ecosystem.config.js создан');
console.log('✅ DAEMON_WS_URL установлен:', 'ws://' + piIP + ':3000');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при создании ecosystem.config.js"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Конфигурация создана"
echo ""

# Проверяем содержимое
echo "=== 3. Проверка содержимого ==="
CONFIG_CHECK=$(run_on_pi "cd $PROJECT_DIR && grep -A 3 'DAEMON_WS_URL' ecosystem.config.js")
echo "$CONFIG_CHECK"
echo ""

# Перезапускаем event-logger
echo "=== 4. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 delete events 2>&1" > /dev/null
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
sleep 2

START_OUT=$(run_on_pi "cd $PROJECT_DIR && pm2 start ecosystem.config.js --only events --update-env 2>&1")
echo "$START_OUT"
echo ""

# Сохраняем конфигурацию
run_on_pi "cd $PROJECT_DIR && pm2 save 2>&1" > /dev/null
echo "✅ Конфигурация PM2 сохранена"
echo ""

# Ждём и проверяем
echo "=== 5. Ожидание запуска (30 секунд) ==="
sleep 30

echo "=== 6. Проверка статуса ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep event-logger || echo 'NOT_FOUND'")
echo "$STATUS"
echo ""

echo "=== 7. Проверка логов подключения ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs events --lines 20 --nostream 2>&1 | tail -20")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
    
    if echo "$LOGS" | grep -q "$PI_IP"; then
        echo ""
        echo "✅ Event-logger использует IP адрес: $PI_IP"
    elif echo "$LOGS" | grep -q "localhost"; then
        echo ""
        echo "⚠️  Event-logger всё ещё использует localhost"
    fi
else
    echo "⚠️  Логи недоступны"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Конфигурация создана и применена"
echo "=========================================="
