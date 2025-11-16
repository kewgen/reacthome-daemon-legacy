#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const LIGHT_CHANNEL = '34731215-af9b-4847-b2f9-67c8940271c0';

async function checkLightChannel() {
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
    
    // Запрашиваем данные канала
    console.log('[STEP] Запрашиваем данные канала освещения...');
    ws.send(JSON.stringify({ type: 'get', state: [LIGHT_CHANNEL] }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      console.log('\n=== АНАЛИЗ КАНАЛА ОСВЕЩЕНИЯ ===\n');
      
      const channelMsgs = messages.filter(m => 
        m.type === 'ACTION_SET' && m.id === LIGHT_CHANNEL
      );
      
      if (channelMsgs.length > 0) {
        const payload = channelMsgs[0].payload || {};
        console.log('Данные канала:');
        console.log(`  ID: ${LIGHT_CHANNEL}`);
        console.log(`  type: ${payload.type || 'не указан'}`);
        console.log(`  value: ${payload.value !== undefined ? payload.value : 'не указан'}`);
        console.log(`  disabled: ${payload.disabled !== undefined ? payload.disabled : 'не указан'}`);
        console.log(`  online: ${payload.online !== undefined ? payload.online : 'не указан'}`);
        console.log(`  ready: ${payload.ready !== undefined ? payload.ready : 'не указан'}`);
        console.log(`  device: ${payload.device || 'не указан'}`);
        console.log(`  site: ${payload.site || 'не указан'}`);
        console.log(`  ip: ${payload.ip || 'не указан'}`);
        console.log(`  timestamp: ${payload.timestamp || channelMsgs[0].timestamp || 'не указан'}`);
        
        // Показываем все ключи payload
        const keys = Object.keys(payload).sort();
        console.log(`\nВсе ключи в payload (${keys.length}):`);
        keys.forEach(key => {
          const value = payload[key];
          if (Array.isArray(value)) {
            console.log(`  ${key}: [массив, ${value.length} элементов]`);
          } else if (typeof value === 'object' && value !== null) {
            console.log(`  ${key}: [объект]`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });
        
        // Анализ для диагностики
        console.log('\n=== ДИАГНОСТИКА ===');
        if (payload.disabled === true) {
          console.log('✗ Канал ОТКЛЮЧЁН (disabled: true)');
        } else {
          console.log('✓ Канал включён (disabled: false или не указан)');
        }
        
        if (payload.online === false) {
          console.log('✗ Устройство ОФФЛАЙН (online: false)');
        } else {
          console.log('✓ Устройство онлайн (online: true или не указан)');
        }
        
        if (!payload.type) {
          console.log('⚠ Тип канала не указан - может быть проблема с обработкой команды');
        } else {
          console.log(`✓ Тип канала: ${payload.type}`);
        }
        
        if (payload.value === false) {
          console.log('ℹ Текущее состояние: выключено (value: false)');
        } else if (payload.value === true) {
          console.log('ℹ Текущее состояние: включено (value: true)');
        }
        
      } else {
        console.log('✗ Канал не найден в ответе GET');
      }
      
      console.log(`\nВсего получено сообщений: ${messages.length}`);
      
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

checkLightChannel().catch(console.error);

