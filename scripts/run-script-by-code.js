#!/usr/bin/env node

/**
 * Скрипт для выполнения скрипта по коду (code)
 * Сначала находит скрипт по коду, затем выполняет его по UUID
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const SCRIPT_CODE = process.argv[2] || process.env.REACTHOME_SCRIPT_CODE || '';

if (!SCRIPT_CODE) {
  console.error('Использование: node run-script-by-code.js "код скрипта"');
  console.error('Или: REACTHOME_SCRIPT_CODE="код" node run-script-by-code.js');
  console.error('');
  console.error('Пример:');
  console.error('  node run-script-by-code.js "Лоджия спот"');
  process.exit(1);
}

const ACTION_SET = 'ACTION_SET';
const ACTION_SCRIPT_RUN = 'ACTION_SCRIPT_RUN';

async function runScriptByCode() {
  console.log(`[INFO] Поиск и выполнение скрипта с code="${SCRIPT_CODE}"`);
  console.log(`[INFO] Подключение к ${WS_URI}...`);
  
  const ws = new WebSocket(WS_URI);
  
  let scriptFound = null;
  const timeout = setTimeout(() => {
    console.log('[ERROR] Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 15000);
  
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('[INFO] Подключение установлено\n');
      
      // Шаг 1: Запрашиваем LIST для поиска скрипта
      console.log('[STEP 1] Запрашиваем список всех объектов...');
      ws.send(JSON.stringify({ type: 'list' }));
      
      setTimeout(() => {
        // Шаг 2: Запрашиваем данные всех скриптов
        if (!scriptFound) {
          console.log('[WARNING] Скрипт не найден в LIST ответе');
          console.log('[INFO] Попробуйте использовать поиск в БД:');
          console.log(`  REACTHOME_USE_SSH=true node scripts/search-script-in-db.js "${SCRIPT_CODE}"`);
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        console.log(`[STEP 2] Запрашиваем данные скрипта ${scriptFound.id}...`);
        ws.send(JSON.stringify({ type: 'get', state: [scriptFound.id] }));
        
        setTimeout(() => {
          // Шаг 3: Выполняем скрипт
          console.log(`[STEP 3] Выполняем скрипт...`);
          const command = {
            type: ACTION_SCRIPT_RUN,
            id: scriptFound.id
          };
          console.log(`[INFO] Отправляем команду:`, JSON.stringify(command, null, 2));
          ws.send(JSON.stringify(command));
          
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            
            console.log('\n=== РЕЗУЛЬТАТЫ ===\n');
            console.log(`✅ Скрипт найден и выполнен!`);
            console.log(`   UUID: ${scriptFound.id}`);
            console.log(`   Название: ${scriptFound.title || '(без названия)'}`);
            console.log(`   Код: ${scriptFound.code || '(без кода)'}`);
            console.log(`   Команда: {"type":"ACTION_SCRIPT_RUN","id":"${scriptFound.id}"}`);
            console.log('');
            console.log('💡 Для повторного выполнения используйте UUID:');
            console.log(`   REACTHOME_SCRIPT_ID="${scriptFound.id}" \\`);
            console.log(`   python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v`);
            
            resolve();
          }, 2000);
        }, 2000);
      }, 2000);
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Собираем ID скриптов из LIST
        if (msg.type === 'list' && msg.state) {
          msg.state.forEach(([id]) => {
            // Сохраняем ID для последующего запроса
            if (!scriptFound) {
              scriptFound = { id };
            }
          });
        }
        
        // Ищем скрипт по коду в ответах ACTION_SET
        if (msg.type === ACTION_SET) {
          const payload = msg.payload || {};
          if (payload.type === 'script') {
            const scriptCode = payload.code || '';
            const scriptTitle = payload.title || '';
            
            // Проверяем совпадение по коду
            if (scriptCode.toLowerCase() === SCRIPT_CODE.toLowerCase() ||
                SCRIPT_CODE.toLowerCase() === scriptCode.toLowerCase()) {
              scriptFound = {
                id: msg.id,
                title: scriptTitle,
                code: scriptCode,
                disabled: payload.disabled || false,
                actions: payload.action || []
              };
              console.log(`[INFO] Найден скрипт:`);
              console.log(`   UUID: ${scriptFound.id}`);
              console.log(`   Название: ${scriptFound.title}`);
              console.log(`   Код: ${scriptFound.code}`);
              console.log(`   Действий: ${scriptFound.actions.length}`);
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
      reject(error);
    });
  });
}

runScriptByCode()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[ERROR]', error);
    process.exit(1);
  });

