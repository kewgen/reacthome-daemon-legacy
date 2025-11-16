#!/usr/bin/env node

/**
 * Интеграционный тест для HTTP сервера сценариев
 * 
 * Тест проверяет:
 * 1. Запуск HTTP сервера
 * 2. Выполнение HTTP запроса с названием сценария
 * 3. Обработку сценария сервисом через WebSocket
 * 
 * Запуск:
 *   node tests/integration/test_http_script_server.js
 */

const http = require('http');
const WebSocket = require('ws');
const { Level } = require('level');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

// Константы
const TEST_WS_PORT = 3999;
const TEST_HTTP_PORT = 8999;
const TEST_DB_PATH = path.join(__dirname, '../../var/test_db');
const SCRIPT_ID = 'script/test_scenario';
const SCRIPT_NAME = 'тестовый сценарий';
const ACTION_SCRIPT_RUN = 'ACTION_SCRIPT_RUN';

// Цвета для вывода
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`[Шаг ${step}] ${message}`, 'blue');
}

// Утилиты
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanup() {
  try {
    await fs.rm(TEST_DB_PATH, { recursive: true, force: true });
  } catch (e) {
    // Игнорируем ошибки очистки
  }
}

async function createTestDatabase() {
  logStep(1, 'Создание тестовой базы данных...');
  
  await cleanup();
  
  // Создаем директорию для тестовой БД
  await fs.mkdir(TEST_DB_PATH, { recursive: true });
  
  const db = new Level(TEST_DB_PATH, { valueEncoding: 'json' });
  
  try {
    // Создаем тестовый сценарий
    await db.put(SCRIPT_ID, {
      type: 'script',
      title: SCRIPT_NAME,
      action: ['action/test_action'],
      disabled: false,
      timestamp: Date.now(),
    });
    
    // Создаем тестовое действие
    await db.put('action/test_action', {
      type: 'ACTION_DO',
      id: 'device/test',
      payload: { value: 1 },
      timestamp: Date.now(),
    });
    
    log(`✓ База данных создана: ${TEST_DB_PATH}`, 'green');
    log(`  - Сценарий: ${SCRIPT_ID} (${SCRIPT_NAME})`, 'green');
  } finally {
    await db.close();
  }
}

class MockWebSocketServer {
  constructor(port) {
    this.port = port;
    this.server = null;
    this.clients = [];
    this.receivedMessages = [];
  }

  start() {
    return new Promise((resolve) => {
      this.server = new WebSocket.Server({ port: this.port });
      
      this.server.on('connection', (ws) => {
        log(`✓ WebSocket клиент подключен`, 'green');
        this.clients.push(ws);
        
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.receivedMessages.push(message);
            log(`  Получено сообщение: ${JSON.stringify(message)}`, 'yellow');
            
            // Отвечаем на команду LIST
            if (message.type === 'list') {
              ws.send(JSON.stringify({
                type: 'list',
                state: [[SCRIPT_ID, Date.now()]],
                assets: [],
              }));
            }
          } catch (e) {
            log(`  Ошибка парсинга сообщения: ${e.message}`, 'red');
          }
        });
        
        ws.on('error', (error) => {
          log(`  WebSocket ошибка: ${error.message}`, 'red');
        });
      });
      
      this.server.on('listening', () => {
        log(`✓ Mock WebSocket сервер запущен на порту ${this.port}`, 'green');
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.clients.forEach(client => client.close());
        this.server.close(() => {
          log('✓ Mock WebSocket сервер остановлен', 'green');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  hasReceivedCommand(commandType, scriptId) {
    return this.receivedMessages.some(
      msg => msg.type === commandType && msg.id === scriptId
    );
  }

  getReceivedCommands() {
    return this.receivedMessages.filter(msg => msg.type === ACTION_SCRIPT_RUN);
  }
}

class HttpScriptServer {
  constructor() {
    this.process = null;
    this.env = {
      ...process.env,
      PORT: TEST_HTTP_PORT.toString(),
      WS_URL: `ws://localhost:${TEST_WS_PORT}`,
    };
  }

  async start() {
    logStep(2, 'Запуск HTTP сервера сценариев...');
    
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, '../../http-script-server.js');
      
      // Временно изменяем путь к БД в процессе
      // Для этого нужно модифицировать код сервера или использовать другой подход
      // Вместо этого, создадим симлинк или скопируем БД
      
      this.process = spawn('node', [serverPath], {
        env: this.env,
        cwd: path.join(__dirname, '../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      let output = '';
      let errorOutput = '';
      
      this.process.stdout.on('data', (data) => {
        output += data.toString();
        const text = data.toString();
        process.stdout.write(text); // Выводим логи сервера
        if (text.includes('HTTP сервер запущен')) {
          log('✓ HTTP сервер запущен', 'green');
          // Даем время на инициализацию и загрузку сценариев
          setTimeout(resolve, 3000);
        }
      });
      
      this.process.stderr.on('data', (data) => {
        errorOutput += data.toString();
        const text = data.toString();
        process.stderr.write(text); // Выводим ошибки сервера
        // Игнорируем предупреждения о блокировке БД, так как мы используем тестовую БД
        if (!text.includes('заблокирована') && !text.includes('LOCK')) {
          // Логируем только важные ошибки
        }
      });
      
      this.process.on('error', (error) => {
        log(`✗ Ошибка запуска сервера: ${error.message}`, 'red');
        reject(error);
      });
      
      this.process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          log(`✗ Сервер завершился с кодом ${code}`, 'red');
          if (errorOutput) {
            log(`  Ошибки: ${errorOutput}`, 'red');
          }
        }
      });
      
      // Таймаут на запуск
      setTimeout(() => {
        if (!output.includes('HTTP сервер запущен')) {
          reject(new Error('Таймаут запуска HTTP сервера'));
        }
      }, 10000);
    });
  }

  async stop() {
    if (this.process) {
      log('Остановка HTTP сервера...', 'yellow');
      this.process.kill('SIGTERM');
      
      return new Promise((resolve) => {
        this.process.on('exit', () => {
          log('✓ HTTP сервер остановлен', 'green');
          resolve();
        });
        
        setTimeout(() => {
          if (!this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
    }
  }
}

async function makeHttpRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: json });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Таймаут HTTP запроса'));
    });
  });
}

async function runTest() {
  log('\n=== Интеграционный тест HTTP сервера сценариев ===\n', 'blue');
  
  let mockWsServer = null;
  let httpServer = null;
  
  try {
    // Шаг 1: Создание тестовой базы данных
    await createTestDatabase();
    
    // Шаг 2: Запуск мок WebSocket сервера
    logStep(2, 'Запуск мок WebSocket сервера...');
    mockWsServer = new MockWebSocketServer(TEST_WS_PORT);
    await mockWsServer.start();
    await sleep(500); // Даем время на запуск
    
    // Шаг 3: Настройка окружения для HTTP сервера
    // HTTP сервер использует process.cwd() + 'var/db', поэтому копируем тестовую БД
    const varDbPath = path.join(__dirname, '../../var/db');
    const varDbBackup = varDbPath + '.backup';
    
    // Сохраняем оригинальную БД если она существует
    let hasOriginalDb = false;
    try {
      await fs.access(varDbPath);
      hasOriginalDb = true;
      await fs.rename(varDbPath, varDbBackup);
      log('✓ Оригинальная БД сохранена', 'green');
    } catch (e) {
      // БД не существует, создадим директорию
      await fs.mkdir(path.dirname(varDbPath), { recursive: true });
    }
    
    // Копируем тестовую БД
    // LevelDB - это директория, поэтому копируем рекурсивно
    try {
      // Убеждаемся, что целевая директория существует
      await fs.mkdir(varDbPath, { recursive: true });
      
      const testDbFiles = await fs.readdir(TEST_DB_PATH);
      for (const file of testDbFiles) {
        // Игнорируем скрытые файлы и LOCK файлы
        if (file.startsWith('.')) continue;
        
        const src = path.join(TEST_DB_PATH, file);
        const dest = path.join(varDbPath, file);
        const stat = await fs.stat(src);
        if (stat.isDirectory()) {
          await fs.cp(src, dest, { recursive: true });
        } else {
          await fs.copyFile(src, dest);
        }
      }
      log('✓ Тестовая БД скопирована в var/db', 'green');
    } catch (e) {
      throw new Error(`Ошибка копирования тестовой БД: ${e.message}`);
    }
    
    // Шаг 4: Запуск HTTP сервера
    logStep(3, 'Запуск HTTP сервера...');
    httpServer = new HttpScriptServer();
    await httpServer.start();
    
    // Проверяем, что сервер готов (через health endpoint)
    logStep(4, 'Проверка готовности сервера...');
    let retries = 10;
    let serverReady = false;
    while (retries > 0 && !serverReady) {
      try {
        const healthResponse = await makeHttpRequest(`http://localhost:${TEST_HTTP_PORT}/health`);
        if (healthResponse.statusCode === 200) {
          log(`✓ Сервер готов: ${JSON.stringify(healthResponse.data)}`, 'green');
          serverReady = true;
        }
      } catch (e) {
        // Сервер еще не готов, ждем
        await sleep(500);
        retries--;
      }
    }
    
    if (!serverReady) {
      throw new Error('HTTP сервер не готов к работе');
    }
    
    // Шаг 5: Выполнение HTTP запроса
    logStep(5, 'Выполнение HTTP запроса...');
    const scriptName = encodeURIComponent(SCRIPT_NAME);
    const url = `http://localhost:${TEST_HTTP_PORT}/script/${scriptName}`;
    log(`  Запрос: GET ${url}`, 'yellow');
    
    const response = await makeHttpRequest(url);
    
    log(`  Ответ: ${response.statusCode}`, response.statusCode === 200 ? 'green' : 'red');
    log(`  Данные: ${JSON.stringify(response.data, null, 2)}`, 'yellow');
    
    // Проверка результата
    if (response.statusCode !== 200) {
      throw new Error(`Ожидался статус 200, получен ${response.statusCode}: ${JSON.stringify(response.data)}`);
    }
    
    if (!response.data.success) {
      throw new Error(`Команда не выполнена успешно: ${JSON.stringify(response.data)}`);
    }
    
    log('✓ HTTP запрос выполнен успешно', 'green');
    
    // Шаг 6: Проверка, что команда была отправлена через WebSocket
    logStep(6, 'Проверка отправки команды через WebSocket...');
    await sleep(1000); // Даем время на отправку команды
    
    const commands = mockWsServer.getReceivedCommands();
    log(`  Получено команд ACTION_SCRIPT_RUN: ${commands.length}`, 'yellow');
    
    if (commands.length === 0) {
      throw new Error('Команда ACTION_SCRIPT_RUN не была отправлена через WebSocket');
    }
    
    const command = commands.find(cmd => cmd.id === SCRIPT_ID);
    if (!command) {
      throw new Error(`Команда для сценария ${SCRIPT_ID} не найдена. Полученные команды: ${JSON.stringify(commands)}`);
    }
    
    log(`✓ Команда отправлена: ${JSON.stringify(command)}`, 'green');
    
    // Финальная проверка
    logStep(7, 'Финальная проверка...');
    if (command.type === ACTION_SCRIPT_RUN && command.id === SCRIPT_ID) {
      log('✓ Все проверки пройдены!', 'green');
      log('\n=== Тест успешно завершен ===\n', 'green');
      return true;
    } else {
      throw new Error(`Неверная команда: ожидалось {type: "${ACTION_SCRIPT_RUN}", id: "${SCRIPT_ID}"}, получено: ${JSON.stringify(command)}`);
    }
    
  } catch (error) {
    log(`\n✗ Ошибка теста: ${error.message}`, 'red');
    if (error.stack) {
      log(`  Stack: ${error.stack}`, 'red');
    }
    log('\n=== Тест провален ===\n', 'red');
    return false;
  } finally {
    // Очистка
    log('Очистка ресурсов...', 'yellow');
    
    if (httpServer) {
      await httpServer.stop();
    }
    
    if (mockWsServer) {
      await mockWsServer.stop();
    }
    
    // Восстанавливаем оригинальную БД
    const varDbPath = path.join(__dirname, '../../var/db');
    const varDbBackup = varDbPath + '.backup';
    try {
      await fs.rm(varDbPath, { recursive: true, force: true });
      await fs.access(varDbBackup);
      await fs.rename(varDbBackup, varDbPath);
      log('✓ Оригинальная БД восстановлена', 'green');
    } catch (e) {
      // Если оригинальной БД не было, просто удаляем тестовую
      try {
        await fs.rm(varDbPath, { recursive: true, force: true });
      } catch (e2) {
        // Игнорируем ошибки
      }
    }
    
    await cleanup();
  }
}

// Запуск теста
if (require.main === module) {
  runTest().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    log(`Критическая ошибка: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = { runTest };

