#!/usr/bin/env node

/**
 * Монитор устройств умного дома с ленивым кэшем на БД
 * 
 * Особенности:
 * - Ленивая загрузка: данные загружаются из БД только при первом обращении
 * - LRU кэш: ограничение размера кэша (по умолчанию 500 устройств)
 * - TTL: автоматическая инвалидация через N часов
 * - Прогрев кэша: опционально загружает популярные устройства при старте
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { Level } = require('level');

// ============================================================================
// Конфигурация
// ============================================================================

const WS_URL = 'ws://192.168.88.4:3000';
const DB_PATH = process.env.DB_PATH || '/tmp/reacthome-db';
const LOG_DIR = './logs/device-monitor';

// Фильтр по типу
const FILTER_TYPE = process.env.FILTER_TYPE || null;  // Например: 'script', 'light_LED', 'ACTION_OFF'
const LOG_FILE_NAME = FILTER_TYPE 
  ? `filtered-${FILTER_TYPE}-${new Date().toISOString().split('T')[0]}.log`
  : `all-devices-${new Date().toISOString().split('T')[0]}.log`;
const LOG_FILE = path.join(LOG_DIR, LOG_FILE_NAME);

// Настройки кэша
const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE) || 500;  // Максимум устройств в кэше
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 3600000;        // TTL 1 час (в мс)
const PREWARM_CACHE = process.env.PREWARM_CACHE === 'true';          // Прогрев кэша при старте

// ============================================================================
// Ленивый кэш с LRU и TTL
// ============================================================================

class LazyDeviceCache {
  constructor(db, options = {}) {
    this.db = db;
    this.cache = new Map();
    this.maxSize = options.maxSize || CACHE_MAX_SIZE;
    this.ttl = options.ttl || CACHE_TTL;
    
    // Статистика
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      dbReads: 0
    };
  }
  
  /**
   * Получить устройство (из кэша или БД)
   */
  async get(id) {
    const cached = this.cache.get(id);
    
    // Проверяем кэш
    if (cached) {
      const age = Date.now() - cached.timestamp;
      
      // Если не устарело - возвращаем из кэша
      if (age < this.ttl) {
        this.stats.hits++;
        
        // Обновляем позицию в LRU (перемещаем в конец)
        this.cache.delete(id);
        this.cache.set(id, cached);
        
        return cached.data;
      }
      
      // Устарело - удаляем
      this.cache.delete(id);
    }
    
    // Кэш-промах - загружаем из БД
    this.stats.misses++;
    this.stats.dbReads++;
    
    try {
      const data = await this.db.get(id);
      
      // Добавляем в кэш
      this.set(id, data);
      
      return data;
    } catch (error) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }
  
  /**
   * Добавить в кэш
   */
  set(id, data) {
    // Проверяем размер кэша
    if (this.cache.size >= this.maxSize && !this.cache.has(id)) {
      // Удаляем самый старый элемент (первый в Map)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }
    
    this.cache.set(id, {
      data,
      timestamp: Date.now()
    });
  }
  
  /**
   * Прогрев кэша (загрузка N первых устройств)
   */
  async prewarm(count = 100) {
    console.error(`🔥 Прогрев кэша: загрузка ${count} устройств...`);
    
    let loaded = 0;
    for await (const [key, value] of this.db.iterator({ limit: count })) {
      if (value && typeof value === 'object' && value.timestamp) {
        this.set(key, value);
        loaded++;
      }
    }
    
    console.error(`✅ Кэш прогрет: ${loaded} устройств`);
  }
  
  /**
   * Получить статистику
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
    
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
      hitRate: `${hitRate}%`,
      avgAge: this._getAvgAge()
    };
  }
  
  _getAvgAge() {
    if (this.cache.size === 0) return 0;
    
    const now = Date.now();
    let totalAge = 0;
    
    for (const entry of this.cache.values()) {
      totalAge += now - entry.timestamp;
    }
    
    return Math.round(totalAge / this.cache.size / 1000); // в секундах
  }
  
  /**
   * Очистить кэш
   */
  clear() {
    this.cache.clear();
    console.error('🗑️  Кэш очищен');
  }
}

// ============================================================================
// Утилиты
// ============================================================================

// Функция getHumanName (из event-log.js)
function getHumanName(obj) {
  if (!obj || typeof obj !== 'object') return null;
  
  const parts = [];
  if (obj.title) parts.push(obj.title);
  if (obj.code) parts.push(obj.code);
  if (obj.name) parts.push(obj.name);
  
  return parts.length > 0 ? parts.join('/') : null;
}

// Создаём директорию для логов
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Функция логирования
const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  const logEntry = data 
    ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n${'='.repeat(80)}\n`
    : `[${timestamp}] ${message}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry);
  
  if (!data) {
    console.error(`[${timestamp}] ${message}`);
  }
};

// ============================================================================
// Инициализация БД и кэша
// ============================================================================

let db;
let deviceCache;

async function initDB() {
  log('='.repeat(80));
  log('Инициализация БД и кэша');
  log('='.repeat(80));
  
  log(`📊 Открываю БД: ${DB_PATH}`);
  
  try {
    db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    // Создаём ленивый кэш
    deviceCache = new LazyDeviceCache(db, {
      maxSize: CACHE_MAX_SIZE,
      ttl: CACHE_TTL
    });
    
    log('✅ БД открыта');
    log('', {
      dbPath: DB_PATH,
      cacheMaxSize: CACHE_MAX_SIZE,
      cacheTTL: `${CACHE_TTL / 1000}s`,
      prewarm: PREWARM_CACHE
    });
    
    // Прогрев кэша (опционально)
    if (PREWARM_CACHE) {
      await deviceCache.prewarm(100);
    }
    
    return true;
  } catch (error) {
    log(`❌ Ошибка открытия БД: ${error.message}`);
    console.error('Stack:', error.stack);
    return false;
  }
}

// Резолвинг ID устройства в имя (с ленивой загрузкой из БД)
const resolveDeviceName = async (id) => {
  try {
    const device = await deviceCache.get(id);
    
    if (device) {
      const humanName = getHumanName(device);
      if (humanName) {
        return `${humanName} [${id}]`;
      }
    }
  } catch (error) {
    console.error(`Ошибка резолвинга ${id}:`, error.message);
  }
  
  return id;
};

// ============================================================================
// WebSocket
// ============================================================================

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

const connect = () => {
  log(`Подключение к ${WS_URL}...`);
  
  ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    reconnectAttempts = 0;
    log('✅ WebSocket подключен', {
      url: WS_URL,
      readyState: ws.readyState
    });
    
    if (FILTER_TYPE) {
      log(`✅ Мониторинг устройств активен (ленивый кэш на БД, фильтр: type=${FILTER_TYPE})`);
    } else {
      log('✅ Мониторинг всех устройств активен (ленивый кэш на БД)');
    }
  });
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Получаем ID устройства
      const deviceId = message.id || 'N/A';
      
      // Применяем фильтр по типу (если задан)
      if (FILTER_TYPE && deviceId !== 'N/A') {
        try {
          const device = await deviceCache.get(deviceId);
          
          // Пропускаем если тип не совпадает
          if (!device || device.type !== FILTER_TYPE) {
            return;
          }
        } catch (error) {
          // Если устройство не найдено в БД - пропускаем
          return;
        }
      }
      
      // Резолвим ID устройства (ленивая загрузка из БД)
      const deviceName = deviceId !== 'N/A' 
        ? await resolveDeviceName(deviceId) 
        : 'N/A';
      
      // Получаем тип устройства для вывода
      let deviceType = 'N/A';
      if (deviceId !== 'N/A') {
        try {
          const device = await deviceCache.get(deviceId);
          deviceType = device?.type || 'N/A';
        } catch (error) {
          // ignore
        }
      }
      
      // Краткая информация для консоли
      console.log(`[${new Date().toISOString()}] 📨 ${message.type} | ${deviceType} | ${deviceName}`);
      
      // Полная информация в файл
      log(`📨 ${message.type}`, {
        device: {
          id: deviceId,
          name: deviceName,
          type: deviceType
        },
        message
      });
      
    } catch (error) {
      log('❌ Ошибка обработки сообщения', {
        error: error.message,
        data: data.toString().substring(0, 200)
      });
    }
  });
  
  ws.on('error', (error) => {
    log('❌ WebSocket ошибка', {
      error: error.message,
      code: error.code
    });
  });
  
  ws.on('close', (code, reason) => {
    log('❌ WebSocket закрыт', {
      code,
      reason: reason.toString()
    });
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      log(`🔄 Переподключение через ${RECONNECT_DELAY}ms (попытка ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(connect, RECONNECT_DELAY);
    } else {
      log('❌ Исчерпаны попытки переподключения');
      process.exit(1);
    }
  });
};

// ============================================================================
// Статистика кэша (каждые 5 минут)
// ============================================================================

setInterval(() => {
  if (deviceCache) {
    const stats = deviceCache.getStats();
    log('📊 Статистика кэша', stats);
  }
}, 5 * 60 * 1000);

// ============================================================================
// Graceful shutdown
// ============================================================================

process.on('SIGINT', async () => {
  console.error('\n🛑 Получен SIGINT, завершение работы...');
  
  if (deviceCache) {
    const stats = deviceCache.getStats();
    log('📊 Финальная статистика кэша', stats);
  }
  
  if (ws) {
    ws.close();
  }
  
  if (db) {
    await db.close();
    log('✅ БД закрыта');
  }
  
  process.exit(0);
});

// ============================================================================
// Запуск
// ============================================================================

(async () => {
  log('='.repeat(80));
  log('Запуск монитора устройства (ленивый кэш)');
  log('='.repeat(80));
  log('Конфигурация:', {
    wsUrl: WS_URL,
    dbPath: DB_PATH,
    logFile: LOG_FILE,
    filterType: FILTER_TYPE || 'none',
    cacheMaxSize: CACHE_MAX_SIZE,
    cacheTTL: `${CACHE_TTL / 1000}s`,
    prewarmCache: PREWARM_CACHE
  });
  
  // Инициализируем БД и кэш
  const dbOk = await initDB();
  if (!dbOk) {
    process.exit(1);
  }
  
  // Подключаемся к WebSocket
  connect();
})();
