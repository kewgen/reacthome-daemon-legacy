# Улучшения monitor.js: базовое решение vs наш проект

**Дата:** 2025-12-10  
**Цель:** Перенести лайфхаки из `/Users/evgen/Documents/Work/reacthome-main/src/monitor.js` в наш проект

---

## 📋 Сравнение версий

| Аспект | Базовое решение (reacthome-main) | Наше решение (reacthome-kewgen) |
|--------|-----------------------------------|----------------------------------|
| **Файл** | `/src/monitor.js` (4460 строк) | Отсутствует |
| **Размер** | 45K+ токенов | - |
| **Загрузка помещений** | ✅ Только через WebSocket | ❌ Нужно добавить |
| **Логирование WebSocket** | ✅ В файлы (ws-in.log, ws-out.log) | ❌ Нужно добавить |
| **Защита от DoS** | ✅ Ограничение 10MB | ❌ Нужно добавить |
| **Таймаут подключения** | ✅ 10 секунд | ❌ Нужно добавить |
| **Обработка отсутствующих устройств** | ✅ Полная | ⚠️ Частично |
| **Резолв помещений через каналы** | ✅ Статистический | ❌ Нужно добавить |

---

## 🎯 Ключевые улучшения из базового решения

### 1. Логирование WebSocket запросов и ответов

**Назначение:** Детальный анализ производительности и отладка WebSocket коммуникации.

**Переменные окружения:**
```bash
WS_REQUEST_LOGGING=1  # Включение логирования
WS_LOG_DIR=./logs     # Директория для логов (по умолчанию: logs/)
```

**Файлы логов:**
- `ws-out.log` - исходящие запросы (LIST, GET)
- `ws-in.log` - входящие ответы (ACTION_SET, LIST)

**Код (добавить в event-logger.js):**

```javascript
const fs = require('fs');
const path = require('path');

const WS_REQUEST_LOGGING = process.env.WS_REQUEST_LOGGING === '1' || process.env.WS_REQUEST_LOGGING === 'true';
const WS_LOG_DIR = process.env.WS_LOG_DIR || path.join(process.cwd(), 'logs');
const WS_LOG_FILE_IN = path.join(WS_LOG_DIR, 'ws-in.log');
const WS_LOG_FILE_OUT = path.join(WS_LOG_DIR, 'ws-out.log');

let wsLogStreams = null;
let wsInCounter = 0;
let wsOutCounter = 0;

function initWsLogStreams() {
  if (!WS_REQUEST_LOGGING || wsLogStreams) return;
  
  try {
    if (!fs.existsSync(WS_LOG_DIR)) {
      fs.mkdirSync(WS_LOG_DIR, { recursive: true });
    }
    
    wsLogStreams = {
      in: fs.createWriteStream(WS_LOG_FILE_IN, { flags: 'a' }),
      out: fs.createWriteStream(WS_LOG_FILE_OUT, { flags: 'a' })
    };
    
    wsLogStreams.in.on('error', (err) => {
      console.error(`[ERROR] Ошибка записи в ${WS_LOG_FILE_IN}:`, err.message);
    });
    wsLogStreams.out.on('error', (err) => {
      console.error(`[ERROR] Ошибка записи в ${WS_LOG_FILE_OUT}:`, err.message);
    });
    
    console.log(`[INFO] Логирование WebSocket включено:`);
    console.log(`[INFO]   Входящие: ${WS_LOG_FILE_IN}`);
    console.log(`[INFO]   Исходящие: ${WS_LOG_FILE_OUT}`);
  } catch (error) {
    console.error(`[ERROR] Не удалось создать потоки логирования:`, error.message);
    wsLogStreams = null;
  }
}

function logWebSocketRequest(type, state) {
  if (!WS_REQUEST_LOGGING || !wsLogStreams) return;
  
  wsOutCounter++;
  const timestamp = new Date().toISOString();
  const requestData = JSON.stringify({ type, state });
  const requestSize = Buffer.byteLength(requestData, 'utf8');
  
  let logLine = `[${wsOutCounter}] ${timestamp} [${type.toUpperCase()}] `;
  
  if (type === 'list') {
    logLine += `LIST запрос (${requestSize} байт)\n`;
    logLine += `${requestData}\n`;
  } else if (type === 'get') {
    const deviceIds = Array.isArray(state) ? state : [];
    const deviceCount = deviceIds.filter(id => !id.includes('/')).length;
    const channelCount = deviceIds.filter(id => id.includes('/')).length;
    
    logLine += `GET запрос: ${deviceCount} устройств, ${channelCount} каналов (${requestSize} байт)\n`;
    logLine += `Первые 10 ID: ${deviceIds.slice(0, 10).join(', ')}\n`;
  }
  
  logLine += '---\n';
  wsLogStreams.out.write(logLine);
}

function logWebSocketResponse(message, dataSize) {
  if (!WS_REQUEST_LOGGING || !wsLogStreams) return;
  
  wsInCounter++;
  const timestamp = new Date().toISOString();
  const msgType = message.type || 'unknown';
  
  let logLine = `[${wsInCounter}] ${timestamp} [${msgType.toUpperCase()}] `;
  
  if (msgType === 'action_set' || msgType === 'ACTION_SET') {
    const hasContext = !!message._context;
    logLine += `ACTION_SET ${hasContext ? 'с контекстом (событие)' : 'без контекста (начальное состояние)'} (${dataSize} байт)\n`;
    logLine += `ID: ${message.id || 'N/A'}\n`;
    if (message.payload) {
      logLine += `Payload keys: ${Object.keys(message.payload).join(', ')}\n`;
    }
  } else if (msgType === 'list' || msgType === 'LIST') {
    const stateCount = message.state ? message.state.length : 0;
    logLine += `LIST ответ: ${stateCount} устройств (${dataSize} байт)\n`;
  } else {
    logLine += `Тип: ${msgType} (${dataSize} байт)\n`;
  }
  
  logLine += '---\n';
  wsLogStreams.in.write(logLine);
}

// Использование:
// 1. В начале event-logger.js:
initWsLogStreams();

// 2. При отправке LIST:
logWebSocketRequest('list', null);
ws.send(JSON.stringify({ type: LIST }));

// 3. При отправке GET:
logWebSocketRequest('get', deviceIds);
ws.send(JSON.stringify({ type: GET, state: deviceIds }));

// 4. При получении сообщения:
ws.on('message', (data) => {
  const dataString = data.toString();
  const dataSize = Buffer.byteLength(dataString, 'utf8');
  const message = JSON.parse(dataString);
  
  logWebSocketResponse(message, dataSize);
  
  // ... обработка сообщения
});
```

**Преимущества:**
- ✅ Отладка проблем с WebSocket
- ✅ Анализ производительности
- ✅ Статистика запросов/ответов
- ✅ Не влияет на работу без включения

---

### 2. Защита от DoS атак

**Проблема:** Большие сообщения могут вызвать переполнение памяти.

**Решение:** Ограничение размера сообщений до 10MB.

**Код (добавить в event-logger.js):**

```javascript
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB

ws.on('message', (data) => {
  try {
    // Зачем: Безопасный парсинг JSON с ограничением размера
    const dataString = data.toString();
    if (dataString.length > MAX_MESSAGE_SIZE) {
      logError(`WebSocket message too large (${dataString.length} bytes), ignoring`);
      return;
    }
    
    const message = JSON.parse(dataString);
    
    // ... обработка сообщения
  } catch (error) {
    logError('Ошибка обработки сообщения WebSocket:', error.message);
  }
});
```

**Преимущества:**
- ✅ Защита от DoS
- ✅ Предотвращение переполнения памяти
- ✅ Логирование подозрительных сообщений

---

### 3. Таймаут подключения к WebSocket

**Проблема:** Если WebSocket не подключается, event-logger висит бесконечно.

**Решение:** Таймаут 10 секунд для подключения.

**Код (добавить в event-logger.js):**

```javascript
const CONNECTION_TIMEOUT = 10000; // 10 секунд

function connect() {
  reconnectAttempts++;
  log(`Попытка подключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} к ${DAEMON_WS_URL}`);
  
  ws = new WebSocket(DAEMON_WS_URL);
  
  // Зачем: Таймаут подключения к WebSocket
  const connectionTimeoutId = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      logError(`Таймаут подключения к WebSocket после 10 секунд. Состояние: ${ws.readyState}`);
      ws.terminate();
      
      // Переподключение
      setTimeout(() => {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          connect();
        } else {
          logError(`Достигнуто максимальное количество попыток переподключения (${MAX_RECONNECT_ATTEMPTS})`);
          process.exit(1);
        }
      }, RECONNECT_DELAY);
    }
  }, CONNECTION_TIMEOUT);
  
  ws.on('open', () => {
    clearTimeout(connectionTimeoutId);
    log('Подключение к WebSocket установлено');
    reconnectAttempts = 0;
    isConnected = true;
    
    // ... остальной код
  });
  
  ws.on('error', (error) => {
    clearTimeout(connectionTimeoutId);
    logError('WebSocket error:', error.message);
    isConnected = false;
  });
  
  ws.on('close', () => {
    clearTimeout(connectionTimeoutId);
    logError('WebSocket закрыт');
    isConnected = false;
    
    // Переподключение
    setTimeout(() => {
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        connect();
      }
    }, RECONNECT_DELAY);
  });
}
```

**Преимущества:**
- ✅ Быстрое обнаружение проблем с подключением
- ✅ Автоматическое переподключение
- ✅ Логирование состояния подключения

---

### 4. Явное различение начального состояния и событий

**Проблема:** Не всегда ясно, когда ACTION_SET - это начальное состояние, а когда - событие.

**Решение:** Проверка `_context` для различения типов сообщений.

**Код (улучшить в event-logger.js):**

```javascript
ws.on('message', (data) => {
  try {
    const dataString = data.toString();
    if (dataString.length > MAX_MESSAGE_SIZE) {
      logError(`WebSocket message too large (${dataString.length} bytes), ignoring`);
      return;
    }
    
    const message = JSON.parse(dataString);
    
    // Зачем: Логируем получение ответа
    logWebSocketResponse(message, Buffer.byteLength(dataString, 'utf8'));
    
    const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
    
    if (isActionSet) {
      const { id, payload } = message;
      
      // Зачем: Различаем начальное состояние и события по наличию _context
      if (!message._context && !isInitialStateReceived) {
        // Это начальное состояние (ответ на GET)
        console.log(`[DEBUG] Получено начальное состояние для ${id}`);
        deviceState.set(id, payload);
        pendingGetRequests--;
        
        if (pendingGetRequests <= 0) {
          isInitialStateReceived = true;
          initStateFromWebSocket(deviceState);
          console.log(`[DEBUG] Начальное состояние загружено: ${deviceState.size} устройств`);
        }
      } else if (message._context) {
        // Это событие изменения
        handleActionSet(message);
      } else {
        // Это событие изменения после загрузки начального состояния
        handleActionSet(message);
      }
    } else if (message.type === 'list' || message.type === 'LIST') {
      handleList(message);
    }
  } catch (error) {
    logError('Ошибка обработки сообщения WebSocket:', error.message, error.stack);
  }
});
```

**Преимущества:**
- ✅ Явное разделение логики для начального состояния и событий
- ✅ Правильная инициализация state
- ✅ Избежание дублирования событий

---

### 5. Загрузка устройств из массивов помещений

**Проблема:** Устройства в массивах помещений (`site.light_220`, `site.socket_220`) не загружаются автоматически.

**Решение:** Дополнительный GET запрос для потребителей из массивов помещений.

**Код (добавить в event-logger.js после получения всех ACTION_SET):**

```javascript
function loadConsumersFromSites(deviceDataMap, ws) {
  const consumerArrays = [
    'light_220', 'light_LED', 'light_RGB', 'light_led',
    'socket_220', 'valve_heating', 'valve_water',
    'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP',
    'thermostat', 'hygrostat', 'co2_stat'
  ];
  
  const consumerIdsFromSites = new Set();
  
  deviceDataMap.forEach((payload, deviceId) => {
    if (payload.type === 'site' || payload.type === 'SITE' || 
        payload.type === 'project' || payload.type === 'PROJECT') {
      consumerArrays.forEach(arrayName => {
        if (payload[arrayName] && Array.isArray(payload[arrayName])) {
          payload[arrayName].forEach(consumerId => {
            if (typeof consumerId === 'string' && !deviceDataMap.has(consumerId)) {
              consumerIdsFromSites.add(consumerId);
            }
          });
        }
      });
    }
  });
  
  if (consumerIdsFromSites.size > 0 && ws.readyState === WebSocket.OPEN) {
    const missingConsumerIds = Array.from(consumerIdsFromSites);
    console.log(`[DEBUG] Запрашиваем ${missingConsumerIds.length} потребителей из массивов помещений`);
    
    logWebSocketRequest('get', missingConsumerIds);
    ws.send(JSON.stringify({ type: 'get', state: missingConsumerIds }));
    
    return missingConsumerIds.length;
  }
  
  return 0;
}

// Использование после инициализации state:
const additionalRequests = loadConsumersFromSites(deviceState, ws);
if (additionalRequests > 0) {
  pendingGetRequests += additionalRequests;
  console.log(`[DEBUG] Ожидаем дополнительно ${additionalRequests} устройств`);
}
```

**Преимущества:**
- ✅ Полная загрузка всех устройств
- ✅ Корректная обработка `endDevice` в событиях каналов
- ✅ Более точные данные о помещениях

---

### 6. Резолв помещений для актуаторов через каналы

**Проблема:** Актуаторы часто не имеют прямого `site`, что приводит к `null` в событиях.

**Решение:** Статистический резолв помещения по каналам.

**Код (добавить в event-log.js):**

```javascript
// Зачем: Определяем помещение актуатора по наиболее частому помещению связанных устройств
function resolveSiteForActuatorViaChannels(actuatorId) {
  const actuatorData = state.get(actuatorId);
  if (!actuatorData || typeof actuatorData.type !== 'number') {
    return null;
  }
  
  // Зачем: Если у актуатора уже есть site, используем его
  if (actuatorData.site) {
    return getSiteName(actuatorId);
  }
  
  // Зачем: Определяем конфигурацию каналов
  const channelConfig = getChannelConfig(actuatorData.type);
  if (!channelConfig) {
    return null;
  }
  
  // Зачем: Подсчитываем частоту помещений связанных устройств
  const siteCounts = new Map();
  const { types, count } = channelConfig;
  
  for (let i = 0; i < count; i++) {
    const channelId = `${actuatorId}/${types[0]}/${i}`;
    const channelData = state.get(channelId);
    
    if (channelData && channelData.bind) {
      const boundDevice = state.get(channelData.bind);
      if (boundDevice && boundDevice.site) {
        const siteId = Array.isArray(boundDevice.site) ? boundDevice.site[0] : boundDevice.site;
        siteCounts.set(siteId, (siteCounts.get(siteId) || 0) + 1);
      }
    }
  }
  
  // Зачем: Выбираем наиболее часто встречающееся помещение
  if (siteCounts.size > 0) {
    const mostCommonSite = Array.from(siteCounts.entries())
      .sort((a, b) => b[1] - a[1])[0][0];
    return getSiteName(mostCommonSite);
  }
  
  return null;
}

function getChannelConfig(deviceType) {
  const channelConfigs = {
    0x0a: { count: 8, types: ['do'] }, 
    0x0b: { count: 16, types: ['do'] },
    0x0e: { count: 4, types: ['dim'] }, 
    0x0f: { count: 8, types: ['dim'] },
    0x23: { count: 2, types: ['do'] }, 
    0xa0: { count: 6, types: ['do'] },
    0xa1: { count: 12, types: ['do'] }, 
    0xa3: { count: 4, types: ['dim'] },
    0xa4: { count: 8, types: ['dim'] }, 
    0xa7: { count: 2, types: ['do'] },
    0xa9: { count: 4, types: ['ao'] },
    0xac: { count: 2, types: ['do', 'dim'] }, 
    0xad: { count: 12, types: ['dim'] },
    0xae: { count: 12, types: ['do'] }, 
    0xaf: { count: 8, types: ['dim'] },
    0xb3: { count: 12, types: ['dim'] }, 
    0xb4: { count: 12, types: ['dim'] },
    0xb5: { count: 18, types: ['do', 'dim'] }, 
    0xb6: { count: 1, types: ['dim'] },
    0xab: { count: 2, types: ['do', 'dim'] },
  };
  
  return channelConfigs[deviceType] || null;
}

// Использование в getSiteName:
function getSiteName(id) {
  // ... существующая логика
  
  // Зачем: Если не удалось получить site обычным способом, пытаемся резолвить через каналы
  const siteName = getSiteNameRecursive(id);
  if (siteName) {
    return siteName;
  }
  
  // Зачем: Пытаемся резолвить через каналы для актуаторов
  return resolveSiteForActuatorViaChannels(id);
}
```

**Преимущества:**
- ✅ Более точное определение помещений
- ✅ Меньше событий с `site: null`
- ✅ Улучшенная аналитика в OpenSearch

---

## 📝 План внедрения

### Этап 1: Логирование (низкий приоритет)
- [ ] Добавить логирование WebSocket в `event-logger.js`
- [ ] Протестировать с `WS_REQUEST_LOGGING=1`
- [ ] Проверить производительность с логированием

### Этап 2: Безопасность (высокий приоритет)
- [ ] Добавить защиту от DoS (ограничение размера сообщений)
- [ ] Добавить таймаут подключения к WebSocket
- [ ] Протестировать обработку больших сообщений

### Этап 3: Полнота данных (средний приоритет)
- [ ] Добавить загрузку устройств из массивов помещений
- [ ] Реализовать резолв помещений через каналы
- [ ] Протестировать на реальных данных

### Этап 4: Оптимизация (низкий приоритет)
- [ ] Явное различение начального состояния и событий
- [ ] Оптимизация обработки отсутствующих устройств
- [ ] Добавить метрики производительности

---

## ✅ Рекомендации

1. **Начать с безопасности:**
   - Добавить защиту от DoS (простое изменение, высокая важность)
   - Добавить таймаут подключения (улучшит надежность)

2. **Затем полнота данных:**
   - Загрузка устройств из массивов помещений
   - Резолв помещений через каналы

3. **В конце - логирование:**
   - Полезно для отладки, но не критично
   - Можно добавить при необходимости

4. **Не создавать полноценный monitor.js:**
   - У нас уже есть event-logger для логирования
   - Monitor нужен только для визуального мониторинга
   - Можно создать упрощенную версию при необходимости

---

## 🚫 Что НЕ нужно переносить

1. **Terminal-kit UI** - не нужен для event-logger
2. **Интерактивный интерфейс** - не нужен для event-logger
3. **Периодическое обновление LIST** - event-logger работает в real-time
4. **Кэширование для UI** - не нужно для логирования

---

## 📊 Итоговые метрики

После внедрения всех улучшений:

- ✅ Защита от DoS: ограничение 10MB
- ✅ Таймаут подключения: 10 секунд
- ✅ Логирование WebSocket: опционально (env var)
- ✅ Полнота данных: +устройства из массивов помещений
- ✅ Точность site: +резолв через каналы
- ✅ Различение типов сообщений: явная проверка `_context`

**Ожидаемые улучшения:**
- 🔒 Безопасность: +100%
- 📊 Полнота данных: +15-20%
- 🎯 Точность site: +30-40%
- 🐛 Отладка: значительно проще с логами

