#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const SEARCH_TERM = process.argv[2] || process.env.REACTHOME_SCRIPT_SEARCH || '';

if (!SEARCH_TERM) {
  console.error('Использование: node find-script-by-name.js "название скрипта"');
  console.error('Или: REACTHOME_SCRIPT_SEARCH="название" node find-script-by-name.js');
  process.exit(1);
}

async function findScript() {
  console.log(`[INFO] Поиск скрипта: "${SEARCH_TERM}"`);
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  const ws = new WebSocket(WS_URI);
  
  const scripts = [];
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 10000);
  
  ws.on('open', () => {
    console.log('[INFO] Подключение установлено\n');
    
    // Запрашиваем LIST
    console.log('[STEP] Запрашиваем список всех объектов...');
    ws.send(JSON.stringify({ type: 'list' }));
    
    setTimeout(() => {
      // Запрашиваем данные всех скриптов
      const scriptIds = scripts.map(s => s.id);
      if (scriptIds.length === 0) {
        console.log('[WARNING] Скрипты не найдены в LIST ответе');
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }
      
      console.log(`[STEP] Запрашиваем данные ${scriptIds.length} скриптов...`);
      ws.send(JSON.stringify({ type: 'get', state: scriptIds }));
      
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        
        console.log('\n=== РЕЗУЛЬТАТЫ ПОИСКА ===\n');
        
        const searchLower = SEARCH_TERM.toLowerCase();
        const matches = scripts.filter(s => {
          const title = (s.title || '').toLowerCase();
          return title.includes(searchLower) || searchLower.includes(title);
        });
        
        if (matches.length === 0) {
          console.log(`❌ Скрипт с названием, содержащим "${SEARCH_TERM}", не найден\n`);
          console.log('Похожие скрипты:');
          const similar = scripts
            .filter(s => {
              const title = (s.title || '').toLowerCase();
              const searchWords = searchLower.split(/\s+/);
              return searchWords.some(word => title.includes(word));
            })
            .slice(0, 10);
          
          if (similar.length > 0) {
            similar.forEach(s => {
              console.log(`  - ${s.title} (UUID: ${s.id})`);
            });
          } else {
            console.log('  (не найдено похожих)');
          }
        } else {
          console.log(`✓ Найдено скриптов: ${matches.length}\n`);
          matches.forEach((script, idx) => {
            console.log(`${idx + 1}. ${script.title || '(без названия)'}`);
            console.log(`   UUID: ${script.id}`);
            console.log(`   Действий: ${script.actions || 0}`);
            console.log(`   Отключён: ${script.disabled ? 'да' : 'нет'}`);
            console.log(`   Команда: {"type":"ACTION_SCRIPT_RUN","id":"${script.id}"}`);
            console.log('');
          });
        }
        
      }, 3000);
    }, 2000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Собираем ID скриптов из LIST
      if (msg.type === 'list' && msg.state) {
        msg.state.forEach(([id]) => {
          scripts.push({ id });
        });
      }
      
      // Собираем данные скриптов из ACTION_SET
      if (msg.type === ACTION_SET) {
        const payload = msg.payload || {};
        if (payload.type === 'script') {
          const idx = scripts.findIndex(s => s.id === msg.id);
          if (idx >= 0) {
            scripts[idx].title = payload.title;
            scripts[idx].disabled = payload.disabled || false;
            scripts[idx].action = payload.action || [];
            scripts[idx].actions = scripts[idx].action.length;
          }
        }
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

const ACTION_SET = 'ACTION_SET';
findScript().catch(console.error);

