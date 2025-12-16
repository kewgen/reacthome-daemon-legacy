#!/usr/bin/env node

/**
 * Зачем: Найти скрипты, которые никто не использует
 * Проверяем ВСЕ объекты системы на наличие ссылок на скрипты в любых полях
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
 * Зачем: Рекурсивно найти все UUID в объекте (включая вложенные объекты и массивы)
 */
function findAllUUIDs(obj, found = new Set(), depth = 0) {
  if (depth > 10) return found; // Защита от бесконечной рекурсии
  
  if (obj === null || obj === undefined) {
    return found;
  }
  
  if (typeof obj === 'string') {
    // Проверяем, является ли строка UUID (формат: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
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
      
      console.log('Всего скриптов:', allScripts.length);
      console.log('Проверяю все объекты системы на ссылки на скрипты...\n');
      
      // Зачем: Собираем все UUID, которые встречаются в объектах системы
      const referencedScriptIds = new Set();
      const referenceStats = {
        byType: {},
        totalReferences: 0
      };
      
      allObjects.forEach((obj, objId) => {
        const objType = obj.type || 'unknown';
        if (!referenceStats.byType[objType]) {
          referenceStats.byType[objType] = { total: 0, withScriptRefs: 0 };
        }
        referenceStats.byType[objType].total++;
        
        // Зачем: Находим все UUID в payload объекта
        const uuids = findAllUUIDs(obj.payload || obj);
        let hasScriptRef = false;
        
        uuids.forEach(uuid => {
          if (scriptIdsSet.has(uuid)) {
            referencedScriptIds.add(uuid);
            hasScriptRef = true;
            referenceStats.totalReferences++;
          }
        });
        
        if (hasScriptRef) {
          referenceStats.byType[objType].withScriptRefs++;
        }
      });
      
      // Зачем: Найти неиспользуемые скрипты и отсортировать по количеству действий
      const unused = allScripts.filter(s => !referencedScriptIds.has(s.id))
        .sort((a, b) => (b.actions || 0) - (a.actions || 0));
      
      console.log('## Статистика использования скриптов\n');
      console.log('Всего скриптов:', allScripts.length);
      console.log('Используются:', referencedScriptIds.size);
      console.log('Не используются:', unused.length);
      console.log('Всего ссылок на скрипты:', referenceStats.totalReferences);
      
      console.log('\n## Типы объектов, которые ссылаются на скрипты:\n');
      console.log('| Тип | Всего | Со ссылками на скрипты |');
      console.log('|-----|-------|-------------------------|');
      Object.entries(referenceStats.byType)
        .filter(([type, stats]) => stats.withScriptRefs > 0)
        .sort((a, b) => b[1].withScriptRefs - a[1].withScriptRefs)
        .forEach(([type, stats]) => {
          console.log(`| ${type} | ${stats.total} | ${stats.withScriptRefs} |`);
        });
      
      // Зачем: Показать список всех неиспользуемых скриптов
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

