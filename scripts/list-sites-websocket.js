#!/usr/bin/env node

/**
 * Скрипт для получения списка помещений (sites) через WebSocket
 *
 * Использование:
 *   node scripts/list-sites-websocket.js
 *   REACTHOME_WS_URI="wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316" \
 *   node scripts/list-sites-websocket.js
 *
 * Зачем: Получает список всех помещений (sites) через WebSocket с поддержкой gateway
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
try {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        const [k, ...v] = t.split('=');
        if (k) process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    });
  }
} catch (e) {}

const PI_HOST = process.env.REACTHOME_PI_HOST || '192.168.88.4';
const PI_WS_PORT = process.env.REACTHOME_PI_WS_PORT || '3000';
const WS_URI = process.env.REACTHOME_WS_URI || `ws://${PI_HOST}:${PI_WS_PORT}`;

// Зачем: Определяем, является ли URI gateway для использования subprotocol 'listen'
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');

async function listSites() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ СПИСОК ПОМЕЩЕНИЙ (SITES)                                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`WebSocket: ${WS_URI}`);
  if (isGateway) {
    console.log(`Тип: Gateway (используется subprotocol 'listen')\n`);
  } else {
    console.log(`Тип: Локальное подключение\n`);
  }
  
  // Зачем: Используем subprotocol 'listen' для gateway подключения
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  const siteIds = [];
  const sites = new Map();
  
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    console.log(`Получено сообщений: ${siteIds.length} ID, ${sites.size} помещений`);
    ws.close();
    process.exit(1);
  }, 30000);
  
  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    
    // Зачем: Сначала запрашиваем список всех объектов через LIST
    console.log('[STEP] Запрашиваем список всех объектов...');
    ws.send(JSON.stringify({ type: 'list' }));
    
    setTimeout(() => {
      // Зачем: Фильтруем только ID помещений из списка
      const allSiteIds = siteIds.filter(id => !id.includes('/'));
      
      if (allSiteIds.length === 0) {
        console.log('[WARNING] Помещения не найдены в LIST ответе');
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }
      
      console.log(`[STEP] Запрашиваем данные ${allSiteIds.length} объектов для поиска помещений...`);
      
      // Зачем: Запрашиваем данные всех объектов батчами по 100 для оптимизации
      const BATCH_SIZE = 100;
      for (let i = 0; i < allSiteIds.length; i += BATCH_SIZE) {
        const batch = allSiteIds.slice(i, i + BATCH_SIZE);
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'get', state: batch }));
        }, i / BATCH_SIZE * 500); // Зачем: Распределяем запросы во времени
      }
      
      // Зачем: Даём время на получение всех ответов
      setTimeout(() => {
        clearTimeout(timeout);
        processResults();
        ws.close();
        process.exit(0);
      }, 5000 + Math.ceil(allSiteIds.length / BATCH_SIZE) * 1000);
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      let dataStr = data.toString();
      
      // Зачем: Для gateway сообщения приходят с префиксом session ID (36 символов)
      if (isGateway && dataStr.length >= 36) {
        const prefix = dataStr.substring(0, 36);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(prefix)) {
          dataStr = dataStr.substring(36);
        }
      }
      
      const message = JSON.parse(dataStr);
      
      // Зачем: Собираем ID объектов из LIST ответа
      if (message.type === 'list' && message.state) {
        message.state.forEach(([id]) => {
          siteIds.push(id);
        });
      }
      
      // Зачем: Сохраняем данные помещений из ACTION_SET ответов
      if (message.type === 'ACTION_SET' && message.payload) {
        const payload = message.payload;
        if (payload.type === 'site' || payload.type === 'SITE') {
          const site = {
            id: message.id,
            title: payload.title,
            code: payload.code,
            name: payload.name,
            project: payload.project,
            parent: payload.parent,
            payload: payload
          };
          sites.set(message.id, site);
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга отдельных сообщений
    }
  });
  
  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
  
  // Зачем: Функция для обработки и вывода результатов
  function processResults() {
    console.log('\n═══════════════════════════════════════════════════════════\n');
    
    const sitesArray = Array.from(sites.values());
    
    // Зачем: Сортируем помещения по названию для удобства просмотра
    sitesArray.sort((a, b) => {
      const nameA = (a.title || a.code || a.name || a.id).toLowerCase();
      const nameB = (b.title || b.code || b.name || b.id).toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    console.log(`📊 НАЙДЕНО ПОМЕЩЕНИЙ: ${sitesArray.length}\n`);
    
    if (sitesArray.length === 0) {
      console.log('⚠️  Помещения не найдены\n');
    } else {
      sitesArray.forEach((site, index) => {
        const siteName = site.title || site.code || site.name || site.id;
        console.log(`${index + 1}. ${siteName}`);
        console.log(`   ID: ${site.id}`);
        if (site.code && site.code !== siteName) {
          console.log(`   Code: ${site.code}`);
        }
        if (site.title && site.title !== siteName) {
          console.log(`   Title: ${site.title}`);
        }
        if (site.name && site.name !== siteName) {
          console.log(`   Name: ${site.name}`);
        }
        console.log('');
      });
      
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('📋 ID ВСЕХ ПОМЕЩЕНИЙ:\n');
      sitesArray.forEach(site => {
        console.log(`  ${site.id}`);
      });
    }
    
    console.log('\n═══════════════════════════════════════════════════════════\n');
  }
}

listSites().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
