#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const LODGIA_UUID = '6b1afa99-9c1e-496e-8bd4-be7e90b71c8d';
const LIGHT_CHANNEL_1 = '34731215-af9b-4847-b2f9-67c8940271c0';
const LIGHT_CHANNEL_2 = '8828b19b-55b6-4f88-ac6b-20c41b02f1ad';

async function testLightControl() {
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  const ws = new WebSocket(WS_URI);
  
  const messages = [];
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
  ws.on('open', () => {
    console.log('[INFO] Подключение установлено\n');
    
    // Шаг 1: Получаем текущее состояние канала
    console.log('[STEP 1] Получаем текущее состояние канала освещения...');
    ws.send(JSON.stringify({ type: 'get', state: [LIGHT_CHANNEL_1] }));
    
    setTimeout(() => {
      // Шаг 2: Отправляем команду включения на канал напрямую
      console.log('[STEP 2] Отправляем ACTION_ON на канал:', LIGHT_CHANNEL_1);
      ws.send(JSON.stringify({ type: 'ACTION_ON', id: LIGHT_CHANNEL_1 }));
      
      setTimeout(() => {
        // Шаг 3: Отправляем команду включения на локацию
        console.log('[STEP 3] Отправляем ACTION_SITE_LIGHT_ON на локацию:', LODGIA_UUID);
        ws.send(JSON.stringify({ type: 'ACTION_SITE_LIGHT_ON', id: LODGIA_UUID }));
        
        setTimeout(() => {
          // Шаг 4: Проверяем состояние канала после команд
          console.log('[STEP 4] Проверяем состояние канала после команд...');
          ws.send(JSON.stringify({ type: 'get', state: [LIGHT_CHANNEL_1] }));
          
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            
            console.log('\n=== АНАЛИЗ РЕЗУЛЬТАТОВ ===\n');
            
            // Анализируем состояние канала до команд
            const beforeMsgs = messages.filter(m => 
              m.type === 'ACTION_SET' && 
              m.id === LIGHT_CHANNEL_1 &&
              messages.indexOf(m) < messages.length / 2
            );
            if (beforeMsgs.length > 0) {
              console.log('Состояние канала ДО команд:');
              const payload = beforeMsgs[0].payload || {};
              console.log(`  value: ${payload.value !== undefined ? payload.value : 'не указан'}`);
              console.log(`  on: ${payload.on !== undefined ? payload.on : 'не указан'}`);
              console.log(`  state: ${payload.state !== undefined ? payload.state : 'не указан'}`);
              console.log(`  timestamp: ${payload.timestamp || beforeMsgs[0].timestamp || 'не указан'}`);
            }
            
            // Анализируем состояние канала после команд
            const afterMsgs = messages.filter(m => 
              m.type === 'ACTION_SET' && 
              m.id === LIGHT_CHANNEL_1
            );
            if (afterMsgs.length > beforeMsgs.length) {
              console.log('\nСостояние канала ПОСЛЕ команд:');
              const lastMsg = afterMsgs[afterMsgs.length - 1];
              const payload = lastMsg.payload || {};
              console.log(`  value: ${payload.value !== undefined ? payload.value : 'не указан'}`);
              console.log(`  on: ${payload.on !== undefined ? payload.on : 'не указан'}`);
              console.log(`  state: ${payload.state !== undefined ? payload.state : 'не указан'}`);
              console.log(`  timestamp: ${payload.timestamp || lastMsg.timestamp || 'не указан'}`);
              
              // Сравниваем
              if (beforeMsgs.length > 0) {
                const beforePayload = beforeMsgs[0].payload || {};
                const changed = 
                  (payload.value !== undefined && payload.value !== beforePayload.value) ||
                  (payload.on !== undefined && payload.on !== beforePayload.on) ||
                  (payload.state !== undefined && payload.state !== beforePayload.state);
                if (changed) {
                  console.log('\n✓ Состояние канала ИЗМЕНИЛОСЬ после команд');
                } else {
                  console.log('\n✗ Состояние канала НЕ ИЗМЕНИЛОСЬ после команд');
                }
              }
            } else {
              console.log('\n✗ Не получено обновлений состояния канала после команд');
            }
            
            // Показываем все полученные сообщения
            console.log(`\nВсего получено сообщений: ${messages.length}`);
            console.log('Типы сообщений:');
            const types = {};
            messages.forEach(m => {
              types[m.type] = (types[m.type] || 0) + 1;
            });
            Object.entries(types).forEach(([type, count]) => {
              console.log(`  ${type}: ${count}`);
            });
            
            console.log('\n=== ВЫВОДЫ ===');
            console.log('1. Команда ACTION_ON отправлена на канал:', LIGHT_CHANNEL_1);
            console.log('2. Команда ACTION_SITE_LIGHT_ON отправлена на локацию:', LODGIA_UUID);
            console.log('3. Проверьте логи сервера для диагностики обработки команд.');
            
          }, 3000);
        }, 2000);
      }, 2000);
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      // console.log('[DEBUG] Получено:', JSON.stringify(msg, null, 2));
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

testLightControl().catch(console.error);

