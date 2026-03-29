#!/usr/bin/env node

/**
 * Скрипт для резолва устройства Dim1 через WebSocket (БЕЗ БД)
 * 
 * Зачем: Отрезолвить привязки каналов актуатора Dim1 используя только WebSocket API
 * 
 * Устройство:
 *   ID: 68:27:19:e4:49:17
 *   Тип: DIM_8 (164)
 *   Каналы с проблемами:
 *     - DIM/1: bind: fd8e5a40-79f4-4990-87b5-64f79b2e7029
 *     - DIM/6: bind: a0272cfa-03de-4c91-a48e-8b739d62de66
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTUATOR_ID = '68:27:19:e4:49:17'; // Dim1
const DEVICE_TYPE = 0xa4; // DIM_8

// Зачем: Каналы DIM_8 актуатора (8 каналов)
const CHANNEL_IDS = [
  `${ACTUATOR_ID}/dim/1`,
  `${ACTUATOR_ID}/dim/2`,
  `${ACTUATOR_ID}/dim/3`,
  `${ACTUATOR_ID}/dim/4`,
  `${ACTUATOR_ID}/dim/5`,
  `${ACTUATOR_ID}/dim/6`,
  `${ACTUATOR_ID}/dim/7`,
  `${ACTUATOR_ID}/dim/8`,
];

async function resolveDeviceViaWebSocket() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ РЕЗОЛВИНГ УСТРОЙСТВА DIM1 ЧЕРЕЗ WEBSOCKET (БЕЗ БД)      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Актуатор: Dim1`);
  console.log(`ID: ${ACTUATOR_ID}`);
  console.log(`Тип: DIM_8 (0x${DEVICE_TYPE.toString(16)})\n`);
  
  const ws = new WebSocket(WS_URI);
  const messages = [];
  let requestPhase = 1; // Зачем: Отслеживаем фазу запросов (1-актуатор, 2-каналы, 3-устройства)
  
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
  ws.on('open', () => {
    console.log(`[✓] Подключено к ${WS_URI}\n`);
    
    // Зачем: Фаза 1 - запрашиваем данные актуатора и его каналов
    console.log('[ФАЗА 1] Запрашиваем актуатор и каналы...');
    const phase1Ids = [ACTUATOR_ID, ...CHANNEL_IDS];
    ws.send(JSON.stringify({ type: 'get', state: phase1Ids }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      messages.push(message);
      
      // Зачем: Отслеживаем получение всех ответов фазы 1
      if (requestPhase === 1) {
        const phase1Ids = [ACTUATOR_ID, ...CHANNEL_IDS];
        const receivedIds = messages
          .filter(m => m.type === 'ACTION_SET')
          .map(m => m.id);
        
        // Зачем: Проверяем, получили ли мы все ID фазы 1
        const allPhase1Received = phase1Ids.every(id => receivedIds.includes(id));
        
        if (allPhase1Received) {
          console.log(`[✓] Получены данные актуатора и ${CHANNEL_IDS.length} каналов\n`);
          
          // Зачем: Фаза 2 - собираем UUID из bind каналов и помещений
          console.log('[ФАЗА 2] Собираем UUID для запроса связанных устройств...');
          const uuidsToRequest = new Set();
          
          CHANNEL_IDS.forEach(channelId => {
            const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
            if (channelMsg && channelMsg.payload && channelMsg.payload.bind) {
              const bind = channelMsg.payload.bind;
              // Зачем: Если bind это UUID (не содержит '/'), добавляем его
              if (!bind.includes('/')) {
                uuidsToRequest.add(bind);
                console.log(`  - Найден bind: ${bind} (канал ${channelId})`);
              }
            }
          });
          
          // Зачем: Добавляем UUID помещения актуатора
          const actuatorMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === ACTUATOR_ID);
          if (actuatorMsg && actuatorMsg.payload && actuatorMsg.payload.site) {
            const site = actuatorMsg.payload.site;
            if (typeof site === 'string') {
              uuidsToRequest.add(site);
              console.log(`  - Найдено помещение: ${site}`);
            } else if (Array.isArray(site) && site.length > 0) {
              uuidsToRequest.add(site[0]);
              console.log(`  - Найдено помещение: ${site[0]}`);
            }
          }
          
          if (uuidsToRequest.size > 0) {
            console.log(`\n[ФАЗА 2] Запрашиваем ${uuidsToRequest.size} связанных устройств...`);
            ws.send(JSON.stringify({ type: 'get', state: Array.from(uuidsToRequest) }));
            requestPhase = 2;
            
            // Зачем: Ждем ответы на запрос связанных устройств
            setTimeout(() => {
              console.log('[✓] Обработка завершена\n');
              clearTimeout(timeout);
              processResults(messages);
              ws.close();
              process.exit(0);
            }, 3000);
          } else {
            console.log('\n[!] Не найдено связанных устройств для запроса\n');
            clearTimeout(timeout);
            processResults(messages);
            ws.close();
            process.exit(0);
          }
        }
      }
    } catch (e) {
      console.error('[ERROR] Ошибка парсинга сообщения:', e.message);
    }
  });
  
  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
}

function processResults(messages) {
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📊 РЕЗУЛЬТАТЫ РЕЗОЛВИНГА\n');
  
  // Зачем: Собираем данные из сообщений
  const deviceData = new Map();
  const channelData = new Map();
  
  messages.forEach(msg => {
    if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
      if (CHANNEL_IDS.includes(msg.id)) {
        channelData.set(msg.id, msg.payload);
      } else {
        deviceData.set(msg.id, msg.payload);
      }
    }
  });
  
  // Зачем: Получаем данные актуатора
  const actuatorData = deviceData.get(ACTUATOR_ID) || {};
  const actuatorSite = actuatorData.site ? (Array.isArray(actuatorData.site) ? actuatorData.site[0] : actuatorData.site) : null;
  
  // Зачем: Получаем название помещения
  let siteName = null;
  if (actuatorSite) {
    const siteData = deviceData.get(actuatorSite);
    if (siteData) {
      siteName = siteData.title || siteData.code || siteData.name || actuatorSite;
    }
  }
  
  // Зачем: Выводим информацию об актуаторе
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║ ИНФОРМАЦИЯ ОБ УСТРОЙСТВЕ                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  console.log(`Название (title): ${actuatorData.title || '—'}`);
  console.log(`Код (code): ${actuatorData.code || '—'}`);
  console.log(`Имя (name): ${actuatorData.name || '—'}`);
  console.log(`ID: ${ACTUATOR_ID}`);
  console.log(`Тип: DIM_8 (${DEVICE_TYPE})`);
  console.log(`Категория: Актуатор`);
  console.log(`Помещение: ${siteName || actuatorSite || '—'}`);
  if (actuatorSite) {
    console.log(`UUID помещения: ${actuatorSite}`);
  }
  
  console.log('\nСтатус подключения:');
  console.log(`  Значение (value): ${actuatorData.value !== undefined ? actuatorData.value : '—'}`);
  console.log(`  Инициализировано (initialized): ${actuatorData.initialized ? 'Да' : 'Нет'}`);
  console.log(`  Онлайн (online): ${actuatorData.online ? 'Да' : 'Нет'}`);
  console.log(`  Готов (ready): ${actuatorData.ready ? '🟢 Да' : '🔴 Нет'}`);
  console.log(`  IP-адрес (ip): ${actuatorData.ip || '—'}`);
  
  if (actuatorData.timestamp) {
    const date = new Date(actuatorData.timestamp);
    console.log(`  Timestamp: ${date.toLocaleString('ru-RU')}`);
  }
  
  // Зачем: Выводим информацию о каналах
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║ КАНАЛЫ АКТУАТОРА                                          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  console.log('  Диммер (DIM) каналы:');
  
  CHANNEL_IDS.forEach((channelId, index) => {
    const channelIndex = index + 1;
    const data = channelData.get(channelId);
    
    if (!data) {
      console.log(`    DIM/${channelIndex}: ⚠️  Данные не получены`);
      return;
    }
    
    const value = data.value !== undefined ? data.value : '—';
    const bind = data.bind || null;
    
    let line = `    DIM/${channelIndex}: ${value} (0-255)`;
    
    if (bind) {
      // Зачем: Проверяем, является ли bind UUID
      if (!bind.includes('/')) {
        const linkedDevice = deviceData.get(bind);
        if (linkedDevice) {
          const deviceType = linkedDevice.type || '—';
          const deviceSiteId = linkedDevice.site ? (Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site) : null;
          
          // Зачем: Формируем отображение имени устройства
          const displayName = linkedDevice.title || linkedDevice.code || linkedDevice.name || bind.substring(0, 8) + '...';
          line += ` → ${displayName}`;
          
          // Зачем: Добавляем информацию о типе устройства
          if (deviceType) {
            line += ` (${deviceType})`;
          }
          
          // Зачем: Добавляем информацию о помещении
          if (deviceSiteId) {
            const deviceSiteData = deviceData.get(deviceSiteId);
            if (deviceSiteData) {
              const deviceSiteName = deviceSiteData.title || deviceSiteData.code || deviceSiteData.name || deviceSiteId;
              line += ` / ${deviceSiteName}`;
            }
          }
          
          console.log(line);
          console.log(`      bind: ${bind}`);
          
          // Зачем: Выводим детальную информацию о связанном устройстве
          if (linkedDevice.title || linkedDevice.code || linkedDevice.name) {
            const details = [];
            if (linkedDevice.title) details.push(`title: "${linkedDevice.title}"`);
            if (linkedDevice.code) details.push(`code: "${linkedDevice.code}"`);
            if (linkedDevice.name) details.push(`name: "${linkedDevice.name}"`);
            console.log(`      └─ ${details.join(', ')}`);
          }
        } else {
          console.log(line + ` → ⚠️  Устройство не найдено`);
          console.log(`      bind: ${bind} [запрошено через WebSocket]`);
        }
      } else {
        // Зачем: Формат MAC-адрес/тип/индекс
        const [mac, type, idx] = bind.split('/');
        console.log(line + ` → Связь с ${mac}/${type}/${idx}`);
        console.log(`      bind: ${bind}`);
      }
    } else {
      console.log(line + ` → (не привязан)`);
    }
  });
  
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  // Зачем: Выводим сводку
  const channelsWithBind = Array.from(channelData.values()).filter(d => d.bind).length;
  const channelsWithoutBind = CHANNEL_IDS.length - channelsWithBind;
  const unresolvedBinds = Array.from(channelData.values()).filter(d => {
    if (!d.bind || d.bind.includes('/')) return false;
    return !deviceData.has(d.bind);
  }).length;
  
  console.log('📈 СВОДКА:');
  console.log(`  Всего каналов: ${CHANNEL_IDS.length}`);
  console.log(`  С привязками (bind): ${channelsWithBind}`);
  console.log(`  Без привязок: ${channelsWithoutBind}`);
  console.log(`  Не отрезолвлено: ${unresolvedBinds}`);
  console.log('');
}

resolveDeviceViaWebSocket().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
