# Справочник Daemon ID и известных UUID в системе

**Дата:** 2025-12-12  
**Версия:** 1.0

---

## Оглавление

1. [Daemon ID](#daemon-id)
2. [Типы UUID в системе](#типы-uuid-в-системе)
3. [Известные UUID из документации](#известные-uuid-из-документации)
4. [Генерация и хранение](#генерация-и-хранение)
5. [Использование](#использование)

---

## Daemon ID

### Что это

**Daemon ID** (`fd6765f1-ed61-4ae4-8d72-9a078a9f4316`) — это **уникальный идентификатор демона ReactHome** (проект **pochta**, "Почтовая", ЖК Архитекторов).

**Альтернативные названия:**
- `mac` (в коде)
- `daemonId` (в некоторых модулях)
- Daemon UUID

### Характеристики

- **Тип:** UUID v4
- **Формат:** `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
- **Хранение:** LevelDB, ключ `"mac"`
- **Генерация:** При первом запуске демона (если отсутствует)
- **Постоянство:** Сохраняется между перезапусками

### Код генерации

**Файл:** `daemon.js` (строки 96-99)

```javascript
if (!init.mac) {
  init.mac = v4();  // Генерация UUID v4
  db.put("mac", init.mac);  // Сохранение в LevelDB
}
```

### Использование

**1. Идентификация демона в gateway:**
```
wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316
```

**2. Ключ для хранения состояния демона:**
```javascript
// В БД хранится объект под ключом daemonId
init[init.mac] = {
  type: DAEMON,
  token: [],
  // ... другие поля
}
```

**3. Инициализация модулей:**
```javascript
discovery.start(init.mac);
websocket.start(init.mac);
start(init.mac);
set(init.mac, { token: [] });
```

**4. Логирование событий:**
```javascript
const daemonId = process.env.MAC || 'unknown';
// Используется в event-logger для идентификации источника
```

---

## Типы UUID в системе

### 1. Daemon ID (DAEMON)

**Тип:** `"daemon"` или `DAEMON`  
**Примеры:** 
- `fd6765f1-ed61-4ae4-8d72-9a078a9f4316` — pochta (Почтовая, Архитекторов)
- `d31775ae-19e8-40c9-81df-d6d672379563` — mindal (Лучистое, Миндальный)  
**Назначение:** Идентификация демона ReactHome  
**Хранение:** LevelDB ключ `"mac"`  
**Количество:** 1 на инстанс демона  
**Известные демоны:** 2 (pochta и mindal)

**Соответствия названий:**
- **Почтовая** = **Архитекторов** = `fd6765f1-ed61-4ae4-8d72-9a078a9f4316`
- **Лучистое** = **Миндальный** = `d31775ae-19e8-40c9-81df-d6d672379563`

---

### 2. Project (PROJECT)

**Тип:** `"project"`  
**Пример:** `a5b0a8f3-fe41-4235-b602-3a09e1eeddbb`  
**Назначение:** Идентификация проекта  
**Хранение:** LevelDB, ключ = UUID  
**Связи:**
- Содержит массивы: `device[]`, `driver[]`, `site[]`, `script[]`, `timer[]`, `schedule[]`
- Может иметь `onStart` (UUID скрипта запуска)

**Структура:**
```json
{
  "type": "project",
  "title": "Название проекта",
  "device": ["uuid1", "uuid2"],
  "site": ["site-uuid1", "site-uuid2"],
  "script": ["script-uuid1"],
  "onStart": "script-uuid-start"
}
```

---

### 3. Site (SITE)

**Тип:** `"site"`  
**Пример:** `6b1afa99-9c1e-496e-8bd4-be7e90b71c8d` (Лоджия)  
**Назначение:** Идентификация локации/помещения  
**Хранение:** LevelDB, ключ = UUID  
**Связи:**
- `project` — UUID родительского проекта
- `site` — массив UUID дочерних локаций
- `light_220[]`, `light_LED[]`, `light_RGB[]` — массивы UUID каналов освещения
- `sensor[]` — массив UUID датчиков

**Структура:**
```json
{
  "type": "site",
  "title": "Лоджия",
  "code": "6",
  "project": "project-uuid",
  "site": [],
  "light_220": ["channel-uuid-1", "channel-uuid-2"],
  "light_LED": ["channel-uuid-3"]
}
```

**Известные локации:**
- `6b1afa99-9c1e-496e-8bd4-be7e90b71c8d` — Лоджия

---

### 4. Script (SCRIPT)

**Тип:** `"script"`  
**Пример:** `e6a8ddef-fa24-4cb6-b494-3619d52cb650` (Наш Скрипт A)  
**Назначение:** Идентификация скрипта автоматизации  
**Хранение:** LevelDB, ключ = UUID  
**Связи:**
- `site` — UUID локации (опционально)
- `action[]` — массив UUID действий
- `onStart` — может быть в project

**Структура:**
```json
{
  "type": "script",
  "title": "Наш Скрипт A",
  "code": "Скрипт A использумый скриптом В и использующий скрипт Б",
  "action": ["action-uuid-1", "action-uuid-2"],
  "site": "site-uuid",
  "disabled": false
}
```

**Известные скрипты:**
- `e6a8ddef-fa24-4cb6-b494-3619d52cb650` — "Наш Скрипт A"
- `41f41ead-...` — "работа лоджия"
- `9de6ce97-...` — "Start"
- `83db5b75-fa69-42f9-bd57-ee9f33d59ed7` — "Лоджия спот"
- `d21fb8e9-e1da-45b0-a9d2-0ab4cb775a6a` — действие переключения

---

### 5. Action (ACTION_*)

**Тип:** `"ACTION_ON"`, `"ACTION_OFF"`, `"ACTION_SCRIPT_RUN"`, и т.д.  
**Пример:** `d21fb8e9-e1da-45b0-a9d2-0ab4cb775a6a`  
**Назначение:** Идентификация действия  
**Хранение:** LevelDB, ключ = UUID  
**Связи:**
- `script` — UUID скрипта-владельца (для ACTION_SCRIPT_RUN)
- `payload.id` — UUID цели действия (устройство, скрипт, и т.д.)

**Структура:**
```json
{
  "type": "ACTION_SCRIPT_RUN",
  "payload": {
    "id": "script-uuid"
  },
  "delay": 0,
  "script": "owner-script-uuid"
}
```

**Типы действий:**
- `ACTION_ON` — включить устройство
- `ACTION_OFF` — выключить устройство
- `ACTION_TOGGLE` — переключить
- `ACTION_DIM` — установить яркость
- `ACTION_SCRIPT_RUN` — запустить скрипт
- И другие (см. `src/constants.js`)

---

### 6. Device (физические устройства)

**Тип:** Числовой (0x0a-0xff) или строковый  
**ID:** MAC-адрес (физические) или UUID (логические)  
**Примеры:**
- Физические: `54:10:ec:19:ce:8b` (RELAY_12, R1)
- Логические: `1853560d-089f-4df7-ac2f-9043f62dcffd` (fan, Вытяжка)

**Хранение:** LevelDB, ключ = MAC или UUID  
**Связи:**
- `site` — UUID локации
- `bind` — привязка к актуатору/каналу
- Каналы: `{MAC}/do/{N}`, `{MAC}/dim/{N}`, `{MAC}/group/{N}`

**Известные устройства:**
- `54:10:ec:19:ce:8b` — RELAY_12 (R1)
- `54:10:ec:19:c4:e8` — RELAY_12 (R2)
- `68:27:19:e4:2a:87` — актуатор (MIX или другой)
- `20:32:84:c9:e6:e9` — S3/S4 модуль
- `1853560d-089f-4df7-ac2f-9043f62dcffd` — Вытяжка (fan)
- `f56f532a-940e-42bb-8526-13a41e529590` — Вытяжка (fan)
- `1da0da36-d0c4-4e7a-ba66-3cae163127e8` — Штора "Старшая рулонная"
- `34731215-af9b-4847-b2f9-67c8940271c0` — Канал освещения

---

### 7. Channel (каналы устройств)

**Тип:** Строковый (путь)  
**Формат:** `{MAC-адрес}/{kind}/{index}`  
**Примеры:**
- `54:10:ec:19:ce:8b/do/1` — реле 1 актуатора R1
- `54:10:ec:19:ce:8b/group/3` — группа 3 актуатора R1
- `68:27:19:e4:2a:87/dim/3` — диммер 3
- `20:32:84:c9:e6:e9/di/4` — цифровой вход 4

**Хранение:** LevelDB, ключ = полный путь  
**Связи:**
- `bind` — UUID устройства-потребителя (прямая привязка)
- Устройства ссылаются через `bind = "{MAC}/{kind}/{index}"` (обратная привязка)

---

### 8. Timer (TIMER)

**Тип:** `"timer"`  
**Назначение:** Идентификация таймера  
**Хранение:** LevelDB, ключ = UUID  
**Связи:**
- `project` — UUID проекта
- `action` — UUID действия при срабатывании

---

### 9. Schedule (SCHEDULE)

**Тип:** `"schedule"`  
**Назначение:** Идентификация расписания  
**Хранение:** LevelDB, ключ = UUID  
**Связи:**
- `project` — UUID проекта
- `action` — UUID действия

---

### 10. Driver (DRIVER)

**Тип:** Числовой или строковый  
**ID:** UUID  
**Назначение:** Идентификация драйвера (ArtNet, DALI, и т.д.)  
**Хранение:** LevelDB, ключ = UUID

---

## Известные UUID из документации

### Daemon ID

| UUID | Проект | Название | Альтернативные названия | Источник |
|------|--------|----------|-------------------------|----------|
| `fd6765f1-ed61-4ae4-8d72-9a078a9f4316` | **pochta** | **Почтовая** | Архитекторов | Реальный демон |
| `d31775ae-19e8-40c9-81df-d6d672379563` | **mindal** | **Лучистое** | Миндальный | Реальный демон |

### Локации (Sites)

| UUID | Название | Код | Источник |
|------|----------|-----|----------|
| `6b1afa99-9c1e-496e-8bd4-be7e90b71c8d` | Лоджия | `6` | `docs/LODGIA_LIGHT_CONTROL_GUIDE.md` |
| `b9e650c7-c896-4987-a9d7-532e47dd0aee` | (не указано) | — | Отчёты |
| `7669d319-f98f-41a0-a021-97c808442481` | (не указано) | — | Отчёты |
| `05c72b5a-77c9-4f70-861e-2b978bc237c8` | (не указано) | — | Отчёты |
| `d3c99514-d451-46bb-b2dc-6d74d842a11` | (не указано) | — | Отчёты |
| `de73d6d9-b32a-43f9-8c21-1e4acab162d6` | (не указано) | — | Отчёты |

### Скрипты

| UUID | Название | Код | Источник |
|------|----------|-----|----------|
| `e6a8ddef-fa24-4cb6-b494-3619d52cb650` | Наш Скрипт A | "Скрипт A использумый..." | `reports/SCRIPTS_OVERVIEW.md` |
| `41f41ead-...` | работа лоджия | — | `reports/SCRIPTS_OVERVIEW.md` |
| `9de6ce97-...` | Start | — | `reports/SCRIPTS_OVERVIEW.md` |
| `83db5b75-fa69-42f9-bd57-ee9f33d59ed7` | Лоджия спот | — | `docs/SCRIPT_EXECUTION_BY_CODE.md` |
| `d21fb8e9-e1da-45b0-a9d2-0ab4cb775a6a` | 6.D.L.3 Toggle | "Лоджия спот" | `docs/SCRIPT_METADATA.md` |

### Устройства (логические)

| UUID | Тип | Название | Источник |
|------|-----|----------|----------|
| `1853560d-089f-4df7-ac2f-9043f62dcffd` | fan | Вытяжка (Ванная) | Отчёты |
| `f56f532a-940e-42bb-8526-13a41e529590` | fan | Вытяжка (Душ) | Отчёты |
| `1da0da36-d0c4-4e7a-ba66-3cae163127e8` | curtains | Старшая рулонная | Отчёты |
| `3dee0ccf-23cb-4b38-a4ae-d76c3aa8b007` | curtains | 1.R2.C.2 | Отчёты |
| `658c4081-fbc6-412a-adba-33d63f16e513` | curtains | 1.R2.C.1 | Отчёты |
| `c8919f33-440c-484b-a441-4c00fef83598` | curtains | Раздвижные | Отчёты |
| `34731215-af9b-4847-b2f9-67c8940271c0` | light_220 | (канал освещения) | `docs/LODGIA_LIGHT_CONTROL_GUIDE.md` |
| `8828b19b-55b6-4f88-ac6b-20c41b02f1ad` | light_220 | (канал освещения) | `docs/LODGIA_LIGHT_CONTROL_GUIDE.md` |

### Устройства (физические, MAC-адреса)

| MAC | Тип | Название | Источник |
|-----|-----|----------|----------|
| `54:10:ec:19:ce:8b` | RELAY_12 (0xa1) | R1 | Отчёты |
| `54:10:ec:19:c4:e8` | RELAY_12 (0xa1) | R2 | Отчёты |
| `68:27:19:e4:2a:87` | (актуатор) | — | Отчёты |
| `20:32:84:c9:e6:e9` | S3/S4 | — | Отчёты |
| `40:f4:71:fc:f8:4d` | SMART_BOTTOM_1 | — | Отчёты |
| `50:35:7b:77:df:ce` | SMART_TOP_A4T | — | Отчёты |
| `50:95:8e:e9:75:02` | DOPPLER_1_DI_4 | — | Отчёты |

---

## Генерация и хранение

### Генерация UUID

**Метод:** UUID v4 (случайный)  
**Библиотека:** `uuid` (npm)  
**Функция:** `v4()`

**Примеры генерации:**
```javascript
const { v4 } = require("uuid");
const daemonId = v4();  // fd6765f1-ed61-4ae4-8d72-9a078a9f4316
```

### Хранение в LevelDB

**Ключ:** UUID (для всех сущностей)  
**Значение:** JSON объект с полями сущности

**Структура:**
```
LevelDB:
  "mac" → "fd6765f1-ed61-4ae4-8d72-9a078a9f4316"  // Daemon ID
  "fd6765f1-ed61-4ae4-8d72-9a078a9f4316" → { type: "daemon", token: [] }
  "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d" → { type: "site", title: "Лоджия", ... }
  "e6a8ddef-fa24-4cb6-b494-3619d52cb650" → { type: "script", title: "Наш Скрипт A", ... }
  "54:10:ec:19:ce:8b" → { type: 161, code: "R1", ... }
  "54:10:ec:19:ce:8b/do/1" → { value: 0, bind: "uuid", ... }
```

---

## Использование

### Получение Daemon ID

**1. Из переменной окружения:**
```bash
export MAC=fd6765f1-ed61-4ae4-8d72-9a078a9f4316
```

**2. Из БД:**
```javascript
const db = require("./src/db");
const daemonId = await db.get("mac");
```

**3. Из состояния:**
```javascript
const init = {};
for await (const [key, value] of db.iterator()) {
  init[key] = value;
}
const daemonId = init.mac;
```

### Подключение через Gateway

**URL:**
```
wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316
```

**Subprotocol:**
```javascript
websocket = await websockets.connect(
  "wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316",
  subprotocols=["listen"]
);
```

### Поиск UUID по названию

**Скрипты:**
```bash
node scripts/find-script-by-name.js "Start"
node scripts/search-script-in-db.js "Лоджия спот"
```

**Локации:**
```bash
node scripts/get-site-name.js <SITE_UUID>
node scripts/list-devices-by-site.js <SITE_UUID>
```

**Устройства:**
```bash
node scripts/find-device-by-name.js "R1"
node scripts/find-device-by-uuid.js <UUID>
```

---

## Иерархия UUID

```
fd6765f1-ed61-4ae4-8d72-9a078a9f4316 (DAEMON)
  │
  ├── project-uuid (PROJECT)
  │   ├── site-uuid-1 (SITE)
  │   │   ├── device-uuid-1 (DEVICE)
  │   │   ├── script-uuid-1 (SCRIPT)
  │   │   └── channel: MAC/do/1
  │   │
  │   ├── script-uuid-2 (SCRIPT)
  │   │   └── action-uuid-1 (ACTION_SCRIPT_RUN)
  │   │       └── script-uuid-3 (SCRIPT)  // Вызываемый скрипт
  │   │
  │   └── timer-uuid-1 (TIMER)
  │
  └── 54:10:ec:19:ce:8b (DEVICE, физический)
      ├── 54:10:ec:19:ce:8b/do/1 (CHANNEL)
      ├── 54:10:ec:19:ce:8b/do/2 (CHANNEL)
      └── 54:10:ec:19:ce:8b/group/3 (GROUP)
```

---

## См. также

- **Структура проекта:** `docs/PROJECT_DESCRIPTION.md`
- **WebSocket API:** `docs/WEBSOCKET_API_REFERENCE.md`
- **Метаинформация скриптов:** `docs/SCRIPT_METADATA.md`
- **Управление лоджией:** `docs/LODGIA_LIGHT_CONTROL_GUIDE.md`
- **Типы устройств:** `docs/06-devices/DEVICE_TYPES_AND_BINDINGS.md`

---

**Документ:** `docs/DAEMON_ID_AND_UUID_REFERENCE.md`  
**Дата:** 2025-12-12  
**Автор:** Жекин Ассистент

