#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const LODGIA_UUID = '6b1afa99-9c1e-496e-8bd4-be7e90b71c8d';

async function traceApplySite() {
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
    
    // Отправляем команду и слушаем все обновления
    console.log('[STEP] Отправляем команду ACTION_SITE_LIGHT_ON...');
    const turn_on = {"type": "ACTION_SITE_LIGHT_ON", "id": LODGIA_UUID};
    console.log(`Команда: ${JSON.stringify(turn_on)}`);
    ws.send(JSON.stringify(turn_on));
    
    // Собираем все обновления в течение 5 секунд
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      console.log('\n=== АНАЛИЗ ОБНОВЛЕНИЙ ===\n');
      
      // Фильтруем обновления каналов освещения
      const lightChannels = [
        '34731215-af9b-4847-b2f9-67c8940271c0',
        '8828b19b-55b6-4f88-ac6b-20c41b02f1ad'
      ];
      
      const lightUpdates = messages.filter(m => 
        m.type === 'ACTION_SET' && 
        lightChannels.includes(m.id) &&
        m.payload?.value === true
      );
      
      console.log(`Всего получено сообщений: ${messages.length}`);
      console.log(`Обновлений каналов освещения (value: true): ${lightUpdates.length}`);
      
      if (lightUpdates.length > 0) {
        console.log('\nДетали обновлений каналов:');
        lightUpdates.forEach((msg, idx) => {
          const timestamp = new Date(msg.payload?.timestamp || msg.timestamp || 0).toISOString();
          console.log(`  ${idx + 1}. Канал: ${msg.id}`);
          console.log(`     Timestamp: ${timestamp}`);
          console.log(`     Value: ${msg.payload?.value}`);
        });
        
        // Группируем по каналам
        const byChannel = {};
        lightUpdates.forEach(msg => {
          if (!byChannel[msg.id]) {
            byChannel[msg.id] = [];
          }
          byChannel[msg.id].push(msg);
        });
        
        console.log('\nГруппировка по каналам:');
        Object.entries(byChannel).forEach(([channelId, updates]) => {
          console.log(`  Канал ${channelId}: ${updates.length} обновлений`);
          if (updates.length > 1) {
            console.log(`    ⚠ ВНИМАНИЕ: Канал получил ${updates.length} обновлений включения!`);
            updates.forEach((update, idx) => {
              const ts = update.payload?.timestamp || update.timestamp || 0;
              const time = new Date(ts).toISOString();
              console.log(`      ${idx + 1}. ${time}`);
            });
          }
        });
      }
      
      // Проверяем, есть ли другие ACTION_SET сообщения
      const otherUpdates = messages.filter(m => 
        m.type === 'ACTION_SET' && 
        !lightChannels.includes(m.id) &&
        m.id !== LODGIA_UUID
      );
      
      if (otherUpdates.length > 0) {
        console.log(`\nДругих обновлений: ${otherUpdates.length}`);
        const uniqueIds = [...new Set(otherUpdates.map(m => m.id))];
        console.log(`Уникальных ID: ${uniqueIds.length}`);
        if (uniqueIds.length <= 10) {
          console.log(`  ${uniqueIds.join(', ')}`);
        }
      }
      
      console.log('\n=== ВЫВОДЫ ===');
      if (lightUpdates.length === 2) {
        console.log('✓ Получено 2 обновления (по одному на каждый канал) - это нормально');
      } else if (lightUpdates.length > 2) {
        console.log(`⚠ Получено ${lightUpdates.length} обновлений включения - больше, чем каналов!`);
        console.log('Возможные причины:');
        console.log('1. Команда обрабатывается несколько раз');
        console.log('2. applySite вызывается рекурсивно для project или дочерних локаций');
        console.log('3. Есть скрипты, которые повторно включают свет');
      } else {
        console.log(`⚠ Получено только ${lightUpdates.length} обновлений - меньше, чем каналов`);
      }
      
    }, 5000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      // Логируем только обновления каналов освещения
      if (msg.type === 'ACTION_SET' && 
          ['34731215-af9b-4847-b2f9-67c8940271c0', '8828b19b-55b6-4f88-ac6b-20c41b02f1ad'].includes(msg.id) &&
          msg.payload?.value === true) {
        console.log(`[DEBUG] Получено обновление: ${msg.id} = ${msg.payload.value} (timestamp: ${msg.payload.timestamp})`);
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

traceApplySite().catch(console.error);

