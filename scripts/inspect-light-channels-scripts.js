#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const LODGIA_UUID = '6b1afa99-9c1e-496e-8bd4-be7e90b71c8d';
const LIGHT_CHANNEL_1 = '34731215-af9b-4847-b2f9-67c8940271c0';
const LIGHT_CHANNEL_2 = '8828b19b-55b6-4f88-ac6b-20c41b02f1ad';

async function checkLightChannelsScripts() {
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
    
    // Запрашиваем данные локации и каналов
    console.log('[STEP] Запрашиваем данные локации и каналов освещения...');
    ws.send(JSON.stringify({ type: 'get', state: [LODGIA_UUID, LIGHT_CHANNEL_1, LIGHT_CHANNEL_2] }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      console.log('\n=== АНАЛИЗ КАНАЛОВ ОСВЕЩЕНИЯ ===\n');
      
      // Анализируем локацию
      const siteMsgs = messages.filter(m => 
        m.type === 'ACTION_SET' && m.id === LODGIA_UUID
      );
      
      if (siteMsgs.length > 0) {
        const sitePayload = siteMsgs[0].payload || {};
        console.log('Локация "Лоджия":');
        console.log(`  UUID: ${LODGIA_UUID}`);
        console.log(`  site (дочерние локации): ${sitePayload.site?.length || 0}`);
        if (sitePayload.site?.length > 0) {
          console.log(`    ${sitePayload.site.join(', ')}`);
        }
        console.log(`  project: ${sitePayload.project || 'нет'}`);
        console.log(`  light_220: ${sitePayload.light_220?.length || 0} каналов`);
        if (sitePayload.light_220?.length > 0) {
          console.log(`    ${sitePayload.light_220.join(', ')}`);
        }
      }
      
      // Анализируем каналы
      const channels = [LIGHT_CHANNEL_1, LIGHT_CHANNEL_2];
      for (const channelId of channels) {
        const channelMsgs = messages.filter(m => 
          m.type === 'ACTION_SET' && m.id === channelId
        );
        
        if (channelMsgs.length > 0) {
          const payload = channelMsgs[0].payload || {};
          console.log(`\nКанал ${channelId}:`);
          console.log(`  onOn: ${payload.onOn || 'нет'}`);
          console.log(`  onOff: ${payload.onOff || 'нет'}`);
          console.log(`  type: ${payload.type || 'не указан'}`);
          console.log(`  value: ${payload.value !== undefined ? payload.value : 'не указан'}`);
          
          if (payload.onOn) {
            console.log(`  ⚠ ВНИМАНИЕ: У канала есть скрипт onOn (${payload.onOn}) - он будет запущен при включении!`);
          }
        }
      }
      
      console.log('\n=== ВЫВОДЫ ===');
      console.log('Если свет включался три раза, возможные причины:');
      console.log('1. У каналов есть скрипты onOn, которые запускаются при включении');
      console.log('2. У локации есть дочерние локации, которые тоже обрабатываются');
      console.log('3. Тест запускался несколько раз');
      console.log('4. Есть скрипты, реагирующие на включение света (например, допплер)');
      
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

checkLightChannelsScripts().catch(console.error);

