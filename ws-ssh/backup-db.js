#!/usr/bin/env node

/**
 * Скрипт для создания бэкапа БД через WebSocket SSH
 * 
 * Зачем: Создаёт архив БД на удалённом демоне и передаёт его локально через base64
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Константы
const PROTOCOL = 'listen';
const PTY_TYPE = 'pty';
const DEFAULT_GATE_URL = 'wss://gate.reacthome.net';
const CONNECTION_TIMEOUT = 30000; // 30 секунд для нестабильных соединений
const DEBUG = process.env.DEBUG === '1';

// Список известных демонов
const KNOWN_DAEMONS = [
  { id: 'fd6765f1-ed61-4ae4-8d72-9a078a9f4316', name: 'Почтовая' },
  { id: 'd31775ae-19e8-40c9-81df-d6d672379563', name: 'Лучистое' },
];

// Параметры
const daemonId = process.env.DAEMON_ID || process.argv[2];
// Зачем: используем проекную папку backups по умолчанию, которая находится на уровень выше ws-ssh
const projectBackupsDir = path.join(__dirname, '..', 'backups');
const outputDir = process.argv[3] || projectBackupsDir;
const gateBaseUrl = process.env.GATE_URL || DEFAULT_GATE_URL;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!daemonId || !uuidRegex.test(daemonId)) {
  console.error('Ошибка: требуется валидный UUID демона');
  console.error('Использование: node backup-db.js <daemon-id> [output-dir]');
  process.exit(1);
}

// Создаём директорию для бэкапов
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const backupFile = path.join(outputDir, `db-backup-${daemonId.substring(0, 8)}-${timestamp}.tar.gz`);

console.log('='.repeat(80));
console.log('Создание бэкапа БД через WebSocket SSH');
console.log('='.repeat(80));
console.log(`Daemon ID: ${daemonId}`);
console.log(`Файл будет сохранён: ${backupFile}`);
console.log('');

// Состояние
let ws = null;
let isConnected = false;
let terminalOutput = '';
let backupData = null;
let commandsSent = 0;
const commands = [
  'cd ~/reacthome-daemon 2>/dev/null || cd /home/pi/reacthome-daemon 2>/dev/null || pwd',
  'BACKUP_FILE=/tmp/db-backup-$$.tar.gz && tar -czf $BACKUP_FILE var/db/ 2>&1 && echo "BACKUP_READY"',
  'base64 -w 0 $BACKUP_FILE 2>/dev/null || base64 $BACKUP_FILE',
  'rm -f $BACKUP_FILE'
];

/**
 * Отправка команды
 */
function sendCommand(cmd) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !isConnected) {
    return false;
  }
  
  const message = {
    type: PTY_TYPE,
    chunk: cmd + '\n'
  };
  
  ws.send(JSON.stringify(message));
  return true;
}

/**
 * Извлечение base64 из вывода
 */
function extractBase64(output) {
  // Удаляем ANSI escape-последовательности и служебные символы
  const clean = output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\?2004[hl]/g, '')
    .replace(/\x08/g, ''); // backspace
  
  // Ищем самую длинную последовательность base64 символов
  // Base64 может быть разбит на несколько строк, поэтому ищем непрерывную последовательность
  const base64Pattern = /[A-Za-z0-9+/]{500,}={0,2}/g;
  const matches = clean.match(base64Pattern);
  
  if (!matches || matches.length === 0) {
    // Пробуем найти base64 без учёта переносов строк
    const noNewlines = clean.replace(/\n/g, '').replace(/\r/g, '');
    const longMatch = noNewlines.match(/[A-Za-z0-9+/]{1000,}={0,2}/);
    if (longMatch) {
      return longMatch[0];
    }
    return null;
  }
  
  // Выбираем самую длинную строку
  let bestMatch = null;
  let bestLength = 0;
  
  for (const match of matches) {
    // Пропускаем строки, которые явно не являются base64 данными
    if (match.includes('$') || match.includes('#') || match.includes('[')) continue;
    
    if (match.length > bestLength) {
      bestLength = match.length;
      bestMatch = match;
    }
  }
  
  // Если нашли несколько коротких совпадений, пробуем объединить их
  if (matches.length > 1 && bestLength < 50000) {
    // Пробуем найти непрерывную последовательность в исходном тексте
    const combined = matches.join('');
    if (combined.length > bestLength && /^[A-Za-z0-9+/]+={0,2}$/.test(combined)) {
      return combined;
    }
  }
  
  return bestMatch;
}

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Подключение
 */
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  
  const gateURL = `${gateBaseUrl}/${daemonId}`;
  if (reconnectAttempts === 0) {
    console.log(`Подключение к ${gateURL}...`);
  } else {
    console.log(`Повторная попытка подключения (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  }
  
  ws = new WebSocket(gateURL, PROTOCOL);
  
  const connectionTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      console.error('Таймаут подключения');
      ws.terminate();
      
      reconnectAttempts++;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        console.log('Повторная попытка через 5 секунд...');
        setTimeout(connect, 5000);
      } else {
        console.error('Превышено максимальное количество попыток подключения');
        process.exit(1);
      }
    }
  }, CONNECTION_TIMEOUT);
  
  ws.on('open', () => {
    clearTimeout(connectionTimeout);
    console.log('✅ WebSocket подключен');
    isConnected = true;
    reconnectAttempts = 0; // Сброс счётчика при успешном подключении
    
    setTimeout(() => {
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      ws.send(JSON.stringify({ type: PTY_TYPE, rows, cols }));
      
      console.log('Создание архива БД...');
      
      // Отправляем команды с задержками
      let delay = 300;
      commands.forEach((cmd, index) => {
        setTimeout(() => {
          if (DEBUG) console.log(`[DEBUG] Отправка команды ${index + 1}: ${cmd.substring(0, 50)}...`);
          sendCommand(cmd);
          commandsSent++;
        }, delay);
        delay += 2000; // 2 секунды между командами
      });
      
      // Таймаут на получение данных
      setTimeout(() => {
        if (!backupData) {
          // Пробуем извлечь base64 ещё раз перед выходом
          backupData = extractBase64(terminalOutput);
          
          if (backupData) {
            console.log('✅ Бэкап найден в выводе, декодирование...');
            try {
              const buffer = Buffer.from(backupData, 'base64');
              fs.writeFileSync(backupFile, buffer);
              const size = (buffer.length / 1024 / 1024).toFixed(2);
              console.log(`✅ Бэкап сохранён: ${backupFile}`);
              console.log(`   Размер: ${size} MB`);
              ws.close();
              setTimeout(() => process.exit(0), 500);
              return;
            } catch (error) {
              console.error('Ошибка сохранения:', error.message);
            }
          }
          
          console.error('Таймаут: бэкап не получен');
          console.log('Вывод терминала (последние 3000 символов):');
          console.log(terminalOutput.slice(-3000));
          console.log('');
          console.log('Попробуйте запустить скрипт ещё раз или проверьте доступность демона');
          process.exit(1);
        }
      }, delay + 8000); // Увеличиваем время ожидания
    }, 200);
  });
  
  ws.on('message', (data) => {
    try {
      const dataStr = data.toString();
      let message = null;
      
      try {
        message = JSON.parse(dataStr);
      } catch (_) {
        // ignore
      }
      
      if (message && message.type === PTY_TYPE && message.chunk) {
        const chunk = message.chunk;
        terminalOutput += chunk;
        
        // Пытаемся извлечь base64 после отправки всех команд
        if (commandsSent >= commands.length && !backupData) {
          backupData = extractBase64(terminalOutput);
          
          if (backupData) {
            console.log('✅ Бэкап получен, декодирование...');
            
            try {
              const buffer = Buffer.from(backupData, 'base64');
              
              fs.writeFileSync(backupFile, buffer);
              
              const size = (buffer.length / 1024 / 1024).toFixed(2);
              console.log(`✅ Бэкап сохранён: ${backupFile}`);
              console.log(`   Размер: ${size} MB`);
              
              // Проверяем, что это валидный tar.gz
              try {
                const { execSync } = require('child_process');
                execSync(`tar -tzf "${backupFile}" > /dev/null 2>&1`, { encoding: 'utf8' });
                console.log('   Формат: валидный tar.gz');
              } catch (_) {
                console.log('   Предупреждение: не удалось проверить формат (но файл сохранён)');
              }
              
              ws.close();
              setTimeout(() => process.exit(0), 500);
            } catch (error) {
              console.error('Ошибка сохранения бэкапа:', error.message);
              process.exit(1);
            }
          }
        }
      }
    } catch (error) {
      if (DEBUG) console.error('Ошибка обработки сообщения:', error.message);
    }
  });
  
  ws.on('error', (error) => {
    clearTimeout(connectionTimeout);
    console.error(`Ошибка WebSocket: ${error.message}`);
    
    reconnectAttempts++;
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log('Повторная попытка через 5 секунд...');
      setTimeout(connect, 5000);
    } else {
      console.error('Превышено максимальное количество попыток подключения');
      process.exit(1);
    }
  });
  
  ws.on('close', () => {
    if (backupData) {
      console.log('Соединение закрыто');
    } else if (commandsSent >= commands.length) {
      console.error('Соединение закрыто до получения бэкапа');
      console.log('Вывод терминала (последние 1000 символов):');
      console.log(terminalOutput.slice(-1000));
      process.exit(1);
    }
  });
}

// Запуск
connect();
