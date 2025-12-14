#!/usr/bin/env node

/**
 * SSH клиент для подключения к демону через внешний WebSocket
 * 
 * Зачем: Обеспечивает удаленный доступ к терминалу демона через внешний WebSocket gate
 * 
 * Использование:
 *   node index.js [daemon-id]
 * 
 * Примеры:
 *   # Запуск с выбором из списка (если UUID не указан)
 *   node index.js
 * 
 *   # Запуск с указанным UUID
 *   node index.js 12345678-1234-1234-1234-123456789abc
 * 
 *   # Batch-режим (выполнение команд без интерактивного TTY)
 *   node index.js <uuid> --cmd "pwd" --cmd "ls" --wait-ms 2000
 * 
 * Переменные окружения:
 *   DAEMON_ID - ID демона (UUID), если указан, выбор из списка не предлагается
 *   GATE_URL - URL WebSocket gate (по умолчанию: wss://gate.reacthome.net)
 *   WIRE_MODE - Режим протокола: 'plain' (по умолчанию) или 'prefixed'
 *   DEBUG - Включить отладочный вывод: '1' или '0'
 *   WAIT_MS - Время ожидания в batch-режиме (по умолчанию: 1500)
 * 
 * Примечание: Для добавления известных демонов отредактируйте массив KNOWN_DAEMONS в скрипте
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');

// Константы
const PROTOCOL = 'listen';
const PTY_TYPE = 'pty';
const DEFAULT_GATE_URL = 'wss://gate.reacthome.net';
const CONNECTION_TIMEOUT = 10000; // 10 секунд
const RECONNECT_DELAY = 3000; // 3 секунды
const DEBUG = process.env.DEBUG === '1' || process.argv.includes('--debug');
const WIRE_MODE = process.env.WIRE_MODE || 'plain';
// Зачем: внешний gate шлёт/ждёт plain JSON; prefixed нужен только для совместимости (локальный ws/старый протокол)

// Список известных UUID демонов
// Зачем: Позволяет быстро выбрать демон из списка без ввода полного UUID
const KNOWN_DAEMONS = [
  { id: 'fd6765f1-ed61-4ae4-8d72-9a078a9f4316', name: 'Почтовая' },
  { id: 'd31775ae-19e8-40c9-81df-d6d672379563', name: 'Лучистое' },
  // Добавьте сюда дополнительные известные UUID демонов в формате: { id: 'uuid', name: 'Описание' }
  // Пример:
  // { id: '87654321-4321-4321-4321-cba987654321', name: 'Демон 2 - Тестовый' },
];

// Разбор аргументов
// Зачем: поддерживаем batch-режим для проверки команд без интерактивного TTY
const argv = process.argv.slice(2);
const batchCommands = [];
let waitMs = Number.parseInt(process.env.WAIT_MS || '1500', 10);
let daemonArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cmd') {
    const v = argv[i + 1];
    if (v !== undefined) {
      batchCommands.push(v);
      i++;
    }
    continue;
  }
  if (a.startsWith('--cmd=')) {
    batchCommands.push(a.slice('--cmd='.length));
    continue;
  }
  if (a === '--wait-ms') {
    const v = argv[i + 1];
    if (v !== undefined) {
      const parsed = Number.parseInt(v, 10);
      if (!Number.isNaN(parsed)) waitMs = parsed;
      i++;
    }
    continue;
  }
  if (a.startsWith('--wait-ms=')) {
    const parsed = Number.parseInt(a.slice('--wait-ms='.length), 10);
    if (!Number.isNaN(parsed)) waitMs = parsed;
    continue;
  }
  if (a === '--daemon') {
    const v = argv[i + 1];
    if (v !== undefined) {
      daemonArg = v;
      i++;
    }
    continue;
  }
  if (a === '--debug') continue;
  if (a.startsWith('-')) continue;
  if (!daemonArg) daemonArg = a;
}

// Получение параметров
let daemonId = process.env.DAEMON_ID || daemonArg;
const gateBaseUrl = process.env.GATE_URL || DEFAULT_GATE_URL;
const isBatchMode = batchCommands.length > 0;

// Проверка формата UUID
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Состояние подключения
let ws = null;
let sessionId = null; // используется только в режиме WIRE_MODE=prefixed
let isConnected = false;
let shouldReconnect = true;
let rl = null;
let selectionRl = null; // Readline для выбора демона

/**
 * Выбор демона из списка
 * Зачем: Предлагает пользователю выбрать демон из известных или ввести свой UUID
 */
function selectDaemon() {
  return new Promise((resolve, reject) => {
    if (KNOWN_DAEMONS.length === 0) {
      // Если список пуст, запрашиваем ввод
      selectionRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      selectionRl.question('Введите UUID демона: ', (input) => {
        const trimmed = input.trim();
        if (uuidRegex.test(trimmed)) {
          selectionRl.close();
          resolve(trimmed);
        } else {
          console.error(`Ошибка: "${trimmed}" не является валидным UUID`);
          selectionRl.close();
          reject(new Error('Неверный формат UUID'));
        }
      });
      return;
    }
    
    // Показываем меню выбора
    console.log('='.repeat(80));
    console.log('Выбор демона для подключения');
    console.log('='.repeat(80));
    console.log('');
    console.log('Известные демоны:');
    KNOWN_DAEMONS.forEach((daemon, index) => {
      console.log(`  ${index + 1}. ${daemon.name || daemon.id}`);
      console.log(`     ID: ${daemon.id}`);
    });
    console.log(`  ${KNOWN_DAEMONS.length + 1}. Ввести UUID вручную`);
    console.log('');
    
    selectionRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    selectionRl.question('Выберите вариант (1-' + (KNOWN_DAEMONS.length + 1) + '): ', (answer) => {
      const choice = parseInt(answer.trim(), 10);
      
      if (choice >= 1 && choice <= KNOWN_DAEMONS.length) {
        // Выбран демон из списка
        const selected = KNOWN_DAEMONS[choice - 1];
        selectionRl.close();
        console.log(`Выбран: ${selected.name || selected.id}`);
        console.log('');
        resolve(selected.id);
      } else if (choice === KNOWN_DAEMONS.length + 1) {
        // Пользователь хочет ввести UUID вручную
        selectionRl.question('Введите UUID демона: ', (input) => {
          const trimmed = input.trim();
          if (uuidRegex.test(trimmed)) {
            selectionRl.close();
            resolve(trimmed);
          } else {
            console.error(`Ошибка: "${trimmed}" не является валидным UUID`);
            selectionRl.close();
            reject(new Error('Неверный формат UUID'));
          }
        });
      } else {
        console.error(`Ошибка: Неверный выбор "${answer}"`);
        selectionRl.close();
        reject(new Error('Неверный выбор'));
      }
    });
  });
}

/**
 * Инициализация обработки ввода для терминала
 * Зачем: Использует raw mode для прямой передачи ввода в PTY без обработки readline
 */
function initReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
  
  // Переводим stdin в raw mode для прямой передачи символов
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  
  // Обработка ввода символов
  process.stdin.on('data', (chunk) => {
    if (!isConnected) {
      return;
    }
    
    // Обработка Ctrl+C
    if (chunk === '\u0003') { // Ctrl+C
      console.log('\nЗавершение подключения...');
      shouldReconnect = false;
      if (ws) {
        ws.close();
      }
      cleanup();
      process.exit(0);
      return;
    }
    
    // Отправляем ввод в терминал
    sendPTYMessage({ chunk });
  });
  
  // Обработка изменения размера терминала
  process.stdout.on('resize', () => {
    if (isConnected) {
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      sendPTYMessage({ rows, cols });
    }
  });
  
  // Обработка завершения
  process.stdin.on('end', () => {
    cleanup();
  });
}

/**
 * Очистка ресурсов
 */
function cleanup() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  if (rl) {
    rl.close();
    rl = null;
  }
  if (selectionRl) {
    selectionRl.close();
    selectionRl = null;
  }
}

/**
 * Отправка сообщения типа PTY
 */
function sendPTYMessage({ chunk, rows, cols }) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (DEBUG) console.error('[DEBUG] WebSocket не готов. readyState:', ws ? ws.readyState : 'null');
    return;
  }
  
  const message = {
    type: PTY_TYPE
  };
  
  if (chunk !== undefined) {
    message.chunk = chunk;
  }
  if (rows !== undefined && rows > 0) {
    message.rows = rows;
  }
  if (cols !== undefined && cols > 0) {
    message.cols = cols;
  }

  // Внешний gate: ожидает plain JSON. Legacy/локальный режим: prefixed `${session}${json}`.
  if (WIRE_MODE === 'prefixed') {
    if (!sessionId) {
      if (DEBUG) console.error('[DEBUG] Сессия не создана (WIRE_MODE=prefixed)');
      return;
    }
    const messageStr = `${sessionId}${JSON.stringify(message)}`;
    if (DEBUG) console.log(`[DEBUG] Отправка сообщения PTY(prefixed): ${JSON.stringify(message)}`);
    ws.send(messageStr);
  } else {
    if (DEBUG) console.log(`[DEBUG] Отправка сообщения PTY(plain): ${JSON.stringify(message)}`);
    ws.send(JSON.stringify(message));
  }
}

/**
 * Подключение к WebSocket gate
 */
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return; // Уже подключено
  }
  
  const gateURL = `${gateBaseUrl}/${daemonId}`;
  console.log(`Подключение к ${gateURL}...`);
  
  ws = new WebSocket(gateURL, PROTOCOL);
  
  const connectionTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      console.error('Таймаут подключения');
      ws.terminate();
      if (shouldReconnect) {
        console.log(`Повторная попытка через ${RECONNECT_DELAY / 1000} секунд...`);
        setTimeout(connect, RECONNECT_DELAY);
      }
    }
  }, CONNECTION_TIMEOUT);
  
  ws.on('open', () => {
    clearTimeout(connectionTimeout);
    console.log('✅ WebSocket подключен');

    // В режиме prefixed сессия нужна для протокола `${session}${json}`
    if (WIRE_MODE === 'prefixed' && !sessionId) {
      sessionId = uuidv4();
      console.log(`✅ Сессия создана (prefixed): ${sessionId}`);
    }

    isConnected = true;

    // Небольшая задержка перед отправкой первого сообщения
    setTimeout(() => {
      // Отправляем начальный размер терминала для инициализации PTY
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      if (DEBUG) console.log(`[DEBUG] Отправка инициализации PTY: rows=${rows}, cols=${cols}`);
      sendPTYMessage({ rows, cols });

      if (!isBatchMode) {
        console.log('✅ Терминал готов к работе');
        console.log('Введите команды (Ctrl+C для выхода):');
        console.log('');
      }

      // Batch-режим: отправляем команды и выходим
      if (isBatchMode) {
        if (DEBUG) console.log(`[DEBUG] Batch режим: команд=${batchCommands.length}, waitMs=${waitMs}`);
        let delayMs = 250;
        for (const cmd of batchCommands) {
          const normalized = cmd.endsWith('\n') ? cmd : `${cmd}\n`;
          setTimeout(() => sendPTYMessage({ chunk: normalized }), delayMs);
          delayMs += 450;
        }
        setTimeout(() => {
          shouldReconnect = false;
          try { ws.close(); } catch (_) {}
          setTimeout(() => process.exit(0), 500);
        }, delayMs + Math.max(0, waitMs));
      }
    }, 100);
  });
  
  ws.on('message', (data) => {
    try {
      const dataStr = data.toString();

      // Внешний gate обычно присылает plain JSON.
      // В legacy-режиме возможен prefixed `${session}${json}`.
      let message = null;
      try {
        message = JSON.parse(dataStr);
      } catch (_) {
        // ignore
      }
      if (!message && dataStr.length >= 36) {
        const possibleSessionId = dataStr.substring(0, 36);
        if (uuidRegex.test(possibleSessionId)) {
          const messageStr = dataStr.substring(36);
          try {
            message = JSON.parse(messageStr);
          } catch (e) {
            if (DEBUG) console.error('[DEBUG] Ошибка парсинга prefixed сообщения:', e.message);
            return;
          }

          // В prefixed-режиме фильтруем по sessionId (если она известна)
          if (WIRE_MODE === 'prefixed') {
            if (!sessionId) sessionId = possibleSessionId;
            if (sessionId !== possibleSessionId) return;
          }
        }
      }
      if (!message) return;
      
      // Обрабатываем сообщение типа PTY
      if (message && message.type === PTY_TYPE) {
        if (message.chunk) {
          // Выводим данные из терминала напрямую в stdout
          try {
            process.stdout.write(message.chunk);
          } catch (writeError) {
            if (DEBUG) console.error('[DEBUG] Ошибка записи в stdout:', writeError.message);
          }
        }
        // Также обрабатываем изменения размера терминала
        if (message.rows && message.cols) {
          if (DEBUG) console.log(`[DEBUG] Получено изменение размера: ${message.rows}x${message.cols}`);
        }
      } else if (message && message.type) {
        // Игнорируем другие типы сообщений (ACTION_SET и т.д.)
        if (DEBUG && message.type !== 'action_set' && message.type !== 'list') {
          console.error('[DEBUG] Игнорируем сообщение типа:', message.type);
        }
      }
    } catch (error) {
      console.error('Ошибка обработки сообщения:', error.message);
    }
  });
  
  ws.on('error', (error) => {
    clearTimeout(connectionTimeout);
    console.error(`Ошибка WebSocket: ${error.message}`);
    isConnected = false;
    sessionId = null;
    
    if (shouldReconnect) {
      console.log(`Повторная попытка через ${RECONNECT_DELAY / 1000} секунд...`);
      setTimeout(connect, RECONNECT_DELAY);
    }
  });
  
  ws.on('close', (code, reason) => {
    clearTimeout(connectionTimeout);
    console.log(`\nWebSocket закрыт (код: ${code}, причина: ${reason || 'нет'})`);
    isConnected = false;
    sessionId = null;
    
    if (shouldReconnect) {
      console.log(`Повторная попытка через ${RECONNECT_DELAY / 1000} секунд...`);
      setTimeout(connect, RECONNECT_DELAY);
    } else {
      cleanup();
      process.exit(0);
    }
  });
  
  ws.on('pong', () => {
    // Обработка pong для keepalive
  });
}

/**
 * Основная функция
 */
async function main() {
  try {
    // Если UUID не указан, предлагаем выбор
    if (!daemonId) {
      if (isBatchMode) {
        console.error('Ошибка: для batch-режима нужно указать UUID демона (аргументом или DAEMON_ID).');
        process.exit(1);
      }
      daemonId = await selectDaemon();
    }
    
    // Проверка формата UUID
    if (!uuidRegex.test(daemonId)) {
      console.error(`Ошибка: ID демона должен быть в формате UUID: ${daemonId}`);
      process.exit(1);
    }
    
    const gateURL = `${gateBaseUrl}/${daemonId}`;
    
    console.log('='.repeat(80));
    console.log('SSH подключение к демону через WebSocket');
    console.log('='.repeat(80));
    console.log(`Gate URL: ${gateURL}`);
    console.log(`Daemon ID: ${daemonId}`);
    console.log(`Protocol: ${PROTOCOL}`);
    if (DEBUG) console.log(`[DEBUG] WIRE_MODE=${WIRE_MODE}, batch=${isBatchMode}`);
    console.log('');
    
    // Инициализация ввода только для интерактивного режима
    if (!isBatchMode) {
      initReadline();
    }
    
    // Подключение к WebSocket
    connect();
    
    // Обработка завершения процесса
    process.on('SIGTERM', () => {
      shouldReconnect = false;
      if (ws) {
        ws.close();
      }
      cleanup();
      process.exit(0);
    });
  
    process.on('SIGINT', () => {
      shouldReconnect = false;
      if (ws) {
        ws.close();
      }
      cleanup();
      process.exit(0);
    });
  } catch (error) {
    console.error('Ошибка:', error.message);
    if (selectionRl) {
      selectionRl.close();
    }
    process.exit(1);
  }
}

// Запуск
main();
