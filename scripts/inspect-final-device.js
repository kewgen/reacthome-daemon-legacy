#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DEVICE_ID = '24ae3078-f4f4-4989-955e-d08a6d4ec9b7';

async function inspectDevice() {
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  const ws = new WebSocket(WS_URI);
  
  const messages = [];
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    console.log('[INFO] Подключение установлено\n');
    
    console.log('[STEP] Запрашиваем данные устройства...');
    ws.send(JSON.stringify({ type: 'get', state: [DEVICE_ID] }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      console.log('\n=== ИНФОРМАЦИЯ О КОНЕЧНОМ УСТРОЙСТВЕ ===\n');
      console.log(`ID: ${DEVICE_ID}\n`);
      
      const deviceMsgs = messages.filter(m => 
        m.type === 'ACTION_SET' && m.id === DEVICE_ID
      );
      
      if (deviceMsgs.length > 0) {
        const payload = deviceMsgs[0].payload || {};
        
        // Формируем человекочитаемое название
        const humanName = [
          payload.title,
          payload.code,
          payload.name
        ].filter(Boolean).join(' / ');
        
        if (humanName) {
          console.log(`✨ НАЗВАНИЕ: ${humanName}\n`);
        }
        
        console.log('📋 ОСНОВНАЯ ИНФОРМАЦИЯ:');
        console.log(`  title: ${payload.title || 'не указан'}`);
        console.log(`  code: ${payload.code || 'не указан'}`);
        console.log(`  name: ${payload.name || 'не указан'}`);
        console.log(`  type: ${payload.type || 'не указан'}`);
        
        console.log('\n🔗 ПРИВЯЗКИ:');
        console.log(`  bind: ${payload.bind || 'не указан'}`);
        console.log(`  site: ${payload.site ? JSON.stringify(payload.site) : 'не указан'}`);
        console.log(`  parent: ${payload.parent || 'не указан'}`);
        console.log(`  project: ${payload.project || 'не указан'}`);
        
        console.log('\n💡 ТЕКУЩЕЕ СОСТОЯНИЕ:');
        console.log(`  value: ${payload.value !== undefined ? payload.value : 'не указан'}`);
        console.log(`  brightness: ${payload.brightness !== undefined ? payload.brightness : 'не указан'}`);
        console.log(`  dimmable: ${payload.dimmable !== undefined ? payload.dimmable : 'не указан'}`);
        console.log(`  group: ${payload.group !== undefined ? payload.group : 'не указан'}`);
        
        console.log('\n📄 ПОЛНЫЕ ДАННЫЕ:');
        console.log(JSON.stringify(payload, null, 2));
        
      } else {
        console.log('❌ Устройство не найдено в ответе GET');
      }
      
      console.log(`\n📊 Всего получено сообщений: ${messages.length}`);
      
    }, 3000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
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

inspectDevice().catch(console.error);















