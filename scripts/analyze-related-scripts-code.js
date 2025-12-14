#!/usr/bin/env node

/**
 * Зачем: Изучить поля code связанных скриптов с целевым скриптом
 * Анализируем code всех скриптов, которые связаны с нашим скриптом
 */

const WebSocket = require('ws');

const TARGET_SCRIPT_ID = process.argv[2] || 'e6a8ddef-fa24-4cb6-b494-3619d52cb650';
const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

const scripts = new Map();
const allObjects = new Map();
const ws = new WebSocket(WS_URI);

const timeout = setTimeout(() => {
  ws.close();
  process.exit(1);
}, 30000);

/**
 * Зачем: Рекурсивно найти все UUID в объекте
 */
function findAllUUIDs(obj, found = new Set(), depth = 0) {
  if (depth > 10) return found;
  
  if (obj === null || obj === undefined) {
    return found;
  }
  
  if (typeof obj === 'string') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(obj)) {
      found.add(obj);
    }
    return found;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach(item => findAllUUIDs(item, found, depth + 1));
    return found;
  }
  
  if (typeof obj === 'object') {
    Object.values(obj).forEach(value => findAllUUIDs(value, found, depth + 1));
    return found;
  }
  
  return found;
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'list' }));
  
  setTimeout(() => {
    const ids = Array.from(allObjects.keys());
    ws.send(JSON.stringify({ type: 'get', state: ids }));
    
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      
      const targetScript = scripts.get(TARGET_SCRIPT_ID);
      if (!targetScript) {
        console.log(`❌ Скрипт с UUID ${TARGET_SCRIPT_ID} не найден`);
        process.exit(1);
      }
      
      const allScripts = Array.from(scripts.values()).filter(s => s.type === 'script');
      const scriptIdsSet = new Set(allScripts.map(s => s.id));
      
      console.log(`## Анализ полей code связанных скриптов\n`);
      console.log(`Целевой скрипт: "${targetScript.title || '(без названия)'}"`);
      console.log(`UUID: ${TARGET_SCRIPT_ID}`);
      console.log(`code: ${targetScript.code || '— (отсутствует)'}\n`);
      
      // Зачем: Найти все скрипты, связанные с целевым скриптом
      const relatedScripts = new Set();
      
      // Зачем: Найти скрипты, которые вызывают наш скрипт
      allObjects.forEach((obj, objId) => {
        // Зачем: ACTION_SCRIPT_RUN: payload.script — владелец (вызывающий), payload.id — вызываемый скрипт
        if (obj.type === 'ACTION_SCRIPT_RUN' && obj.payload && obj.payload.script) {
          const callerScriptId = obj.payload.script;
          const calleeScriptId = obj.payload.payload?.id;
          if (calleeScriptId === TARGET_SCRIPT_ID && scriptIdsSet.has(callerScriptId)) {
            relatedScripts.add(callerScriptId);
          }
        }
      });
      
      // Зачем: Найти скрипты, которые вызываются нашим скриптом
      if (targetScript.action && Array.isArray(targetScript.action)) {
        targetScript.action.forEach(actionId => {
          const actionObj = allObjects.get(actionId);
          if (actionObj && actionObj.type === 'ACTION_SCRIPT_RUN' && actionObj.payload) {
            // Зачем: В payload.id лежит UUID запускаемого скрипта
            if (actionObj.payload.payload && actionObj.payload.payload.id) {
              const targetId = actionObj.payload.payload.id;
              if (scriptIdsSet.has(targetId)) {
                relatedScripts.add(targetId);
              }
            }
          }
        });
      }
      
      const relatedScriptsList = Array.from(relatedScripts)
        .map(id => allScripts.find(s => s.id === id))
        .filter(s => s);
      
      // Зачем: Добавить целевой скрипт в список для полного анализа, исключая дубликаты
      const uniqueRelatedScripts = relatedScriptsList.filter(s => s.id !== TARGET_SCRIPT_ID);
      const allRelatedScripts = [
        { script: targetScript, relation: 'Целевой скрипт' },
        ...uniqueRelatedScripts.map(s => ({ script: s, relation: 'Связанный скрипт' }))
      ];
      
      console.log(`## Найдено связанных скриптов: ${relatedScriptsList.length}\n`);
      
      if (allRelatedScripts.length > 0) {
        console.log('## Детали всех скриптов (целевой + связанные):\n');
        console.log('| № | UUID | title | code | actions | disabled | Связь |');
        console.log('|---|------|-------|------|---------|----------|-------|');
        
        allRelatedScripts.forEach((item, i) => {
          const script = item.script;
          const uuid = script.id.substring(0, 8) + '...';
          const title = (script.title || '(без названия)').substring(0, 50);
          const code = (script.code || '—').substring(0, 40);
          const actions = script.actions || 0;
          const disabled = script.disabled ? 'да' : 'нет';
          const relation = item.relation;
          console.log(`| ${i + 1} | ${uuid} | ${title} | ${code} | ${actions} | ${disabled} | ${relation} |`);
        });
        
        console.log('\n## Полные структуры всех скриптов:\n');
        
        allRelatedScripts.forEach((item, i) => {
          const script = item.script;
          console.log(`### ${i + 1}. "${script.title || '(без названия)'}" (${item.relation})\n`);
          const scriptObj = allObjects.get(script.id);
          const fullStructure = {
            id: script.id,
            ...(scriptObj?.payload || {})
          };
          console.log('```json');
          console.log(JSON.stringify(fullStructure, null, 2));
          console.log('```\n');
        });
        
        console.log('## Статистика по полю code:\n');
        
        const withCode = allRelatedScripts.filter(item => item.script.code && item.script.code.trim() !== '');
        const withoutCode = allRelatedScripts.filter(item => !item.script.code || item.script.code.trim() === '');
        
        console.log(`Скриптов с code: ${withCode.length}`);
        console.log(`Скриптов без code: ${withoutCode.length}\n`);
        
        if (withCode.length > 0) {
          console.log('### Скрипты с code:\n');
          withCode.forEach((item, i) => {
            const script = item.script;
            console.log(`${i + 1}. "${script.title || '(без названия)'}" (${item.relation})`);
            console.log(`   code: "${script.code}"`);
            console.log(`   UUID: ${script.id}`);
            console.log(`   Полная структура:`);
            const scriptObj = allObjects.get(script.id);
            const fullStructure = {
              id: script.id,
              ...(scriptObj?.payload || {})
            };
            console.log('   ```json');
            console.log('   ' + JSON.stringify(fullStructure, null, 2).split('\n').join('\n   '));
            console.log('   ```');
            console.log('');
          });
        }
        
        if (withoutCode.length > 0) {
          console.log('### Скрипты без code:\n');
          withoutCode.forEach((item, i) => {
            const script = item.script;
            console.log(`${i + 1}. "${script.title || '(без названия)'}" (${item.relation})`);
            console.log(`   code: отсутствует`);
            console.log(`   UUID: ${script.id}`);
            console.log(`   Полная структура:`);
            const scriptObj = allObjects.get(script.id);
            const fullStructure = {
              id: script.id,
              ...(scriptObj?.payload || {})
            };
            console.log('   ```json');
            console.log('   ' + JSON.stringify(fullStructure, null, 2).split('\n').join('\n   '));
            console.log('   ```');
            console.log('');
          });
        }
        
        // Зачем: Анализ паттернов в code
        if (withCode.length > 0) {
          console.log('## Анализ паттернов в code:\n');
          
          const codePatterns = {
            latinOnly: [],
            withCyrillic: [],
            withSpaces: [],
            withSpecialChars: [],
            short: [],
            long: []
          };
          
          withCode.forEach(item => {
            const script = item.script;
            const code = script.code;
            
            // Зачем: Классифицировать code по различным признакам
            if (/^[a-zA-Z0-9._-]+$/.test(code)) {
              codePatterns.latinOnly.push(item);
            }
            if (/[а-яА-ЯёЁ]/.test(code)) {
              codePatterns.withCyrillic.push(item);
            }
            if (/\s/.test(code)) {
              codePatterns.withSpaces.push(item);
            }
            if (/[^a-zA-Z0-9._\s-]/.test(code)) {
              codePatterns.withSpecialChars.push(item);
            }
            if (code.length <= 10) {
              codePatterns.short.push(item);
            }
            if (code.length > 30) {
              codePatterns.long.push(item);
            }
          });
          
          console.log('### Классификация по паттернам:\n');
          console.log(`- Только латиница/цифры/точки/подчёркивания/дефисы: ${codePatterns.latinOnly.length}`);
          console.log(`- С кириллицей: ${codePatterns.withCyrillic.length}`);
          console.log(`- С пробелами: ${codePatterns.withSpaces.length}`);
          console.log(`- Со специальными символами: ${codePatterns.withSpecialChars.length}`);
          console.log(`- Короткие (≤10 символов): ${codePatterns.short.length}`);
          console.log(`- Длинные (>30 символов): ${codePatterns.long.length}\n`);
          
          if (codePatterns.withCyrillic.length > 0) {
            console.log('### Примеры code с кириллицей:\n');
            codePatterns.withCyrillic.forEach((item, i) => {
              console.log(`${i + 1}. "${item.script.title}" (${item.relation}) → code: "${item.script.code}"`);
            });
            console.log('');
          }
          
          if (codePatterns.withSpaces.length > 0) {
            console.log('### Примеры code с пробелами:\n');
            codePatterns.withSpaces.forEach((item, i) => {
              console.log(`${i + 1}. "${item.script.title}" (${item.relation}) → code: "${item.script.code}"`);
            });
            console.log('');
          }
        }
      } else {
        console.log('⚠️ Связанные скрипты не найдены\n');
      }
      
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
