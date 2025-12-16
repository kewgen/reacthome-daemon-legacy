#!/bin/bash

###############################################################################
# Скрипт для исправления статуса устройства в БД
# Использование: ./scripts/fix-device-status-on-pi.sh <MAC_ADDRESS>
# Зачем: Устанавливает online: false для устройства, которое не отвечает
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

MAC_ADDRESS="${1:-60:66:13:b4:aa:df}"
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
REMOTE_PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
  echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
  exit 1
fi

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>&1 | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   Исправление статуса устройства в БД                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "MAC адрес: $MAC_ADDRESS"
echo ""

# Останавливаем демон для доступа к БД
echo "🛑 Остановка демона для доступа к БД..."
run_on_pi "pm2 stop daemon" > /dev/null 2>&1 || true
sleep 2

# Создаём скрипт для исправления статуса
TMP_SCRIPT=$(mktemp)
cat > "$TMP_SCRIPT" << 'NODE_SCRIPT'
const { Level } = require('level');
const mac = process.argv[2] || '60:66:13:b4:aa:df';

async function fixDeviceStatus() {
  let db;
  try {
    db = new Level('var/db', { valueEncoding: 'json' });
    
    // Получаем текущее состояние устройства
    let device;
    try {
      device = await db.get(mac);
    } catch (error) {
      if (error.type === 'NotFoundError') {
        console.log(JSON.stringify({
          error: 'Устройство не найдено в БД',
          mac: mac
        }, null, 2));
        await db.close();
        return;
      }
      throw error;
    }
    
    console.log('Текущее состояние:');
    console.log(JSON.stringify({
      mac: mac,
      online: device.online,
      ready: device.ready,
      initialized: device.initialized,
      ip: device.ip
    }, null, 2));
    
    // Обновляем статус
    const updated = {
      ...device,
      online: false,
      ready: false
    };
    
    await db.put(mac, updated);
    
    console.log('\nОбновлённое состояние:');
    console.log(JSON.stringify({
      mac: mac,
      online: updated.online,
      ready: updated.ready,
      initialized: updated.initialized,
      ip: updated.ip
    }, null, 2));
    
    await db.close();
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2));
    if (db) {
      await db.close().catch(() => {});
    }
    process.exit(1);
  }
}

fixDeviceStatus();
NODE_SCRIPT

# Копируем скрипт на малинку
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$TMP_SCRIPT" $USER@$HOST:/tmp/fix-device-status.js
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
EOF

# Выполняем исправление
echo ""
echo "🔧 Исправление статуса устройства..."
RESULT=$(run_on_pi "cd $REMOTE_PROJECT_DIR && NODE_PATH=./node_modules node /tmp/fix-device-status.js '$MAC_ADDRESS' 2>&1")

echo "$RESULT"

# Перезапускаем демон
echo ""
echo "🔄 Перезапуск демона..."
run_on_pi "pm2 restart daemon" > /dev/null 2>&1 || true
sleep 2

echo ""
echo "✅ Готово! Демон перезапущен и попытается переподключиться к устройству."

# Очистка
rm -f "$TMP_EXPECT" "$TMP_SCRIPT"
run_on_pi "rm -f /tmp/fix-device-status.js" 2>/dev/null || true












