# Инсайты из monitor.js (reacthome-main)

**Дата:** 2025-12-10  
**Источник:** `/Users/evgen/Documents/Work/reacthome-main/monitoring/scripts/monitor.js`  
**Размер:** 3350 строк кода

---

## 🎯 Основное назначение

Мониторинг щитовых устройств с терминальным UI на `terminal-kit`. Интерактивный интерфейс для отображения состояния устройств в реальном времени через WebSocket.

---

## 💡 Ключевые инсайты

### 1. Гибридный подход: WebSocket + LevelDB

**Паттерн:** Комбинирование WebSocket для получения данных и LevelDB для fallback.

```javascript
// Зачем: LevelDB используется для загрузки помещений, которые могут отсутствовать в WebSocket ответах
async function loadSitesFromDB() {
  const siteMap = new Map();
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  
  for await (const [key, value] of db.iterator()) {
    const type = value.type;
    if (type === 'site' || type === 'SITE' || type === 'project' || type === 'PROJECT') {
      const siteName = value.title || value.code || value.name || key;
      siteMap.set(key, siteName);
    }
  }
  
  return siteMap;
}

// Зачем: Инициализируем siteMap из БД, чтобы помещения уже были загружены
const siteMap = new Map(initialSiteMap);
```

**Инсайт:** 
- Помещения загружаются из БД заранее (fallback)
- Устройства загружаются через WebSocket (основной источник)
- Если устройство отсутствует в WebSocket, пытаются загрузить из БД

**Применение для event-logger:**
- Можно использовать БД как fallback для получения метаданных устройств, которые не пришли через WebSocket
- Особенно полезно для помещений и проектов, которые могут отсутствовать в LIST

---

### 2. Различение начального состояния и событий изменений

**Паттерн:** Использование `_context` для различения типов сообщений.

```javascript
// Зачем: Обрабатываем только сообщения без _context (начальное состояние из GET)
// Сообщения с _context - это события изменений, их пропускаем при начальной загрузке
if (!message._context) {
  // Это начальное состояние из GET запроса
  deviceDataMap.set(id, payload);
  pendingGetRequests--;
} else {
  // Это событие изменения - пропускаем при начальной загрузке
  console.log('[DEBUG] Пропущено ACTION_SET с _context (событие изменения)');
}
```

**Инсайт:**
- `_context` отсутствует → начальное состояние (ответ на GET)
- `_context` присутствует → событие изменения (real-time update)

**Применение для event-logger:**
- Event-logger уже использует этот паттерн правильно
- Можно улучшить обработку: явно проверять `_context` для разделения логики

---

### 3. Обработка отсутствующих устройств

**Паттерн:** Ленивая загрузка устройств по требованию.

```javascript
// Зачем: Если устройство отсутствует в списке, но было запрошено, пытаемся добавить его
const isMissingDevice = display.requestedMissingDevices.has(deviceId);
const deviceExists = display.allDevices.some(d => d.id === deviceId);

if (isMissingDevice && !deviceExists) {
  if (payload && payload.type) {
    // Устройство с данными, добавляем его
    display.addMissingDevice(deviceId, payload);
  } else {
    // Payload пустой, пытаемся загрузить из БД
    display.loadDeviceFromDB(deviceId).then(deviceFromDB => {
      if (deviceFromDB) {
        display.addMissingDevice(deviceId, deviceFromDB);
      } else {
        // Создаем минимальное устройство для отображения
        display.addMissingDevice(deviceId, {
          type: 0x00,
          name: `Устройство ${deviceId.substring(0, 8)}...`,
          id: deviceId
        });
      }
    });
  }
}
```

**Инсайт:**
- Устройства могут упоминаться в `bind` каналов, но отсутствовать в начальном LIST
- Нужна ленивая загрузка по требованию
- Fallback на БД, если WebSocket не вернул данные

**Применение для event-logger:**
- При обработке событий каналов может потребоваться загрузка `endDevice` из БД
- Можно реализовать кэш отсутствующих устройств с попыткой загрузки из БД

---

### 4. Обработка устройств из массивов помещений

**Паттерн:** Дополнительный GET запрос для потребителей из массивов помещений.

```javascript
// Зачем: Собираем ID устройств из массивов помещений (light_220, light_LED и т.д.)
const consumerIdsFromSites = new Set();
deviceDataMap.forEach((payload, deviceId) => {
  if (payload.type === 'site' || payload.type === 'SITE' || payload.type === 'project' || payload.type === 'PROJECT') {
    const consumerArrays = ['light_220', 'light_LED', 'light_RGB', 'light_led', 
                            'socket_220', 'valve_heating', 'valve_water', 
                            'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP',
                            'thermostat', 'hygrostat', 'co2_stat'];
    consumerArrays.forEach(arrayName => {
      if (payload[arrayName] && Array.isArray(payload[arrayName])) {
        payload[arrayName].forEach(consumerId => {
          if (typeof consumerId === 'string') {
            consumerIdsFromSites.add(consumerId);
          }
        });
      }
    });
  }
});

// Зачем: Запрашиваем устройства из массивов помещений, если они еще не загружены
if (consumerIdsFromSites.size > 0 && ws.readyState === WebSocket.OPEN) {
  const missingConsumerIds = Array.from(consumerIdsFromSites).filter(id => !deviceDataMap.has(id));
  if (missingConsumerIds.length > 0) {
    console.log(`[DEBUG] Запрашиваем ${missingConsumerIds.length} потребителей из массивов помещений`);
    ws.send(JSON.stringify({ type: 'get', state: missingConsumerIds }));
    pendingGetRequests += missingConsumerIds.length;
  }
}
```

**Инсайт:**
- Устройства могут храниться в массивах внутри помещений (`site.light_220`, `site.socket_220`)
- Нужен дополнительный GET запрос для этих устройств
- Счетчик `pendingGetRequests` должен учитывать дополнительные запросы

**Применение для event-logger:**
- Event-logger может не получать все устройства в начальном LIST
- Может потребоваться дополнительный GET для устройств из массивов помещений
- Особенно важно для `endDevice` в событиях каналов

---

### 5. Резолв помещений для актуаторов через каналы

**Паттерн:** Определение помещения актуатора по помещениям связанных устройств.

```javascript
// Зачем: Резолвим помещения для актуаторов по их каналам
// Если актуатор не имеет привязки к помещению, но его каналы привязаны к устройствам с помещениями,
// определяем помещение актуатора по наиболее часто встречающемуся помещению связанных устройств
for (const device of devices) {
  if (device.category === 'Актуатор' && typeof device.type === 'number' && !device.site && !device.siteId) {
    const siteCounts = new Map();
    const channelConfig = getActuatorChannelCount(device.type);
    
    if (channelConfig) {
      // Проверяем каналы актуатора
      for (let i = 0; i < channelConfig.count; i++) {
        const channelId = `${device.id}/${channelConfig.types[0]}/${i}`;
        const channelData = deviceDataMap.get(channelId);
        
        if (channelData && channelData.bind) {
          // Находим связанное устройство и его помещение
          const boundDevice = deviceDataMap.get(channelData.bind);
          if (boundDevice && boundDevice.site) {
            const siteId = Array.isArray(boundDevice.site) ? boundDevice.site[0] : boundDevice.site;
            siteCounts.set(siteId, (siteCounts.get(siteId) || 0) + 1);
          }
        }
      }
      
      // Выбираем наиболее часто встречающееся помещение
      if (siteCounts.size > 0) {
        const mostCommonSite = Array.from(siteCounts.entries())
          .sort((a, b) => b[1] - a[1])[0][0];
        device.siteId = mostCommonSite;
        device.site = siteMap.get(mostCommonSite) || null;
      }
    }
  }
}
```

**Инсайт:**
- Актуаторы могут не иметь прямого `site`, но их каналы связаны с устройствами, у которых есть `site`
- Можно определить помещение актуатора статистически (по наиболее частому помещению связанных устройств)

**Применение для event-logger:**
- При обогащении событий каналов можно использовать этот подход для определения `site` актуатора
- Улучшит точность поля `site` в событиях OpenSearch

---

### 6. Защита от DoS атак

**Паттерн:** Ограничение размера сообщений WebSocket.

```javascript
// Зачем: Безопасный парсинг JSON с ограничением размера для предотвращения DoS атак
const dataString = data.toString();
if (dataString.length > 10 * 1024 * 1024) { // Зачем: Ограничение размера сообщения до 10MB
  console.error('WebSocket message too large, ignoring');
  return;
}
const message = JSON.parse(dataString);
```

**Инсайт:**
- Защита от больших сообщений, которые могут вызвать DoS
- Ограничение размера до 10MB перед парсингом JSON

**Применение для event-logger:**
- Event-logger должен иметь аналогичную защиту
- Особенно важно при обработке больших payload в ACTION_SET

---

### 7. Таймауты и обработка неполных ответов

**Паттерн:** Таймаут для получения всех ответов на GET запрос.

```javascript
const STATE_REQUEST_TIMEOUT = 10000; // 10 секунд

// Зачем: Устанавливаем таймаут для получения всех ответов
timeoutId = setTimeout(() => {
  if (!processingStarted) {
    processingStarted = true;
    if (pendingGetRequests > 0) {
      console.log(`Предупреждение: получено не все ответы на GET (ожидалось ${deviceIds.length}, получено ${deviceIds.length - pendingGetRequests})`);
    }
    processDevicesAndSites();
  }
}, STATE_REQUEST_TIMEOUT);
```

**Инсайт:**
- Не все ответы на GET могут прийти (сетевые проблемы, таймауты)
- Нужен таймаут для обработки неполных данных
- Флаг `processingStarted` предотвращает повторную обработку

**Применение для event-logger:**
- Event-logger уже имеет таймаут (`STATE_REQUEST_TIMEOUT = 30000`)
- Можно улучшить логирование неполных ответов

---

### 8. Обработка каналов и bind

**Паттерн:** Пропуск каналов при обработке устройств, но учет их для резолва помещений.

```javascript
// Зачем: Пропускаем каналы (ID содержат '/')
if (deviceId.includes('/')) {
  return;
}

// Но при резолве помещений проверяем каналы:
const channelId = `${device.id}/${channelConfig.types[0]}/${i}`;
const channelData = deviceDataMap.get(channelId);
if (channelData && channelData.bind) {
  // Используем bind для резолва помещения
}
```

**Инсайт:**
- Каналы не добавляются как отдельные устройства в список
- Но их данные используются для резолва помещений и связей
- `bind` канала указывает на `endDevice`

**Применение для event-logger:**
- Event-logger уже обрабатывает каналы правильно
- Можно улучшить резолв `endDevice` через `bind`

---

### 9. Периодическое обновление состояния

**Паттерн:** Периодический LIST запрос для обновления состояния.

```javascript
const UPDATE_INTERVAL = 3000; // 3 секунды

ws.on('open', () => {
  // Первоначальный LIST
  ws.send(JSON.stringify({ type: 'list' }));
  
  // Зачем: Периодическое обновление состояния
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'list' }));
      // После LIST будет GET для новых устройств
    }
  }, UPDATE_INTERVAL);
});
```

**Инсайт:**
- Периодическое обновление позволяет получать новые устройства
- Можно использовать для синхронизации состояния

**Применение для event-logger:**
- Event-logger не нуждается в периодическом обновлении (получает события в реальном времени)
- Но можно использовать для восстановления после переподключения

---

### 10. Обработка устройств из bind каналов

**Паттерн:** Автоматическое добавление устройств, упоминаемых в `bind` каналов.

```javascript
// Зачем: Также проверяем устройства, которые упоминаются в bind каналов, но не были загружены
const isReferencedInBind = Array.from(display.allDevices).some(device => {
  if (device.category === 'Актуатор' && typeof device.type === 'number') {
    const channels = display.getActuatorChannels(device.id, device.type);
    return channels.some(ch => ch.channelState && ch.channelState.bind === deviceId);
  }
  return false;
});

if ((isConsumer || isShieldDevice) && isReferencedInBind) {
  // Зачем: Это устройство, которое упоминается в bind каналов актуаторов
  console.log(`[DEBUG] Добавляем устройство из bind: ${deviceId}, тип: ${payload.type}`);
  display.addMissingDevice(deviceId, payload);
}
```

**Инсайт:**
- Устройства могут упоминаться в `bind` каналов, но отсутствовать в начальном LIST
- Нужна проверка всех каналов актуаторов для поиска упоминаний
- Автоматическое добавление таких устройств улучшает полноту данных

**Применение для event-logger:**
- При обогащении событий каналов может потребоваться загрузка `endDevice` из БД
- Можно реализовать автоматическую загрузку устройств из `bind`

---

## 🔧 Технические детали

### Используемые библиотеки:
- `terminal-kit` (^3.0.0) - терминальный UI
- `ws` (^7.2.5) - WebSocket клиент
- `level` - LevelDB для fallback

### Переменные окружения:
- `REACTHOME_WS_URI` - URI WebSocket (по умолчанию `ws://localhost:3000`)
- `DB_PATH` - путь к БД (по умолчанию `var/db`)

### Типы устройств:
- **Щитовые актуаторы:** 0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab
- **Щитовые сенсоры:** 0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0
- **Конечные устройства:** 0x26, 0x27, 0x2a, 0x2c, 0x30-0x3b
- **Потребители:** `light_220`, `light_LED`, `light_RGB`, `socket_220`, `valve_heating`, `valve_water`, `warm_floor`, `AC`, `FAN`, `BOILER`, `PUMP`, `thermostat`, `hygrostat`, `co2_stat`

---

## 📊 Сравнение с event-logger

| Аспект | monitor.js | event-logger |
|--------|-----------|--------------|
| **Источник данных** | WebSocket + LevelDB (fallback) | Только WebSocket |
| **Обработка _context** | ✅ Различает начальное состояние и события | ✅ Различает |
| **Fallback на БД** | ✅ Для помещений и отсутствующих устройств | ❌ Нет |
| **Обработка каналов** | ✅ Пропускает каналы, но использует для резолва | ✅ Обрабатывает каналы |
| **Защита от DoS** | ✅ Ограничение размера сообщений | ❓ Не проверено |
| **Таймауты** | ✅ 10 секунд | ✅ 30 секунд |
| **Периодическое обновление** | ✅ Каждые 3 секунды | ❌ Нет (real-time) |

---

## ✅ Рекомендации для event-logger

1. **Добавить fallback на БД для метаданных:**
   - Загружать помещения из БД при старте
   - Использовать БД для получения `endDevice`, если не пришло через WebSocket

2. **Улучшить обработку отсутствующих устройств:**
   - Реализовать ленивую загрузку устройств из БД по требованию
   - Особенно важно для `endDevice` в событиях каналов

3. **Добавить защиту от DoS:**
   - Ограничить размер сообщений WebSocket (например, 10MB)
   - Проверять размер перед парсингом JSON

4. **Улучшить резолв помещений:**
   - Использовать статистический подход для актуаторов без прямого `site`
   - Определять помещение по наиболее частому помещению связанных устройств

5. **Обработка устройств из массивов помещений:**
   - Реализовать дополнительный GET для устройств из `site.light_220`, `site.socket_220` и т.д.
   - Особенно важно для полноты данных о `endDevice`

6. **Улучшить логирование:**
   - Логировать неполные ответы на GET запросы
   - Логировать попытки загрузки из БД

---

## 🎯 Итоговые выводы

1. **Гибридный подход эффективен:** WebSocket для основных данных, БД для fallback
2. **Различение типов сообщений важно:** `_context` позволяет правильно обрабатывать начальное состояние и события
3. **Ленивая загрузка улучшает производительность:** Загружать устройства по требованию, а не все сразу
4. **Резолв помещений через каналы:** Статистический подход для актуаторов без прямого `site`
5. **Защита от DoS необходима:** Ограничение размера сообщений перед парсингом




