#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const LIGHT_CHANNEL = '34731215-af9b-4847-b2f9-67c8940271c0';
const DEVICE_MAC = '68:27:19:e4:49:17';

async function checkDeviceBind() {
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
    
    // Запрашиваем данные канала и устройства
    console.log('[STEP] Запрашиваем данные канала и устройства...');
    ws.send(JSON.stringify({ type: 'get', state: [LIGHT_CHANNEL, DEVICE_MAC] }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      console.log('\n=== АНАЛИЗ ПРИВЯЗКИ КАНАЛА К УСТРОЙСТВУ ===\n');
      
      // Анализируем канал
      const channelMsgs = messages.filter(m => 
        m.type === 'ACTION_SET' && m.id === LIGHT_CHANNEL
      );
      
      if (channelMsgs.length > 0) {
        const channelPayload = channelMsgs[0].payload || {};
        console.log('Канал освещения:');
        console.log(`  ID: ${LIGHT_CHANNEL}`);
        console.log(`  bind: ${channelPayload.bind || 'не указан'}`);
        console.log(`  type: ${channelPayload.type || 'не указан'}`);
        console.log(`  value: ${channelPayload.value !== undefined ? channelPayload.value : 'не указан'}`);
        
        if (channelPayload.bind) {
          const [dev, kind, index] = channelPayload.bind.split('/');
          console.log(`\n  Парсинг bind:`);
          console.log(`    dev (MAC): ${dev}`);
          console.log(`    kind: ${kind}`);
          console.log(`    index: ${index}`);
          
          // Проверяем устройство
          const deviceMsgs = messages.filter(m => 
            m.type === 'ACTION_SET' && m.id === dev
          );
          
          if (deviceMsgs.length > 0) {
            const devicePayload = deviceMsgs[0].payload || {};
            console.log(`\n  Устройство найдено:`);
            console.log(`    MAC: ${dev}`);
            console.log(`    type: ${devicePayload.type || 'не указан'}`);
            console.log(`    ip: ${devicePayload.ip || 'не указан'}`);
            console.log(`    online: ${devicePayload.online !== undefined ? devicePayload.online : 'не указан'}`);
            console.log(`    ready: ${devicePayload.ready !== undefined ? devicePayload.ready : 'не указан'}`);
            
            // Проверяем, поддерживается ли тип устройства в ACTION_ON
            const supportedTypes = [
              'DEVICE_TYPE_SERVER',
              'DEVICE_TYPE_RS_HUB4',
              'DEVICE_TYPE_DIM4',
              'DEVICE_TYPE_DIM_4',
              'DEVICE_TYPE_DIM8',
              'DEVICE_TYPE_DIM_8',
              'DEVICE_TYPE_DIM_8_RS',
              'DEVICE_TYPE_DIM_12_LED_RS',
              'DEVICE_TYPE_DIM_12_AC_RS',
              'DEVICE_TYPE_DIM_12_DC_RS',
              'DEVICE_TYPE_DIM_1_AC_RS',
              'DEVICE_TYPE_DI_4_RSM',
              'DEVICE_TYPE_AO_4_DIN',
              'DEVICE_TYPE_MIX_1_RS',
              'DEVICE_TYPE_MIX_6x12_RS',
              'DEVICE_TYPE_RELAY_2',
              'DEVICE_TYPE_RELAY_2_DIN',
              'DEVICE_TYPE_RELAY_12_RS',
              'DEVICE_TYPE_MIX_H',
            ];
            
            console.log(`\n  Диагностика:`);
            if (!devicePayload.ip) {
              console.log(`    ✗ IP-адрес не указан - команда не может быть отправлена`);
            } else {
              console.log(`    ✓ IP-адрес указан: ${devicePayload.ip}`);
            }
            
            if (devicePayload.online === false) {
              console.log(`    ✗ Устройство оффлайн`);
            } else {
              console.log(`    ✓ Устройство онлайн (или статус не указан)`);
            }
            
            if (!devicePayload.type) {
              console.log(`    ✗ Тип устройства не указан - команда может не обработаться`);
            } else {
              console.log(`    ✓ Тип устройства: ${devicePayload.type}`);
              // Проверяем, поддерживается ли тип
              const typeNum = typeof devicePayload.type === 'number' ? devicePayload.type : null;
              if (typeNum !== null) {
                // Здесь нужно проверить, соответствует ли тип одному из поддерживаемых
                // Но у нас нет числовых значений констант, поэтому просто выводим тип
                console.log(`    ℹ Числовой тип: ${typeNum}`);
              }
            }
            
            // Проверяем тип канала (kind)
            if (kind === 'dim') {
              console.log(`    ✓ Тип канала: dim (диммер) - поддерживается`);
            } else if (kind === 'do') {
              console.log(`    ✓ Тип канала: do (реле) - поддерживается`);
            } else {
              console.log(`    ⚠ Тип канала: ${kind} - может не поддерживаться`);
            }
            
          } else {
            console.log(`\n  ✗ Устройство с MAC ${dev} НЕ найдено в state`);
            console.log(`    Это означает, что команда ACTION_ON не сможет отправить команду на устройство`);
          }
        } else {
          console.log(`\n  ✗ Привязка (bind) не указана для канала`);
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

checkDeviceBind().catch(console.error);

