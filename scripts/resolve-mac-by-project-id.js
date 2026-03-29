#!/usr/bin/env node

/**
 * Резолвинг mac (DUID демона) по ID проекта через WebSocket
 * 
 * Использование:
 *   node scripts/resolve-mac-by-project-id.js <PROJECT_ID> [gateway_url]
 * 
 * Переменные окружения:
 *   REACTHOME_WS_URI - базовый URL gateway (по умолчанию: wss://gate.reacthome.net)
 * 
 * Зачем: Найти mac демона по ID проекта для подключения через gateway
 * 
 * Пример:
 *   node scripts/resolve-mac-by-project-id.js ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4
 */

const WebSocket = require('ws');

const PROJECT_ID = process.argv[2];
const GATEWAY_BASE = process.env.REACTHOME_WS_URI || 'wss://gate.reacthome.net';

if (!PROJECT_ID) {
  console.error('❌ Ошибка: не указан PROJECT_ID');
  console.error('Использование: node scripts/resolve-mac-by-project-id.js <PROJECT_ID> [gateway_url]');
  console.error('\nПример:');
  console.error('  node scripts/resolve-mac-by-project-id.js ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4');
  process.exit(1);
}

/**
 * Подключение к демону и поиск project ID
 */
async function findDaemonByProject(daemonMac) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${GATEWAY_BASE}/${daemonMac}`, ['listen']);
    let found = false;
    const timeout = setTimeout(() => {
      if (!found) {
        ws.close();
        resolve(null);
      }
    }, 5000);

    ws.on('open', () => {
      // Запрашиваем объект демона
      ws.send(JSON.stringify({ 
        type: 'get', 
        state: [daemonMac] 
      }));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'ACTION_SET' && message.id === daemonMac) {
          const projectId = message.payload?.project;
          if (projectId === PROJECT_ID) {
            found = true;
            clearTimeout(timeout);
            ws.close();
            resolve(daemonMac);
          }
        }
      } catch (e) {
        // Игнорируем ошибки парсинга
      }
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });

    ws.on('close', () => {
      if (!found) {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  });
}

/**
 * Поиск mac по project ID через перебор известных демонов
 * 
 * ВАЖНО: Это работает только если известны mac адреса демонов заранее.
 * В реальности gateway сервер должен иметь API для поиска демона по project ID.
 */
async function resolveMacByProjectId() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ РЕЗОЛВИНГ MAC ПО PROJECT ID                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Project ID: ${PROJECT_ID}`);
  console.log(`Gateway: ${GATEWAY_BASE}\n`);

  // Известные mac адреса демонов (можно расширить)
  // В реальности это должно быть API на gateway сервере
  const knownDaemons = [
    'd31775ae-19e8-40c9-81df-d6d672379563', // Миндальный (из БД)
    'fd6765f1-ed61-4ae4-8d72-9a078a9f4316', // Почтовый (из документации)
  ];

  console.log(`[STEP 1] Проверяю ${knownDaemons.length} известных демонов...\n`);

  for (const mac of knownDaemons) {
    console.log(`  Проверяю демон: ${mac.substring(0, 8)}...`);
    const result = await findDaemonByProject(mac);
    if (result) {
      console.log(`\n✅ НАЙДЕН ДЕМОН!\n`);
      console.log(`   MAC (DUID): ${result}`);
      console.log(`   Project ID: ${PROJECT_ID}`);
      console.log(`   Gateway URL: ${GATEWAY_BASE}/${result}\n`);
      return result;
    }
  }

  console.log(`\n❌ Демон с project ID "${PROJECT_ID}" не найден среди известных демонов\n`);
  console.log(`💡 РЕШЕНИЕ:`);
  console.log(`   Gateway сервер должен предоставлять API для поиска демона по project ID.`);
  console.log(`   Например: GET https://gate.reacthome.net/api/daemon/by-project/${PROJECT_ID}`);
  console.log(`   Или через WebSocket: подключиться к gateway и запросить список всех демонов.\n`);
  
  return null;
}

/**
 * Альтернативный способ: через WebSocket запрос к gateway
 * 
 * Если gateway поддерживает запрос списка демонов, можно использовать этот метод
 */
async function resolveViaGatewayAPI() {
  console.log(`\n[STEP 2] Попытка резолвинга через gateway API...\n`);
  
  // TODO: Если gateway имеет API endpoint для поиска демона по project ID
  // Например: wss://gate.reacthome.net/api/daemon/by-project/${PROJECT_ID}
  
  console.log(`⚠️  Gateway API для поиска демона по project ID не реализован в клиентском коде.`);
  console.log(`   Это должно быть реализовано на стороне gateway сервера.\n`);
}

// Запуск
resolveMacByProjectId()
  .then((mac) => {
    if (mac) {
      console.log(`📋 Результат (JSON):`);
      console.log(JSON.stringify({ 
        projectId: PROJECT_ID, 
        daemonMac: mac,
        gatewayUrl: `${GATEWAY_BASE}/${mac}`
      }, null, 2));
      process.exit(0);
    } else {
      resolveViaGatewayAPI()
        .then(() => process.exit(1))
        .catch(() => process.exit(1));
    }
  })
  .catch((error) => {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  });
