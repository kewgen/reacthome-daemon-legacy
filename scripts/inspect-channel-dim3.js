#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const CHANNEL_ID = '68:27:19:e4:30:a9/dim/3';
const DEVICE_MAC = '68:27:19:e4:30:a9';

async function inspectChannel() {
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
    
    // Запрашиваем данные канала и родительского устройства
    console.log('[STEP] Запрашиваем данные канала и устройства...');
    ws.send(JSON.stringify({ type: 'get', state: [CHANNEL_ID, DEVICE_MAC] }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      console.log('\n=== АНАЛИЗ КАНАЛА ДИММЕРА ===\n');
      console.log(`Канал: ${CHANNEL_ID}`);
      console.log(`Родительское устройство: ${DEVICE_MAC}\n`);
      
      // Анализируем канал
      const channelMsgs = messages.filter(m => 
        m.type === 'ACTION_SET' && m.id === CHANNEL_ID
      );
      
      if (channelMsgs.length > 0) {
        const channelPayload = channelMsgs[0].payload || {};
        console.log('📍 ИНФОРМАЦИЯ О КАНАЛЕ:');
        console.log(`  ID: ${CHANNEL_ID}`);
        console.log(`  Тип канала: dim (диммер)`);
        console.log(`  Индекс: 3`);
        console.log(`  title: ${channelPayload.title || 'не указан'}`);
        console.log(`  code: ${channelPayload.code || 'не указан'}`);
        console.log(`  name: ${channelPayload.name || 'не указан'}`);
        console.log(`  value: ${channelPayload.value !== undefined ? channelPayload.value : 'не указан'}`);
        console.log(`  brightness: ${channelPayload.brightness !== undefined ? channelPayload.brightness : 'не указан'}`);
        console.log(`  site: ${channelPayload.site || 'не указан'}`);
        console.log(`  parent: ${channelPayload.parent || 'не указан'}`);
        
        // Формируем человекочитаемое название
        const humanName = [
          channelPayload.title,
          channelPayload.code,
          channelPayload.name
        ].filter(Boolean).join(' / ');
        
        if (humanName) {
          console.log(`\n✨ КОНЕЧНОЕ УСТРОЙСТВО: ${humanName}`);
        }
        
        // Проверяем родительское устройство
        const deviceMsgs = messages.filter(m => 
          m.type === 'ACTION_SET' && m.id === DEVICE_MAC
        );
        
        if (deviceMsgs.length > 0) {
          const devicePayload = deviceMsgs[0].payload || {};
          console.log(`\n🔌 РОДИТЕЛЬСКОЕ УСТРОЙСТВО (${DEVICE_MAC}):`);
          console.log(`  title: ${devicePayload.title || 'не указан'}`);
          console.log(`  code: ${devicePayload.code || 'не указан'}`);
          console.log(`  name: ${devicePayload.name || 'не указан'}`);
          console.log(`  type: ${devicePayload.type || 'не указан'}`);
          console.log(`  ip: ${devicePayload.ip || 'не указан'}`);
          console.log(`  online: ${devicePayload.online !== undefined ? devicePayload.online : 'не указан'}`);
          
          // Формируем название родительского устройства
          const parentName = [
            devicePayload.title,
            devicePayload.code,
            devicePayload.name
          ].filter(Boolean).join(' / ');
          
          if (parentName) {
            console.log(`\n📦 Щитовое устройство: ${parentName}`);
          }
        } else {
          console.log(`\n⚠️  Родительское устройство не найдено в state`);
        }
        
        // Выводим JSON для детального анализа
        console.log(`\n📄 ПОЛНЫЕ ДАННЫЕ КАНАЛА:`);
        console.log(JSON.stringify(channelPayload, null, 2));
        
      } else {
        console.log('❌ Канал не найден в ответе GET');
        console.log('Возможно, канал не существует или не подключен');
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

inspectChannel().catch(console.error);















