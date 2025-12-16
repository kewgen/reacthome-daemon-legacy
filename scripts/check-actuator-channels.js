#!/usr/bin/env node

/**
 * Скрипт для проверки состояния каналов актуатора
 * 
 * Использование:
 *   node scripts/check-actuator-channels.js "68:27:19:e4:49:19"
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTUATOR_ID = process.argv[2] || '68:27:19:e4:49:19';

const ws = new WebSocket(WS_URI);
const messages = [];

ws.on('open', () => {
  console.log(`✅ Подключено к ${WS_URI}\n`);
  
  // Зачем: Запрашиваем данные актуатора и его каналов
  const channelIds = [];
  for (let i = 1; i <= 8; i++) {
    channelIds.push(`${ACTUATOR_ID}/dim/${i}`);
  }
  
  console.log(`📤 Запрашиваем данные актуатора и ${channelIds.length} каналов...`);
  ws.send(JSON.stringify({ type: 'get', state: [ACTUATOR_ID, ...channelIds] }));
  
  setTimeout(() => {
    ws.close();
    processResults();
  }, 3000);
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    messages.push(message);
  } catch (e) {
    console.error('Ошибка парсинга:', e.message);
  }
});

function processResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 РЕЗУЛЬТАТЫ ПРОВЕРКИ КАНАЛОВ');
  console.log('='.repeat(80) + '\n');
  
  // Зачем: Находим данные актуатора
  const actuatorMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === ACTUATOR_ID);
  if (actuatorMsg) {
    console.log(`✅ Актуатор найден: ${ACTUATOR_ID}`);
    console.log(`   Тип: ${actuatorMsg.payload?.type || 'не указан'}`);
    console.log(`   Название: ${actuatorMsg.payload?.title || actuatorMsg.payload?.code || 'не указано'}\n`);
  } else {
    console.log(`❌ Актуатор не найден: ${ACTUATOR_ID}\n`);
  }
  
  // Зачем: Проверяем каналы
  console.log('Каналы DIM:');
  for (let i = 1; i <= 8; i++) {
    const channelId = `${ACTUATOR_ID}/dim/${i}`;
    const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
    
    if (channelMsg) {
      const payload = channelMsg.payload || {};
      const value = payload.value !== undefined ? payload.value : '—';
      const bind = payload.bind || null;
      
      console.log(`  DIM/${i}:`);
      console.log(`    ID канала: ${channelId}`);
      console.log(`    Значение: ${value}`);
      console.log(`    Bind: ${bind || '(отсутствует)'}`);
      console.log(`    Все поля payload:`, JSON.stringify(payload, null, 2));
      console.log('');
    } else {
      console.log(`  DIM/${i}: ❌ Канал не найден в ответе`);
      console.log('');
    }
  }
  
  console.log('='.repeat(80));
  console.log(`Всего получено сообщений: ${messages.length}`);
}








