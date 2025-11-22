# WebSocket API Reference - Полное описание API

**Дата создания:** 2025-11-16  
**Версия:** 1.0  
**Порт:** 3000  
**Протокол:** WebSocket (JSON)

## Содержание

1. [Обзор](#обзор)
2. [Подключение](#подключение)
3. [Формат сообщений](#формат-сообщений)
4. [Типы сообщений](#типы-сообщений)
5. [Команды управления](#команды-управления)
6. [Примеры использования](#примеры-использования)
7. [Обработка ошибок](#обработка-ошибок)
8. [Лучшие практики](#лучшие-практики)

---

## Обзор

WebSocket API на порту 3000 предоставляет единый интерфейс для управления системой ReactHome Daemon. Все сообщения передаются в формате JSON через WebSocket соединение.

### Основные возможности

- ✅ Управление состоянием объектов (устройства, локации, скрипты)
- ✅ Выполнение команд управления устройствами
- ✅ Запуск скриптов и автоматизаций
- ✅ Получение данных о состоянии системы
- ✅ Управление камерами и медиа
- ✅ Работа с SIP и Janus WebRTC
- ✅ Терминальный доступ

### Архитектура

```
Клиент → WebSocket (порт 3000) → handle.js → Диспетчеры
                                      ↓
                            service.js (команды)
                            actions (состояние)
                            camera (камеры)
                            sip (звонки)
                            janus (WebRTC)
```

---

## Подключение

### URL подключения

#### Локальное подключение
```
ws://<host>:3000
```

**Пример:**
```
ws://192.168.88.4:3000
```

#### Удалённое подключение через Gateway
```
wss://gate.reacthome.net/<mac-address>
```

**Пример:**
```
wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316
```

**Протокол:** При подключении к gateway необходимо указать subprotocol `listen`:
```python
websocket = await websockets.connect(
    "wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316",
    subprotocols=["listen"]
)
```

### Установка соединения

#### Локальное подключение

При подключении к локальному серверу (`ws://<host>:3000`) сервер автоматически:
1. Создаёт уникальную сессию (UUID) для клиента
2. Регистрирует клиента в системе пиров (peers)
3. Готов принимать команды

**Код сервера:** `src/websocket/server.js`

```javascript
server.on("connection", (socket) => {
  const session = uuid(); // Генерируется UUID сессии
  peers.set(session, {
    session,
    online: true,
    state: "active",
    timestamp: Date.now(),
    send(message, cb) {
      socket.send(JSON.stringify(message), cb);
    },
  });
});
```

#### Удалённое подключение через Gateway

При подключении к gateway (`wss://gate.reacthome.net/<mac>`) процесс следующий:

1. **Клиент подключается** к gateway с subprotocol `listen`
2. **Gateway создаёт session ID** (UUID) для клиента
3. **Gateway проксирует сообщения** к демону, добавляя session ID как префикс
4. **Демон получает сообщения** в формате: `{session_id}{json_message}`

**⚠️ КРИТИЧЕСКИ ВАЖНО: Session ID добавляется gateway сервером**

**Клиент НЕ должен добавлять session ID к сообщениям!**

```python
# ✅ ПРАВИЛЬНО - отправляем чистый JSON
await websocket.send(json.dumps({
    "type": "ACTION_SCRIPT_RUN",
    "id": "script-uuid"
}))

# ❌ НЕПРАВИЛЬНО - НЕ добавляйте session ID!
# Это приведёт к двойному префиксу и ошибке парсинга JSON
session_id = "123e4567-e89b-12d3-a456-426614174000"
await websocket.send(session_id + json.dumps({
    "type": "ACTION_SCRIPT_RUN",
    "id": "script-uuid"
}))
```

**Что происходит при двойном session ID:**
- Клиент отправляет: `{session_id_1}{json}`
- Gateway добавляет: `{session_id_2}{session_id_1}{json}`
- Демон получает: `{session_id_2}{session_id_1}{json}`
- Демон пытается распарсить `{session_id_1}{json}` как JSON → **Ошибка!**

**Код gateway:** `src/websocket/gate.js`

```javascript
socket.on("message", (data) => {
  const dataStr = typeof data === 'string' ? data : data.toString('utf8');
  const session = dataStr.substring(0, 36); // Извлекаем session ID
  const message = dataStr.substring(36);     // Остальное - JSON
  // ...
  handle(session, message);
});
```

### Сессия

- Каждое подключение получает уникальный UUID сессии
- При локальном подключении сессия создаётся сервером
- При подключении через gateway сессия создаётся gateway сервером
- Сессия используется для маршрутизации ответов
- При отключении сессия удаляется автоматически

---

## Формат сообщений

### Входящие сообщения (клиент → сервер)

Все сообщения должны быть валидным JSON:

```json
{
  "type": "ТИП_СООБЩЕНИЯ",
  ...дополнительные_поля
}
```

### Исходящие сообщения (сервер → клиент)

Сервер отправляет JSON сообщения:

```json
{
  "type": "ТИП_СООБЩЕНИЯ",
  "id": "uuid-объекта",
  "payload": {...},
  ...дополнительные_поля
}
```

### Кодировка

- Все сообщения в кодировке UTF-8
- JSON должен быть валидным
- Поддерживаются Unicode символы (включая кириллицу)

---

## Типы сообщений

### 1. Управление состоянием

#### `ACTION_SET`

Обновление состояния объекта в системе.

**Запрос:**
```json
{
  "type": "ACTION_SET",
  "id": "uuid-объекта",
  "payload": {
    "field1": "value1",
    "field2": "value2"
  }
}
```

**Параметры:**
- `id` (string, обязательное) - UUID объекта
- `payload` (object, обязательное) - данные для обновления

**Ответ:**
Сервер транслирует обновление всем подключённым клиентам:

```json
{
  "type": "ACTION_SET",
  "id": "uuid-объекта",
  "payload": {
    "field1": "value1",
    "field2": "value2",
    "timestamp": 1763322698986
  }
}
```

**Особенности:**
- Поле `timestamp` добавляется автоматически
- Если `payload.title` или `payload.code` изменены, инициализируется Assist
- Обновление сохраняется в LevelDB
- Транслируется через `broadcast` всем клиентам

**Пример:**
```json
{
  "type": "ACTION_SET",
  "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7",
  "payload": {
    "title": "Новое название",
    "disabled": false
  }
}
```

**Код:** `src/websocket/handle.js:30-38`

---

#### `ACTION_ADD`

Добавление значения в массив поля объекта.

**Запрос:**
```json
{
  "type": "ACTION_ADD",
  "id": "uuid-объекта",
  "ref": "field_name",
  "value": "value_to_add"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID объекта
- `ref` (string, обязательное) - имя поля (массив)
- `value` (any, обязательное) - значение для добавления

**Пример:**
```json
{
  "type": "ACTION_ADD",
  "id": "site-uuid",
  "ref": "script",
  "value": "script-uuid"
}
```

**Код:** `src/websocket/handle.js:40-43`

---

#### `ACTION_DEL`

Удаление значения из массива поля объекта.

**Запрос:**
```json
{
  "type": "ACTION_DEL",
  "id": "uuid-объекта",
  "ref": "field_name",
  "value": "value_to_remove"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID объекта
- `ref` (string, обязательное) - имя поля (массив)
- `value` (any, обязательное) - значение для удаления

**Пример:**
```json
{
  "type": "ACTION_DEL",
  "id": "site-uuid",
  "ref": "script",
  "value": "script-uuid"
}
```

**Код:** `src/websocket/handle.js:45-48`

---

#### `ACTION_MAKE_BIND` / `ACTION_ADD_BIND`

Создание привязок между объектами.

**Запрос:**
```json
{
  "type": "ACTION_MAKE_BIND",
  "id": "uuid-объекта-1",
  "ref": "field_name",
  "value": "uuid-объекта-2",
  "bind": "bind_type"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID исходного объекта
- `ref` (string, обязательное) - имя поля
- `value` (string, обязательное) - UUID целевого объекта
- `bind` (string, опциональное) - тип привязки

**Код:** `src/websocket/handle.js:50-58`

---

### 2. Запросы данных

#### `LIST`

Получение списка всех объектов в системе.

**Запрос:**
```json
{
  "type": "list"
}
```

**Ответ:**
```json
{
  "type": "list",
  "state": [
    ["uuid1", timestamp1],
    ["uuid2", timestamp2],
    ...
  ],
  "assets": [
    "image1.png",
    "image2.jpg",
    ...
  ]
}
```

**Параметры ответа:**
- `state` (array, обязательное) - массив `[uuid, timestamp]` для каждого объекта
- `assets` (array, обязательное) - список доступных ассетов (изображений)

**Особенности:**
- Возвращает только объекты с полем `timestamp`
- `timestamp` - время последнего обновления объекта
- Используется для синхронизации состояния

**Пример использования:**
```python
await websocket.send(json.dumps({"type": "list"}))
response = await websocket.recv()
data = json.loads(response)
if data.get("type") == "list":
    for uuid, timestamp in data.get("state", []):
        print(f"Object: {uuid}, updated: {timestamp}")
```

**Код:** `src/websocket/handle.js:69-71`, `src/init/list.js`

---

#### `GET`

Получение данных конкретных объектов.

**Запрос:**
```json
{
  "type": "get",
  "state": ["uuid1", "uuid2", ...],
  "assets": ["image.png", ...]
}
```

**Параметры:**
- `state` (array[string], опциональное) - массив UUID объектов
- `assets` (array[string], опциональное) - массив имён ассетов

**Ответ:**
Сервер отправляет серию сообщений:

1. Для каждого объекта в `state`:
```json
{
  "type": "ACTION_SET",
  "id": "uuid-объекта",
  "payload": {
    ...полные_данные_объекта
  }
}
```

2. Для каждого ассета в `assets`:
```json
{
  "type": "ACTION_ASSET",
  "name": "image.png",
  "payload": "base64-encoded-data"
}
```

**Пример:**
```json
// Запрос
{
  "type": "get",
  "state": ["83db5b75-fa69-42f9-bd57-ee9f33d59ed7"]
}

// Ответ
{
  "type": "ACTION_SET",
  "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7",
  "payload": {
    "type": "script",
    "title": "6.D.L.3 Toggle",
    "code": "Лоджия спот",
    "action": ["d21fb8e9-e1da-45b0-a9d2-0ab4cb775a6a"],
    "timestamp": 1763322698986,
    "modified": 1763322695786
  }
}
```

**Особенности:**
- Можно запросить несколько объектов одновременно
- Ассеты возвращаются в формате base64
- Если объект не найден, сообщение не отправляется
- **GET работает как через локальное подключение, так и через gateway**

**Пример через gateway:**
```python
# Подключение к gateway
websocket = await websockets.connect(
    "wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316",
    subprotocols=["listen"]
)

# Отправка GET запроса (без session ID префикса!)
await websocket.send(json.dumps({
    "type": "get",
    "state": ["34731215-af9b-4847-b2f9-67c8940271c0"]
}))

# Получение ответа (gateway автоматически добавит session ID)
response = await websocket.recv()
# Gateway отправляет: {session_id}{json_message}
# Нужно удалить первые 36 символов (session ID)
data = json.loads(response[36:])  # Удаляем session ID префикс
```

**Код:** `src/websocket/handle.js:77-79`, `src/init/get.js`

---

### 3. Выполнение команд

Все команды управления устройствами и системой отправляются как JSON с полем `type`. Неизвестные типы автоматически передаются в `service.run(action)`.

#### `ACTION_SCRIPT_RUN`

Выполнение скрипта.

**Запрос:**
```json
{
  "type": "ACTION_SCRIPT_RUN",
  "id": "uuid-скрипта"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID скрипта

**Процесс выполнения:**
1. Получение скрипта из state: `const script = get(id)`
2. Проверка `disabled` - если `true`, выполнение прерывается
3. Для каждого действия в `script.action`:
   - Получение данных действия: `const { type, payload, delay } = get(action_id)`
   - Формирование команды: `{ action: action_id, type, ...payload }`
   - Если `delay > 0`: выполнение с задержкой через `setTimeout`
   - Иначе: немедленное выполнение через `run(action)`

**Пример:**
```json
{
  "type": "ACTION_SCRIPT_RUN",
  "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7"
}
```

**Ответ:**
Сервер не отправляет явного подтверждения. Вместо этого транслируются обновления состояния устройств, затронутых выполнением скрипта.

**Код:** `src/controllers/service.js:3158-3173`

**См. также:** [SCRIPT_METADATA.md](./SCRIPT_METADATA.md)

---

#### `ACTION_SITE_LIGHT_ON`

Включение всего освещения в локации.

**Запрос:**
```json
{
  "type": "ACTION_SITE_LIGHT_ON",
  "id": "uuid-локации"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID локации (Site)

**Процесс:**
1. Получение локации: `const site = get(id)`
2. Рекурсивный обход дочерних локаций через `applySite`
3. Для каждого канала в `light_220`, `light_LED`, `light_RGB`:
   - Выполнение `ACTION_ON` для канала

**Пример:**
```json
{
  "type": "ACTION_SITE_LIGHT_ON",
  "id": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d"
}
```

**Код:** `src/controllers/service.js:120`, `src/actions/create.js:applySite`

---

#### `ACTION_SITE_LIGHT_OFF`

Выключение всего освещения в локации.

**Запрос:**
```json
{
  "type": "ACTION_SITE_LIGHT_OFF",
  "id": "uuid-локации"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID локации (Site)

**Процесс:** Аналогичен `ACTION_SITE_LIGHT_ON`, но выполняет `ACTION_OFF` для каждого канала.

**Код:** `src/controllers/service.js:27`

---

#### `ACTION_ON`

Включение устройства или канала.

**Запрос:**
```json
{
  "type": "ACTION_ON",
  "id": "uuid-устройства-или-канала"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID устройства или канала

**Пример:**
```json
{
  "type": "ACTION_ON",
  "id": "34731215-af9b-4847-b2f9-67c8940271c0"
}
```

---

#### `ACTION_OFF`

Выключение устройства или канала.

**Запрос:**
```json
{
  "type": "ACTION_OFF",
  "id": "uuid-устройства-или-канала"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID устройства или канала

---

#### `ACTION_TOGGLE`

Переключение состояния устройства или канала.

**Запрос:**
```json
{
  "type": "ACTION_TOGGLE",
  "id": "uuid-устройства-или-канала"
}
```

**Параметры:**
- `id` (string, обязательное) - UUID устройства или канала

**Пример:**
```json
{
  "type": "ACTION_TOGGLE",
  "id": "34731215-af9b-4847-b2f9-67c8940271d0"
}
```

---

#### `ACTION_DIM`

Установка яркости устройства.

**Запрос:**
```json
{
  "type": "ACTION_DIM",
  "id": "uuid-устройства",
  "value": 50
}
```

**Параметры:**
- `id` (string, обязательное) - UUID устройства
- `value` (number, обязательное) - значение яркости (0-100)

---

### 4. Другие типы сообщений

#### `ACTION_ASSET`

Загрузка файла (ассета) в систему.

**Запрос:**
```json
{
  "type": "ACTION_ASSET",
  "name": "image.png",
  "payload": "base64-encoded-data"
}
```

**Параметры:**
- `name` (string, обязательное) - имя файла
- `payload` (string, обязательное) - содержимое файла в base64

**Процесс:**
1. Декодирование base64 данных
2. Сохранение файла в директорию ассетов
3. Трансляция `LIST` с обновлённым списком ассетов

**Код:** `src/websocket/handle.js:60-67`

---

#### `TOKEN`

Регистрация push-токена для уведомлений.

**Запрос:**
```json
{
  "type": "token",
  "token": "fcm-token-or-apns-token",
  "platform": "ios" | "android"
}
```

**Параметры:**
- `token` (string, обязательное) - push-токен
- `platform` (string, обязательное) - платформа: `"ios"` или `"android"`

**Особенности:**
- Токен привязывается к текущей сессии
- При отключении токен удаляется автоматически

**Код:** `src/websocket/handle.js:73-75`

---

#### `ACK`, `BYE`, `INFO`

SIP команды для управления звонками.

**Запрос:**
```json
{
  "type": "ACK",
  "call_id": "uuid-звонка",
  ...дополнительные_поля
}
```

**Особенности:**
- Если `call_id` указан, команда обрабатывается SIP-обработчиком
- Иначе транслируется всем клиентам через `broadcast`

**Код:** `src/websocket/handle.js:81-99`

---

#### `WATCH`, `START`, `STOP`, `PAUSE`

Команды управления камерами.

**Запрос:**
```json
{
  "type": "WATCH",
  "id": "uuid-камеры",
  ...дополнительные_поля
}
```

**Код:** `src/websocket/handle.js:101-115`

---

#### `KEEPALIVE`, `CANDIDATE`

Команды для Janus WebRTC.

**Запрос:**
```json
{
  "type": "KEEPALIVE",
  ...дополнительные_поля
}
```

**Код:** `src/websocket/handle.js:117-123`

---

#### `PTY`

Терминальные команды.

**Запрос:**
```json
{
  "type": "pty",
  "chunk": "ls\n",
  "rows": 24,
  "cols": 80
}
```

**Параметры:**
- `chunk` (string, обязательное) - команда или данные
- `rows` (number, опциональное) - количество строк терминала
- `cols` (number, опциональное) - количество столбцов терминала

**Ответ:**
```json
{
  "type": "pty",
  "chunk": "output from command"
}
```

**Код:** `src/websocket/handle.js:125-127`

---

#### `navigate`

Синхронизация навигации UI.

**Запрос:**
```json
{
  "type": "navigate",
  "path": "/location/123"
}
```

**Особенности:**
- Транслируется всем подключённым клиентам
- Используется для синхронизации состояния UI

**Код:** `src/websocket/handle.js:129-131`

---

#### `state`

Обновление состояния сессии клиента.

**Запрос:**
```json
{
  "type": "state",
  "value": "active" | "inactive" | ...
}
```

**Особенности:**
- Обновляет поле `peer.state` для текущей сессии
- Не транслируется другим клиентам

**Код:** `src/websocket/handle.js:133-135`

---

#### `ACTION_ASSIST`

Обработка голосовых команд.

**Запрос:**
```json
{
  "type": "ACTION_ASSIST",
  "payload": {
    "message": "включи свет в лоджии",
    "skill_application": "..."
  }
}
```

**Ответ:**
```json
{
  "type": "ACTION_ASSIST",
  "answer": "Выполняю: включение света в лоджии"
}
```

**Код:** `src/websocket/handle.js:137-139`

---

## Команды управления

Все команды, не обработанные явными обработчиками, передаются в `service.run(action)`. Это включает:

- `ACTION_ON`, `ACTION_OFF`, `ACTION_TOGGLE`
- `ACTION_DIM`, `ACTION_RGB`, `ACTION_SETPOINT`
- `ACTION_TIMER_START`, `ACTION_TIMER_STOP`
- `ACTION_SCHEDULE_START`, `ACTION_SCHEDULE_STOP`
- И другие команды из `src/constants.js`

**Полный список:** См. `src/constants.js` и `src/controllers/service.js`

---

## Примеры использования

### Python

#### Подключение и выполнение скрипта

```python
import asyncio
import json
import websockets

async def run_script(script_id: str):
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as websocket:
        # Выполнение скрипта
        command = {
            "type": "ACTION_SCRIPT_RUN",
            "id": script_id
        }
        await websocket.send(json.dumps(command))
        
        # Ожидание обновлений
        try:
            response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            print(json.loads(response))
        except asyncio.TimeoutError:
            print("Таймаут ожидания ответа")

asyncio.run(run_script("83db5b75-fa69-42f9-bd57-ee9f33d59ed7"))
```

#### Получение данных объекта

```python
async def get_object(uuid: str):
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as websocket:
        # Запрос данных
        await websocket.send(json.dumps({
            "type": "get",
            "state": [uuid]
        }))
        
        # Получение ответа
        response = await asyncio.wait_for(websocket.recv(), timeout=3.0)
        data = json.loads(response)
        if data.get("type") == "ACTION_SET" and data.get("id") == uuid:
            return data.get("payload")

payload = asyncio.run(get_object("83db5b75-fa69-42f9-bd57-ee9f33d59ed7"))
print(payload)
```

#### Включение света в локации

```python
async def turn_on_site_light(site_id: str):
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as websocket:
        command = {
            "type": "ACTION_SITE_LIGHT_ON",
            "id": site_id
        }
        await websocket.send(json.dumps(command))
        
        # Собираем обновления в течение 5 секунд
        updates = []
        deadline = asyncio.get_running_loop().time() + 5.0
        while asyncio.get_running_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(websocket.recv(), timeout=0.5)
                msg = json.loads(raw)
                if msg.get("type") == "ACTION_SET":
                    updates.append(msg)
            except asyncio.TimeoutError:
                continue
        
        return updates

updates = asyncio.run(turn_on_site_light("6b1afa99-9c1e-496e-8bd4-be7e90b71c8d"))
print(f"Получено {len(updates)} обновлений")
```

---

### JavaScript/Node.js

#### Подключение и выполнение скрипта

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://192.168.88.4:3000');

ws.on('open', () => {
  console.log('Подключение установлено');
  
  const command = {
    type: 'ACTION_SCRIPT_RUN',
    id: '83db5b75-fa69-42f9-bd57-ee9f33d59ed7'
  };
  
  ws.send(JSON.stringify(command));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('Получено сообщение:', message);
});

ws.on('error', (error) => {
  console.error('Ошибка WebSocket:', error);
});
```

#### Получение списка всех объектов

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://192.168.88.4:3000');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'list' }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.type === 'list') {
    console.log(`Найдено объектов: ${message.state.length}`);
    console.log(`Найдено ассетов: ${message.assets.length}`);
    
    // Получаем данные первых 10 объектов
    const first10 = message.state.slice(0, 10).map(([id]) => id);
    ws.send(JSON.stringify({
      type: 'get',
      state: first10
    }));
  } else if (message.type === 'ACTION_SET') {
    console.log(`Объект ${message.id}:`, message.payload);
  }
});
```

---

### wscat (командная строка)

#### Выполнение скрипта

```bash
echo '{"type":"ACTION_SCRIPT_RUN","id":"83db5b75-fa69-42f9-bd57-ee9f33d59ed7"}' | \
  npx --yes wscat -c ws://192.168.88.4:3000
```

#### Получение данных объекта

```bash
echo '{"type":"get","state":["83db5b75-fa69-42f9-bd57-ee9f33d59ed7"]}' | \
  npx --yes wscat -c ws://192.168.88.4:3000
```

#### Получение списка объектов

```bash
echo '{"type":"list"}' | npx --yes wscat -c ws://192.168.88.4:3000
```

#### Интерактивный режим

```bash
npx --yes wscat -c ws://192.168.88.4:3000
```

В интерактивном режиме можно отправлять команды:
```
{"type":"list"}
{"type":"get","state":["uuid"]}
{"type":"ACTION_SCRIPT_RUN","id":"uuid"}
```

---

## Обработка ошибок

### Ошибки подключения

Если сервер недоступен, WebSocket соединение не установится. Обрабатывайте ошибки подключения:

```python
try:
    async with websockets.connect(uri) as websocket:
        # работа с соединением
except websockets.exceptions.ConnectionClosed:
    print("Соединение закрыто")
except websockets.exceptions.InvalidURI:
    print("Неверный URI")
except Exception as e:
    print(f"Ошибка: {e}")
```

### Ошибки парсинга JSON

Если отправлен невалидный JSON, сервер логирует ошибку в консоль, но не отправляет ответ клиенту:

```javascript
// src/websocket/handle.js:145-147
catch (e) {
  console.error(e);
}
```

**Рекомендация:** Всегда проверяйте валидность JSON перед отправкой.

### Ошибки выполнения команд

Сервер не отправляет явных сообщений об ошибках. Если команда не может быть выполнена:

1. Проверьте логи сервера (`/home/pi/.pm2/logs/daemon-error.log`)
2. Убедитесь, что объект существует (используйте `GET`)
3. Проверьте, что объект не отключен (`disabled: true`)

### Таймауты

Используйте таймауты для всех операций:

```python
try:
    response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
except asyncio.TimeoutError:
    print("Таймаут ожидания ответа")
```

---

## Лучшие практики

### 1. Используйте UUID для идентификации

Всегда используйте UUID для идентификации объектов, а не названия:

```python
# ✅ Правильно
{"type": "ACTION_SCRIPT_RUN", "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7"}

# ❌ Неправильно (может не работать)
{"type": "ACTION_SCRIPT_RUN", "id": "Лоджия спот"}
```

### 2. Обрабатывайте асинхронные ответы

Сервер может отправлять несколько сообщений в ответ на один запрос:

```python
async def get_multiple_objects(uuids):
    await websocket.send(json.dumps({
        "type": "get",
        "state": uuids
    }))
    
    results = {}
    deadline = asyncio.get_running_loop().time() + 5.0
    
    while len(results) < len(uuids) and asyncio.get_running_loop().time() < deadline:
        response = await asyncio.wait_for(websocket.recv(), timeout=1.0)
        msg = json.loads(response)
        if msg.get("type") == "ACTION_SET" and msg.get("id") in uuids:
            results[msg.get("id")] = msg.get("payload")
    
    return results
```

### 3. Используйте таймауты

Всегда устанавливайте разумные таймауты:

```python
# Для быстрых операций
response = await asyncio.wait_for(websocket.recv(), timeout=2.0)

# Для длительных операций
response = await asyncio.wait_for(websocket.recv(), timeout=10.0)
```

### 4. Обрабатывайте обновления состояния

Сервер транслирует обновления состояния всем клиентам. Обрабатывайте их:

```python
async def listen_for_updates(websocket, target_ids):
    while True:
        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=1.0)
            msg = json.loads(raw)
            if msg.get("type") == "ACTION_SET" and msg.get("id") in target_ids:
                print(f"Обновление {msg.get('id')}: {msg.get('payload')}")
        except asyncio.TimeoutError:
            continue
```

### 5. Проверяйте существование объектов

Перед выполнением команд проверяйте, что объект существует:

```python
async def safe_run_script(script_id):
    # Сначала получаем данные скрипта
    await websocket.send(json.dumps({
        "type": "get",
        "state": [script_id]
    }))
    
    response = await asyncio.wait_for(websocket.recv(), timeout=3.0)
    msg = json.loads(response)
    
    if msg.get("type") == "ACTION_SET" and msg.get("id") == script_id:
        payload = msg.get("payload", {})
        if payload.get("disabled"):
            print("Скрипт отключен")
            return
        
        # Теперь безопасно выполняем
        await websocket.send(json.dumps({
            "type": "ACTION_SCRIPT_RUN",
            "id": script_id
        }))
    else:
        print("Скрипт не найден")
```

### 6. Логируйте операции

Логируйте все важные операции для отладки:

```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("Отправка команды: %s", command)
await websocket.send(json.dumps(command))

response = await websocket.recv()
logger.info("Получен ответ: %s", response)
```

### 7. Используйте переподключение

Реализуйте автоматическое переподключение при разрыве соединения:

```python
async def connect_with_reconnect(uri, max_retries=5):
    for attempt in range(max_retries):
        try:
            async with websockets.connect(uri) as websocket:
                return websocket
        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise
```

---

## Производительность

### Рекомендации

1. **Батчинг запросов:** Запрашивайте несколько объектов одновременно:
   ```json
   {"type": "get", "state": ["uuid1", "uuid2", "uuid3"]}
   ```

2. **Короткие таймауты:** Используйте короткие таймауты для быстрых операций (0.2-2 секунды)

3. **Ранний выход:** Прекращайте ожидание после получения нужных данных

4. **Кэширование:** Кэшируйте данные объектов, которые редко изменяются

### Ограничения

- Максимальный размер сообщения ограничен настройками WebSocket (обычно 1-16 MB)
- Длительные скрипты могут блокировать обработку других команд
- Большое количество одновременных подключений может снизить производительность

---

## Безопасность

### Текущие ограничения

- ❌ Сервер не требует аутентификации для локальных подключений
- ❌ Все команды выполняются с правами процесса демона
- ❌ Нет шифрования (используется `ws://`, а не `wss://`)

### Рекомендации

1. **Используйте только в доверенной сети**
2. **Для внешнего доступа используйте VPN или туннель**
3. **Ограничьте доступ к порту 3000 через firewall**
4. **Регулярно проверяйте логи на подозрительную активность**

---

## Gateway: Работа через удалённый шлюз

### Обзор

Gateway (`wss://gate.reacthome.net`) позволяет подключаться к демону удалённо через безопасное WebSocket соединение (WSS). Gateway проксирует сообщения между клиентом и демоном, добавляя session ID для маршрутизации.

### Подключение

```python
import websockets
import json

# Подключение к gateway
websocket = await websockets.connect(
    "wss://gate.reacthome.net/fd6765f1-ed61-4ae4-8d72-9a078a9f4316",
    subprotocols=["listen"]  # Обязательно указать subprotocol
)
```

### Формат сообщений

#### Отправка сообщений (клиент → gateway → демон)

**⚠️ КРИТИЧЕСКИ ВАЖНО:** Клиент отправляет **чистый JSON без префиксов**:

```python
# ✅ ПРАВИЛЬНО
await websocket.send(json.dumps({
    "type": "ACTION_SCRIPT_RUN",
    "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7"
}))
```

Gateway автоматически добавит session ID при маршрутизации к демону:
```
{session_id}{json_message}
```

#### Получение сообщений (демон → gateway → клиент)

Gateway отправляет сообщения с префиксом session ID (36 символов UUID):

```python
raw = await websocket.recv()
# raw = "123e4567-e89b-12d3-a456-426614174000{"type":"ACTION_SET",...}"

# Удаляем session ID префикс
session_id = raw[:36]
message = json.loads(raw[36:])
```

### Типичные ошибки

#### ❌ Ошибка: Двойной session ID

**Проблема:** Клиент добавляет session ID, gateway тоже добавляет → двойной префикс

```python
# ❌ НЕПРАВИЛЬНО
session_id = "123e4567-e89b-12d3-a456-426614174000"
await websocket.send(session_id + json.dumps({"type": "ACTION_SCRIPT_RUN", "id": "..."}))
```

**Результат:** Демон получает `{session_id_2}{session_id_1}{json}` и не может распарсить JSON

**Решение:** Отправлять чистый JSON, gateway сам добавит session ID

#### ❌ Ошибка: Не указан subprotocol

**Проблема:** Gateway требует subprotocol `listen`

```python
# ❌ НЕПРАВИЛЬНО
websocket = await websockets.connect("wss://gate.reacthome.net/...")
```

**Решение:** Указать subprotocol при подключении

```python
# ✅ ПРАВИЛЬНО
websocket = await websockets.connect(
    "wss://gate.reacthome.net/...",
    subprotocols=["listen"]
)
```

### Примеры использования

#### Выполнение скрипта через gateway

```python
import asyncio
import json
import websockets

async def run_script_via_gateway(script_id: str, mac_address: str):
    uri = f"wss://gate.reacthome.net/{mac_address}"
    
    async with websockets.connect(uri, subprotocols=["listen"]) as ws:
        # Отправляем команду (без session ID!)
        await ws.send(json.dumps({
            "type": "ACTION_SCRIPT_RUN",
            "id": script_id
        }))
        
        # Получаем ответы (с session ID префиксом)
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                # Удаляем session ID префикс
                message = json.loads(raw[36:])
                print(f"Получено: {message}")
            except asyncio.TimeoutError:
                break

asyncio.run(run_script_via_gateway(
    "83db5b75-fa69-42f9-bd57-ee9f33d59ed7",
    "fd6765f1-ed61-4ae4-8d72-9a078a9f4316"
))
```

#### GET запрос через gateway

```python
async def get_device_state_via_gateway(device_id: str, mac_address: str):
    uri = f"wss://gate.reacthome.net/{mac_address}"
    
    async with websockets.connect(uri, subprotocols=["listen"]) as ws:
        # Отправляем GET запрос
        await ws.send(json.dumps({
            "type": "get",
            "state": [device_id]
        }))
        
        # Получаем ответ
        raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
        message = json.loads(raw[36:])  # Удаляем session ID
        
        if message.get("type") == "ACTION_SET" and message.get("id") == device_id:
            return message.get("payload")
    
    return None
```

### Интеграционные тесты

Примеры работы с gateway можно найти в интеграционных тестах:

- `tests/integration/test_bra_device_detection_external.py` - тест работы через gateway
- Демонстрирует правильное подключение, отправку команд и обработку ответов

---

## См. также

- [WEBSOCKET_PORT_3000_GUIDE.md](./WEBSOCKET_PORT_3000_GUIDE.md) - краткое руководство
- [SCRIPT_METADATA.md](./SCRIPT_METADATA.md) - метаинформация скриптов
- [SCRIPT_EXECUTION_QUICK_START.md](./SCRIPT_EXECUTION_QUICK_START.md) - быстрый старт выполнения скриптов
- [SCRIPT_SEARCH_METHODOLOGY.md](./SCRIPT_SEARCH_METHODOLOGY.md) - методика поиска скриптов
- [LODGIA_LIGHT_CONTROL_GUIDE.md](./LODGIA_LIGHT_CONTROL_GUIDE.md) - управление освещением
- [gateway-logging-guide.md](./gateway-logging-guide.md) - руководство по логированию gateway

---

**Версия документа:** 1.1  
**Последнее обновление:** 2025-11-22

