const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Конфигурация OpenSearch
const OPENSEARCH_ENABLED = process.env.OPENSEARCH_ENABLED === 'true';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const OPENSEARCH_INDEX_PREFIX = process.env.OPENSEARCH_INDEX_PREFIX || 'reacthome-events';
// Зачем: таймауты защищают от “висящих” запросов и накопления очереди при проблемах сети/балансировщика
const OPENSEARCH_REQUEST_TIMEOUT_MS = parseInt(process.env.OPENSEARCH_REQUEST_TIMEOUT_MS || '15000', 10);
// Зачем: ограничиваем частоту ensureIndexMapping, иначе при большом потоке событий появляются лишние HEAD/PUT на _mapping
const OPENSEARCH_MAPPING_TTL_MS = parseInt(process.env.OPENSEARCH_MAPPING_TTL_MS || String(10 * 60 * 1000), 10); // 10 минут
// Расшифровка пути с ~ (если указан)
const expandPath = (filePath) => {
  if (filePath && filePath.startsWith('~')) {
    return filePath.replace('~', os.homedir());
  }
  return filePath;
};

const OPENSEARCH_CA_CERT = expandPath(process.env.OPENSEARCH_CA_CERT) || path.join(os.homedir(), '.opensearch', 'root.crt');

// HTTPS Agent с сертификатом
let httpsAgent = null;
const getHttpsAgent = () => {
  if (httpsAgent) return httpsAgent;
  
  // Зачем: keepAlive снижает число новых TCP/TLS соединений и уменьшает вероятность ETIMEDOUT при частых bulk-запросах
  const agentDefaults = {
    keepAlive: true,
    keepAliveMsecs: 10_000,
    maxSockets: 8,
    maxFreeSockets: 2
  };

  if (fs.existsSync(OPENSEARCH_CA_CERT)) {
    const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
    httpsAgent = new https.Agent({
      ...agentDefaults,
      ca: ca,
      rejectUnauthorized: true
    });
    console.log(`[opensearch] Используется CA сертификат: ${OPENSEARCH_CA_CERT}`);
  } else {
    // Если сертификат не найден, используем стандартный agent (для тестирования)
    // ⚠️ ВНИМАНИЕ: В продакшене должен быть установлен сертификат!
    httpsAgent = new https.Agent({
      ...agentDefaults,
      rejectUnauthorized: false // ⚠️ Только для разработки, в продакшене должен быть true
    });
    console.warn(`[opensearch] ⚠️ CA сертификат не найден: ${OPENSEARCH_CA_CERT}`);
    console.warn(`[opensearch] ⚠️ Используется insecure режим (rejectUnauthorized=false)`);
    console.warn(`[opensearch] ⚠️ Для продакшена выполните: ./scripts/install_opensearch_cert.sh`);
  }
  
  return httpsAgent;
};

// Зачем: единая обёртка над fetch с таймаутом (node-fetch v2 требует AbortController)
const fetchWithTimeout = async (url, options = {}, timeoutMs = OPENSEARCH_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

// Конфигурация экспоненциального backoff
const BACKOFF_INITIAL_DELAY = parseInt(process.env.OPENSEARCH_BACKOFF_INITIAL_DELAY || '1000'); // 1 секунда
const BACKOFF_MAX_DELAY = parseInt(process.env.OPENSEARCH_BACKOFF_MAX_DELAY || '60000'); // 60 секунд
const BACKOFF_MAX_ATTEMPTS = parseInt(process.env.OPENSEARCH_BACKOFF_MAX_ATTEMPTS || '10'); // Максимум 10 попыток
const BACKOFF_BASE = parseFloat(process.env.OPENSEARCH_BACKOFF_BASE || '2'); // Множитель 2

// Состояние
let opensearchFailedBatch = [];
const OPENSEARCH_FAILED_BATCH_SIZE = parseInt(process.env.OPENSEARCH_FAILED_BATCH_SIZE || '100', 10); // Зачем: настраиваемый лимит, чтобы не терять события при кратких деградациях
let isOpensearchAvailable = true;
// Зачем: защита от “шторма” параллельных sendBatch — при большом потоке и сетевых ошибках это резко увеличивает задержку
let isSending = false;

// Состояние повторных попыток
const retryState = {
  attemptNumber: 0,
  lastError: null,
  lastErrorTime: null,
  nextRetryTime: null,
  isRetrying: false,
  recoveryScheduled: false
};

// Зачем: кеш успешной ensureIndexMapping по имени индекса (уменьшаем сетевую нагрузку)
const ensuredIndexCache = new Map(); // indexName -> ts
const shouldEnsureIndex = (indexName) => {
  const ts = ensuredIndexCache.get(indexName);
  if (typeof ts === 'number' && (Date.now() - ts) < OPENSEARCH_MAPPING_TTL_MS) return false;
  return true;
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
  return `${OPENSEARCH_INDEX_PREFIX}-${dateStr}`;
};

// Создание маппинга индекса (если не существует)
const ensureIndexMapping = async (indexName) => {
  if (!OPENSEARCH_ENABLED || !OPENSEARCH_URL) return;
  // Зачем: для существующего индекса mapping уже создан; повторять слишком часто — дорого и может вызвать “premature close” из-за нагрузки
  if (!shouldEnsureIndex(indexName)) return;
  
  try {
    // Проверяем существование индекса
    const checkUrl = `${OPENSEARCH_URL}/${indexName}`;
    const checkResponse = await fetchWithTimeout(checkUrl, {
      method: 'HEAD',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
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
            // Зачем: фиксируем PID логгера для диагностики дублей/мультизапусков
            logger_pid: { type: 'long' },
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
      const createUrl = `${OPENSEARCH_URL}/${indexName}`;
      const createResponse = await fetchWithTimeout(createUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
        },
        body: JSON.stringify(mapping),
        agent: getHttpsAgent()
      });
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`[opensearch] Ошибка создания индекса ${indexName}:`, errorText);
      } else {
        console.log(`[opensearch] Индекс ${indexName} создан`);
      }
    } else {
      // Индекс существует - добавляем только недостающие поля по одному
      // Зачем: добавляем trace_id/logger_pid и parentDevice (channel и endDevice уже могут существовать с другими типами)
      // В OpenSearch можно добавлять только новые поля, нельзя изменять существующие
      // Добавляем поля по одному, чтобы не конфликтовать с существующими
      
      // Пробуем добавить trace_id
      try {
        const traceIdField = { properties: { trace_id: { type: 'keyword' } } };
        const traceIdUrl = `${OPENSEARCH_URL}/${indexName}/_mapping`;
        const traceIdResponse = await fetchWithTimeout(traceIdUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
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
        const loggerPidField = { properties: { logger_pid: { type: 'long' } } };
        const loggerPidUrl = `${OPENSEARCH_URL}/${indexName}/_mapping`;
        const loggerPidResponse = await fetchWithTimeout(loggerPidUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
          },
          body: JSON.stringify(loggerPidField),
          agent: getHttpsAgent()
        });
        // Зачем: не логируем - слишком частое событие, засоряет логи
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
        const parentDeviceUrl = `${OPENSEARCH_URL}/${indexName}/_mapping`;
        const parentDeviceResponse = await fetchWithTimeout(parentDeviceUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
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

    // Зачем: кешируем только успешную ensureIndexMapping, чтобы не “залипать” на ошибках сети/балансировщика
    ensuredIndexCache.set(indexName, Date.now());
  } catch (err) {
    console.error(`[opensearch] Ошибка проверки/создания индекса ${indexName}:`, err.message);
  }
};

// Отправка батча в OpenSearch через Bulk API
const sendBatch = async (events, retryAttempt = 0) => {
  if (!OPENSEARCH_ENABLED || !OPENSEARCH_URL || events.length === 0) return;
  
  // Зачем: предотвращаем параллельные отправки (они провоцируют premature close и раздувают задержку)
  if (isSending && retryAttempt === 0) {
    opensearchFailedBatch.push(...events);
    if (opensearchFailedBatch.length > OPENSEARCH_FAILED_BATCH_SIZE) {
      const dropped = opensearchFailedBatch.length - OPENSEARCH_FAILED_BATCH_SIZE;
      opensearchFailedBatch = opensearchFailedBatch.slice(-OPENSEARCH_FAILED_BATCH_SIZE);
      console.error(`[opensearch] Dropped ${dropped} events due to failed batch overflow`);
    }
    return;
  }

  // Если превышено максимальное количество попыток
  if (retryAttempt >= BACKOFF_MAX_ATTEMPTS) {
    const droppedCount = events.length;
    console.error(`[opensearch] Превышено максимальное количество попыток (${BACKOFF_MAX_ATTEMPTS}), отброшено ${droppedCount} событий`);
    console.error(`[opensearch] Последняя ошибка:`, retryState.lastError?.message || 'unknown');
    
    // Сбросить флаг через 5 минут для новой попытки с новыми событиями
    if (!retryState.recoveryScheduled) {
      retryState.recoveryScheduled = true;
      setTimeout(() => {
        isOpensearchAvailable = true;
        retryState.attemptNumber = 0;
        retryState.isRetrying = false;
        retryState.recoveryScheduled = false;
        console.log(`[opensearch] 🔄 Сброс флага доступности после таймаута, новые события будут отправляться`);
      }, 5 * 60 * 1000); // 5 минут
    }
    return;
  }
  
  // Зачем: если уже идёт ретрай, новые события не штурмуют OpenSearch — складируем и ждём восстановления
  if (retryState.isRetrying && retryAttempt === 0) {
    opensearchFailedBatch.push(...events);
    if (opensearchFailedBatch.length > OPENSEARCH_FAILED_BATCH_SIZE) {
      const dropped = opensearchFailedBatch.length - OPENSEARCH_FAILED_BATCH_SIZE;
      opensearchFailedBatch = opensearchFailedBatch.slice(-OPENSEARCH_FAILED_BATCH_SIZE);
      console.error(`[opensearch] Dropped ${dropped} events due to failed batch overflow`);
    }
    return;
  }

  isSending = true;
  
  try {
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
          index: {
            _index: indexName,
            _id: `${event.id}_${event.timestamp}_${event.param}` // Уникальный ID для дедупликации
          }
        }) + '\n';
        // Document line
        bulkBody += JSON.stringify(event) + '\n';
      }
      
      try {
        const bulkUrl = `${OPENSEARCH_URL}/_bulk`;
        const response = await fetchWithTimeout(bulkUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
          },
          body: bulkBody,
          agent: getHttpsAgent()
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`HTTP ${response.status}: ${errorText}`);
          error.status = response.status; // Добавляем статус для классификации ошибок
          throw error;
        }
        
        const result = await response.json();
        
        // Проверяем ошибки в ответе
        if (result.errors) {
          const errors = result.items.filter(item => item.index && item.index.error);
          if (errors.length > 0) {
            console.error(`[opensearch] Ошибки при индексации ${errors.length} событий:`, 
              errors.slice(0, 3).map(e => e.index.error.reason));
          }
        }
        
        // При успехе - сброс состояния повторных попыток
        if (retryAttempt > 0) {
          const recoveryTime = retryState.lastErrorTime ? Date.now() - retryState.lastErrorTime : 0;
          console.log(`[opensearch] ✅ Успешная отправка после ${retryAttempt} попыток (время восстановления: ${(recoveryTime/1000).toFixed(1)}s)`);
        }
        
        retryState.attemptNumber = 0;
        retryState.lastError = null;
        retryState.lastErrorTime = null;
        retryState.nextRetryTime = null;
        retryState.isRetrying = false;
        isOpensearchAvailable = true;
        
        // Если были failed события - логировать успешное восстановление
        if (opensearchFailedBatch.length > 0) {
          console.log(`[opensearch] Recovered ${opensearchFailedBatch.length} failed events`);
          opensearchFailedBatch = [];
        }
        
      } catch (err) {
        // Проверка, является ли ошибка retryable
        const isRetryable = isRetryableError(err);
        
        if (!isRetryable) {
          console.error(`[opensearch] ❌ Non-retryable ошибка (не будет повторных попыток):`, err.message);
          if (err.status) {
            console.error(`[opensearch] HTTP статус: ${err.status}`);
          }
          if (err.code) {
            console.error(`[opensearch] Код ошибки: ${err.code}`);
          }
          // Не повторяем для non-retryable ошибок
          return;
        }
        
        // Обновление состояния
        const nextAttempt = retryAttempt + 1;
        retryState.attemptNumber = nextAttempt;
        retryState.lastError = err;
        retryState.lastErrorTime = retryState.lastErrorTime || Date.now();
        retryState.isRetrying = true;
        isOpensearchAvailable = false;
        
        // Вычисление задержки с экспоненциальным backoff
        const delay = calculateBackoffDelay(retryAttempt);
        retryState.nextRetryTime = Date.now() + delay;
        
        console.warn(`[opensearch] ⚠️ Ошибка отправки (попытка ${retryState.attemptNumber}/${BACKOFF_MAX_ATTEMPTS}):`, err.message);
        if (err.code) {
          console.warn(`[opensearch] Код ошибки: ${err.code}`);
        }
        if (err.status) {
          console.warn(`[opensearch] HTTP статус: ${err.status}`);
        }
        console.warn(`[opensearch] Повторная попытка через ${delay}ms (${(delay/1000).toFixed(1)}s)`);
        
        // Добавить события в резервное хранилище
        opensearchFailedBatch.push(...dateEvents);
        
        // Ограничить размер резервного хранилища
        if (opensearchFailedBatch.length > OPENSEARCH_FAILED_BATCH_SIZE) {
          const dropped = opensearchFailedBatch.length - OPENSEARCH_FAILED_BATCH_SIZE;
          opensearchFailedBatch = opensearchFailedBatch.slice(-OPENSEARCH_FAILED_BATCH_SIZE);
          console.error(`[opensearch] Dropped ${dropped} events due to failed batch overflow`);
        }
        
        // Планирование повторной попытки с экспоненциальным backoff
        setTimeout(() => {
          if (opensearchFailedBatch.length > 0) {
            const eventsToRetry = [...opensearchFailedBatch];
            opensearchFailedBatch = [];
            sendBatch(eventsToRetry, nextAttempt);
          }
        }, delay);
      }
    }
  } finally {
    isSending = false;
  }
};

// Периодическая отправка failed событий (только если не идёт активная повторная попытка)
const retryFailedEvents = () => {
  if (opensearchFailedBatch.length > 0 && !retryState.isRetrying) {
    // Сброс состояния перед новой попыткой
    retryState.attemptNumber = 0;
    retryState.isRetrying = false;
    sendBatch([...opensearchFailedBatch], 0);
    opensearchFailedBatch = [];
  }
};

// Периодическая проверка доступности OpenSearch
const checkAvailability = async () => {
  if (!OPENSEARCH_ENABLED || !OPENSEARCH_URL) return;
  
  if (!isOpensearchAvailable) {
    try {
      // Используем AbortController для таймаута (node-fetch v2 не поддерживает timeout напрямую)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${OPENSEARCH_URL}`, {
        method: 'HEAD',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
        },
        agent: getHttpsAgent(),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        isOpensearchAvailable = true;
        retryState.attemptNumber = 0;
        retryState.isRetrying = false;
        retryState.recoveryScheduled = false;
        console.log('[opensearch] ✅ OpenSearch снова доступен, новые события будут отправляться');
        
        // Попытаться отправить накопленные события
        if (opensearchFailedBatch.length > 0) {
          const eventsToRetry = [...opensearchFailedBatch];
          opensearchFailedBatch = [];
          sendBatch(eventsToRetry, 0);
        }
      }
    } catch (err) {
      // OpenSearch всё ещё недоступен или таймаут - это нормально
      if (err.name !== 'AbortError') {
        // Логируем только не-таймауты
      }
    }
  }
};

// Инициализация
if (OPENSEARCH_ENABLED && OPENSEARCH_URL) {
  // Инициализация HTTPS Agent с сертификатом
  getHttpsAgent();
  
  // Периодическая повторная отправка failed событий (раз в минуту)
  setInterval(retryFailedEvents, 60000);
  
  // Периодическая проверка доступности OpenSearch (раз в 5 минут)
  setInterval(checkAvailability, 5 * 60 * 1000);
  
  console.log(`[opensearch] OpenSearch интеграция включена: ${OPENSEARCH_URL}`);
} else {
  console.log('[opensearch] OpenSearch интеграция отключена (OPENSEARCH_ENABLED=false или OPENSEARCH_URL не задан)');
}

module.exports = {
  sendBatch,
  isEnabled: () => OPENSEARCH_ENABLED && OPENSEARCH_URL
};

