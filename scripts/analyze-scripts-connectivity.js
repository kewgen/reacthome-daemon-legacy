#!/usr/bin/env node

/**
 * Зачем: Проанализировать связность элементов системы и построить граф связей
 * Анализируем связи между скриптами, находим циклы, цепочки, центральные узлы
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

/**
 * Зачем: Найти циклы в графе связей (рекурсивные вызовы)
 */
function findCycles(graph, startNode, visited = new Set(), path = []) {
  const cycles = [];
  
  if (visited.has(startNode)) {
    // Найден цикл
    const cycleStart = path.indexOf(startNode);
    if (cycleStart !== -1) {
      cycles.push(path.slice(cycleStart).concat(startNode));
    }
    return cycles;
  }
  
  visited.add(startNode);
  path.push(startNode);
  
  const neighbors = graph[startNode] || [];
  for (const neighbor of neighbors) {
    cycles.push(...findCycles(graph, neighbor, new Set(visited), [...path]));
  }
  
  return cycles;
}

/**
 * Зачем: Обойти граф и найти достижимые узлы
 */
function traverse(graph, startNode) {
  const visited = new Set();
  const stack = [startNode];
  while (stack.length) {
    const node = stack.pop();
    if (visited.has(node)) continue;
    visited.add(node);
    const next = graph[node] || [];
    for (const n of next) {
      if (!visited.has(n)) stack.push(n);
    }
  }
  return visited;
}

/**
 * Зачем: Построить обратный граф (входящие ребра)
 */
function buildReverseGraph(graph) {
  const reverse = {};
  Object.keys(graph).forEach((k) => {
    reverse[k] = [];
  });
  Object.entries(graph).forEach(([from, tos]) => {
    tos.forEach((to) => {
      if (!reverse[to]) reverse[to] = [];
      reverse[to].push(from);
    });
  });
  return reverse;
}

/**
 * Зачем: Найти все пути от начального узла до конечного
 */
function findAllPaths(graph, start, end, visited = new Set(), path = []) {
  if (start === end) {
    return [[...path, end]];
  }
  
  visited.add(start);
  path.push(start);
  
  const paths = [];
  const neighbors = graph[start] || [];
  
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      paths.push(...findAllPaths(graph, neighbor, end, new Set(visited), [...path]));
    }
  }
  
  return paths;
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
      
      console.log(`## Анализ системы связей\n`);
      console.log(`Целевой скрипт: "${targetScript.title || '(без названия)'}"`);
      console.log(`UUID: ${TARGET_SCRIPT_ID}\n`);
      
      // Зачем: Построить граф связей между скриптами (скрипт -> скрипт) через ACTION_SCRIPT_RUN
      const graph = {}; // scriptId -> [array of connected scriptIds]
      const edgeTypes = {}; // "scriptId1->scriptId2" -> "тип связи"
      
      // Зачем: Инициализировать граф для всех скриптов
      allScripts.forEach(script => {
        graph[script.id] = [];
      });
      
      // Зачем: ACTION_SCRIPT_RUN: obj.payload.script — владелец действия, obj.payload.payload.id — запускаемый скрипт
      allObjects.forEach((obj, objId) => {
        if (obj.type === 'ACTION_SCRIPT_RUN' && obj.payload) {
          const callerScriptId = obj.payload.script;
          const targetId = obj.payload.payload?.id;
          
          if (scriptIdsSet.has(callerScriptId)) {
            if (targetId && scriptIdsSet.has(targetId)) {
              // Связь: callerScriptId -> targetId
              if (!graph[callerScriptId]) {
                graph[callerScriptId] = [];
              }
              if (!graph[callerScriptId].includes(targetId)) {
                graph[callerScriptId].push(targetId);
                edgeTypes[`${callerScriptId}->${targetId}`] = 'ACTION_SCRIPT_RUN';
              }
            }
          }
        }
      });

      // Зачем: Сузить анализ до компоненты связности вокруг целевого скрипта (в обе стороны)
      const reverseGraph = buildReverseGraph(graph);
      const forwardReach = traverse(graph, TARGET_SCRIPT_ID);
      const backwardReach = traverse(reverseGraph, TARGET_SCRIPT_ID);
      const relatedSet = new Set([...forwardReach, ...backwardReach]);
      
      // Зачем: Найти непосредственных вызывающих и вызываемых для целевого скрипта
      const callerIds = (reverseGraph[TARGET_SCRIPT_ID] || []).filter((id) => relatedSet.has(id));
      const calledIds = (graph[TARGET_SCRIPT_ID] || []).filter((id) => relatedSet.has(id));
      const callers = callerIds.map((id) => allScripts.find((s) => s.id === id)).filter(Boolean);
      const called = calledIds.map((id) => allScripts.find((s) => s.id === id)).filter(Boolean);
      
      console.log(`## Статистика связности\n`);
      console.log(`Всего скриптов в системе: ${allScripts.length}`);
      console.log(`Скриптов в компоненте связности вокруг целевого: ${relatedSet.size}`);
      console.log(`Скриптов, вызывающих целевой: ${callers.length}`);
      console.log(`Скриптов, вызываемых целевым: ${called.length}\n`);
      
      // Зачем: Подсчитать степени узлов (количество связей) внутри компоненты
      const inDegree = {}; // Сколько скриптов вызывают данный
      const outDegree = {}; // Сколько скриптов вызывает данный
      
      relatedSet.forEach((id) => {
        inDegree[id] = 0;
        outDegree[id] = 0;
      });
      
      relatedSet.forEach((from) => {
        const toList = (graph[from] || []).filter((to) => relatedSet.has(to));
        outDegree[from] = toList.length;
        toList.forEach((to) => {
          inDegree[to] = (inDegree[to] || 0) + 1;
        });
      });
      
      // Зачем: Найти центральные узлы (скрипты с большим количеством связей)
      const centralNodes = Array.from(relatedSet)
        .map(id => {
          const script = allScripts.find(s => s.id === id);
          if (!script) return null;
          return {
            id,
            title: script.title || '(без названия)',
            inDegree: inDegree[id] || 0,
            outDegree: outDegree[id] || 0,
            totalDegree: (inDegree[id] || 0) + (outDegree[id] || 0)
          };
        })
        .filter(n => n)
        .sort((a, b) => b.totalDegree - a.totalDegree);
      
      console.log(`## Центральные узлы (по количеству связей)\n`);
      console.log('| № | UUID | title | Входящие | Исходящие | Всего |');
      console.log('|---|------|-------|----------|-----------|-------|');
      centralNodes.slice(0, 10).forEach((node, i) => {
        const uuid = node.id.substring(0, 8) + '...';
        const title = (node.title || '(без названия)').substring(0, 40);
        console.log(`| ${i + 1} | ${uuid} | ${title} | ${node.inDegree} | ${node.outDegree} | ${node.totalDegree} |`);
      });
      
      // Зачем: Найти циклы (рекурсивные вызовы)
      const cycles = findCycles(graph, TARGET_SCRIPT_ID);
      const uniqueCycles = [];
      const cycleStrings = new Set();
      
      cycles.forEach(cycle => {
        const cycleStr = cycle.join('->');
        if (!cycleStrings.has(cycleStr)) {
          cycleStrings.add(cycleStr);
          uniqueCycles.push(cycle);
        }
      });
      
      console.log(`\n## Обнаруженные циклы (рекурсивные вызовы)\n`);
      if (uniqueCycles.length > 0) {
        uniqueCycles.forEach((cycle, i) => {
          console.log(`### Цикл ${i + 1}:\n`);
          cycle.forEach((scriptId, idx) => {
            const script = allScripts.find(s => s.id === scriptId);
            const arrow = idx < cycle.length - 1 ? ' → ' : ' → (возврат)';
            console.log(`${script ? `"${script.title}"` : scriptId}${arrow}`);
          });
          console.log('');
        });
      } else {
        console.log('⚠️ Циклы не обнаружены\n');
      }
      
      // Зачем: Построить дерево вызовов от целевого скрипта
      console.log(`## Дерево вызовов от целевого скрипта\n`);
      
      function buildCallTree(scriptId, visited = new Set(), depth = 0, maxDepth = 5) {
        if (depth > maxDepth || visited.has(scriptId)) {
          return null;
        }
        
        const script = allScripts.find(s => s.id === scriptId);
        if (!script) return null;
        
        visited.add(scriptId);
        
        const node = {
          id: scriptId,
          title: script.title || '(без названия)',
          code: script.code || null,
          children: []
        };
        
        const children = graph[scriptId] || [];
        children.forEach(childId => {
          const childTree = buildCallTree(childId, new Set(visited), depth + 1, maxDepth);
          if (childTree) {
            node.children.push(childTree);
          }
        });
        
        return node;
      }
      
      function printTree(node, prefix = '', isLast = true) {
        const marker = isLast ? '└── ' : '├── ';
        console.log(`${prefix}${marker}"${node.title}" (${node.id.substring(0, 8)}...)`);
        if (node.code) {
          console.log(`${prefix}${isLast ? '    ' : '│   '}   code: "${node.code}"`);
        }
        
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        node.children.forEach((child, index) => {
          const isLastChild = index === node.children.length - 1;
          printTree(child, childPrefix, isLastChild);
        });
      }
      
      const callTree = buildCallTree(TARGET_SCRIPT_ID);
      if (callTree) {
        printTree(callTree);
        console.log('');
      }
      
      // Зачем: Найти пути, которые объясняют связность вокруг целевого (caller -> TARGET -> callee)
      console.log(`## Пути вокруг целевого скрипта\n`);
      if (callers.length === 0 && called.length === 0) {
        console.log('⚠️ Не найдено ни вызывающих, ни вызываемых для целевого скрипта\n');
      } else {
        callers.forEach((c) => {
          console.log(`### Кто вызывает целевой: "${c.title || c.id}" → "${targetScript.title || TARGET_SCRIPT_ID}"\n`);
          console.log(`1. "${c.title || c.id}" → "${targetScript.title || TARGET_SCRIPT_ID}"\n`);
        });
        called.forEach((c) => {
          console.log(`### Кого вызывает целевой: "${targetScript.title || TARGET_SCRIPT_ID}" → "${c.title || c.id}"\n`);
          console.log(`1. "${targetScript.title || TARGET_SCRIPT_ID}" → "${c.title || c.id}"\n`);
        });
        // Зачем: Показать составные цепочки caller -> ... -> callee (если есть)
        if (callers.length > 0 && called.length > 0) {
          const maxPairs = 5;
          let shown = 0;
          for (const caller of callers) {
            for (const callee of called) {
              if (shown >= maxPairs) break;
              const paths = findAllPaths(graph, caller.id, callee.id).slice(0, 3);
              if (paths.length > 0) {
                console.log(`### Цепочка: "${caller.title}" → "${callee.title}"\n`);
                paths.forEach((p, idx) => {
                  const s = p.map((id) => allScripts.find((x) => x.id === id)?.title || id.substring(0, 8) + '...').join(' → ');
                  console.log(`${idx + 1}. ${s}`);
                });
                console.log('');
                shown++;
              }
            }
            if (shown >= maxPairs) break;
          }
        }
      }
      
      // Зачем: Статистика по типам связей
      console.log(`## Статистика по типам связей\n`);
      const edgeTypeStats = {};
      Object.values(edgeTypes).forEach(type => {
        edgeTypeStats[type] = (edgeTypeStats[type] || 0) + 1;
      });
      
      Object.entries(edgeTypeStats).forEach(([type, count]) => {
        console.log(`- ${type}: ${count}`);
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
