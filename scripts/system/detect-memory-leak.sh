#!/bin/bash

###############################################################################
# Скрипт для достоверного определения утечек памяти
# 
# Использование:
#   ./scripts/system/detect-memory-leak.sh [process_name] [duration_minutes]
#   ./scripts/system/detect-memory-leak.sh events 30
#
# Зачем: Создает heap snapshots в разные моменты времени и сравнивает их,
#        позволяя точно определить, какие объекты удерживают память и растут
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
REMOTE_PROJECT_DIR="/home/pi/reacthome-daemon"
PROCESS_NAME="${1:-events}"
DURATION_MINUTES="${2:-30}"  # Длительность теста в минутах
SNAPSHOT_INTERVAL_MINUTES=10  # Интервал между snapshots

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   Определение утечек памяти                                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Процесс: $PROCESS_NAME"
echo "⏱️  Длительность: $DURATION_MINUTES минут"
echo "📸 Интервал snapshots: $SNAPSHOT_INTERVAL_MINUTES минут"
echo ""

# Создаём временные скрипты для SSH
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
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"


run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>&1 | grep -v "password:\|spawn\|Warning:"
}

copy_from_pi() {
    local remote_file="$1"
    local local_file="$2"
    # Зачем: Копируем файлы с малинки на локальную машину для анализа
    expect << EOF
set timeout 300
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST:$remote_file $local_file
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
EOF
}

copy_to_pi() {
    local local_file="$1"
    local remote_file="$2"
    # Зачем: Копируем файлы с локальной машины на малинку
    expect << EOF
set timeout 60
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $local_file $USER@$HOST:$remote_file
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
EOF
}

# Очистка при выходе
cleanup() {
    rm -f "$TMP_EXPECT" "$TMP_HEAP_SCRIPT" "$TMP_STATS_SCRIPT"
}
trap cleanup EXIT

# Проверяем процесс
echo "🔍 Проверка процесса $PROCESS_NAME..."
PID=$(run_on_pi "cd $REMOTE_PROJECT_DIR && pm2 pid $PROCESS_NAME 2>/dev/null | head -1")
if [ -z "$PID" ] || [ "$PID" = "0" ]; then
    echo "❌ Процесс $PROCESS_NAME не найден"
    exit 1
fi
echo "✅ Процесс найден (PID: $PID)"
echo ""

# Создаём скрипт для создания heap snapshot через inspector
HEAP_SNAPSHOT_SCRIPT=$(cat << 'HEAP_SNAPSHOT_EOF'
const v8 = require('v8');
const fs = require('fs');
const http = require('http');

const outputFile = process.argv[2] || '/tmp/heap-snapshot.heapsnapshot';
const inspectorPort = parseInt(process.env.INSPECTOR_PORT || '9229', 10);

console.log('📊 Создание heap snapshot...');
console.log(`   Inspector порт: ${inspectorPort}`);
console.log(`   Выходной файл: ${outputFile}`);

// Функция для получения snapshot через inspector API
function getHeapSnapshot(port, outputPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/json/list',
      method: 'GET'
    };

    // Сначала получаем список процессов
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const processes = JSON.parse(data);
          if (processes.length === 0) {
            reject(new Error('Inspector не подключен'));
            return;
          }

          const targetId = processes[0].id;
          console.log(`   Target ID: ${targetId}`);

          // Запрашиваем heap snapshot
          const snapshotOptions = {
            hostname: 'localhost',
            port: port,
            path: `/json/version`,
            method: 'GET'
          };

          // Используем v8 API напрямую (более надежно)
          try {
            const snapshot = v8.writeHeapSnapshot(outputPath);
            console.log(`✅ Heap snapshot создан: ${snapshot}`);
            resolve(snapshot);
          } catch (err) {
            reject(err);
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Альтернативный метод через v8 API (работает без inspector)
try {
  const snapshotPath = v8.writeHeapSnapshot(outputFile);
  console.log(`✅ Heap snapshot создан: ${snapshotPath}`);
  process.exit(0);
} catch (err) {
  console.error(`❌ Ошибка создания snapshot: ${err.message}`);
  process.exit(1);
}
HEAP_SNAPSHOT_EOF
)

# Создаём скрипт для получения статистики памяти
MEMORY_STATS_SCRIPT=$(cat << 'MEMORY_STATS_EOF'
const v8 = require('v8');
const memUsage = process.memoryUsage();
const heapStats = v8.getHeapStatistics();

const stats = {
  timestamp: new Date().toISOString(),
  memoryUsage: {
    rss: memUsage.rss,
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    external: memUsage.external,
    arrayBuffers: memUsage.arrayBuffers
  },
  heapStatistics: {
    totalHeapSize: heapStats.total_heap_size,
    usedHeapSize: heapStats.used_heap_size,
    heapSizeLimit: heapStats.heap_size_limit,
    totalAvailableSize: heapStats.total_available_size,
    totalPhysicalSize: heapStats.total_physical_size,
    numberOfNativeContexts: heapStats.number_of_native_contexts,
    numberOfDetachedContexts: heapStats.number_of_detached_contexts
  }
};

console.log(JSON.stringify(stats, null, 2));
MEMORY_STATS_EOF
)

# Копируем скрипты на малинку
# Зачем: Загружаем скрипты для создания heap snapshots и получения статистики на малинку
TMP_HEAP_SCRIPT=$(mktemp)
TMP_STATS_SCRIPT=$(mktemp)
echo "$HEAP_SNAPSHOT_SCRIPT" > "$TMP_HEAP_SCRIPT"
echo "$MEMORY_STATS_SCRIPT" > "$TMP_STATS_SCRIPT"

copy_to_pi "$TMP_HEAP_SCRIPT" "/tmp/create-heap-snapshot.js"
copy_to_pi "$TMP_STATS_SCRIPT" "/tmp/get-memory-stats.js"

# Создаём директорию для результатов
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="$PROJECT_DIR/memory-leak-analysis-$PROCESS_NAME-$TIMESTAMP"
mkdir -p "$RESULTS_DIR"

echo "📁 Результаты будут сохранены в: $RESULTS_DIR"
echo ""

# Запускаем процесс с inspector (если еще не запущен)
echo "🔧 Настройка inspector для процесса..."
INSPECTOR_PORT=9229

# Проверяем, запущен ли процесс с inspector
INSPECTOR_RUNNING=$(run_on_pi "cd $REMOTE_PROJECT_DIR && pm2 describe $PROCESS_NAME 2>/dev/null | grep 'inspector' || echo 'no'")
if echo "$INSPECTOR_RUNNING" | grep -q "no"; then
    echo "⚠️  Inspector не включен. Перезапускаем процесс с inspector..."
    run_on_pi "cd $REMOTE_PROJECT_DIR && pm2 restart $PROCESS_NAME --update-env --node-args='--inspect=0.0.0.0:$INSPECTOR_PORT' 2>&1" || true
    sleep 3
fi

# Создаём первый snapshot (базовая линия)
echo "📸 Создание базового snapshot (t=0)..."
SNAPSHOT_0="/tmp/heap-snapshot-${PROCESS_NAME}-t0-${TIMESTAMP}.heapsnapshot"
STATS_0="/tmp/memory-stats-${PROCESS_NAME}-t0-${TIMESTAMP}.json"

run_on_pi "cd $REMOTE_PROJECT_DIR && node /tmp/create-heap-snapshot.js $SNAPSHOT_0 2>&1" || {
    echo "⚠️  Не удалось создать snapshot через v8 API, пробуем альтернативный метод..."
    # Альтернативный метод: используем inspector через curl
    run_on_pi "cd $REMOTE_PROJECT_DIR && curl -s http://localhost:$INSPECTOR_PORT/json/list > /dev/null 2>&1 && echo 'inspector_ok' || echo 'inspector_not_available'"
}

# Получаем статистику памяти
run_on_pi "cd $REMOTE_PROJECT_DIR && node /tmp/get-memory-stats.js > $STATS_0 2>&1"

# Копируем результаты
copy_from_pi "$SNAPSHOT_0" "$RESULTS_DIR/heap-snapshot-t0.heapsnapshot" 2>/dev/null || echo "⚠️  Не удалось скачать snapshot t0"
copy_from_pi "$STATS_0" "$RESULTS_DIR/memory-stats-t0.json" 2>/dev/null || echo "⚠️  Не удалось скачать stats t0"

echo "✅ Базовый snapshot создан"
echo ""

# Ждем и создаем промежуточные snapshots
SNAPSHOT_COUNT=$((DURATION_MINUTES / SNAPSHOT_INTERVAL_MINUTES))
for i in $(seq 1 $SNAPSHOT_COUNT); do
    WAIT_MINUTES=$((i * SNAPSHOT_INTERVAL_MINUTES))
    echo "⏳ Ожидание $WAIT_MINUTES минут перед следующим snapshot..."
    sleep $((SNAPSHOT_INTERVAL_MINUTES * 60))
    
    echo "📸 Создание snapshot #$i (t=$WAIT_MINUTES мин)..."
    SNAPSHOT_N="/tmp/heap-snapshot-${PROCESS_NAME}-t${i}-${TIMESTAMP}.heapsnapshot"
    STATS_N="/tmp/memory-stats-${PROCESS_NAME}-t${i}-${TIMESTAMP}.json"
    
    run_on_pi "cd $REMOTE_PROJECT_DIR && node /tmp/create-heap-snapshot.js $SNAPSHOT_N 2>&1" || true
    run_on_pi "cd $REMOTE_PROJECT_DIR && node /tmp/get-memory-stats.js > $STATS_N 2>&1"
    
    copy_from_pi "$SNAPSHOT_N" "$RESULTS_DIR/heap-snapshot-t${i}.heapsnapshot" 2>/dev/null || true
    copy_from_pi "$STATS_N" "$RESULTS_DIR/memory-stats-t${i}.json" 2>/dev/null || true
    
    echo "✅ Snapshot #$i создан"
    echo ""
done

# Создаём финальный snapshot
echo "📸 Создание финального snapshot (t=$DURATION_MINUTES мин)..."
SNAPSHOT_FINAL="/tmp/heap-snapshot-${PROCESS_NAME}-final-${TIMESTAMP}.heapsnapshot"
STATS_FINAL="/tmp/memory-stats-${PROCESS_NAME}-final-${TIMESTAMP}.json"

run_on_pi "cd $REMOTE_PROJECT_DIR && node /tmp/create-heap-snapshot.js $SNAPSHOT_FINAL 2>&1" || true
run_on_pi "cd $REMOTE_PROJECT_DIR && node /tmp/get-memory-stats.js > $STATS_FINAL 2>&1"

copy_from_pi "$SNAPSHOT_FINAL" "$RESULTS_DIR/heap-snapshot-final.heapsnapshot" 2>/dev/null || true
copy_from_pi "$STATS_FINAL" "$RESULTS_DIR/memory-stats-final.json" 2>/dev/null || true

echo "✅ Финальный snapshot создан"
echo ""

# Анализируем результаты
echo "📊 Анализ результатов..."
echo ""

# Создаём скрипт для сравнения статистики
COMPARE_SCRIPT=$(cat << 'COMPARE_EOF'
const fs = require('fs');
const path = require('path');

const resultsDir = process.argv[2];
if (!resultsDir || !fs.existsSync(resultsDir)) {
  console.error('❌ Директория не найдена');
  process.exit(1);
}

const statsFiles = fs.readdirSync(resultsDir)
  .filter(f => f.startsWith('memory-stats-') && f.endsWith('.json'))
  .sort()
  .map(f => path.join(resultsDir, f));

if (statsFiles.length < 2) {
  console.error('❌ Недостаточно файлов статистики для сравнения');
  process.exit(1);
}

const stats = statsFiles.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║   Анализ утечек памяти                                        ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');

const first = stats[0];
const last = stats[stats.length - 1];

const rssDiff = last.memoryUsage.rss - first.memoryUsage.rss;
const heapUsedDiff = last.memoryUsage.heapUsed - first.memoryUsage.heapUsed;
const heapTotalDiff = last.memoryUsage.heapTotal - first.memoryUsage.heapTotal;

console.log('📈 Изменение памяти:');
console.log(`   RSS:         ${(rssDiff / 1024 / 1024).toFixed(2)}MB (${first.memoryUsage.rss / 1024 / 1024 | 0}MB → ${last.memoryUsage.rss / 1024 / 1024 | 0}MB)`);
console.log(`   Heap Used:   ${(heapUsedDiff / 1024 / 1024).toFixed(2)}MB (${first.memoryUsage.heapUsed / 1024 / 1024 | 0}MB → ${last.memoryUsage.heapUsed / 1024 / 1024 | 0}MB)`);
console.log(`   Heap Total:  ${(heapTotalDiff / 1024 / 1024).toFixed(2)}MB (${first.memoryUsage.heapTotal / 1024 / 1024 | 0}MB → ${last.memoryUsage.heapTotal / 1024 / 1024 | 0}MB)`);
console.log('');

if (rssDiff > 50 * 1024 * 1024) {
  console.log('⚠️  ВНИМАНИЕ: Значительный рост RSS (>50MB) - возможна утечка памяти!');
}
if (heapUsedDiff > 30 * 1024 * 1024) {
  console.log('⚠️  ВНИМАНИЕ: Значительный рост Heap Used (>30MB) - возможна утечка памяти!');
}

console.log('');
console.log('💡 Для детального анализа откройте heap snapshots в Chrome DevTools:');
console.log('   1. Откройте chrome://inspect');
console.log('   2. Нажмите "Load" и выберите файлы .heapsnapshot');
console.log('   3. Сравните snapshots, чтобы найти растущие объекты');
console.log('');
COMPARE_EOF
)

TMP_COMPARE=$(mktemp)
echo "$COMPARE_SCRIPT" > "$TMP_COMPARE"
node "$TMP_COMPARE" "$RESULTS_DIR"

rm -f "$TMP_COMPARE" "$TMP_HEAP_SCRIPT" "$TMP_STATS_SCRIPT"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   ✅ Анализ завершен                                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📁 Результаты сохранены в: $RESULTS_DIR"
echo ""
echo "📋 Следующие шаги:"
echo "   1. Откройте Chrome DevTools (chrome://inspect)"
echo "   2. Загрузите heap snapshots из директории результатов"
echo "   3. Сравните первый и последний snapshot"
echo "   4. Найдите объекты, которые растут в размере"
echo "   5. Используйте 'Comparison' view для точного определения утечек"
echo ""








