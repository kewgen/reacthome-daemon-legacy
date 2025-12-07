#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const LODGIA_UUID = '6b1afa99-9c1e-496e-8bd4-be7e90b71c8d';
const LODGIA_CODE = '6';

async function checkLodgiaIds() {
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  const ws = new WebSocket(WS_URI);
  
  const messages = [];
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    console.log('[INFO] Подключение установлено');
    
    // Шаг 1: Запрашиваем LIST
    console.log('[STEP 1] Отправляем LIST...');
    ws.send(JSON.stringify({ type: 'list' }));
    
    setTimeout(() => {
      // Шаг 2: Запрашиваем данные по UUID
      console.log('[STEP 2] Запрашиваем данные по UUID:', LODGIA_UUID);
      ws.send(JSON.stringify({ type: 'get', state: [LODGIA_UUID] }));
      
      setTimeout(() => {
        // Шаг 3: Запрашиваем данные по коду
        console.log('[STEP 3] Запрашиваем данные по коду:', LODGIA_CODE);
        ws.send(JSON.stringify({ type: 'get', state: [LODGIA_CODE] }));
        
        setTimeout(() => {
          clearTimeout(timeout);
          ws.close();
          
          console.log('\n=== АНАЛИЗ РЕЗУЛЬТАТОВ ===\n');
          
          // Анализируем LIST
          const listMsg = messages.find(m => m.type === 'list');
          if (listMsg) {
            console.log('LIST ответ:');
            console.log(`  Всего записей в state: ${listMsg.state?.length || 0}`);
            const lodgiaInList = listMsg.state?.find(([id]) => 
              id === LODGIA_UUID || id === LODGIA_CODE || id.includes('6b1afa99')
            );
            if (lodgiaInList) {
              console.log(`  ✓ Лоджия найдена в LIST с ID: ${lodgiaInList[0]}`);
            } else {
              console.log(`  ✗ Лоджия НЕ найдена в LIST`);
              // Показываем первые 10 ID для справки
              console.log(`  Первые 10 ID из LIST:`);
              listMsg.state?.slice(0, 10).forEach(([id]) => {
                console.log(`    - ${id}`);
              });
            }
          } else {
            console.log('✗ LIST ответ не получен');
          }
          
          // Анализируем GET по UUID
          const uuidMsgs = messages.filter(m => 
            m.type === 'ACTION_SET' && m.id === LODGIA_UUID
          );
          if (uuidMsgs.length > 0) {
            console.log(`\n✓ GET по UUID (${LODGIA_UUID}) успешен:`);
            const payload = uuidMsgs[0].payload || {};
            console.log(`  type: ${payload.type || 'не указан'}`);
            console.log(`  title: ${payload.title || 'не указан'}`);
            console.log(`  code: ${payload.code || 'не указан'}`);
            console.log(`  light_220: ${payload.light_220?.length || 0} каналов`);
            if (payload.light_220?.length > 0) {
              console.log(`    ${payload.light_220.join(', ')}`);
            }
          } else {
            console.log(`\n✗ GET по UUID (${LODGIA_UUID}) не вернул данных`);
          }
          
          // Анализируем GET по коду
          const codeMsgs = messages.filter(m => 
            m.type === 'ACTION_SET' && m.id === LODGIA_CODE
          );
          if (codeMsgs.length > 0) {
            console.log(`\n✓ GET по коду (${LODGIA_CODE}) успешен:`);
            const payload = codeMsgs[0].payload || {};
            console.log(`  type: ${payload.type || 'не указан'}`);
            console.log(`  title: ${payload.title || 'не указан'}`);
            console.log(`  code: ${payload.code || 'не указан'}`);
            console.log(`  light_220: ${payload.light_220?.length || 0} каналов`);
            if (payload.light_220?.length > 0) {
              console.log(`    ${payload.light_220.join(', ')}`);
            }
          } else {
            console.log(`\n✗ GET по коду (${LODGIA_CODE}) не вернул данных`);
          }
          
          // Ищем все сообщения ACTION_SET с title "Лоджия"
          const lodgiaByTitle = messages.filter(m => 
            m.type === 'ACTION_SET' && 
            m.payload?.title === 'Лоджия'
          );
          if (lodgiaByTitle.length > 0) {
            console.log(`\n✓ Найдены записи с title="Лоджия":`);
            lodgiaByTitle.forEach(msg => {
              console.log(`  ID: ${msg.id}`);
              console.log(`    type: ${msg.payload?.type || 'не указан'}`);
              console.log(`    code: ${msg.payload?.code || 'не указан'}`);
              console.log(`    light_220: ${msg.payload?.light_220?.length || 0} каналов`);
            });
          }
          
          console.log('\n=== ВЫВОДЫ ===');
          console.log('Для управления освещением нужно использовать ID, под которым локация хранится в state.');
          console.log('Проверьте выше, какой ID вернул GET запрос с данными локации.');
          
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

checkLodgiaIds().catch(console.error);

