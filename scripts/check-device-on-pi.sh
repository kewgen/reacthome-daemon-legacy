#!/bin/bash

###############################################################################
# Скрипт для проверки устройства в БД на малинке
# Использование: ./scripts/check-device-on-pi.sh <MAC_ADDRESS>
# Зачем: Проверяет состояние устройства в БД по MAC адресу
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
echo "║   Проверка устройства в БД                                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "MAC адрес: $MAC_ADDRESS"
echo ""

# Создаём Node.js скрипт для проверки устройства
CHECK_SCRIPT=$(cat << 'NODE_SCRIPT'
const { Level } = require('level');
const mac = process.argv[2] || '60:66:13:b4:aa:df';

async function checkDevice() {
  try {
    const db = new Level('var/db', { valueEncoding: 'json' });
    
    let device = null;
    let found = false;
    
    // Проверяем основную запись устройства
    try {
      device = await db.get(mac);
      found = true;
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }
    
    if (!found) {
      console.log(JSON.stringify({
        found: false,
        mac: mac,
        error: 'Устройство не найдено в БД'
      }, null, 2));
      await db.close();
      return;
    }
    
    // Собираем полную информацию об устройстве
    const info = {
      found: true,
      mac: mac,
      type: device.type,
      version: device.version,
      ip: device.ip,
      online: device.online,
      ready: device.ready,
      initialized: device.initialized,
      timestamp: device.timestamp,
      hub: device.hub,
      site: device.site,
      code: device.code,
      modified: device.modified,
      temperature: device.temperature,
      humidity: device.humidity,
      co2: device.co2,
      temperature_correct: device.temperature_correct,
      humidity_correct: device.humidity_correct,
      co2_correct: device.co2_correct
    };
    
    // Проверяем каналы устройства (di/1, di/2, rgb/1 и т.д.)
    const channels = [];
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith(mac + '/')) {
        channels.push({
          channel: key.replace(mac + '/', ''),
          value: value.value,
          timestamp: value.timestamp,
          bind: value.bind,
          modified: value.modified
        });
      }
    }
    
    info.channels = channels;
    
    console.log(JSON.stringify(info, null, 2));
    
    await db.close();
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2));
    process.exit(1);
  }
}

checkDevice();
NODE_SCRIPT
)

# Останавливаем демон для доступа к БД
echo "🛑 Остановка демона для доступа к БД..."
run_on_pi "pm2 stop daemon" > /dev/null 2>&1 || true
sleep 2

# Копируем скрипт на малинку через expect
echo "📋 Проверка устройства в БД..."
echo ""

# Создаём временный файл со скриптом локально
TMP_SCRIPT=$(mktemp)
cat > "$TMP_SCRIPT" << 'NODE_SCRIPT'
const { Level } = require('level');
const mac = process.argv[2] || '60:66:13:b4:aa:df';

async function checkDevice() {
  let db;
  try {
    db = new Level('var/db', { valueEncoding: 'json' });
    
    let device = null;
    let found = false;
    
    // Проверяем основную запись устройства
    try {
      device = await db.get(mac);
      found = true;
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }
    
    if (!found) {
      console.log(JSON.stringify({
        found: false,
        mac: mac,
        error: 'Устройство не найдено в БД'
      }, null, 2));
      await db.close();
      return;
    }
    
    // Собираем полную информацию об устройстве
    const info = {
      found: true,
      mac: mac,
      type: device.type,
      version: device.version,
      ip: device.ip,
      online: device.online,
      ready: device.ready,
      initialized: device.initialized,
      timestamp: device.timestamp,
      hub: device.hub,
      site: device.site,
      code: device.code,
      modified: device.modified,
      temperature: device.temperature,
      humidity: device.humidity,
      co2: device.co2,
      temperature_correct: device.temperature_correct,
      humidity_correct: device.humidity_correct,
      co2_correct: device.co2_correct
    };
    
    // Проверяем каналы устройства (di/1, di/2, rgb/1 и т.д.)
    const channels = [];
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith(mac + '/')) {
        channels.push({
          channel: key.replace(mac + '/', ''),
          value: value.value,
          timestamp: value.timestamp,
          bind: value.bind,
          modified: value.modified
        });
      }
    }
    
    info.channels = channels;
    
    console.log(JSON.stringify(info, null, 2));
    
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

checkDevice();
NODE_SCRIPT

# Копируем скрипт на малинку
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$TMP_SCRIPT" $USER@$HOST:/tmp/check-device.js
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
EOF

# Выполняем проверку
RESULT=$(run_on_pi "cd $REMOTE_PROJECT_DIR && NODE_PATH=./node_modules node /tmp/check-device.js '$MAC_ADDRESS' 2>&1")

echo "$RESULT"

# Перезапускаем демон
echo ""
echo "🔄 Перезапуск демона..."
run_on_pi "pm2 restart daemon" > /dev/null 2>&1 || true
sleep 2

# Очистка
rm -f "$TMP_EXPECT" "$TMP_SCRIPT"
run_on_pi "rm -f /tmp/check-device.js" 2>/dev/null || true

# Очистка
rm -f "$TMP_EXPECT"
run_on_pi "rm -f /tmp/check-device.js" 2>/dev/null || true

