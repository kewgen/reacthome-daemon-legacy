# Быстрая справка: Резолвинг MAC демона

## TL;DR

```javascript
// Резолвинг mac по project ID (O(1))
const mac = get(projectId).daemon;

// Или используй готовую функцию
const { resolveMacByProjectId } = require('./src/util-daemon');
const mac = resolveMacByProjectId(projectId);
```

## Терминология

| Термин | Значение | Пример |
|--------|----------|--------|
| **DUID** | Daemon Unique ID | UUID v4 |
| **mac** | Идентификатор демона | `d31775ae-19e8-40c9-81df-d6d672379563` |
| **project** | Проект (умный дом) | `ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4` |
| **site** | Сайт (локация, этаж) | `5a1d4386-639e-4091-95ec-8c98a85cb30b` |

## Структура связей

```
Демон:
  ID: mac (UUID v4)
  Поле: project → ID проекта

Проект:
  ID: UUID v4
  Поле: daemon → mac демона  ← ОБРАТНАЯ ССЫЛКА!

Сайт:
  ID: UUID v4
  Поле: parent → ID проекта  ← НЕ project!
```

## API функции

### resolveMacByProjectId(projectId)
```javascript
const { resolveMacByProjectId } = require('./src/util-daemon');
const mac = resolveMacByProjectId("ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4");
// → "d31775ae-19e8-40c9-81df-d6d672379563"
```

### resolveMacBySiteId(siteId)
```javascript
const { resolveMacBySiteId } = require('./src/util-daemon');
const mac = resolveMacBySiteId("5a1d4386-639e-4091-95ec-8c98a85cb30b");
// → "d31775ae-19e8-40c9-81df-d6d672379563"
```

### resolveMacById(id)
```javascript
const { resolveMacById } = require('./src/util-daemon');
const mac = resolveMacById("любой-id");
// Работает с project, site, device, channel
```

### getAllDaemons()
```javascript
const { getAllDaemons } = require('./src/util-daemon');
const daemons = getAllDaemons();
// [{ id: "mac", project: "projectId", title: "...", code: "..." }]
```

## WebSocket резолвинг

### Клиент знает только project ID

```javascript
const WebSocket = require('ws');
const projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4";

// Подключаемся к любому демону
const ws = new WebSocket('ws://192.168.88.4:3000');

ws.on('open', () => {
  // Запрашиваем объект проекта
  ws.send(JSON.stringify({ type: 'get', state: [projectId] }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.id === projectId) {
    const mac = message.payload.daemon;  // ← РЕЗОЛВИНГ!
    console.log('Gateway URL:', `wss://gate.reacthome.net/${mac}`);
  }
});
```

## Тестирование

```bash
# Тест на локальной БД
node scripts/test-daemon-resolving.js

# Тест на backup БД
DB_PATH=/tmp/db-check/var/db node scripts/test-daemon-resolving.js
```

## Частые ошибки

### ❌ Неправильно
```javascript
// Перебор всех демонов (O(n))
for (const [id, obj] of Object.entries(state())) {
  if (obj.type === 'daemon' && obj.project === projectId) {
    return id;
  }
}
```

### ✅ Правильно
```javascript
// Прямой доступ (O(1))
const mac = get(projectId).daemon;
```

### ❌ Неправильно
```javascript
// Забыли про site.parent
const projectId = site.project;
```

### ✅ Правильно
```javascript
// Учитываем оба варианта
const projectId = site.project || site.parent;
```

## Сложность операций

| Операция | Сложность | Комментарий |
|----------|-----------|-------------|
| `resolveMacByProjectId()` | O(1) | Прямой доступ |
| `resolveMacBySiteId()` | O(1) | Два прямых доступа |
| `resolveMacById()` | O(depth) | Рекурсивный обход, max depth=10 |
| `getAllDaemons()` | O(n) | Полный обход state |

## Файлы

| Файл | Назначение |
|------|------------|
| `src/util-daemon.js` | Модуль с функциями резолвинга |
| `scripts/test-daemon-resolving.js` | Тестовый скрипт |
| `docs/DAEMON_RESOLVING.md` | Полная документация |
| `reports/DAEMON_RESOLVING_RESEARCH.md` | Отчет об исследовании |

## Связанные документы

- [Полная документация](./DAEMON_RESOLVING.md)
- [Отчет об исследовании](../reports/DAEMON_RESOLVING_RESEARCH.md)
- [Структура проекта](./PROJECT_DESCRIPTION.md)
- [WebSocket API](./WEBSOCKET_API_REFERENCE.md)

## Контакты

Вопросы и предложения: создайте issue или обратитесь к техлиду.
