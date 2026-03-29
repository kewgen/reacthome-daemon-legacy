@#!/usr/bin/env node

/**
 * Скрипт для получения списка всех актуаторов через WebSocket
 * 
 * Зачем: Найти все актуаторы в системе для последующего резолвинга
 * 
 * Использование:
 *   node scripts/list-actuators-via-websocket.js
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

// Зачем: Типы актуаторов
const ACTUATOR_TYPES = {
  // Реле
  0x0a: 'DO8',
  0x0b: 'DO16',
  0x11: 'DO12',
  0x23: 'RELAY_2',
  0xa0: 'RELAY_6',
  0xa1: 'RELAY_12',
  0xa2: 'RELAY_24',
  0xa7: 'RELAY_2_DIN',
  0xae: 'RELAY_12_RS',
  // Диммеры
  0x0e: 'DIM4',
  0x0f: 'DIM8',
  0xa3: 'DIM_4',
  0xa4: 'DIM_8',
  0xa5: 'LANAMP',
  0xaf: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS',
  0xb3: 'DIM_12_AC_RS',
  0xb4: 'DIM_12_DC_RS',
  0xb6: 'DIM_1_AC_RS',
  // Аналоговые выходы
  0xa9: 'AO_4_DIN',
  // Смешанные
  0x41: 'MIX_H',
  0xaa: 'MIX_2',
  0xab: 'MIX_1',
  0xac: 'MIX_1_RS',
  0xb5: 'MIX_6x12_RS',
};

async function listActuators() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ СПИСОК АКТУАТОРОВ В СИСТЕМЕ                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  
  const ws = new WebSocket(WS_URI);
  const actuators = [];
  
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    console.log(`[✓] Подключено к ${WS_URI}\n`);
    console.log('[ЗАПРОС] Получаю список всех устройств...\n');
    
    // Зачем: Запрашиваем список всех устройств
    ws.send(JSON.stringify({ type: 'list' }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Зачем: Обрабатываем ответ на запрос list (формат: [[id, timestamp], ...])
      if ((message.type === 'list' || message.type === 'LIST') && Array.isArray(message.state)) {
        // Зачем: Извлекаем ID устройств из массива пар [id, timestamp]
        const deviceIds = message.state
          .map(item => Array.isArray(item) ? item[0] : item)
          .filter(id => id && !id.includes('/')); // Пропускаем каналы
        
        console.log(`[✓] Получено ${deviceIds.length} устройств\n`);
        
        // Зачем: Запрашиваем данные всех устройств одним запросом
        console.log('[ЗАПРОС] Получаю данные устройств...\n');
        ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
        
        // Зачем: Ждем получения всех данных
        setTimeout(() => {
          clearTimeout(timeout);
          displayActuators(actuators);
          ws.close();
          process.exit(0);
        }, 5000);
      }
      
      // Зачем: Обрабатываем данные устройств
      if (message.type === 'ACTION_SET' && message.id && message.payload) {
        const deviceType = message.payload.type;
        
        // Зачем: Проверяем, является ли устройство актуатором
        if (typeof deviceType === 'number' && ACTUATOR_TYPES[deviceType]) {
          actuators.push({
            id: message.id,
            type: deviceType,
            typeName: ACTUATOR_TYPES[deviceType],
            title: message.payload.title,
            code: message.payload.code,
            name: message.payload.name,
            online: message.payload.online,
            ready: message.payload.ready,
            ip: message.payload.ip,
          });
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });
  
  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
}

function displayActuators(actuators) {
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`📊 НАЙДЕНО АКТУАТОРОВ: ${actuators.length}\n`);
  
  if (actuators.length === 0) {
    console.log('⚠️  Актуаторы не найдены\n');
    return;
  }
  
  // Зачем: Сортируем по типу и имени
  actuators.sort((a, b) => {
    if (a.typeName !== b.typeName) return a.typeName.localeCompare(b.typeName);
    const nameA = a.title || a.code || a.name || a.id;
    const nameB = b.title || b.code || b.name || b.id;
    return nameA.localeCompare(nameB);
  });
  
  // Зачем: Группируем по типам
  const byType = {};
  actuators.forEach(act => {
    if (!byType[act.typeName]) {
      byType[act.typeName] = [];
    }
    byType[act.typeName].push(act);
  });
  
  // Зачем: Выводим по группам
  Object.keys(byType).sort().forEach(typeName => {
    const acts = byType[typeName];
    console.log(`\n${typeName} (${acts.length}):`);
    console.log('─'.repeat(60));
    
    acts.forEach(act => {
      const name = act.title || act.code || act.name || 'без имени';
      const status = act.online ? '🟢' : '🔴';
      const ready = act.ready ? '✓' : '✗';
      const ip = act.ip || '—';
      
      console.log(`  ${status} ${name}`);
      console.log(`     ID: ${act.id}`);
      console.log(`     Тип: ${typeName} (0x${act.type.toString(16)})`);
      console.log(`     Онлайн: ${act.online ? 'Да' : 'Нет'} | Готов: ${ready} | IP: ${ip}`);
      
      // Зачем: Выводим команду для резолвинга
      console.log(`     Резолвинг: node scripts/resolve-actuator-via-websocket.js "${act.id}"`);
      console.log('');
    });
  });
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

listActuators().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
