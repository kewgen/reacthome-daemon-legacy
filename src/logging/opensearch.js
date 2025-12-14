const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const { VAR } = require('../assets/constants'); // Зачем: файл-лог вместо console в интерактивном режиме

// Правило: в интерактивном режиме нельзя спамить в консоль (ломает 📊 панель в event-logger).
const IS_TTY = !!process.stdout.isTTY;
let currentOpensearchLogFile = null;
const formatArgs = (args) => {
  try {
    if (!args || args.length === 0) return '';
    return args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 160 }))).join(' ');
  } catch (e) {
    return '';
  }
};
const writeLogFile = (level, message, args) => {
  try {
    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const file = path.join(logDir, `opensearch-${today}.log`);
    if (currentOpensearchLogFile !== file) currentOpensearchLogFile = file;
    const ts = new Date().toISOString();
    const extra = formatArgs(args);
    fs.appendFileSync(
      currentOpensearchLogFile,
      `[${ts}] [pid:${process.pid}] [${level}] ${message}${extra ? ' ' + extra : ''}\n`,
      'utf8'
    );
  } catch (e) {
    // ignore
  }
};
const osLog = (message, ...args) => {
  if (IS_TTY) return writeLogFile('INFO', message, args);
  console.log(message, ...args);
};
const osWarn = (message, ...args) => {
  if (IS_TTY) return writeLogFile('WARN', message, args);
  console.warn(message, ...args);
};
const osError = (message, ...args) => {
  if (IS_TTY) return writeLogFile('ERROR', message, args);
  console.error(message, ...args);
};

// ==========================
// Config (variant A)
// ==========================
// Зачем: раньше env читался один раз на require() → в интерактиве (env-preload) OpenSearch залипал как "выключен".
// Теперь конфиг инициализируется явно через init()/initFromEnv() и может быть переинициализирован.
let config = {
  enabled: false,
  url: '',
  user: '',
  password: '',
  indexPrefix: 'reacthome-events',
  caCert: path.join(os.homedir(), '.opensearch', 'root.crt'),
  requestTimeoutMs: parseInt(process.env.OPENSEARCH_REQUEST_TIMEOUT_MS || '15000', 10), // Зачем: чтобы bulk не висел бесконечно
  keepAlive: process.env.OPENSEARCH_KEEPALIVE !== 'false', // default true
  maxSockets: parseInt(process.env.OPENSEARCH_MAX_SOCKETS || '25', 10), // Зачем: ограничиваем параллелизм, чтобы не ловить ETIMEDOUT
  availabilityCheckMs: parseInt(process.env.OPENSEARCH_AVAILABILITY_CHECK_MS || '30000', 10) // Зачем: панель должна быстро отражать статус
};

const isEnabled = () => !!(config && config.enabled === true && config.url);

// Расшифровка пути с ~ (если указан)
const expandPath = (filePath) => {
  if (filePath && filePath.startsWith('~')) {
    return filePath.replace('~', os.homedir());
  }
  return filePath;
};

const initFromEnv = () => {
  const enabled = process.env.OPENSEARCH_ENABLED === 'true';
  const url = process.env.OPENSEARCH_URL || '';
  const user = process.env.OPENSEARCH_USER || '';
  const password = process.env.OPENSEARCH_PASSWORD || '';
  const indexPrefix = process.env.OPENSEARCH_INDEX_PREFIX || 'reacthome-events';
  const caCert = expandPath(process.env.OPENSEARCH_CA_CERT) || path.join(os.homedir(), '.opensearch', 'root.crt');

  init({
    enabled,
    url,
    user,
    password,
    indexPrefix,
    caCert
  });
};

// HTTPS Agent с сертификатом
let httpsAgent = null;
let httpsAgentKey = null;
const getHttpsAgent = () => {
  if (httpsAgent) return httpsAgent;
  
  const key = `${config.caCert}|${config.keepAlive ? 'ka1' : 'ka0'}|${config.maxSockets}`;
  httpsAgentKey = key;

  if (fs.existsSync(config.caCert)) {
    const ca = fs.readFileSync(config.caCert);
    httpsAgent = new https.Agent({
      ca: ca,
      rejectUnauthorized: true,
      keepAlive: !!config.keepAlive,
      maxSockets: Number.isFinite(config.maxSockets) ? config.maxSockets : 25
    });
    osLog(`[opensearch] Используется CA сертификат: ${config.caCert}`);
  } else {
    // Если сертификат не найден, используем стандартный agent (для тестирования)
    // ⚠️ ВНИМАНИЕ: В продакшене должен быть установлен сертификат!
    httpsAgent = new https.Agent({
      rejectUnauthorized: false, // ⚠️ Только для разработки, в продакшене должен быть true
      keepAlive: !!config.keepAlive,
      maxSockets: Number.isFinite(config.maxSockets) ? config.maxSockets : 25
    });
    osWarn(`[opensearch] ⚠️ CA сертификат не найден: ${config.caCert}`);
    osWarn(`[opensearch] ⚠️ Используется insecure режим (rejectUnauthorized=false)`);
    osWarn(`[opensearch] ⚠️ Для продакшена выполните: ./scripts/install_opensearch_cert.sh`);
  }
  
  return httpsAgent;
};

// Конфигурация экспоненциального backoff
const BACKOFF_INITIAL_DELAY = parseInt(process.env.OPENSEARCH_BACKOFF_INITIAL_DELAY || '1000'); // 1 секунда
const BACKOFF_MAX_DELAY = parseInt(process.env.OPENSEARCH_BACKOFF_MAX_DELAY || '60000'); // 60 секунд
const BACKOFF_MAX_ATTEMPTS = parseInt(process.env.OPENSEARCH_BACKOFF_MAX_ATTEMPTS || '10'); // Максимум 10 попыток
const BACKOFF_BASE = parseFloat(process.env.OPENSEARCH_BACKOFF_BASE || '2'); // Множитель 2

// Состояние
let opensearchFailedBatch = [];
const OPENSEARCH_FAILED_BATCH_SIZE = 100;
let isOpensearchAvailable = true;

// Метрики (для панели/диагностики)
const metrics = {
  ok: 0,              // сколько документов успешно принято (включая 409 при create)
  fail: 0,            // сколько документов не удалось отправить (запрос/батч)
  dropped: 0,         // сколько документов отброшено из failedBatch overflow
  failedBatch: 0,     // текущий размер failedBatch
  lastOkTs: 0,
  lastFailTs: 0,
  lastError: null
};

let availabilityInterval = null;
let lastInitSignature = null;
let lastExternalRetryLogTs = 0; // Зачем: не спамим логами при внешнем ретрае (event-logger)

const init = (nextConfig = {}) => {
  // Зачем: допускаем переинициализацию после env-preload (TTY) или при смене настроек.
  const next = {
    ...config,
    ...nextConfig
  };
  const signature = JSON.stringify({
    enabled: next.enabled === true,
    url: next.url || '',
    user: next.user || '',
    password: next.password ? 'set' : '',
    indexPrefix: next.indexPrefix || '',
    caCert: next.caCert || '',
    requestTimeoutMs: next.requestTimeoutMs || 0,
    keepAlive: next.keepAlive !== false,
    maxSockets: next.maxSockets || 0,
    availabilityCheckMs: next.availabilityCheckMs || 0
  });

  // Зачем: initFromEnv может вызываться несколько раз (auto-init + явный init после env-preload).
  // Если конфиг не изменился — не пересоздаём интервалы и не спамим логами.
  if (lastInitSignature === signature) {
    config = next;
    return;
  }

  lastInitSignature = signature;
  config = next;

  // Сбрасываем agent, если изменился ключ (CA / keepAlive / maxSockets)
  const nextKey = `${config.caCert}|${config.keepAlive ? 'ka1' : 'ka0'}|${config.maxSockets}`;
  if (httpsAgentKey !== nextKey) {
    httpsAgent = null;
    httpsAgentKey = null;
  }

  if (availabilityInterval) {
    clearInterval(availabilityInterval);
    availabilityInterval = null;
  }

  if (isEnabled()) {
    getHttpsAgent();
    // Быстрый healthcheck, чтобы панель не показывала устаревшее состояние
    setTimeout(() => checkAvailability().catch(() => {}), 0);
    availabilityInterval = setInterval(() => checkAvailability().catch(() => {}), Math.max(5000, config.availabilityCheckMs || 30000));
    osLog(`[opensearch] OpenSearch интеграция включена: ${config.url}`);
  } else {
    osLog('[opensearch] OpenSearch интеграция отключена (OPENSEARCH_ENABLED=false или OPENSEARCH_URL не задан)');
  }
};

// Состояние повторных попыток
const retryState = {
  attemptNumber: 0,
  lastError: null,
  lastErrorTime: null,
  nextRetryTime: null,
  isRetrying: false,
  recoveryScheduled: false
};

// Проверка, является ли ошибка retryable (временной)
const isRetryableError = (error) => {
  // Сетевые ошибки (всегда retryable)
  if (error.code) {
    const retryableCodes = [
      'ECONNREFUSED',  // Соединение отклонено
      'ETIMEDOUT',     // Таймаут соединения
      'ENOTFOUND',     // DNS не разрешён
      'ECONNRESET',    // Соединение сброшено
      'EAI_AGAIN',     // Временная ошибка DNS
      'EHOSTUNREACH',  // Хост недоступен
      'ENETUNREACH'    // Сеть недоступна
    ];
    if (retryableCodes.includes(error.code)) {
      return true;
    }
  }
  
  // HTTP ошибки
  if (error.status) {
    const retryableStatuses = [
      429, // Too Many Requests
      502, // Bad Gateway
      503, // Service Unavailable
      504  // Gateway Timeout
    ];
    if (retryableStatuses.includes(error.status)) {
      return true;
    }
    
    // Non-retryable ошибки
    const nonRetryableStatuses = [
      400, // Bad Request
      401, // Unauthorized
      403, // Forbidden
      404  // Not Found
    ];
    if (nonRetryableStatuses.includes(error.status)) {
      return false;
    }
  }
  
  // Если ошибка содержит сообщение о таймауте или сети - считаем retryable
  const errorMessage = error.message || String(error);
  const retryablePatterns = [
    /timeout/i,
    /connection/i,
    /network/i,
    /unreachable/i,
    /refused/i
  ];
  if (retryablePatterns.some(pattern => pattern.test(errorMessage))) {
    return true;
  }
  
  // По умолчанию считаем ошибку retryable (для обратной совместимости)
  return true;
};

// Вычисление задержки с экспоненциальным backoff и jitter
const calculateBackoffDelay = (attemptNumber) => {
  // Экспоненциальная задержка: initialDelay * (base ^ attemptNumber)
  const exponentialDelay = BACKOFF_INITIAL_DELAY * Math.pow(BACKOFF_BASE, attemptNumber);
  
  // Ограничение максимальной задержкой
  const delay = Math.min(exponentialDelay, BACKOFF_MAX_DELAY);
  
  // Jitter: случайное отклонение ±20% для предотвращения thundering herd
  const jitter = delay * 0.2 * (Math.random() * 2 - 1); // от -0.2 до +0.2
  
  return Math.max(100, Math.round(delay + jitter)); // Минимум 100ms
};

// Формирование индекса по дате
const getIndexName = (date) => {
  const dateStr = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  return `${config.indexPrefix}-${dateStr}`;
};

// Создание маппинга индекса (если не существует)
const ensureIndexMapping = async (indexName) => {
  if (!isEnabled()) return;
  
  try {
    // Проверяем существование индекса
    const checkUrl = `${config.url}/${indexName}`;
    const checkResponse = await fetch(checkUrl, {
      method: 'HEAD',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
      },
      agent: getHttpsAgent()
    });
    
    // Получаем полный маппинг для создания/обновления
    const mapping = {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          // Отключаем динамические маппинги для строгого контроля структуры
          // Зачем: все поля должны быть явно определены в маппинге для предсказуемости и правильной индексации
          'index.mapper.dynamic': false
        },
        mappings: {
          properties: {
            timestamp: { type: 'date' },
            logger_pid: { type: 'long' }, // Зачем: идентификация источника дублей (несколько процессов логгера)
            id: { type: 'keyword' },
            device: {
              properties: {
                type: { type: 'keyword' },
                human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                name: { type: 'keyword' },
                code: { type: 'keyword' },
                title: { type: 'keyword' }
              }
            },
            param: { type: 'keyword' },
            old: { 
              type: 'keyword' // keyword может хранить любые значения как строки (boolean, number, string)
            },
            new: { 
              type: 'keyword' // keyword может хранить любые значения как строки (boolean, number, string)
            },
            value: {
              properties: {
                old: { type: 'float' }, // Числовые значения (temperature, humidity, co2, r, g, b, brightness, fan_speed, setpoint)
                new: { type: 'float' }
              }
            },
            trigger: {
              properties: {
                type: { type: 'keyword' },
                ref: { type: 'keyword' },
                id: { type: 'keyword' },
                human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                session: { type: 'keyword' },
                remote_ip: { type: 'ip' }
              }
            },
            site: { type: 'keyword' },
            project: { type: 'keyword' },
            trace_id: { type: 'keyword' },
            channel: {
              properties: {
                id: { type: 'keyword' },
                type: { type: 'keyword' },
                index: { type: 'long' }, // Используем long вместо integer для совместимости
                value: { type: 'keyword' },
                velocity: { type: 'keyword' }
              }
            },
            parentDevice: {
              properties: {
                id: { type: 'keyword' },
                type: { type: 'keyword' },
                human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                title: { type: 'keyword' },
                code: { type: 'keyword' },
                name: { type: 'keyword' },
                ip: { type: 'ip' }
              }
            },
            endDevice: {
              properties: {
                id: { type: 'keyword' },
                type: { type: 'keyword' },
                human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                title: { type: 'keyword' },
                code: { type: 'keyword' },
                name: { type: 'keyword' },
                site: { type: 'text' } // Используем text для совместимости с существующим маппингом
              }
            },
            extra: {
              properties: {
                actuator_on: {
                  properties: {
                    on_timestamp: { type: 'long' },
                    param: { type: 'keyword' }
                  }
                },
                actuator_off: {
                  properties: {
                    on_timestamp: { type: 'long' },
                    duration_ms: { type: 'long' },
                    duration_seconds: { type: 'integer' },
                    param: { type: 'keyword' }
                  }
                },
                actuator_update: {
                  properties: {
                    on_timestamp: { type: 'long' },
                    duration_ms: { type: 'long' },
                    duration_seconds: { type: 'integer' },
                    param: { type: 'keyword' }
                  }
                },
                end_device_on: {
                  properties: {
                    on_timestamp: { type: 'long' },
                    channel_id: { type: 'keyword' },
                    value: { type: 'keyword' }
                  }
                },
                end_device_off: {
                  properties: {
                    on_timestamp: { type: 'long' },
                    duration_ms: { type: 'long' },
                    duration_seconds: { type: 'integer' },
                    channel_id: { type: 'keyword' },
                    value: { type: 'keyword' }
                  }
                },
                end_device_update: {
                  properties: {
                    on_timestamp: { type: 'long' },
                    duration_ms: { type: 'long' },
                    duration_seconds: { type: 'integer' },
                    channel_id: { type: 'keyword' },
                    value: { type: 'keyword' }
                  }
                }
              }
              // Не используем dynamic: true, чтобы поля точно индексировались согласно маппингу
            }
          }
        }
      };
      
    if (checkResponse.status === 404) {
      // Создаём индекс с правильным маппингом
      const createUrl = `${config.url}/${indexName}`;
      const createResponse = await fetch(createUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
        },
        body: JSON.stringify(mapping),
        agent: getHttpsAgent()
      });
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        osError(`[opensearch] Ошибка создания индекса ${indexName}:`, errorText);
      } else {
        osLog(`[opensearch] Индекс ${indexName} создан`);
      }
    } else {
      // Индекс существует - добавляем только недостающие поля по одному
      // Зачем: добавляем trace_id и parentDevice (channel и endDevice уже могут существовать с другими типами)
      // В OpenSearch можно добавлять только новые поля, нельзя изменять существующие
      // Добавляем поля по одному, чтобы не конфликтовать с существующими
      
      // Пробуем добавить trace_id
      try {
        const traceIdField = { properties: { trace_id: { type: 'keyword' } } };
        const traceIdUrl = `${config.url}/${indexName}/_mapping`;
        const traceIdResponse = await fetch(traceIdUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
          },
          body: JSON.stringify(traceIdField),
          agent: getHttpsAgent()
        });
        // Зачем: не логируем - слишком частое событие, засоряет логи
      } catch (err) {
        // Игнорируем ошибки - поле может уже существовать
      }

      // Пробуем добавить logger_pid
      try {
        const pidField = { properties: { logger_pid: { type: 'long' } } };
        const pidUrl = `${config.url}/${indexName}/_mapping`;
        await fetch(pidUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
          },
          body: JSON.stringify(pidField),
          agent: getHttpsAgent()
        });
      } catch (err) {
        // Игнорируем ошибки - поле может уже существовать
      }
      
      // Пробуем добавить parentDevice
      try {
        const parentDeviceField = {
          properties: {
            parentDevice: {
              properties: {
                id: { type: 'keyword' },
                type: { type: 'keyword' },
                human: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                title: { type: 'keyword' },
                code: { type: 'keyword' },
                name: { type: 'keyword' },
                ip: { type: 'ip' }
              }
            }
          }
        };
        const parentDeviceUrl = `${config.url}/${indexName}/_mapping`;
        const parentDeviceResponse = await fetch(parentDeviceUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
          },
          body: JSON.stringify(parentDeviceField),
          agent: getHttpsAgent()
        });
        // Зачем: не логируем - слишком частое событие, засоряет логи
      } catch (err) {
        // Игнорируем ошибки - поле может уже существовать
      }
      
      // ВАЖНО: extra с enabled: false нельзя изменить для существующего индекса
      // Для исправления нужно пересоздать индекс или использовать reindex API
      // Новые индексы будут создаваться с правильным маппингом extra автоматически
    }
  } catch (err) {
    osError(`[opensearch] Ошибка проверки/создания индекса ${indexName}:`, err.message);
  }
};

// Отправка батча в OpenSearch через Bulk API
const sendBatch = async (events, retryAttemptOrOptions = 0, maybeOptions = {}) => {
  const retryAttempt = typeof retryAttemptOrOptions === 'number' ? retryAttemptOrOptions : 0;
  const options = typeof retryAttemptOrOptions === 'number' ? (maybeOptions || {}) : (retryAttemptOrOptions || {});
  const enqueueOnFail = options.enqueueOnFail !== false; // default true

  if (!isEnabled() || events.length === 0) return;
  
  // Если превышено максимальное количество попыток
  if (retryAttempt >= BACKOFF_MAX_ATTEMPTS) {
    const droppedCount = events.length;
    osError(`[opensearch] Превышено максимальное количество попыток (${BACKOFF_MAX_ATTEMPTS}), отброшено ${droppedCount} событий`);
    osError(`[opensearch] Последняя ошибка:`, retryState.lastError?.message || 'unknown');
    
    // Сбросить флаг через 5 минут для новой попытки с новыми событиями
    if (!retryState.recoveryScheduled) {
      retryState.recoveryScheduled = true;
      setTimeout(() => {
        isOpensearchAvailable = true;
        retryState.attemptNumber = 0;
        retryState.isRetrying = false;
        retryState.recoveryScheduled = false;
        osLog(`[opensearch] 🔄 Сброс флага доступности после таймаута, новые события будут отправляться`);
      }, 5 * 60 * 1000); // 5 минут
    }
    return;
  }
  
  // УБРАНА БЛОКИРОВКА: Всегда пытаемся отправить новые события, даже если предыдущие не удались
  // Это позволяет отправлять события после восстановления доступности OpenSearch
  // if (!isOpensearchAvailable && opensearchFailedBatch.length === 0 && retryAttempt === 0) {
  //   return;
  // }
  
  // Группируем события по дате для создания правильных индексов
  const eventsByDate = {};
  for (const event of events) {
    const date = new Date(event.timestamp);
    const dateStr = date.toISOString().split('T')[0];
    if (!eventsByDate[dateStr]) {
      eventsByDate[dateStr] = [];
    }
    eventsByDate[dateStr].push(event);
  }
  
  // Отправляем события по датам
  for (const [dateStr, dateEvents] of Object.entries(eventsByDate)) {
    const indexName = getIndexName(dateStr);
    
    // Убеждаемся, что индекс существует
    await ensureIndexMapping(indexName);
    
    // Формируем bulk запрос
    let bulkBody = '';
    for (const event of dateEvents) {
      // Action line
      bulkBody += JSON.stringify({
        // Зачем: create + уникальный _id → дедупликация. 409 считаем успехом.
        create: {
          _index: indexName,
          _id: `${event.id}_${event.timestamp}_${event.param}` // Уникальный ID для дедупликации
        }
      }) + '\n';
      // Document line
      bulkBody += JSON.stringify(event) + '\n';
    }
    
    try {
      const bulkUrl = `${config.url}/_bulk`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, config.requestTimeoutMs || 15000));
      const response = await fetch(bulkUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
        },
        body: bulkBody,
        agent: getHttpsAgent(),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${errorText}`);
        error.status = response.status; // Добавляем статус для классификации ошибок
        throw error;
      }
      
      const result = await response.json();
      
      // Проверяем ошибки в ответе
      if (result && Array.isArray(result.items)) {
        let okDocs = 0;
        let failDocs = 0;
        const firstReasons = [];
        for (const it of result.items) {
          const action = it.create || it.index || it.update || it.delete;
          const status = action && action.status ? action.status : 0;
          if (status >= 200 && status < 300) {
            okDocs += 1;
          } else if (status === 409) {
            // Зачем: conflict при create означает дубль → считаем как ok для метрик.
            okDocs += 1;
          } else {
            failDocs += 1;
            const reason = action && action.error && action.error.reason ? action.error.reason : null;
            if (reason && firstReasons.length < 3) firstReasons.push(reason);
          }
        }
        if (failDocs > 0) {
          osError(`[opensearch] Ошибки при индексации ${failDocs} событий:`, firstReasons);
        }
        metrics.ok += okDocs;
        metrics.fail += failDocs;
        if (okDocs > 0) metrics.lastOkTs = Date.now();
        if (failDocs > 0) metrics.lastFailTs = Date.now();
      }
      
      // При успехе - сброс состояния повторных попыток
      if (retryAttempt > 0) {
        const recoveryTime = retryState.lastErrorTime ? Date.now() - retryState.lastErrorTime : 0;
        osLog(`[opensearch] ✅ Успешная отправка после ${retryAttempt} попыток (время восстановления: ${(recoveryTime/1000).toFixed(1)}s)`);
      }
      
      retryState.attemptNumber = 0;
      retryState.lastError = null;
      retryState.lastErrorTime = null;
      retryState.nextRetryTime = null;
      retryState.isRetrying = false;
      isOpensearchAvailable = true;
      metrics.lastError = null;
      
      // Если были failed события - логировать успешное восстановление
      if (opensearchFailedBatch.length > 0) {
        osLog(`[opensearch] Recovered ${opensearchFailedBatch.length} failed events`);
        opensearchFailedBatch = [];
      }
      
    } catch (err) {
      // Проверка, является ли ошибка retryable
      const isRetryable = isRetryableError(err);
      
      if (!isRetryable) {
        osError(`[opensearch] ❌ Non-retryable ошибка (не будет повторных попыток):`, err.message);
        if (err.status) {
          osError(`[opensearch] HTTP статус: ${err.status}`);
        }
        if (err.code) {
          osError(`[opensearch] Код ошибки: ${err.code}`);
        }
        // Не повторяем для non-retryable ошибок
        return;
      }

      // Зачем: если внешний код сам ретраит/буферизует (event-logger), то здесь не делаем backoff/reties,
      // иначе получаем двойные ретраи и шум в логах.
      if (!enqueueOnFail) {
        isOpensearchAvailable = false;
        metrics.lastError = err && err.message ? err.message : String(err);
        metrics.lastFailTs = Date.now();
        metrics.fail += dateEvents.length;
        const now = Date.now();
        if (now - lastExternalRetryLogTs > 5000) {
          lastExternalRetryLogTs = now;
          osWarn(`[opensearch] ❌ Ошибка bulk (external retry):`, err.message);
          if (err.code) osWarn(`[opensearch] Код ошибки: ${err.code}`);
          if (err.status) osWarn(`[opensearch] HTTP статус: ${err.status}`);
        }
        throw err;
      }
      
      // Обновление состояния
      retryState.attemptNumber = retryAttempt + 1;
      retryState.lastError = err;
      retryState.lastErrorTime = retryState.lastErrorTime || Date.now();
      retryState.isRetrying = true;
      isOpensearchAvailable = false;
      metrics.lastError = err && err.message ? err.message : String(err);
      metrics.lastFailTs = Date.now();
      metrics.fail += dateEvents.length;
      
      // Вычисление задержки с экспоненциальным backoff
      const delay = calculateBackoffDelay(retryAttempt);
      retryState.nextRetryTime = Date.now() + delay;
      
      osWarn(`[opensearch] ⚠️ Ошибка отправки (попытка ${retryState.attemptNumber}/${BACKOFF_MAX_ATTEMPTS}):`, err.message);
      if (err.code) {
        osWarn(`[opensearch] Код ошибки: ${err.code}`);
      }
      if (err.status) {
        osWarn(`[opensearch] HTTP статус: ${err.status}`);
      }
      if (enqueueOnFail) {
        osWarn(`[opensearch] Повторная попытка через ${delay}ms (${(delay/1000).toFixed(1)}s)`);
      }
      
      if (enqueueOnFail) {
        // Добавить события в резервное хранилище
        opensearchFailedBatch.push(...dateEvents);
      }
      
      // Ограничить размер резервного хранилища
      if (enqueueOnFail && opensearchFailedBatch.length > OPENSEARCH_FAILED_BATCH_SIZE) {
        const dropped = opensearchFailedBatch.length - OPENSEARCH_FAILED_BATCH_SIZE;
        opensearchFailedBatch = opensearchFailedBatch.slice(-OPENSEARCH_FAILED_BATCH_SIZE);
        osError(`[opensearch] Dropped ${dropped} events due to failed batch overflow`);
        metrics.dropped += dropped;
      }
      metrics.failedBatch = opensearchFailedBatch.length;
      
      // Планирование повторной попытки с экспоненциальным backoff
      if (enqueueOnFail) {
        setTimeout(() => {
          if (opensearchFailedBatch.length > 0) {
            const eventsToRetry = [...opensearchFailedBatch];
            opensearchFailedBatch = [];
            metrics.failedBatch = opensearchFailedBatch.length;
            // Зачем: внутренние ретраи не должны приводить к unhandled rejection
            sendBatch(eventsToRetry, retryState.attemptNumber, { enqueueOnFail: true }).catch(() => {});
          }
        }, delay);
      }

      // Зачем: ошибка должна быть видна вызывающему коду (logger буферизует сам, event-log просто логирует).
      throw err;
    }
  }
};

// Периодическая отправка failed событий (только если не идёт активная повторная попытка)
const retryFailedEvents = () => {
  if (opensearchFailedBatch.length > 0 && !retryState.isRetrying) {
    // Сброс состояния перед новой попыткой
    retryState.attemptNumber = 0;
    retryState.isRetrying = false;
    // Зачем: внутренние ретраи не должны приводить к unhandled rejection
    sendBatch([...opensearchFailedBatch], 0, { enqueueOnFail: true }).catch(() => {});
    opensearchFailedBatch = [];
    metrics.failedBatch = opensearchFailedBatch.length;
  }
};

// Периодическая проверка доступности OpenSearch
const checkAvailability = async () => {
  if (!isEnabled()) return;

  try {
    // Используем AbortController для таймаута (node-fetch v2 не поддерживает timeout напрямую)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.url}`, {
      method: 'HEAD',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`
      },
      agent: getHttpsAgent(),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      if (!isOpensearchAvailable) {
        osLog('[opensearch] ✅ OpenSearch снова доступен');
      }
      isOpensearchAvailable = true;
      metrics.lastOkTs = Date.now();
      return;
    }

    isOpensearchAvailable = false;
    metrics.lastFailTs = Date.now();
    metrics.lastError = `HTTP ${response.status}`;
  } catch (err) {
    isOpensearchAvailable = false;
    metrics.lastFailTs = Date.now();
    if (err && err.name !== 'AbortError') {
      metrics.lastError = err.message || String(err);
    }
  }
};

// Инициализация (backward-compatible)
// Зачем: модули, которые просто require('./opensearch'), должны продолжать работать.
// При этом интерактивный event-logger после env-preload может вызвать initFromEnv() повторно.
initFromEnv();
if (isEnabled()) {
  // Периодическая повторная отправка failed событий (раз в минуту)
  setInterval(retryFailedEvents, 60000);
}

module.exports = {
  sendBatch,
  init,
  initFromEnv,
  checkAvailability,
  isAvailable: () => isOpensearchAvailable,
  getMetrics: () => ({
    ok: metrics.ok,
    fail: metrics.fail,
    queued: opensearchFailedBatch.length,
    dropped: metrics.dropped,
    failedBatch: metrics.failedBatch,
    lastOkTs: metrics.lastOkTs,
    lastFailTs: metrics.lastFailTs,
    lastError: metrics.lastError
  }),
  isEnabled
};

