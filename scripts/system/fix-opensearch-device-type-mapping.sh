#!/bin/bash

#
# Исправление маппинга device.type в OpenSearch
#
# Проблема: индекс был создан с маппингом device.type как 'long', 
# но в событиях приходят строковые значения ('site', 'timer', 'ACTION_DOPPLER_HANDLE', 'light_LED')
#
# Решение: создаём новый индекс с правильным маппингом (keyword) и переиндексируем данные
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🔧 Исправление маппинга device.type в OpenSearch на Raspberry Pi ($HOST)"
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

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

# Создаём скрипт для исправления маппинга
FIX_SCRIPT=$(mktemp)
cat > "$FIX_SCRIPT" << 'SCRIPT_EOF'
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Конфигурация из переменных окружения
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const OPENSEARCH_INDEX_PREFIX = process.env.OPENSEARCH_INDEX_PREFIX || 'reacthome-events';
const OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT || path.join(os.homedir(), '.opensearch', 'root.crt');

// HTTPS Agent
let httpsAgent = null;
if (fs.existsSync(OPENSEARCH_CA_CERT)) {
  const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
  httpsAgent = new https.Agent({
    ca: ca,
    rejectUnauthorized: true
  });
} else {
  httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
}

const authHeader = `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`;

// Получение текущего маппинга индекса
async function getIndexMapping(indexName) {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}/_mapping`, {
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    return data[indexName]?.mappings || null;
  } catch (error) {
    console.error(`Ошибка получения маппинга для ${indexName}:`, error.message);
    return null;
  }
}

// Проверка типа поля device.type
function checkDeviceTypeMapping(mapping) {
  if (!mapping || !mapping.properties || !mapping.properties.device) {
    return null;
  }
  
  const deviceTypeMapping = mapping.properties.device.properties?.type;
  if (!deviceTypeMapping) {
    return null;
  }
  
  return deviceTypeMapping.type || null;
}

// Получение списка индексов
async function getIndices() {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/_cat/indices/${OPENSEARCH_INDEX_PREFIX}-*?format=json&h=index`, {
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    return data.map(item => item.index).sort();
  } catch (error) {
    console.error('Ошибка получения списка индексов:', error.message);
    return [];
  }
}

// Обновление маппинга через PUT mapping API
async function updateMapping(indexName) {
  try {
    const mappingUpdate = {
      properties: {
        device: {
          properties: {
            type: { type: 'keyword' }
          }
        }
      }
    };
    
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}/_mapping`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(mappingUpdate),
      agent: httpsAgent
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Ошибка обновления маппинга для ${indexName}:`, error.message);
    return false;
  }
}

// Основная функция
async function main() {
  console.log('🔍 Проверка маппинга индексов...\n');
  
  const indices = await getIndices();
  if (indices.length === 0) {
    console.log('❌ Индексы не найдены');
    process.exit(1);
  }
  
  console.log(`Найдено индексов: ${indices.length}\n`);
  
  let fixedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  for (const indexName of indices) {
    console.log(`Проверка индекса: ${indexName}`);
    
    const mapping = await getIndexMapping(indexName);
    if (!mapping) {
      console.log(`  ⚠️  Маппинг не найден, пропускаем\n`);
      skippedCount++;
      continue;
    }
    
    const deviceType = checkDeviceTypeMapping(mapping);
    console.log(`  Тип device.type: ${deviceType || 'не найден'}`);
    
    if (deviceType === 'long') {
      console.log(`  🔧 Обновление маппинга...`);
      const success = await updateMapping(indexName);
      if (success) {
        console.log(`  ✅ Маппинг обновлён\n`);
        fixedCount++;
      } else {
        console.log(`  ❌ Ошибка обновления маппинга\n`);
        errorCount++;
      }
    } else if (deviceType === 'keyword') {
      console.log(`  ✅ Маппинг уже правильный (keyword)\n`);
      skippedCount++;
    } else {
      console.log(`  ⚠️  Неизвестный тип маппинга, пропускаем\n`);
      skippedCount++;
    }
  }
  
  console.log('\n==========================================');
  console.log('Результаты:');
  console.log(`  Исправлено: ${fixedCount}`);
  console.log(`  Пропущено: ${skippedCount}`);
  console.log(`  Ошибок: ${errorCount}`);
  console.log('==========================================\n');
  
  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
SCRIPT_EOF

# Копируем скрипт на малинку
echo "📤 Копирование скрипта на Raspberry Pi..."
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

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/fix-device-type-mapping.js" "$FIX_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "✅ Скрипт скопирован"
echo ""

# Запускаем скрипт на малинке из директории проекта (где установлены зависимости)
# Загружаем переменные окружения из .env файла
echo "🚀 Запуск скрипта исправления маппинга..."
echo ""

run_on_pi "cd $PROJECT_DIR && cp /tmp/fix-device-type-mapping.js . && set -a && [ -f .env ] && source .env && set +a && node fix-device-type-mapping.js && rm -f fix-device-type-mapping.js"

echo ""
echo "🧹 Очистка временных файлов..."
run_on_pi "rm -f /tmp/fix-device-type-mapping.js"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$FIX_SCRIPT"

echo ""
echo "=========================================="
echo "✅ Исправление маппинга завершено"
echo "=========================================="
echo ""
echo "⚠️  ВАЖНО: Если обновление маппинга не помогло (из-за существующих данных),"
echo "   нужно будет пересоздать индексы или использовать reindex API."
echo ""
