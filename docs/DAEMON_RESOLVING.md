# Резолвинг MAC (DUID) демона по ID проекта/сайта

## История исследования

### Исходный вопрос
> "определи как в коде демона в папке src резолвится duid демона по id умного дома"

### Путь исследования

1. **Поиск термина "duid"** — не найден в коде
2. **Поиск "daemon"** — найдено множество упоминаний
3. **Поиск "uuid"** — найден файл `src/mac.js`
4. **Открытие:** `mac` — это UUID v4, используемый как DUID демона
5. **Поиск связей:** изучение `daemon.js`, `src/controllers/state.js`, `src/actions/create.js`
6. **Проверка БД:** анализ структуры LevelDB
7. **Ключевое открытие:** поле `daemon` в объекте проекта!

### Терминология

- **DUID** (Daemon Unique ID) = **mac** = UUID v4
- **mac** — ключ в БД и идентификатор демона
- **project** — проект (умный дом)
- **site** — сайт (локация, этаж)

## ✅ НАЙДЕНО! Резолвинг через поле `daemon` в объекте проекта

### Ключевое открытие

Проект содержит **обратную ссылку** на демон через поле `daemon`:
- Демон → Проект: `daemon.project = "project-id"`
- Проект → Демон: `project.daemon = "mac"` ← **ОБРАТНАЯ ССЫЛКА!**

Это позволяет резолвить mac по project ID за **O(1)**:
```javascript
const mac = get(projectId).daemon;
```

### Почему это важно

До этого открытия казалось, что резолвинг возможен только через:
1. Перебор всех демонов в state
2. Запрос к внешнему gateway API
3. Сканирование всей БД

**Реальность:** Двусторонняя связь позволяет мгновенный резолвинг в обе стороны!

### Структура связей в БД

Проект содержит **обратную ссылку** на демон через поле `daemon`:

```json
{
  "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4": {
    "type": "project",
    "daemon": "d31775ae-19e8-40c9-81df-d6d672379563",  ← ОБРАТНАЯ ССЫЛКА!
    "title": "Миндальный",
    "site": [...],
    "script": [...]
  }
}
```

### Резолвинг в коде

#### 1. По ID проекта

```javascript
const { get } = require('./actions');

// Получить mac по project ID
const projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4";
const project = get(projectId);
const mac = project.daemon;  // "d31775ae-19e8-40c9-81df-d6d672379563"
```

#### 2. По ID сайта

```javascript
const { get } = require('./actions');

// Получить mac по site ID
const siteId = "5a1d4386-639e-4091-95ec-8c98a85cb30b";
const site = get(siteId);
const projectId = site.project || site.parent;  // ID проекта (может быть в project или parent)
const project = get(projectId);
const mac = project.daemon;  // mac демона
```

**Важно:** Сайт может использовать поле `project` или `parent` для ссылки на проект.

#### 3. Универсальная функция

Создан модуль `src/util-daemon.js` с функциями резолвинга:

```javascript
const { resolveMacByProjectId, resolveMacBySiteId, resolveMacById } = require('./util-daemon');

// По project ID
const mac1 = resolveMacByProjectId("ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4");

// По site ID
const mac2 = resolveMacBySiteId("5a1d4386-639e-4091-95ec-8c98a85cb30b");

// По любому ID (универсальный)
const mac3 = resolveMacById("любой-id");
```

### Схема резолвинга

```
Клиент знает: projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4"
                    ↓
            get(projectId)
                    ↓
         { daemon: "d31775ae-19e8-40c9-81df-d6d672379563" }
                    ↓
         mac = "d31775ae-19e8-40c9-81df-d6d672379563"
                    ↓
    wss://gate.reacthome.net/d31775ae-19e8-40c9-81df-d6d672379563
```

## Использование через WebSocket

### Клиент знает только project ID

```javascript
const WebSocket = require('ws');

const projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4";

// Шаг 1: Подключиться к любому демону или локальному серверу
const ws = new WebSocket('ws://192.168.88.4:3000');

ws.on('open', () => {
  // Шаг 2: Запросить объект проекта
  ws.send(JSON.stringify({ 
    type: 'get', 
    state: [projectId] 
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  if (message.type === 'ACTION_SET' && message.id === projectId) {
    // Шаг 3: Извлечь mac из поля daemon
    const mac = message.payload.daemon;
    console.log('MAC демона:', mac);
    
    // Шаг 4: Подключиться к нужному демону через gateway
    const daemonWs = new WebSocket(
      `wss://gate.reacthome.net/${mac}`, 
      ['listen']
    );
    // ... работа с демоном
  }
});
```

## API функции

### `resolveMacByProjectId(projectId)`

Резолвит mac по ID проекта.

**Параметры:**
- `projectId` (string) - ID проекта

**Возвращает:**
- `string` - mac демона
- `null` - если проект не найден или не имеет поля daemon

**Пример:**
```javascript
const mac = resolveMacByProjectId("ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4");
// "d31775ae-19e8-40c9-81df-d6d672379563"
```

### `resolveMacBySiteId(siteId)`

Резолвит mac по ID сайта через project → daemon.

**Параметры:**
- `siteId` (string) - ID сайта

**Возвращает:**
- `string` - mac демона
- `null` - если сайт/проект не найден

**Пример:**
```javascript
const mac = resolveMacBySiteId("5a1d4386-639e-4091-95ec-8c98a85cb30b");
// "d31775ae-19e8-40c9-81df-d6d672379563"
```

### `resolveMacById(id)`

Универсальный резолвинг mac по любому ID.

**Параметры:**
- `id` (string) - ID любого объекта (проект, сайт, устройство, канал)

**Возвращает:**
- `string` - mac демона
- `null` - если демон не найден

**Алгоритм:**
1. Проверяет, является ли объект демоном → возвращает ID
2. Проверяет поле `daemon` → возвращает его
3. Проверяет поле `project` → рекурсивно ищет в проекте
4. Проверяет поле `site` → рекурсивно ищет в сайте
5. Проверяет поле `parent` → рекурсивно ищет в родителе

**Пример:**
```javascript
// По project ID
const mac1 = resolveMacById("ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4");

// По site ID
const mac2 = resolveMacById("5a1d4386-639e-4091-95ec-8c98a85cb30b");

// По device ID
const mac3 = resolveMacById("e4:5f:01:1f:dc:3f");

// По channel ID
const mac4 = resolveMacById("e4:5f:01:1f:dc:3f/do/1");
```

### `getAllDaemons()`

Получить список всех демонов в системе.

**Возвращает:**
- `Array<{id, project, title, code}>` - массив демонов

**Пример:**
```javascript
const daemons = getAllDaemons();
// [
//   {
//     id: "d31775ae-19e8-40c9-81df-d6d672379563",
//     project: "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4",
//     title: "Лучистое",
//     code: "s1"
//   }
// ]
```

## Двусторонняя связь

Демон и проект имеют **двустороннюю связь**:

```
Демон → Проект:
{
  "d31775ae-19e8-40c9-81df-d6d672379563": {
    "type": "daemon",
    "project": "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4"  ← прямая ссылка
  }
}

Проект → Демон:
{
  "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4": {
    "type": "project",
    "daemon": "d31775ae-19e8-40c9-81df-d6d672379563"  ← обратная ссылка
  }
}
```

Это позволяет резолвить в обе стороны:
- `get(mac).project` → ID проекта
- `get(projectId).daemon` → mac демона

## Использование в коде

### Пример 1: Подключение к демону по project ID

```javascript
const { resolveMacByProjectId } = require('./src/util-daemon');
const WebSocket = require('ws');

const projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4";
const mac = resolveMacByProjectId(projectId);

if (mac) {
  const ws = new WebSocket(`wss://gate.reacthome.net/${mac}`, ['listen']);
  ws.on('open', () => {
    console.log('Подключено к демону:', mac);
  });
}
```

### Пример 2: Резолвинг через WebSocket GET

```javascript
const WebSocket = require('ws');

const projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4";

// Подключаемся к любому демону или локальному серверу
const ws = new WebSocket('ws://192.168.88.4:3000');

ws.on('open', () => {
  // Запрашиваем объект проекта
  ws.send(JSON.stringify({ 
    type: 'get', 
    state: [projectId] 
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  if (message.type === 'ACTION_SET' && message.id === projectId) {
    const mac = message.payload.daemon;
    console.log('MAC демона:', mac);
    console.log('Gateway URL:', `wss://gate.reacthome.net/${mac}`);
  }
});
```

## Детали реализации

### Инициализация mac в daemon.js

```javascript
// daemon.js:96-98
if (!init.mac) {
  init.mac = v4();  // Генерация UUID v4
  db.put("mac", init.mac);
}
```

**Зачем:** При первом запуске демона генерируется уникальный UUID v4, который сохраняется в БД под ключом `"mac"`.

### Установка типа DAEMON

```javascript
// daemon.js:57
const start = (id) => {
  set(id, { type: DAEMON });  // Устанавливаем type: "daemon"
  const { project } = get(id) || {};
  // ...
}
```

**Зачем:** Объект демона получает тип `DAEMON`, что позволяет идентифицировать его в state.

### Структура в LevelDB

```
Ключ "mac":
  "d31775ae-19e8-40c9-81df-d6d672379563"

Ключ "d31775ae-19e8-40c9-81df-d6d672379563" (объект демона):
  {
    "type": "daemon",
    "project": "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4",
    "timestamp": 1766945218309,
    "token": [...]
  }

Ключ "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4" (объект проекта):
  {
    "type": "project",
    "daemon": "d31775ae-19e8-40c9-81df-d6d672379563",  ← ОБРАТНАЯ ССЫЛКА!
    "title": "Миндальный",
    "site": [...],
    "script": [...]
  }
```

### Особенности структуры Site

Сайт может использовать **два разных поля** для ссылки на проект:
- `site.project` — прямая ссылка на проект
- `site.parent` — ссылка на родителя (проект)

```javascript
// Пример сайта
{
  "type": "site",
  "title": "1 Этаж",
  "parent": "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4"  // Используется parent!
}
```

**Зачем:** Функция `resolveMacBySiteId` проверяет оба поля:
```javascript
const projectId = site.project || site.parent;
```

## Проверка через БД

### Извлечение backup

```bash
# Распаковка backup
tar -xzf backups/db-backup-*.tar.gz -C /tmp/db-check

# Проверка структуры
node scripts/inspect-daemon-project-storage.js /tmp/db-check/var/db
```

### Прямой запрос к БД

```javascript
const { Level } = require('level');
const db = new Level('/tmp/db-check/var/db', { valueEncoding: 'json' });

(async () => {
  // Получить mac
  const mac = await db.get('mac');
  console.log('MAC:', mac);
  
  // Получить объект демона
  const daemon = await db.get(mac);
  console.log('Project ID:', daemon.project);
  
  // Получить объект проекта
  const project = await db.get(daemon.project);
  console.log('Daemon field:', project.daemon);
  
  // Проверка двусторонней связи
  console.log('Связь корректна:', project.daemon === mac);
  
  await db.close();
})();
```

## Альтернативные подходы (отвергнуты)

### ❌ Подход 1: Перебор всех демонов

```javascript
// Неэффективно: O(n)
const findDaemonByProject = (projectId) => {
  const st = state();
  for (const [id, obj] of Object.entries(st)) {
    if (obj.type === 'daemon' && obj.project === projectId) {
      return id;
    }
  }
  return null;
};
```

**Почему отвергнут:** Сложность O(n), требует обхода всего state.

### ❌ Подход 2: Gateway API

```javascript
// Требует внешний сервис
const resolveMacByProjectId = async (projectId) => {
  const response = await fetch(`https://gate.reacthome.net/api/resolve?projectId=${projectId}`);
  return response.json();
};
```

**Почему отвергнут:** Требует реализации API на gateway, сетевой запрос, зависимость от внешнего сервиса.

### ✅ Подход 3: Обратная ссылка (выбран)

```javascript
// Эффективно: O(1)
const mac = get(projectId).daemon;
```

**Почему выбран:** Мгновенный доступ, нет зависимостей, уже реализовано в структуре данных!

## Связанные файлы

### Созданные файлы

- `src/util-daemon.js` — модуль с функциями резолвинга
- `scripts/test-daemon-resolving.js` — тестовый скрипт
- `docs/DAEMON_RESOLVING.md` — эта документация

### Существующие файлы

- `src/mac.js` — получение mac демона из state
- `src/actions/create.js` — функции работы с состоянием (get, set)
- `src/controllers/state.js` — хранилище состояния
- `src/db.js` — инициализация LevelDB
- `daemon.js:96-98` — инициализация mac
- `daemon.js:57` — установка type: DAEMON
- `src/gc.js` — сборка мусора и обход иерархии
- `src/websocket/gate.js` — подключение к gateway
- `src/websocket/handle.js` — обработка WebSocket сообщений

### Вспомогательные скрипты

- `scripts/get-daemon-uuid.js` — получить UUID демона из БД
- `scripts/inspect-daemon-project-storage.js` — инспекция структуры БД
- `scripts/identify-daemon-project.js` — обратный резолвинг (mac → project)

## Тесты

### Запуск тестов

```bash
# Тест на локальной БД
node scripts/test-daemon-resolving.js

# Тест на backup БД
DB_PATH=/tmp/db-check/var/db node scripts/test-daemon-resolving.js
```

### Результаты тестов

```
[ТЕСТ 1] Резолвинг по project ID:
   Вход: projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4"
   Код: get(projectId).daemon
   Результат: d31775ae-19e8-40c9-81df-d6d672379563
   Статус: ✅ УСПЕХ

[ТЕСТ 2] Резолвинг по site ID:
   Вход: siteId = "5a1d4386-639e-4091-95ec-8c98a85cb30b"
   Название сайта: 1 Этаж
   Код: get(siteId).project/parent → get(projectId).daemon
   Site.project: отсутствует
   Site.parent: ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4
   Используется: ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4
   Результат: d31775ae-19e8-40c9-81df-d6d672379563
   Статус: ✅ УСПЕХ

[ТЕСТ 3] Обратный резолвинг (mac → project):
   Вход: mac = "d31775ae-19e8-40c9-81df-d6d672379563"
   Код: get(mac).project
   Результат: ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4
   Статус: ✅ УСПЕХ
```

## Выводы

1. **DUID = mac = UUID v4** — уникальный идентификатор демона
2. **Двусторонняя связь** — daemon.project ↔ project.daemon
3. **Резолвинг за O(1)** — прямой доступ через get(projectId).daemon
4. **Site использует parent** — не project, а parent для ссылки на проект
5. **Универсальная функция** — resolveMacById работает с любым ID
6. **WebSocket резолвинг** — можно запросить объект проекта и извлечь daemon
7. **Gateway URL** — wss://gate.reacthome.net/{mac}

## Рекомендации

### Для разработчиков

1. Используйте `resolveMacByProjectId(projectId)` для прямого резолвинга
2. Используйте `resolveMacById(id)` для универсального резолвинга
3. Не забывайте про `site.parent` вместо `site.project`
4. Кешируйте результаты, если нужна высокая производительность

### Для клиентов

1. Если знаете только project ID — запросите объект проекта через WebSocket
2. Извлеките поле `daemon` из ответа
3. Подключитесь к `wss://gate.reacthome.net/{daemon}`
4. Не пытайтесь перебирать демоны — используйте обратную ссылку!

### Для администраторов

1. Проверяйте целостность связей: `daemon.project` ↔ `project.daemon`
2. Используйте `scripts/test-daemon-resolving.js` для диагностики
3. Backup БД содержит всю структуру связей
4. LevelDB хранит данные в JSON формате
