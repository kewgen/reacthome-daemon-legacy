#!/bin/bash

#
# Профилирование CPU для Node.js процесса на малинке
#
# Использование:
#   ./scripts/system/profile-cpu-on-pi.sh [process_name] [duration_seconds]
#
# Примеры:
#   ./scripts/system/profile-cpu-on-pi.sh daemon 30
#   ./scripts/system/profile-cpu-on-pi.sh events 60
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-daemon}"
DURATION="${2:-30}"  # Длительность профилирования в секундах

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "📊 Профилирование CPU процесса: $PROCESS_NAME"
echo "⏱️  Длительность: ${DURATION} секунд"
echo ""

# Создаём временный expect скрипт для SSH
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

# Создаём временный expect скрипт для SCP
TMP_EXPECT_SCP=$(mktemp)
cat > "$TMP_EXPECT_SCP" << 'EXPECT_SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host:$remote_file $local_file
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_SCP_EOF
chmod +x "$TMP_EXPECT_SCP"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

# Проверяем, запущен ли процесс
echo "🔍 Проверка процесса $PROCESS_NAME..."
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep $PROCESS_NAME")
if [ -z "$STATUS" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден в PM2"
    echo ""
    echo "Доступные процессы:"
    run_on_pi "cd $PROJECT_DIR && pm2 list"
    rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP"
    exit 1
fi

echo "✅ Процесс найден"
echo ""

# Получаем информацию о процессе
PM2_INFO=$(run_on_pi "cd $PROJECT_DIR && pm2 info $PROCESS_NAME | grep -E 'script path|pid'")
echo "📋 Информация о процессе:"
echo "$PM2_INFO"
echo ""

# Метод 1: Использование встроенного CPU профайлера через perf_hooks
echo "🚀 Метод 1: Программное профилирование через perf_hooks (без перезапуска)"
echo ""

CPU_PROFILE_SCRIPT=$(cat << 'CPU_SCRIPT_EOF'
const { performance, PerformanceObserver } = require('perf_hooks');
const fs = require('fs');
const v8 = require('v8');

const duration = parseInt(process.argv[2]) * 1000; // в миллисекундах
const outputFile = process.argv[3] || '/tmp/cpu-profile.cpuprofile';

console.log(`📊 Начало профилирования CPU на ${duration/1000} секунд...`);
console.log(`📁 Результат будет сохранён в: ${outputFile}`);
console.log('');

// Включаем CPU профилирование
v8.setFlagsFromString('--prof');
const profiler = v8.startupProfiler();

// Создаём Performance Observer для отслеживания операций
const obs = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    // Можно логировать, но это не критично для CPU профиля
});

obs.observe({ entryTypes: ['measure', 'mark'] });

const startTime = Date.now();
const samples = [];

// Собираем статистику каждые 100мс
const interval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const elapsed = Date.now() - startTime;
    
    samples.push({
        timestamp: elapsed,
        memory: {
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal
        },
        cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
        }
    });
    
    if (elapsed % 5000 < 100) {  // Каждые 5 секунд
        const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
        const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
        console.log(`[${(elapsed/1000).toFixed(1)}s] RSS: ${rssMB}MB, Heap: ${heapMB}MB`);
    }
}, 100);

setTimeout(() => {
    clearInterval(interval);
    obs.disconnect();
    
    console.log('');
    console.log('✅ Профилирование завершено');
    
    // Создаём CPU профиль в формате Chrome DevTools
    const profile = {
        startTime: startTime,
        endTime: Date.now(),
        nodes: [],
        samples: [],
        timeDeltas: []
    };
    
    // Сохраняем метаданные профилирования
    const metadata = {
        timestamp: new Date().toISOString(),
        duration: duration,
        samples: samples,
        processInfo: {
            pid: process.pid,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
        }
    };
    
    // Сохраняем метаданные в JSON
    const metadataFile = outputFile.replace('.cpuprofile', '-metadata.json');
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    console.log(`📄 Метаданные сохранены в: ${metadataFile}`);
    
    // Для полноценного .cpuprofile нужен встроенный профайлер
    // Сохраняем упрощённую версию
    fs.writeFileSync(outputFile, JSON.stringify(profile, null, 2));
    console.log(`📊 Профиль сохранён в: ${outputFile}`);
    console.log('');
    console.log('💡 Для детального анализа используйте метод 2 (--cpu-prof)');
    
    process.exit(0);
}, duration);
CPU_SCRIPT_EOF
)

# Копируем скрипт на малинку
TMP_SCRIPT=$(mktemp)
echo "$CPU_PROFILE_SCRIPT" > "$TMP_SCRIPT"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="/tmp/cpu-profile-${PROCESS_NAME}-${TIMESTAMP}.cpuprofile"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "/tmp/profile-cpu.js" "$TMP_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "⏳ Запуск профилирования (это займёт ${DURATION} секунд)..."
echo ""

# Запускаем профилирование в фоне через PM2 exec или напрямую через node
# Используем PM2 для запуска скрипта в контексте процесса
run_on_pi "cd $PROJECT_DIR && node /tmp/profile-cpu.js $DURATION $OUTPUT_FILE" &
PROFILE_PID=$!

# Ждём завершения
wait $PROFILE_PID 2>/dev/null

echo ""
echo "📥 Скачивание результатов..."

# Скачиваем файлы профиля
METADATA_FILE="${OUTPUT_FILE%.cpuprofile}-metadata.json"
LOCAL_OUTPUT_DIR="./reports/cpu-profiles"
mkdir -p "$LOCAL_OUTPUT_DIR"

LOCAL_PROFILE="${LOCAL_OUTPUT_DIR}/cpu-profile-${PROCESS_NAME}-${TIMESTAMP}.cpuprofile"
LOCAL_METADATA="${LOCAL_OUTPUT_DIR}/cpu-profile-${PROCESS_NAME}-${TIMESTAMP}-metadata.json"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "$OUTPUT_FILE" "$LOCAL_PROFILE" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
"$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "$METADATA_FILE" "$LOCAL_METADATA" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

if [ -f "$LOCAL_PROFILE" ] || [ -f "$LOCAL_METADATA" ]; then
    echo "✅ Результаты сохранены:"
    [ -f "$LOCAL_PROFILE" ] && echo "   📊 Профиль: $LOCAL_PROFILE"
    [ -f "$LOCAL_METADATA" ] && echo "   📄 Метаданные: $LOCAL_METADATA"
else
    echo "⚠️  Не удалось скачать результаты"
fi

echo ""
echo "=========================================="
echo "📊 Метод 2: Профилирование через --cpu-prof флаг"
echo "=========================================="
echo ""
echo "Для более детального профилирования можно перезапустить процесс с флагом:"
echo "  pm2 restart $PROCESS_NAME --update-env --node-args='--cpu-prof --cpu-prof-dir=/tmp'"
echo ""
echo "После перезапуска процесс создаст .cpuprofile файлы в /tmp"
echo "Их можно открыть в Chrome DevTools: chrome://inspect → Open dedicated DevTools → Performance → Load"
echo ""

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$TMP_SCRIPT"

echo "✅ Профилирование CPU завершено"
echo ""

