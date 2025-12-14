#!/usr/bin/env node

/**
 * Зачем: Найти все объекты системы, связанные со скриптом, и показать их полную структуру
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
 * Зачем: Рекурсивно найти все UUID в объекте и проверить, содержит ли он целевой UUID
 */
function containsUUID(obj, targetUUID, path = '', depth = 0) {
  if (depth > 15) return null; // Защита от бесконечной рекурсии
  
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (typeof obj === 'string') {
    if (obj === targetUUID) {
      return { path, value: obj };
    }
    return null;
  }
  
  if (Array.isArray(obj)) {
    const results = [];
    obj.forEach((item, index) => {
      const result = containsUUID(item, targetUUID, `${path}[${index}]`, depth + 1);
      if (result) {
        results.push(result);
      }
    });
    return results.length > 0 ? results : null;
  }
  
  if (typeof obj === 'object') {
    const results = [];
    Object.entries(obj).forEach(([key, value]) => {
      const newPath = path ? `${path}.${key}` : key;
      if (value === targetUUID) {
        results.push({ path: newPath, value });
      } else {
        const result = containsUUID(value, targetUUID, newPath, depth + 1);
        if (result) {
          if (Array.isArray(result)) {
            results.push(...result);
          } else {
            results.push(result);
          }
        }
      }
    });
    return results.length > 0 ? results : null;
  }
  
  return null;
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
      
      const targetScriptObject = allObjects.get(TARGET_SCRIPT_ID);
      const allScripts = Array.from(scripts.values()).filter(s => s.type === 'script');
      
      console.log(`## Полная структура скрипта и связанных объектов\n`);
      console.log(`Скрипт: "${targetScript.title || '(без названия)'}"`);
      console.log(`UUID: ${TARGET_SCRIPT_ID}\n`);
      
      // Зачем: Показать полную структуру самого скрипта
      console.log(`## Структура самого скрипта\n`);
      console.log(`### UUID: ${TARGET_SCRIPT_ID}\n`);
      
      if (targetScriptObject && targetScriptObject.payload) {
        console.log('**Полная структура объекта скрипта:**');
        console.log('```json');
        // Зачем: Добавляем UUID скрипта в структуру, так как он хранится как ключ, а не в payload
        const fullScriptStructure = {
          id: TARGET_SCRIPT_ID,
          ...targetScriptObject.payload
        };
        console.log(JSON.stringify(fullScriptStructure, null, 2));
        console.log('```\n');
        
        // Зачем: Показать детали действий скрипта
        if (targetScriptObject.payload.action && Array.isArray(targetScriptObject.payload.action)) {
          console.log(`**Действий в скрипте:** ${targetScriptObject.payload.action.length}\n`);
          
          if (targetScriptObject.payload.action.length > 0) {
            console.log('**Список UUID действий:**');
            targetScriptObject.payload.action.forEach((actionId, i) => {
              const actionObj = allObjects.get(actionId);
              if (actionObj) {
                console.log(`${i + 1}. ${actionObj.type || 'unknown'} (${actionId})`);
              } else {
                console.log(`${i + 1}. (не найден) (${actionId})`);
              }
            });
            console.log('');
          }
        }
      } else {
        console.log('⚠️ Полная структура скрипта не найдена\n');
      }
      
      console.log('---\n');
      
      // Зачем: Найти все объекты, которые содержат UUID этого скрипта
      const connectedObjects = [];
      
      allObjects.forEach((obj, objId) => {
        const matches = containsUUID(obj.payload || obj, TARGET_SCRIPT_ID);
        if (matches) {
          connectedObjects.push({
            id: objId,
            type: obj.type || 'unknown',
            payload: obj.payload,
            matches: Array.isArray(matches) ? matches : [matches]
          });
        }
      });
      
      console.log(`Найдено связанных объектов: ${connectedObjects.length}\n`);
      
      // Зачем: Группировать по типам и показать полную структуру
      const byType = {};
      connectedObjects.forEach(obj => {
        if (!byType[obj.type]) {
          byType[obj.type] = [];
        }
        byType[obj.type].push(obj);
      });
      
      Object.entries(byType)
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([type, objs]) => {
          console.log(`## ${type} (${objs.length} объектов)\n`);
          
          objs.forEach((obj, i) => {
            console.log(`### ${i + 1}. UUID: ${obj.id}\n`);
            
            // Зачем: Показать пути, где найден UUID скрипта
            console.log('**Пути, где найден UUID скрипта:**');
            obj.matches.forEach(match => {
              console.log(`- \`${match.path}\` = \`${match.value}\``);
            });
            console.log('');
            
            // Зачем: Показать полную структуру объекта с добавлением id
            console.log('**Полная структура объекта:**');
            console.log('```json');
            // Зачем: Добавляем id объекта в структуру, так как он хранится как ключ, а не в payload
            const fullObjectStructure = {
              id: obj.id,
              ...(obj.payload || obj)
            };
            console.log(JSON.stringify(fullObjectStructure, null, 2));
            console.log('```\n');
            
            // Зачем: Для ACTION_SCRIPT_RUN показать дополнительную информацию
            if (type === 'ACTION_SCRIPT_RUN' && obj.payload) {
              const scriptId = obj.payload.script;
              const script = allScripts.find(s => s.id === scriptId);
              if (script) {
                console.log(`**Вызывается из скрипта:** "${script.title || '(без названия)'}" (${scriptId})`);
              }
              if (obj.payload.payload && obj.payload.payload.id) {
                const targetId = obj.payload.payload.id;
                const targetObj = allObjects.get(targetId);
                if (targetObj) {
                  console.log(`**Запускает объект:** ${targetObj.type || 'unknown'} (${targetId})`);
                  if (targetObj.type === 'script') {
                    const targetScript = allScripts.find(s => s.id === targetId);
                    if (targetScript) {
                      console.log(`**Название запускаемого скрипта:** "${targetScript.title || '(без названия)'}"`);
                    }
                  }
                }
              }
              console.log('');
            }
            
            // Зачем: Для project показать название проекта
            if (type === 'project' && obj.payload) {
              console.log(`**Название проекта:** "${obj.payload.title || '(без названия)'}"`);
              console.log('');
            }
            
            console.log('---\n');
          });
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

