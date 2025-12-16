#!/bin/bash

#
# Проверка всех индексов OpenSearch на правильность маппинга device.type
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

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

# Создаём скрипт для проверки всех индексов
CHECK_SCRIPT=$(mktemp)
cat > "$CHECK_SCRIPT" << 'SCRIPT_EOF'
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const OPENSEARCH_INDEX_PREFIX = process.env.OPENSEARCH_INDEX_PREFIX || 'reacthome-events';
const OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT || path.join(os.homedir(), '.opensearch', 'root.crt');

let httpsAgent = null;
if (fs.existsSync(OPENSEARCH_CA_CERT)) {
  const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
  httpsAgent = new https.Agent({ ca: ca, rejectUnauthorized: true });
} else {
  httpsAgent = new https.Agent({ rejectUnauthorized: false });
}

const authHeader = `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`;

async function getIndices() {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/_cat/indices/${OPENSEARCH_INDEX_PREFIX}-*?format=json&h=index,creation.date.string`, {
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()).sort((a, b) => a.index.localeCompare(b.index));
  } catch (error) {
    console.error('Ошибка получения индексов:', error.message);
    return [];
  }
}

async function getIndexMapping(indexName) {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}/_mapping`, {
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data[indexName]?.mappings || null;
  } catch (error) {
    console.error(`Ошибка получения маппинга для ${indexName}:`, error.message);
    return null;
  }
}

function checkDeviceTypeMapping(mapping) {
  if (!mapping?.properties?.device?.properties?.type) return null;
  return mapping.properties.device.properties.type.type || null;
}

async function main() {
  console.log('🔍 Проверка всех индексов OpenSearch...\n');
  
  const indices = await getIndices();
  if (indices.length === 0) {
    console.log('❌ Индексы не найдены');
    process.exit(1);
  }
  
  console.log(`Найдено индексов: ${indices.length}\n`);
  console.log('Индекс | Дата создания | Тип device.type | Статус');
  console.log('-------|---------------|------------------|--------');
  
  let correctCount = 0;
  let incorrectCount = 0;
  
  for (const item of indices) {
    const indexName = item.index;
    const creationDate = item['creation.date.string'] || 'неизвестно';
    
    const mapping = await getIndexMapping(indexName);
    const deviceType = checkDeviceTypeMapping(mapping);
    
    let status = '❓';
    if (deviceType === 'keyword') {
      status = '✅';
      correctCount++;
    } else if (deviceType === 'long') {
      status = '❌';
      incorrectCount++;
    }
    
    console.log(`${indexName} | ${creationDate} | ${deviceType || 'не найден'} | ${status}`);
  }
  
  console.log('\n==========================================');
  console.log(`✅ Правильных маппингов: ${correctCount}`);
  console.log(`❌ Неправильных маппингов: ${incorrectCount}`);
  console.log('==========================================\n');
  
  if (incorrectCount > 0) {
    console.log('⚠️  Обнаружены индексы с неправильным маппингом!');
    console.log('   Запустите скрипт fix-opensearch-device-type-mapping.sh для исправления.\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
SCRIPT_EOF

# Копируем и запускаем
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

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/check-all-indices.js" "$CHECK_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

run_on_pi "cd $PROJECT_DIR && cp /tmp/check-all-indices.js . && set -a && [ -f .env ] && source .env && set +a && node check-all-indices.js && rm -f check-all-indices.js"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$CHECK_SCRIPT"
