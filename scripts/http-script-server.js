#!/usr/bin/env node

/**
 * HTTP сервер для запуска сценариев умного дома по имени
 * 
 * Требования:
 *   - Node.js 18+ (совместимо с требованиями основного проекта)
 *   - ws ^7.2.5 (совместимо с версией в основном проекте)
 *   - level ^8.0.0 (совместимо с версией в основном проекте)
 * 
 * Использование:
 *   node http-script-server.js
 * 
 * API:
 *   GET /script/:name - запустить сценарий по имени
 *   GET /scripts - получить список всех сценариев
 *   GET /health - проверка здоровья сервера
 * 
 * Пример:
 *   curl http://localhost:8080/script/вечер
 *   curl http://localhost:8080/scripts
 */

// Встроенные модули Node.js (не требуют установки)
const http = require('http');
const url = require('url');
const path = require('path');

// Внешние зависимости (совместимы с версиями из основного проекта)
// ws ^7.2.5 - WebSocket клиент
// level ^8.0.0 - LevelDB обертка
const WebSocket = require('ws');

const WS_PORT = 3000;
const HTTP_PORT = process.env.PORT || 8080;
const WS_URL = process.env.WS_URL || `ws://localhost:${WS_PORT}`;

// Константы из проекта
const ACTION_SCRIPT_RUN = 'ACTION_SCRIPT_RUN';
const SCRIPT = 'script';
const LIST = 'list';

class ScriptServer {
  constructor() {
    this.ws = null;
    this.scripts = new Map(); // name -> id
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
    this.requestId = 0;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log(`Подключение к WebSocket: ${WS_URL}`);
      
      this.ws = new WebSocket(WS_URL);
      
      this.ws.on('open', () => {
        console.log('WebSocket подключен');
        this.connected = true;
        this.loadScripts().then(() => {
          resolve();
        }).catch(reject);
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (e) {
          console.error('Ошибка парсинга сообщения:', e);
        }
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error.message);
        this.connected = false;
        // WebSocket.CLOSED = 3 (ws версия 7.x)
        if (!this.ws || this.ws.readyState === 3) {
          reject(error);
        }
      });

      this.ws.on('close', () => {
        console.log('WebSocket отключен, переподключение через 5 секунд...');
        this.connected = false;
        setTimeout(() => this.connect().catch(console.error), 5000);
      });
    });
  }

  handleMessage(message) {
    // Обработка ответов на запросы
    if (message.type === LIST && message.state) {
      // Обновляем список сценариев
      this.updateScripts(message.state);
    }
  }

  send(message) {
    return new Promise((resolve, reject) => {
      // WebSocket.OPEN = 1 (ws версия 7.x)
      if (!this.connected || !this.ws || this.ws.readyState !== 1) {
        reject(new Error('WebSocket не подключен'));
        return;
      }

      const requestId = ++this.requestId;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Таймаут ожидания ответа'));
      }, 5000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        this.ws.send(JSON.stringify(message), (error) => {
          if (error) {
            clearTimeout(timeout);
            this.pendingRequests.delete(requestId);
            reject(error);
          } else {
            // Для простых команд сразу резолвим
            if (message.type === ACTION_SCRIPT_RUN) {
              clearTimeout(timeout);
              this.pendingRequests.delete(requestId);
              resolve({ success: true });
            }
          }
        });
      } catch (e) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(e);
      }
    });
  }

  async loadScripts() {
    try {
      // Запрашиваем список всех данных
      await this.send({ type: LIST });
      console.log(`Загружено сценариев: ${this.scripts.size}`);
    } catch (e) {
      console.error('Ошибка загрузки сценариев:', e.message);
    }
  }

  updateScripts(stateList) {
    // stateList - это массив [id, timestamp]
    // Для получения полных данных нужно использовать команду GET
    // Но проще использовать прямое чтение из БД
    this.loadScriptsFromDB();
  }

  async loadScriptsFromDB() {
    try {
      // Динамический require для level (загружается только при необходимости)
      const { Level } = require('level');
      const dbPath = path.join(process.cwd(), 'var', 'db');
      // Level 8.x API: new Level(path, { valueEncoding: 'json' })
      const db = new Level(dbPath, { valueEncoding: 'json' });
      
      const scripts = new Map();
      
      // Level 8.x API: async iterator для чтения всех записей
      for await (const [key, value] of db.iterator()) {
        // Проверяем, является ли это сценарием
        if (value && value.type === SCRIPT && value.title) {
          const name = value.title.toLowerCase().trim();
          scripts.set(name, key);
          // Также добавляем варианты с разными регистрами
          scripts.set(value.title.trim(), key);
        }
      }
      
      // Level 8.x API: асинхронное закрытие базы данных
      await db.close();
      this.scripts = scripts;
      console.log(`Загружено сценариев из БД: ${this.scripts.size}`);
    } catch (e) {
      // Обработка ошибки блокировки БД (когда демон уже открыл базу)
      if (e.code === 'LEVEL_LOCKED' || e.message.includes('LOCK')) {
        console.warn('База данных заблокирована демоном. Попробуйте запустить сервер на другой машине или использовать WebSocket.');
      } else {
        console.error('Ошибка чтения БД:', e.message);
      }
      // Продолжаем работу, возможно сценарии уже загружены
    }
  }

  findScript(name) {
    const normalizedName = name.toLowerCase().trim();
    
    // Точное совпадение (приоритет)
    if (this.scripts.has(normalizedName)) {
      return this.scripts.get(normalizedName);
    }
    
    // Поиск по частичному совпадению (только если точного нет)
    let bestMatch = null;
    let bestMatchLength = 0;
    
    for (const [scriptName, scriptId] of this.scripts.entries()) {
      const scriptNameLower = scriptName.toLowerCase();
      if (scriptNameLower.includes(normalizedName) || normalizedName.includes(scriptNameLower)) {
        // Выбираем самое длинное совпадение (более точное)
        const matchLength = Math.min(scriptNameLower.length, normalizedName.length);
        if (matchLength > bestMatchLength) {
          bestMatch = scriptId;
          bestMatchLength = matchLength;
        }
      }
    }
    
    return bestMatch;
  }

  async runScript(name) {
    const scriptId = this.findScript(name);
    
    if (!scriptId) {
      throw new Error(`Сценарий "${name}" не найден`);
    }

    if (!this.connected) {
      throw new Error('WebSocket не подключен');
    }

    try {
      await this.send({
        type: ACTION_SCRIPT_RUN,
        id: scriptId
      });
      return { success: true, scriptId, name };
    } catch (e) {
      throw new Error(`Ошибка запуска сценария: ${e.message}`);
    }
  }

  getScriptsList() {
    const scriptsById = new Map(); // id -> name (берем первое оригинальное имя)
    
    for (const [name, id] of this.scripts.entries()) {
      // Сохраняем оригинальное имя (не lowercase), если его еще нет
      if (!scriptsById.has(id) || name !== name.toLowerCase()) {
        scriptsById.set(id, name);
      }
    }
    
    const list = [];
    for (const [id, name] of scriptsById.entries()) {
      list.push({ name, id });
    }
    
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  startHttpServer() {
    const server = http.createServer(async (req, res) => {
      // Используем WHATWG URL API для совместимости с Node.js 18+
      // url.parse устарел, но для простоты используем его (совместим с Node.js 18+)
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;
      const method = req.method;

      // CORS заголовки
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        // Маршрут: GET /script/:name
        if (method === 'GET' && pathname.startsWith('/script/')) {
          const scriptName = decodeURIComponent(pathname.slice('/script/'.length));
          
          if (!scriptName) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Имя сценария не указано' }, null, 2));
            return;
          }

          try {
            const result = await this.runScript(scriptName);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result, null, 2));
          } catch (e) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message }, null, 2));
          }
          return;
        }

        // Маршрут: GET /scripts
        if (method === 'GET' && pathname === '/scripts') {
          const scripts = this.getScriptsList();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ scripts, count: scripts.length }, null, 2));
          return;
        }

        // Маршрут: GET /health
        if (method === 'GET' && pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'ok',
            connected: this.connected,
            scriptsCount: this.scripts.size
          }, null, 2));
          return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Маршрут не найден' }, null, 2));
      } catch (e) {
        console.error('Ошибка обработки запроса:', e);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Внутренняя ошибка сервера' }, null, 2));
      }
    });

    server.listen(HTTP_PORT, () => {
      console.log(`HTTP сервер запущен на порту ${HTTP_PORT}`);
      console.log(`  GET http://localhost:${HTTP_PORT}/script/:name - запустить сценарий`);
      console.log(`  GET http://localhost:${HTTP_PORT}/scripts - список сценариев`);
      console.log(`  GET http://localhost:${HTTP_PORT}/health - статус сервера`);
    });

    server.on('error', (error) => {
      console.error('Ошибка HTTP сервера:', error);
    });
  }

  async start() {
    // Загружаем сценарии из БД при старте
    this.loadScriptsFromDB();
    
    // Подключаемся к WebSocket
    await this.connect();
    
    // Запускаем HTTP сервер
    this.startHttpServer();
    
    // Периодически обновляем список сценариев
    setInterval(() => {
      this.loadScriptsFromDB();
    }, 60000); // каждую минуту
  }
}

// Запуск сервера
const server = new ScriptServer();
server.start().catch((error) => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});

// Обработка сигналов завершения
process.on('SIGINT', () => {
  console.log('\nЗавершение работы...');
  if (server.ws) {
    server.ws.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nЗавершение работы...');
  if (server.ws) {
    server.ws.close();
  }
  process.exit(0);
});

