#!/usr/bin/env node

/**
 * Зачем: Изучить семантику поля code всех скриптов, связанных с целевым скриптом
 * Анализируем code связанных скриптов (которые используют целевой или используются им)
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
      
      console.log(`## Анализ семантики поля code связанных скриптов\n`);
      console.log(`Целевой скрипт: "${targetScript.title || '(без названия)'}"`);
      console.log(`UUID: ${TARGET_SCRIPT_ID}`);
      console.log(`code: ${targetScript.code || '— (отсутствует)'}\n`);
      
      // Зачем: Найти все скрипты, связанные с целевым
      const relatedScripts = new Set();
      
      // Зачем: Найти скрипты, которые используют целевой скрипт
      allObjects.forEach((obj, objId) => {
        const uuids = findAllUUIDs(obj.payload || obj);
        if (uuids.has(TARGET_SCRIPT_ID)) {
          if (obj.type === 'ACTION_SCRIPT_RUN' && obj.payload && obj.payload.script) {
            const callerScriptId = obj.payload.script;
            if (scriptIdsSet.has(callerScriptId)) {
              relatedScripts.add(callerScriptId);
            }
          }
        }
      });
      
      // Зачем: Найти скрипты, которые использует целевой скрипт
      if (targetScript.action && Array.isArray(targetScript.action)) {
        targetScript.action.forEach(actionId => {
          const actionObj = allObjects.get(actionId);
          if (actionObj && actionObj.type === 'ACTION_SCRIPT_RUN' && actionObj.payload) {
            const scriptId = actionObj.payload.script;
            if (scriptIdsSet.has(scriptId)) {
              relatedScripts.add(scriptId);
            }
            // Зачем: Также проверить payload.action.id для вложенных скриптов
            if (actionObj.payload.payload && actionObj.payload.payload.id) {
              const nestedScriptId = actionObj.payload.payload.id;
              if (scriptIdsSet.has(nestedScriptId)) {
                relatedScripts.add(nestedScriptId);
              }
            }
          }
        });
      }
      
      // Зачем: Найти скрипты из того же проекта
      const projectScripts = new Set();
      allObjects.forEach((obj, objId) => {
        if (obj.type === 'project' && obj.payload && obj.payload.script) {
          const uuids = findAllUUIDs(obj.payload);
          if (uuids.has(TARGET_SCRIPT_ID)) {
            // Зачем: Это проект, к которому принадлежит целевой скрипт
            if (Array.isArray(obj.payload.script)) {
              obj.payload.script.forEach(scriptId => {
                if (scriptIdsSet.has(scriptId)) {
                  projectScripts.add(scriptId);
                }
              });
            }
          }
        }
      });
      
      const relatedScriptsArray = Array.from(relatedScripts).map(id => {
        const script = allScripts.find(s => s.id === id);
        return script ? { id, ...script } : null;
      }).filter(Boolean);
      
      const projectScriptsArray = Array.from(projectScripts).map(id => {
        const script = allScripts.find(s => s.id === id);
        return script ? { id, ...script } : null;
      }).filter(Boolean);
      
      console.log(`## Статистика:\n`);
      console.log(`Скриптов, которые используют целевой: ${relatedScriptsArray.filter(s => {
        // Проверяем, вызывают ли они целевой скрипт
        const obj = allObjects.get(s.id);
        if (obj && obj.payload && obj.payload.action) {
          return obj.payload.action.some(actionId => {
            const actionObj = allObjects.get(actionId);
            return actionObj && actionObj.type === 'ACTION_SCRIPT_RUN' && 
                   actionObj.payload && actionObj.payload.payload &&
                   actionObj.payload.payload.id === TARGET_SCRIPT_ID;
          });
        }
        return false;
      }).length}`);
      console.log(`Скриптов, которые использует целевой: ${relatedScriptsArray.filter(s => {
        // Проверяем, использует ли целевой этот скрипт
        return targetScript.action && targetScript.action.some(actionId => {
          const actionObj = allObjects.get(actionId);
          return actionObj && actionObj.type === 'ACTION_SCRIPT_RUN' && 
                 actionObj.payload && actionObj.payload.script === s.id;
        });
      }).length}`);
      console.log(`Скриптов в том же проекте: ${projectScriptsArray.length}\n`);
      
      // Зачем: Анализ семантики поля code
      console.log(`## Анализ семантики поля code\n`);
      
      /**
       * Зачем: Определить паттерн code скрипта для анализа семантики
       */
      function analyzeCodePattern(code) {
        const patterns = [];
        
        // Зачем: Определяем различные характеристики code
        if (/^[A-Z0-9_]+$/.test(code)) {
          patterns.push('UPPERCASE_WITH_UNDERSCORES');
        }
        if (/^[a-z0-9_]+$/.test(code)) {
          patterns.push('lowercase_with_underscores');
        }
        if (/^[A-Z][a-z]+/.test(code)) {
          patterns.push('PascalCase');
        }
        if (/^[a-z][A-Z]/.test(code)) {
          patterns.push('camelCase');
        }
        if (/[а-яА-Я]/.test(code)) {
          patterns.push('Cyrillic');
        }
        if (/\s/.test(code)) {
          patterns.push('with_spaces');
        }
        if (/[^\w\s]/.test(code)) {
          patterns.push('with_special_chars');
        }
        if (/\d/.test(code)) {
          patterns.push('with_numbers');
        }
        if (/\./.test(code)) {
          patterns.push('with_dots');
        }
        if (/[A-Z]/.test(code) && /[a-z]/.test(code)) {
          patterns.push('mixed_case');
        }
        
        // Зачем: Определяем семантический тип
        let semanticType = 'unknown';
        if (/toggle|on|off|open|close/i.test(code)) {
          semanticType = 'action_command';
        } else if (/^\d+\./.test(code) || /[A-Z]\d+/.test(code)) {
          semanticType = 'device_reference';
        } else if (/[а-яА-Я]/.test(code)) {
          semanticType = 'descriptive_russian';
        } else if (/^[A-Z][a-z]+/.test(code)) {
          semanticType = 'descriptive_english';
        }
        
        return {
          patterns: patterns.length > 0 ? patterns : ['plain_text'],
          semanticType
        };
      }
      
      const codeStats = {
        withCode: [],
        withoutCode: [],
        codePatterns: {},
        semanticTypes: {}
      };
      
      // Зачем: Анализируем code связанных скриптов
      relatedScriptsArray.forEach(script => {
        if (script.code) {
          codeStats.withCode.push(script);
          const analysis = analyzeCodePattern(script.code);
          
          // Зачем: Группируем по паттернам
          analysis.patterns.forEach(pattern => {
            if (!codeStats.codePatterns[pattern]) {
              codeStats.codePatterns[pattern] = [];
            }
            codeStats.codePatterns[pattern].push(script);
          });
          
          // Зачем: Группируем по семантическим типам
          if (!codeStats.semanticTypes[analysis.semanticType]) {
            codeStats.semanticTypes[analysis.semanticType] = [];
          }
          codeStats.semanticTypes[analysis.semanticType].push(script);
        } else {
          codeStats.withoutCode.push(script);
        }
      });
      
      // Зачем: Анализируем code скриптов из проекта
      const projectCodeStats = {
        withCode: [],
        withoutCode: [],
        codePatterns: {},
        semanticTypes: {}
      };
      
      projectScriptsArray.forEach(script => {
        if (script.code) {
          projectCodeStats.withCode.push(script);
          const analysis = analyzeCodePattern(script.code);
          
          // Зачем: Группируем по паттернам
          analysis.patterns.forEach(pattern => {
            if (!projectCodeStats.codePatterns[pattern]) {
              projectCodeStats.codePatterns[pattern] = [];
            }
            projectCodeStats.codePatterns[pattern].push(script);
          });
          
          // Зачем: Группируем по семантическим типам
          if (!projectCodeStats.semanticTypes[analysis.semanticType]) {
            projectCodeStats.semanticTypes[analysis.semanticType] = [];
          }
          projectCodeStats.semanticTypes[analysis.semanticType].push(script);
        } else {
          projectCodeStats.withoutCode.push(script);
        }
      });
      
      console.log(`### Связанные скрипты (прямые связи):\n`);
      console.log(`С code: ${codeStats.withCode.length}`);
      console.log(`Без code: ${codeStats.withoutCode.length}\n`);
      
      if (codeStats.withCode.length > 0) {
        console.log(`#### Примеры скриптов с code:\n`);
        codeStats.withCode.slice(0, 10).forEach((script, i) => {
          console.log(`${i + 1}. "${script.title || '(без названия)'}"`);
          console.log(`   UUID: ${script.id.substring(0, 8)}...`);
          console.log(`   code: "${script.code}"`);
          console.log('');
        });
      }
      
      if (codeStats.codePatterns && Object.keys(codeStats.codePatterns).length > 0) {
        console.log(`#### Паттерны в code связанных скриптов:\n`);
        Object.entries(codeStats.codePatterns)
          .sort((a, b) => b[1].length - a[1].length)
          .forEach(([pattern, scripts]) => {
            console.log(`- **${pattern}**: ${scripts.length} скриптов`);
            scripts.slice(0, 3).forEach(script => {
              console.log(`  - "${script.title || '(без названия)'}": \`${script.code}\``);
            });
            if (scripts.length > 3) {
              console.log(`  ... и ещё ${scripts.length - 3}`);
            }
            console.log('');
          });
      }
      
      if (codeStats.semanticTypes && Object.keys(codeStats.semanticTypes).length > 0) {
        console.log(`#### Семантические типы code связанных скриптов:\n`);
        Object.entries(codeStats.semanticTypes)
          .sort((a, b) => b[1].length - a[1].length)
          .forEach(([type, scripts]) => {
            console.log(`- **${type}**: ${scripts.length} скриптов`);
            scripts.forEach(script => {
              console.log(`  - "${script.title || '(без названия)'}": \`${script.code}\``);
            });
            console.log('');
          });
      }
      
      console.log(`### Скрипты из того же проекта:\n`);
      console.log(`С code: ${projectCodeStats.withCode.length}`);
      console.log(`Без code: ${projectCodeStats.withoutCode.length}\n`);
      
      if (projectCodeStats.withCode.length > 0) {
        console.log(`#### Примеры скриптов проекта с code:\n`);
        projectCodeStats.withCode.slice(0, 10).forEach((script, i) => {
          const analysis = analyzeCodePattern(script.code);
          console.log(`${i + 1}. "${script.title || '(без названия)'}"`);
          console.log(`   UUID: ${script.id.substring(0, 8)}...`);
          console.log(`   code: "${script.code}"`);
          console.log(`   паттерны: ${analysis.patterns.join(', ')}`);
          console.log(`   семантика: ${analysis.semanticType}`);
          console.log('');
        });
        
        if (projectCodeStats.codePatterns && Object.keys(projectCodeStats.codePatterns).length > 0) {
          console.log(`#### Паттерны в code скриптов проекта:\n`);
          Object.entries(projectCodeStats.codePatterns)
            .sort((a, b) => b[1].length - a[1].length)
            .forEach(([pattern, scripts]) => {
              console.log(`- **${pattern}**: ${scripts.length} скриптов`);
              scripts.slice(0, 5).forEach(script => {
                console.log(`  - "${script.title || '(без названия)'}": \`${script.code}\``);
              });
              if (scripts.length > 5) {
                console.log(`  ... и ещё ${scripts.length - 5}`);
              }
              console.log('');
            });
        }
        
        if (projectCodeStats.semanticTypes && Object.keys(projectCodeStats.semanticTypes).length > 0) {
          console.log(`#### Семантические типы code скриптов проекта:\n`);
          Object.entries(projectCodeStats.semanticTypes)
            .sort((a, b) => b[1].length - a[1].length)
            .forEach(([type, scripts]) => {
              console.log(`- **${type}**: ${scripts.length} скриптов`);
              scripts.slice(0, 5).forEach(script => {
                console.log(`  - "${script.title || '(без названия)'}": \`${script.code}\``);
              });
              if (scripts.length > 5) {
                console.log(`  ... и ещё ${scripts.length - 5}`);
              }
              console.log('');
            });
        }
      }
      
      // Зачем: Полный список всех связанных скриптов с их code
      console.log(`## Полный список связанных скриптов с code:\n`);
      console.log(`| № | UUID | title | code | actions | disabled |`);
      console.log(`|---|------|-------|------|---------|----------|`);
      
      const allRelated = [...relatedScriptsArray];
      allRelated.forEach((script, i) => {
        const uuid = script.id.substring(0, 8) + '...';
        const title = (script.title || '(без названия)').substring(0, 50);
        const code = (script.code || '—').substring(0, 40);
        const actions = script.actions || 0;
        const disabled = script.disabled ? 'да' : 'нет';
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
