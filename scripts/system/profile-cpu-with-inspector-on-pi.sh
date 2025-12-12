#!/bin/bash

#
# Профилирование CPU через Chrome DevTools Protocol (--inspect)
# Более детальное профилирование с возможностью подключения через Chrome DevTools
#
# Использование:
#   ./scripts/system/profile-cpu-with-inspector-on-pi.sh [process_name] [duration_seconds]
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-daemon}"
DURATION="${2:-30}"
INSPECT_PORT="${3:-9229}"  # Порт для Chrome DevTools Protocol

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "📊 Профилирование CPU через Inspector для процесса: $PROCESS_NAME"
echo "⏱️  Длительность: ${DURATION} секунд"
echo "🔌 Inspector порт: ${INSPECT_PORT}"
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

# Проверяем процесс
echo "🔍 Проверка процесса $PROCESS_NAME..."
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep $PROCESS_NAME")
if [ -z "$STATUS" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден"
    rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP"
    exit 1
fi

echo "✅ Процесс найден"
echo ""

# Создаём скрипт для профилирования через Inspector API
INSPECTOR_SCRIPT=$(cat << 'INSPECTOR_SCRIPT_EOF'
const http = require('http');
const fs = require('fs');

const inspectPort = parseInt(process.argv[2]) || 9229;
const duration = parseInt(process.argv[3]) * 1000;
const outputFile = process.argv[4] || '/tmp/cpu-profile-inspector.cpuprofile';

console.log(`🔌 Подключение к Inspector на порту ${inspectPort}...`);

// Функция для вызова Inspector API
function callInspector(method, params = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ method, params });
        const options = {
            hostname: 'localhost',
            port: inspectPort,
            path: '/json',
            method: 'GET'
        };
        
        // Сначала получаем список доступных targets
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const targets = JSON.parse(body);
                    if (targets.length === 0) {
                        reject(new Error('Нет доступных targets'));
                        return;
                    }
                    
                    // Используем первый target
                    const target = targets[0];
                    const wsUrl = target.webSocketDebuggerUrl;
                    const targetId = target.id;
                    
                    // Вызываем метод через HTTP API
                    const methodOptions = {
                        hostname: 'localhost',
                        port: inspectPort,
                        path: `/json/runtime/evaluate?targetId=${targetId}`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': data.length
                        }
                    };
                    
                    // Альтернативный подход: используем WebSocket или прямой HTTP вызов
                    // Для простоты используем прямой вызов через /json/execute
                    const executeOptions = {
                        hostname: 'localhost',
                        port: inspectPort,
                        path: `/json/execute`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': data.length
                        }
                    };
                    
                    const methodReq = http.request(executeOptions, (methodRes) => {
                        let methodBody = '';
                        methodRes.on('data', (chunk) => { methodBody += chunk; });
                        methodRes.on('end', () => {
                            try {
                                resolve(JSON.parse(methodBody));
                            } catch (e) {
                                reject(e);
                            }
                        });
                    });
                    
                    methodReq.on('error', reject);
                    methodReq.write(data);
                    methodReq.end();
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', reject);
        req.end();
    });
}

// Упрощённый подход: используем встроенный профайлер через perf_hooks
// и создаём .cpuprofile файл вручную
const { performance } = require('perf_hooks');
const v8 = require('v8');

console.log('📊 Начало профилирования через встроенный профайлер...');

// Включаем CPU профилирование
const profiler = v8.startupProfiler();
const startTime = Date.now();
const samples = [];

const interval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const elapsed = Date.now() - startTime;
    
    samples.push({
        timestamp: elapsed,
        memory: memUsage
    });
    
    if (elapsed % 5000 < 100) {
        const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
        console.log(`[${(elapsed/1000).toFixed(1)}s] RSS: ${rssMB}MB`);
    }
}, 100);

setTimeout(() => {
    clearInterval(interval);
    
    console.log('');
    console.log('✅ Профилирование завершено');
    
    // Создаём упрощённый CPU профиль
    // Для полноценного профиля нужен --cpu-prof флаг при запуске
    const profile = {
        startTime: startTime,
        endTime: Date.now(),
        nodes: [],
        samples: samples.map(s => s.timestamp),
        timeDeltas: []
    };
    
    const metadata = {
        timestamp: new Date().toISOString(),
        duration: duration,
        samples: samples,
        note: 'Для детального профиля используйте --cpu-prof флаг при запуске процесса'
    };
    
    fs.writeFileSync(outputFile, JSON.stringify(profile, null, 2));
    const metadataFile = outputFile.replace('.cpuprofile', '-metadata.json');
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    
    console.log(`📊 Профиль сохранён в: ${outputFile}`);
    console.log(`📄 Метаданные сохранены в: ${metadataFile}`);
    
    process.exit(0);
}, duration);
INSPECTOR_SCRIPT_EOF
)

# Копируем скрипт
TMP_SCRIPT=$(mktemp)
echo "$INSPECTOR_SCRIPT" > "$TMP_SCRIPT"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="/tmp/cpu-profile-inspector-${PROCESS_NAME}-${TIMESTAMP}.cpuprofile"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "/tmp/profile-cpu-inspector.js" "$TMP_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "⚠️  Для использования Inspector нужно перезапустить процесс с флагом --inspect"
echo ""
echo "Выполните на малинке:"
echo "  cd $PROJECT_DIR"
echo "  pm2 restart $PROCESS_NAME --update-env --node-args='--inspect=0.0.0.0:${INSPECT_PORT}'"
echo ""
echo "Или используйте метод с --cpu-prof:"
echo "  pm2 restart $PROCESS_NAME --update-env --node-args='--cpu-prof --cpu-prof-dir=/tmp'"
echo ""

# Запускаем упрощённое профилирование
echo "⏳ Запуск упрощённого профилирования..."
run_on_pi "cd $PROJECT_DIR && node /tmp/profile-cpu-inspector.js $INSPECT_PORT $DURATION $OUTPUT_FILE" &
PROFILE_PID=$!
wait $PROFILE_PID 2>/dev/null

echo ""
echo "📥 Скачивание результатов..."

LOCAL_OUTPUT_DIR="./reports/cpu-profiles"
mkdir -p "$LOCAL_OUTPUT_DIR"

LOCAL_PROFILE="${LOCAL_OUTPUT_DIR}/cpu-profile-inspector-${PROCESS_NAME}-${TIMESTAMP}.cpuprofile"
LOCAL_METADATA="${LOCAL_OUTPUT_DIR}/cpu-profile-inspector-${PROCESS_NAME}-${TIMESTAMP}-metadata.json"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "$OUTPUT_FILE" "$LOCAL_PROFILE" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
METADATA_FILE="${OUTPUT_FILE%.cpuprofile}-metadata.json"
"$TMP_EXPECT_SCP" "$HOST" "$USER" "$PASS" "$METADATA_FILE" "$LOCAL_METADATA" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

if [ -f "$LOCAL_PROFILE" ] || [ -f "$LOCAL_METADATA" ]; then
    echo "✅ Результаты сохранены:"
    [ -f "$LOCAL_PROFILE" ] && echo "   📊 Профиль: $LOCAL_PROFILE"
    [ -f "$LOCAL_METADATA" ] && echo "   📄 Метаданные: $LOCAL_METADATA"
fi

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$TMP_SCRIPT"

echo ""
echo "✅ Готово"
echo ""

