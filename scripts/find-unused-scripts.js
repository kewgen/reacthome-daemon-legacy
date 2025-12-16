#!/usr/bin/env node

/**
 * Зачем: Найти скрипты, которые никто не использует
 * - Не используются в action других скриптов
 * - Не используются в ACTION_SCRIPT_RUN
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

const scripts = new Map();
const allObjects = new Map();
const ws = new WebSocket(WS_URI);

const timeout = setTimeout(() => {
  ws.close();
  process.exit(1);
}, 30000);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'list' }));
  
  setTimeout(() => {
    const ids = Array.from(allObjects.keys());
    ws.send(JSON.stringify({ type: 'get', state: ids }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      const allScripts = Array.from(scripts.values()).filter(s => s.type === 'script');
      const scriptIdsSet = new Set(allScripts.map(s => s.id));
      
      // Зачем: Находим скрипты, используемые в action других скриптов
      const scriptsReferencedInActions = new Set();
      allScripts.forEach(script => {
        if (script.action && Array.isArray(script.action)) {
          // Зачем: Проверяем каждый actionId, является ли он UUID скрипта
          script.action.forEach(actionId => {
            if (scriptIdsSet.has(actionId)) {
              scriptsReferencedInActions.add(actionId);
            }
          });
        }
      });
      
      // Зачем: Находим скрипты, используемые в ACTION_SCRIPT_RUN
      const scriptsReferencedInActionScriptRun = new Set();
      allObjects.forEach((obj, id) => {
        if (obj.type === 'ACTION_SCRIPT_RUN' && obj.payload && obj.payload.script) {
          const scriptId = obj.payload.script;
          // Зачем: Проверяем, является ли scriptId UUID скрипта
          if (scriptIdsSet.has(scriptId)) {
            scriptsReferencedInActionScriptRun.add(scriptId);
          }
        }
      });
      
      // Зачем: Объединяем все используемые скрипты и находим неиспользуемые
      const allReferenced = new Set([...scriptsReferencedInActions, ...scriptsReferencedInActionScriptRun]);
      const unused = allScripts.filter(s => !allReferenced.has(s.id))
        .sort((a, b) => (b.actions || 0) - (a.actions || 0));
      
      console.log('## Неиспользуемые скрипты\n');
      console.log('Всего скриптов:', allScripts.length);
      console.log('Используются в action других скриптов:', scriptsReferencedInActions.size);
      console.log('Используются в ACTION_SCRIPT_RUN:', scriptsReferencedInActionScriptRun.size);
      console.log('Всего используемых:', allReferenced.size);
      console.log('Не используются:', unused.length);
      console.log('\n## Все неиспользуемые скрипты\n');
      console.log('| № | UUID | title | code | actions | disabled |');
      console.log('|---|------|-------|------|---------|----------|');
      
      unused.forEach((s, i) => {
        const uuid = s.id.substring(0, 8) + '...';
        const title = (s.title || '(без названия)').substring(0, 50);
        const code = (s.code || '—').substring(0, 40);
        const actions = s.actions || 0;
        const disabled = s.disabled ? 'да' : 'нет';
        console.log(`| ${i + 1} | ${uuid} | ${title} | ${code} | ${actions} | ${disabled} |`);
      });
      
      process.exit(0);
    }, 6000);
  }, 2000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    if (msg.type === 'list' && msg.state) {
      msg.state.forEach(([id]) => {
        allObjects.set(id, { id });
      });
    }
    
    if (msg.type === 'ACTION_SET') {
      const p = msg.payload || {};
      const obj = allObjects.get(msg.id) || { id: msg.id };
      obj.type = p.type;
      obj.payload = p;
      
      if (p.type === 'script') {
        const s = scripts.get(msg.id) || { id: msg.id };
        s.type = 'script';
        s.action = p.action || [];
        s.actions = s.action.length;
        s.title = p.title;
        s.code = p.code;
        s.disabled = p.disabled || false;
        scripts.set(msg.id, s);
      }
      
      allObjects.set(msg.id, obj);
    }
  } catch (e) {
    // Игнорируем ошибки парсинга
  }
});

ws.on('error', (e) => {
  clearTimeout(timeout);
  process.exit(1);
});

