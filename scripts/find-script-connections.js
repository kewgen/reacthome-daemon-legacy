#!/usr/bin/env node

/**
 * Зачем: Найти все связи конкретного скрипта
 * - Где используется (какие объекты ссылаются на него)
 * - На что ссылается (какие действия/скрипты использует)
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
      
      // Зачем: Получить все скрипты и создать Set для быстрого поиска
      const allScripts = Array.from(scripts.values()).filter(s => s.type === 'script');
      const scriptIdsSet = new Set(allScripts.map(s => s.id));
      
      console.log(`## Связи скрипта: "${targetScript.title || '(без названия)'}"\n`);
      console.log(`UUID: ${TARGET_SCRIPT_ID}\n`);
      
      // Зачем: Найти все объекты, которые ссылаются на этот скрипт
      const references = [];
      allObjects.forEach((obj, objId) => {
        // Зачем: Рекурсивно найти все UUID в объекте
        const uuids = findAllUUIDs(obj.payload || obj);
        if (uuids.has(TARGET_SCRIPT_ID)) {
          references.push({
            id: objId,
            type: obj.type || 'unknown',
            payload: obj.payload
          });
        }
      });
      
      // Зачем: Разделить ссылки на "использование" и "принадлежность"
      const usageReferences = references.filter(ref => ref.type !== 'project');
      const projectReferences = references.filter(ref => ref.type === 'project');
      
      console.log('## Принадлежность к проекту:\n');
      if (projectReferences.length > 0) {
        projectReferences.forEach((ref, i) => {
          console.log(`${i + 1}. Проект: "${ref.payload?.title || '(без названия)'}"`);
          console.log(`   UUID: ${ref.id}`);
          console.log('');
        });
      } else {
        console.log('⚠️ Скрипт не принадлежит ни одному проекту\n');
      }
      
      console.log('## Где используется этот скрипт:\n');
      console.log(`Найдено ссылок: ${usageReferences.length}\n`);
      
      if (usageReferences.length > 0) {
        // Зачем: Группировать ссылки по типам объектов для удобного отображения
        const byType = {};
        usageReferences.forEach(ref => {
          if (!byType[ref.type]) {
            byType[ref.type] = [];
          }
          byType[ref.type].push(ref);
        });
        
        // Зачем: Отсортировать по количеству ссылок и вывести детали
        Object.entries(byType)
          .sort((a, b) => b[1].length - a[1].length)
          .forEach(([type, refs]) => {
            console.log(`### ${type} (${refs.length}):\n`);
            refs.forEach((ref, i) => {
              console.log(`${i + 1}. UUID: ${ref.id}`);
              
              // Зачем: Показать более детальную информацию в зависимости от типа
              if (type === 'ACTION_SCRIPT_RUN' && ref.payload) {
                const scriptId = ref.payload.script;
                const script = allScripts.find(s => s.id === scriptId);
                if (script) {
                  const isSelf = scriptId === TARGET_SCRIPT_ID;
                  console.log(`   Вызывается из скрипта: "${script.title || '(без названия)'}" ${isSelf ? '⚠️ (РЕКУРСИЯ - ссылка на себя)' : ''}`);
                  console.log(`   UUID вызывающего скрипта: ${scriptId}`);
                }
                if (ref.payload.payload && ref.payload.payload.id) {
                  const targetId = ref.payload.payload.id;
                  const targetObj = allObjects.get(targetId);
                  if (targetObj) {
                    const targetType = targetObj.type || 'unknown';
                    const isTargetScript = targetId === TARGET_SCRIPT_ID;
                    console.log(`   Запускает: ${targetType} (${targetId.substring(0, 8)}...) ${isTargetScript ? '⚠️ (этот скрипт)' : ''}`);
                    if (targetObj.type === 'script') {
                      const targetScript = allScripts.find(s => s.id === targetId);
                      if (targetScript) {
                        console.log(`   Название запускаемого скрипта: "${targetScript.title || '(без названия)'}"`);
                      }
                    }
                  }
                }
              }
              
              console.log('');
            });
          });
      } else {
        console.log('⚠️ Скрипт нигде не используется (кроме принадлежности к проекту)\n');
      }
      
      // Зачем: Найти все объекты, на которые ссылается этот скрипт
      console.log('## На что ссылается этот скрипт:\n');
      
      if (targetScript.action && Array.isArray(targetScript.action)) {
        console.log(`Действий в скрипте: ${targetScript.action.length}\n`);
        
        const actionTypes = {};
        const scriptRefs = [];
        
        targetScript.action.forEach(actionId => {
          const obj = allObjects.get(actionId);
          if (obj) {
            const type = obj.type || 'unknown';
            if (!actionTypes[type]) {
              actionTypes[type] = [];
            }
            actionTypes[type].push({ id: actionId, obj });
            
            if (scriptIdsSet.has(actionId)) {
              const script = allScripts.find(s => s.id === actionId);
              scriptRefs.push({ id: actionId, script });
            }
          }
        });
        
        if (scriptRefs.length > 0) {
          console.log('### Ссылки на другие скрипты:\n');
          scriptRefs.forEach((ref, i) => {
            const isSelf = ref.id === TARGET_SCRIPT_ID;
            console.log(`${i + 1}. "${ref.script.title || '(без названия)'}" ${isSelf ? '⚠️ (РЕКУРСИЯ - ссылка на себя)' : ''}`);
            console.log(`   UUID: ${ref.id}`);
            console.log(`   Действий в скрипте: ${ref.script.actions || 0}`);
            console.log(`   Отключен: ${ref.script.disabled ? 'да' : 'нет'}`);
            console.log('');
          });
        }
        
        console.log('### Действия по типам:\n');
        Object.entries(actionTypes)
          .sort((a, b) => b[1].length - a[1].length)
          .forEach(([type, actions]) => {
            console.log(`- ${type}: ${actions.length}`);
          });
        
        console.log('\n### Детали действий:\n');
        targetScript.action.forEach((actionId, i) => {
          const obj = allObjects.get(actionId);
          if (obj) {
            const type = obj.type || 'unknown';
            console.log(`${i + 1}. ${type} (${actionId})`);
            
            // Зачем: Показать детали для ACTION_SCRIPT_RUN
            if (type === 'ACTION_SCRIPT_RUN' && obj.payload && obj.payload.script) {
              const scriptId = obj.payload.script;
              const script = allScripts.find(s => s.id === scriptId);
              if (script) {
                const isSelf = scriptId === TARGET_SCRIPT_ID;
                console.log(`   Запускает скрипт: "${script.title || '(без названия)'}" ${isSelf ? '⚠️ (РЕКУРСИЯ)' : ''}`);
                console.log(`   UUID скрипта: ${scriptId}`);
              }
              if (obj.payload.payload && obj.payload.payload.id) {
                const targetId = obj.payload.payload.id;
                const targetObj = allObjects.get(targetId);
                if (targetObj && targetObj.type === 'script') {
                  const targetScript = allScripts.find(s => s.id === targetId);
                  if (targetScript) {
                    console.log(`   Скрипт запускает: "${targetScript.title || '(без названия)'}" (${targetId.substring(0, 8)}...)`);
                  }
                }
              }
            }
            
            const payloadStr = JSON.stringify(obj.payload || {}).substring(0, 150);
            console.log(`   payload: ${payloadStr}...`);
            console.log('');
          }
        });
      } else {
        console.log('⚠️ Скрипт не содержит действий\n');
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

