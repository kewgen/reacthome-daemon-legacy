#!/usr/bin/env node

/**
 * Зачем: Проверить гипотезу - все скрипты принадлежат проекту
 * Проверяем связь скриптов с объектом project
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
      
      const allScripts = Array.from(scripts.values()).filter(s => s.type === 'script');
      const scriptIdsSet = new Set(allScripts.map(s => s.id));
      
      // Зачем: Найти все объекты типа project
      const projects = [];
      allObjects.forEach((obj, id) => {
        if (obj.type === 'project') {
          // Зачем: Сохраняем проект с его UUID и payload
          projects.push({ id, payload: obj.payload });
        }
      });
      
      console.log('## Проверка принадлежности скриптов к проекту\n');
      console.log(`Всего скриптов: ${allScripts.length}`);
      console.log(`Всего проектов: ${projects.length}\n`);
      
      if (projects.length === 0) {
        console.log('⚠️ Проекты не найдены');
        process.exit(0);
      }
      
      // Зачем: Проверить, какие скрипты упоминаются в проектах
      const scriptsInProjects = new Set();
      const projectScriptMap = new Map(); // projectId -> Set of scriptIds
      
      // Зачем: Для каждого проекта найти все скрипты, которые в нём упоминаются
      projects.forEach(project => {
        const projectScripts = new Set();
        // Зачем: Рекурсивно найти все UUID в payload проекта
        const uuids = findAllUUIDs(project.payload || {});
        
        // Зачем: Отфильтровать только те UUID, которые являются скриптами
        uuids.forEach(uuid => {
          if (scriptIdsSet.has(uuid)) {
            scriptsInProjects.add(uuid);
            projectScripts.add(uuid);
          }
        });
        
        // Зачем: Сохранить информацию о проекте и его скриптах
        if (projectScripts.size > 0) {
          projectScriptMap.set(project.id, {
            id: project.id,
            title: project.payload?.title || '(без названия)',
            scripts: projectScripts
          });
        }
      });
      
      const scriptsNotInProjects = allScripts.filter(s => !scriptsInProjects.has(s.id));
      
      console.log('## Статистика:\n');
      console.log(`Скриптов в проектах: ${scriptsInProjects.size}`);
      console.log(`Скриптов НЕ в проектах: ${scriptsNotInProjects.length}\n`);
      
      // Зачем: Показать детали по каждому проекту
      console.log('## Скрипты по проектам:\n');
      projectScriptMap.forEach((projectInfo, projectId) => {
        console.log(`### Проект: "${projectInfo.title}" (${projectId.substring(0, 8)}...)`);
        console.log(`   Скриптов в проекте: ${projectInfo.scripts.size}`);
        
        // Показываем первые 10 скриптов
        const scriptList = Array.from(projectInfo.scripts).slice(0, 10);
        scriptList.forEach(scriptId => {
          const script = allScripts.find(s => s.id === scriptId);
          if (script) {
            console.log(`   - "${script.title || '(без названия)'}" (${scriptId.substring(0, 8)}...)`);
          }
        });
        if (projectInfo.scripts.size > 10) {
          console.log(`   ... и ещё ${projectInfo.scripts.size - 10} скриптов`);
        }
        console.log('');
      });
      
      // Зачем: Показать скрипты, которые не принадлежат проектам
      if (scriptsNotInProjects.length > 0) {
        console.log('## Скрипты, которые НЕ принадлежат проектам:\n');
        console.log('| № | UUID | title | code | actions | disabled |');
        console.log('|---|------|-------|------|---------|----------|');
        
        scriptsNotInProjects.forEach((s, i) => {
          const uuid = s.id.substring(0, 8) + '...';
          const title = (s.title || '(без названия)').substring(0, 50);
          const code = (s.code || '—').substring(0, 40);
          const actions = s.actions || 0;
          const disabled = s.disabled ? 'да' : 'нет';
          console.log(`| ${i + 1} | ${uuid} | ${title} | ${code} | ${actions} | ${disabled} |`);
        });
      } else {
        console.log('✅ Все скрипты принадлежат проектам!\n');
      }
      
      // Зачем: Проверить структуру project для понимания связи
      if (projects.length > 0) {
        console.log('## Структура проекта (пример):\n');
        const exampleProject = projects[0];
        console.log('UUID:', exampleProject.id);
        console.log('Title:', exampleProject.payload?.title || '(без названия)');
        console.log('\nПоля payload:');
        if (exampleProject.payload) {
          Object.keys(exampleProject.payload).forEach(key => {
            const value = exampleProject.payload[key];
            if (Array.isArray(value)) {
              console.log(`  ${key}: [массив из ${value.length} элементов]`);
            } else if (typeof value === 'object') {
              console.log(`  ${key}: {объект}`);
            } else {
              const strValue = String(value).substring(0, 100);
              console.log(`  ${key}: ${strValue}`);
            }
          });
        }
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

