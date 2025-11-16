#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

async function listScripts() {
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  const ws = new WebSocket(WS_URI);
  
  const scripts = new Map();
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
      const scriptIds = Array.from(scripts.keys());
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
        
        console.log('\n=== СПИСОК СКРИПТОВ ===\n');
        
        const scriptsArray = Array.from(scripts.entries())
          .map(([id, info]) => ({
            id,
            ...info
          }))
          .sort((a, b) => (b.actions || 0) - (a.actions || 0));
        
        console.log(`Всего скриптов: ${scriptsArray.length}\n`);
        
        scriptsArray.forEach((script, idx) => {
          console.log(`${idx + 1}. ${script.title || '(без названия)'}`);
          console.log(`   UUID: ${script.id}`);
          console.log(`   Действий: ${script.actions || 0}`);
          console.log(`   Отключён: ${script.disabled ? 'да' : 'нет'}`);
          if (script.action && script.action.length > 0) {
            console.log(`   Первые действия: ${script.action.slice(0, 3).join(', ')}`);
          }
          console.log('');
        });
        
        // Группировка по использованию
        console.log('\n=== СТАТИСТИКА ===\n');
        const withActions = scriptsArray.filter(s => (s.actions || 0) > 0);
        const disabled = scriptsArray.filter(s => s.disabled);
        const enabled = scriptsArray.filter(s => !s.disabled);
        
        console.log(`Скриптов с действиями: ${withActions.length}`);
        console.log(`Включённых: ${enabled.length}`);
        console.log(`Отключённых: ${disabled.length}`);
        
        if (withActions.length > 0) {
          console.log('\n=== СКРИПТЫ ДЛЯ ТЕСТИРОВАНИЯ ===\n');
          withActions.slice(0, 10).forEach(script => {
            console.log(`UUID: ${script.id}`);
            console.log(`Название: ${script.title || '(без названия)'}`);
            console.log(`Команда: {"type":"ACTION_SCRIPT_RUN","id":"${script.id}"}`);
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
          scripts.set(id, { id });
        });
      }
      
      // Собираем данные скриптов из ACTION_SET
      if (msg.type === ACTION_SET) {
        const payload = msg.payload || {};
        if (payload.type === 'script') {
          const script = scripts.get(msg.id) || { id: msg.id };
          script.title = payload.title;
          script.disabled = payload.disabled || false;
          script.action = payload.action || [];
          script.actions = script.action.length;
          scripts.set(msg.id, script);
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
listScripts().catch(console.error);

