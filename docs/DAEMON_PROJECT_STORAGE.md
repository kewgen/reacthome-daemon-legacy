# Хранение ID демона и проекта в LevelDB

## Структура хранения

### 1. ID демона (duid)

ID демона хранится в БД в двух местах:

#### Ключ `"mac"`
- **Ключ**: строка `"mac"`
- **Значение**: UUID демона (например, `"d31775ae-2025-12-28T18-06-41-h4s"`)
- **Назначение**: хранит идентификатор демона для быстрого доступа

**Код инициализации** (`daemon.js:96-98`):
```javascript
if (!init.mac) {
  init.mac = v4();  // Генерируется UUID v4
  db.put("mac", init.mac);
}
```

#### Объект демона
- **Ключ**: UUID демона (значение из ключа `"mac"`)
- **Значение**: объект с полями:
  ```json
  {
    "type": "daemon",
    "project": "<ID проекта>",
    "device": [...],
    "token": [...],
    "temperature": 45.2,
    "timestamp": 1234567890
  }
  ```

**Код загрузки** (`daemon.js:100-104`):
```javascript
const d = init[init.mac];
if (d) {
  delete d.ip;
  set(init.mac, d);
}
```

### 2. ID проекта

ID проекта хранится в объекте демона:

- **Ключ**: ID проекта (UUID или строка)
- **Значение**: объект с полями:
  ```json
  {
    "type": "project",
    "site": [...],
    "device": [...],
    "driver": [...],
    "script": [...],
    "timer": [...],
    "schedule": [...],
    "shell": [...],
    "onStart": "<ID скрипта>",
    "title": "Название проекта",
    "timestamp": 1234567890
  }
  ```

**Связь**: объект демона содержит поле `project`, которое указывает на ID проекта.

## Схема связей

```
LevelDB
│
├─ Ключ: "mac"
│  └─ Значение: "d31775ae-2025-12-28T18-06-41-h4s" (UUID демона)
│
├─ Ключ: "d31775ae-2025-12-28T18-06-41-h4s"
│  └─ Значение: {
│       type: "daemon",
│       project: "project-uuid-123",  ←───┐
│       device: [...],                     │
│       token: [...],                      │
│       ...                                 │
│     }                                    │
│                                          │
└─ Ключ: "project-uuid-123"  ←────────────┘
   └─ Значение: {
        type: "project",
        site: [...],
        device: [...],
        driver: [...],
        script: [...],
        ...
      }
```

## Резолвинг duid демона по id проекта

Чтобы найти duid демона по id проекта, нужно:

1. **Прямой поиск**: пройтись по всем записям БД и найти объект с `type === "daemon"` и `project === <ID проекта>`

2. **Обратный поиск**: подниматься вверх по иерархии `project` от проекта до демона (но в текущей реализации демон не имеет родительского проекта, поэтому этот способ не работает)

**Текущая реализация** (`src/drivers/driver.js:52`):
```javascript
const { project } = get(mac()) || {};
```

Это означает, что демон получает проект напрямую из своего объекта, а не через обход иерархии.

## Функция резолвинга

В текущем коде нет функции для резолвинга duid демона по id проекта. Можно реализовать так:

```javascript
// Найти демон по ID проекта
function findDaemonByProjectId(projectId) {
  const state = require('./controllers/state').state();
  const mac = require('./mac')();
  
  // Проверяем текущий демон
  const daemon = state[mac];
  if (daemon && daemon.project === projectId) {
    return mac;
  }
  
  // Ищем среди всех объектов с типом "daemon"
  for (const [id, obj] of Object.entries(state)) {
    if (obj && obj.type === 'daemon' && obj.project === projectId) {
      return id;
    }
  }
  
  return null;
}
```

## Проверка структуры БД

Для проверки структуры хранения используйте скрипт:

```bash
node scripts/inspect-daemon-project-storage.js [путь_к_бд]
```

Скрипт выведет:
- Ключ `"mac"` и его значение (UUID демона)
- Объект демона с полем `project`
- Объект проекта по ID из поля `project` демона
- Схему связей между записями

## Примеры использования

### Получение ID демона
```javascript
const mac = require('./src/mac');
const daemonId = mac(); // Возвращает UUID демона
```

### Получение ID проекта из демона
```javascript
const mac = require('./src/mac');
const { get } = require('./src/actions');
const daemonId = mac();
const daemon = get(daemonId);
const projectId = daemon.project; // ID проекта
```

### Получение объекта проекта
```javascript
const mac = require('./src/mac');
const { get } = require('./src/actions');
const daemonId = mac();
const daemon = get(daemonId);
const projectId = daemon.project;
const project = get(projectId); // Объект проекта
```

## Важные замечания

1. **ID демона** всегда хранится в ключе `"mac"` и используется как ключ для объекта демона
2. **ID проекта** хранится в поле `project` объекта демона
3. **Связь односторонняя**: демон → проект (нет обратной ссылки от проекта к демону)
4. **Тип объекта** определяется полем `type` в значении записи БД
5. **Все записи** содержат поле `timestamp` для отслеживания изменений
