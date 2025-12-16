#!/bin/bash

#
# Профилирование использования памяти на Raspberry Pi
#
# Использование:
#   ./scripts/system/profile-memory-on-pi.sh [process_name] [duration]
#   ./scripts/system/profile-memory-on-pi.sh events 60
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-events}"
DURATION="${2:-60}"  # секунд
INTERVAL="${3:-5}"  # интервал сбора данных в секундах

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "📊 Профилирование памяти процесса: $PROCESS_NAME"
echo "⏱️  Длительность: $DURATION секунд, интервал: $INTERVAL секунд"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

# Получаем PID процесса
echo "🔍 Поиск процесса $PROCESS_NAME..."
PID=$(run_on_pi "cd $PROJECT_DIR && pm2 pid $PROCESS_NAME 2>/dev/null | head -1")
if [ -z "$PID" ] || [ "$PID" = "0" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Найден процесс с PID: $PID"
echo ""

# Создаём скрипт для сбора данных о памяти
MEMORY_SCRIPT=$(cat << 'MEMORY_SCRIPT_EOF'
const fs = require('fs');
const process = require('process');

const pid = process.argv[2];
const duration = parseInt(process.argv[3]) * 1000; // в миллисекундах
const interval = parseInt(process.argv[4]) * 1000;
const outputFile = process.argv[5];

const data = [];
const startTime = Date.now();

function getMemoryInfo() {
  try {
    const memInfo = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const vmRSS = memInfo.match(/VmRSS:\s+(\d+)\s+kB/);
    const vmSize = memInfo.match(/VmSize:\s+(\d+)\s+kB/);
    const vmData = memInfo.match(/VmData:\s+(\d+)\s+kB/);
    const vmStk = memInfo.match(/VmStk:\s+(\d+)\s+kB/);
    const vmExe = memInfo.match(/VmExe:\s+(\d+)\s+kB/);
    
    return {
      timestamp: Date.now(),
      vmRSS: vmRSS ? parseInt(vmRSS[1]) : 0,      // Физическая память
      vmSize: vmSize ? parseInt(vmSize[1]) : 0,    // Виртуальная память
      vmData: vmData ? parseInt(vmData[1]) : 0,     // Данные
      vmStk: vmStk ? parseInt(vmStk[1]) : 0,       // Стек
      vmExe: vmExe ? parseInt(vmExe[1]) : 0        // Исполняемый код
    };
  } catch (e) {
    return null;
  }
}

const timer = setInterval(() => {
  const memInfo = getMemoryInfo();
  if (memInfo) {
    data.push(memInfo);
    const elapsed = (Date.now() - startTime) / 1000;
    const rssMB = (memInfo.vmRSS / 1024).toFixed(2);
    console.log(`[${elapsed.toFixed(1)}s] RSS: ${rssMB}MB, VmSize: ${(memInfo.vmSize/1024).toFixed(2)}MB`);
  }
}, interval);

setTimeout(() => {
  clearInterval(timer);
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
  console.log(`\n✅ Данные сохранены в ${outputFile}`);
  console.log(`📊 Всего записей: ${data.length}`);
  
  if (data.length > 0) {
    const rssValues = data.map(d => d.vmRSS);
    const minRSS = Math.min(...rssValues);
    const maxRSS = Math.max(...rssValues);
    const avgRSS = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;
    
    console.log(`\n📈 Статистика RSS (физическая память):`);
    console.log(`   Минимум: ${(minRSS/1024).toFixed(2)}MB`);
    console.log(`   Максимум: ${(maxRSS/1024).toFixed(2)}MB`);
    console.log(`   Среднее: ${(avgRSS/1024).toFixed(2)}MB`);
    console.log(`   Разница: ${((maxRSS-minRSS)/1024).toFixed(2)}MB`);
  }
  
  process.exit(0);
}, duration);
MEMORY_SCRIPT_EOF
)

# Копируем скрипт на малинку
TMP_EXPECT_SCP=$(mktemp)
cat > "$TMP_EXPECT_SCP" << 'EXPECT_SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $local_file $user@$host:$remote_file
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_SCP_EOF
chmod +x "$TMP_EXPECT_SCP"

TMP_SCRIPT=$(mktemp)
echo "$MEMORY_SCRIPT" > "$TMP_SCRIPT"
OUTPUT_FILE="/tmp/memory-profile-${PROCESS_NAME}-$(date +%Y%m%d_%H%M%S).json"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/profile-memory.js" "$TMP_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "🚀 Запуск профилирования..."
run_on_pi "node /tmp/profile-memory.js $PID $DURATION $INTERVAL $OUTPUT_FILE"

echo ""
echo "📥 Скачивание результатов..."
"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "$OUTPUT_FILE" "/tmp/$(basename $OUTPUT_FILE)" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

LOCAL_OUTPUT="/tmp/memory-profile-${PROCESS_NAME}-$(date +%Y%m%d_%H%M%S).json"
if [ -f "/tmp/$(basename $OUTPUT_FILE)" ]; then
    mv "/tmp/$(basename $OUTPUT_FILE)" "$LOCAL_OUTPUT"
    echo "✅ Результаты сохранены в: $LOCAL_OUTPUT"
else
    echo "⚠️  Не удалось скачать результаты"
fi

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$TMP_SCRIPT"

echo ""
echo "=========================================="
echo "✅ Профилирование завершено"
echo "=========================================="
echo ""
echo "Для анализа данных используйте:"
echo "  node scripts/system/analyze-memory-profile.js $LOCAL_OUTPUT"
echo ""

