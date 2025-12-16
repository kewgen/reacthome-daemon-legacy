#!/bin/bash

#
# Пересоздание индекса OpenSearch с правильным маппингом
#
# Удаляет текущий индекс и создаёт новый с правильным маппингом для timestamp
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

# Дата индекса (по умолчанию сегодня)
INDEX_DATE="${1:-$(date +%Y-%m-%d)}"
INDEX_NAME="reacthome-events--${INDEX_DATE}"

echo "🔄 Пересоздание индекса OpenSearch: $INDEX_NAME"
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

# Создаём скрипт для пересоздания индекса
RECREATE_SCRIPT=$(mktemp)
cat > "$RECREATE_SCRIPT" << 'SCRIPT_EOF'
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const INDEX_NAME = process.argv[2] || `reacthome-events--${new Date().toISOString().split('T')[0]}`;
const OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT || path.join(os.homedir(), '.opensearch', 'root.crt');

let httpsAgent = null;
if (fs.existsSync(OPENSEARCH_CA_CERT)) {
  const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
  httpsAgent = new https.Agent({ ca: ca, rejectUnauthorized: true });
} else {
  httpsAgent = new https.Agent({ rejectUnauthorized: false });
}

const authHeader = `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`;

// Проверка существования индекса
async function indexExists(indexName) {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}`, {
      method: 'HEAD',
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    return response.status === 200;
  } catch (error) {
    console.error(`Ошибка проверки индекса ${indexName}:`, error.message);
    return false;
  }
}

// Получение количества документов в индексе
async function getDocumentCount(indexName) {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}/_count`, {
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    if (!response.ok) return 0;
    const data = await response.json();
    return data.count || 0;
  } catch (error) {
    console.error(`Ошибка получения количества документов:`, error.message);
    return 0;
  }
}

// Удаление индекса
async function deleteIndex(indexName) {
  try {
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}`, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader },
      agent: httpsAgent
    });
    
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Ошибка удаления индекса ${indexName}:`, error.message);
    return false;
  }
}

// Создание индекса с правильным маппингом
async function createIndex(indexName) {
  try {
    const mapping = {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        'index.mapper.dynamic': false
      },
      mappings: {
        properties: {
          timestamp: { type: 'date' },  // Правильный тип для ISO строки
          id: { type: 'keyword' },
          device: {
            properties: {
              type: { type: 'keyword' },
              type_hex: { type: 'keyword' },
              human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              name: { type: 'keyword' }
            }
          },
          param: { type: 'keyword' },
          old: { type: 'keyword' },
          new: { type: 'keyword' },
          value: {
            properties: {
              old: { type: 'float' },
              new: { type: 'float' }
            }
          },
          trigger: {
            properties: {
              type: { type: 'keyword' },
              ref: { type: 'keyword' },
              id: { type: 'keyword' },
              human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              session: { type: 'keyword' },
              remote_ip: { type: 'ip' }
            }
          },
          site: { type: 'keyword' },
          project: { type: 'keyword' },
          trace_id: { type: 'keyword' },
          extra: { type: 'object', enabled: false },
          payload: { type: 'object', enabled: false }
        }
      }
    };
    
    const response = await fetch(`${OPENSEARCH_URL}/${indexName}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(mapping),
      agent: httpsAgent
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return true;
  } catch (error) {
    console.error(`Ошибка создания индекса ${indexName}:`, error.message);
    return false;
  }
}

// Основная функция
async function main() {
  console.log(`🔍 Проверка индекса: ${INDEX_NAME}\n`);
  
  const exists = await indexExists(INDEX_NAME);
  
  if (exists) {
    const docCount = await getDocumentCount(INDEX_NAME);
    console.log(`📊 Текущее состояние:`);
    console.log(`   Индекс существует: ✅`);
    console.log(`   Количество документов: ${docCount}\n`);
    
    if (docCount > 0) {
      console.log(`⚠️  ВНИМАНИЕ: В индексе ${docCount} документов!`);
      console.log(`   При удалении индекса все данные будут потеряны.\n`);
      console.log(`❓ Продолжить удаление? (y/n): `);
      
      // В интерактивном режиме нужно подтверждение
      // Для автоматического режима используем переменную окружения
      if (process.env.FORCE_RECREATE !== 'true') {
        console.log(`   Используйте FORCE_RECREATE=true для автоматического подтверждения`);
        process.exit(1);
      }
    }
    
    console.log(`🗑️  Удаление индекса...`);
    const deleted = await deleteIndex(INDEX_NAME);
    if (!deleted) {
      console.error(`❌ Не удалось удалить индекс`);
      process.exit(1);
    }
    console.log(`✅ Индекс удалён\n`);
  } else {
    console.log(`ℹ️  Индекс не существует, будет создан новый\n`);
  }
  
  console.log(`📝 Создание индекса с правильным маппингом...`);
  const created = await createIndex(INDEX_NAME);
  if (!created) {
    console.error(`❌ Не удалось создать индекс`);
    process.exit(1);
  }
  console.log(`✅ Индекс создан: ${INDEX_NAME}\n`);
  
  console.log(`==========================================`);
  console.log(`✅ Пересоздание индекса завершено`);
  console.log(`==========================================\n`);
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

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "/tmp/recreate-index.js" "$RECREATE_SCRIPT" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "✅ Скрипт скопирован"
echo ""

# Запускаем скрипт на малинке
echo "🚀 Запуск скрипта пересоздания индекса..."
echo ""

# Если индекс содержит данные, запрашиваем подтверждение
DOC_COUNT=$(run_on_pi "cd $PROJECT_DIR && set -a && [ -f .env ] && source .env && set +a && node -e \"
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const INDEX_NAME = '$INDEX_NAME';
const OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT || path.join(os.homedir(), '.opensearch', 'root.crt');
let httpsAgent = null;
if (fs.existsSync(OPENSEARCH_CA_CERT)) {
  const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
  httpsAgent = new https.Agent({ ca: ca, rejectUnauthorized: true });
} else {
  httpsAgent = new https.Agent({ rejectUnauthorized: false });
}
const authHeader = 'Basic ' + Buffer.from(OPENSEARCH_USER + ':' + OPENSEARCH_PASSWORD).toString('base64');
fetch(OPENSEARCH_URL + '/' + INDEX_NAME + '/_count', {
  headers: { 'Authorization': authHeader },
  agent: httpsAgent
}).then(r => r.json()).then(d => console.log(d.count || 0)).catch(() => console.log('0'));
\"" 2>/dev/null | tail -1)

if [ -n "$DOC_COUNT" ] && [ "$DOC_COUNT" != "0" ] && [ "$DOC_COUNT" != "undefined" ]; then
    echo "⚠️  ВНИМАНИЕ: В индексе $INDEX_NAME найдено $DOC_COUNT документов!"
    echo ""
    echo "При пересоздании индекса все данные будут потеряны."
    echo ""
    read -p "Продолжить? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "❌ Отменено пользователем"
        rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$RECREATE_SCRIPT"
        exit 1
    fi
    echo ""
fi

# Запускаем с FORCE_RECREATE=true для автоматического подтверждения
run_on_pi "cd $PROJECT_DIR && cp /tmp/recreate-index.js . && set -a && [ -f .env ] && source .env && set +a && FORCE_RECREATE=true node recreate-index.js '$INDEX_NAME' && rm -f recreate-index.js"

echo ""
echo "🧹 Очистка временных файлов..."
run_on_pi "rm -f /tmp/recreate-index.js"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$RECREATE_SCRIPT"

echo ""
echo "=========================================="
echo "✅ Пересоздание индекса завершено"
echo "=========================================="
echo ""
echo "ℹ️  Новые события будут индексироваться с правильным форматом timestamp"
echo ""
