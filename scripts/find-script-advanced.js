#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const SEARCH_TERM = process.argv[2] || process.env.REACTHOME_SCRIPT_SEARCH || '';

if (!SEARCH_TERM) {
  console.error('Использование: node find-script-advanced.js "название скрипта"');
  console.error('Или: REACTHOME_SCRIPT_SEARCH="название" node find-script-advanced.js');
  process.exit(1);
}

/**
 * Нормализует строку для поиска: приводит к нижнему регистру, удаляет лишние пробелы
 */
function normalize(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Вычисляет схожесть строк (простой алгоритм)
 */
function similarity(str1, str2) {
  const s1 = normalize(str1);
  const s2 = normalize(str2);
  
  // Точное совпадение
  if (s1 === s2) return 100;
  
  // Одно содержит другое
  if (s1.includes(s2) || s2.includes(s1)) return 80;
  
  // Все слова из одного есть в другом
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const commonWords = words1.filter(w => words2.includes(w));
  if (commonWords.length === words1.length && commonWords.length === words2.length) {
    return 70;
  }
  
  // Частичное совпадение слов
  const commonCount = commonWords.length;
  const totalWords = Math.max(words1.length, words2.length);
  if (totalWords > 0) {
    return Math.round((commonCount / totalWords) * 60);
  }
  
  return 0;
}

async function findScriptAdvanced() {
  console.log(`[INFO] Расширенный поиск скрипта: "${SEARCH_TERM}"`);
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  const ws = new WebSocket(WS_URI);
  
  const scripts = [];
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
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
        
        console.log('\n=== РЕЗУЛЬТАТЫ РАСШИРЕННОГО ПОИСКА ===\n');
        
        // Вычисляем схожесть для каждого скрипта
        const scored = scripts
          .filter(s => s.title) // Только скрипты с названием
          .map(s => ({
            ...s,
            score: similarity(SEARCH_TERM, s.title || ''),
            normalizedTitle: normalize(s.title || '')
          }))
          .filter(s => s.score > 0) // Только с ненулевой схожестью
          .sort((a, b) => b.score - a.score); // Сортируем по убыванию схожести
        
        if (scored.length === 0) {
          console.log(`❌ Скрипты, похожие на "${SEARCH_TERM}", не найдены\n`);
          
          // Показываем все скрипты, содержащие хотя бы одно слово из запроса
          const searchWords = normalize(SEARCH_TERM).split(/\s+/);
          const partialMatches = scripts
            .filter(s => {
              const title = normalize(s.title || '');
              return searchWords.some(word => title.includes(word));
            })
            .slice(0, 10);
          
          if (partialMatches.length > 0) {
            console.log('Скрипты, содержащие отдельные слова из запроса:');
            partialMatches.forEach(s => {
              console.log(`  - ${s.title} (UUID: ${s.id})`);
            });
          }
        } else {
          console.log(`✓ Найдено похожих скриптов: ${scored.length}\n`);
          
          // Показываем топ-10 наиболее похожих
          const topMatches = scored.slice(0, 10);
          topMatches.forEach((script, idx) => {
            console.log(`${idx + 1}. ${script.title || '(без названия)'} [схожесть: ${script.score}%]`);
            console.log(`   UUID: ${script.id}`);
            console.log(`   Действий: ${script.actions || 0}`);
            console.log(`   Отключён: ${script.disabled ? 'да' : 'нет'}`);
            console.log(`   Команда: {"type":"ACTION_SCRIPT_RUN","id":"${script.id}"}`);
            console.log('');
          });
          
          // Если есть точное совпадение (100%), выделяем его
          const exactMatch = scored.find(s => s.score === 100);
          if (exactMatch) {
            console.log('🎯 ТОЧНОЕ СОВПАДЕНИЕ:');
            console.log(`   UUID: ${exactMatch.id}`);
            console.log(`   Название: ${exactMatch.title}`);
            console.log(`   Команда: {"type":"ACTION_SCRIPT_RUN","id":"${exactMatch.id}"}`);
            console.log('');
          }
        }
        
      }, 5000);
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
findScriptAdvanced().catch(console.error);

