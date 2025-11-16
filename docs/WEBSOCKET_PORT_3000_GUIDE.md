# Руководство: WebSocket сервер на порту 3000

**Дата создания:** 2025-11-16  
**Порт:** 3000  
**Протокол:** WebSocket

## Архитектура

### Компоненты

1. **Сервер** (`src/websocket/server.js`)
   - Создаёт WebSocket сервер на порту 3000
   - Генерирует уникальную сессию (UUID) для каждого подключения
   - Управляет пирами (peers) - активными подключениями

2. **Обработчик сообщений** (`src/websocket/handle.js`)
   - Парсит входящие JSON сообщения
   - Маршрутизирует по типу сообщения
   - Неизвестные типы передаются в `run(action)` для выполнения команд

3. **Диспетчер команд** (`src/controllers/service.js`)
   - Обрабатывает все команды управления
   - Выполняет скрипты через `ACTION_SCRIPT_RUN`
   - Управляет устройствами, локациями, таймерами

## Поддерживаемые типы сообщений

### Управление состоянием

#### `ACTION_SET`
Обновление состояния объекта.

```json
{"type": "ACTION_SET", "id": "uuid", "payload": {...}}
```

#### `ACTION_ADD`
Добавление значения в массив.

```json
{"type": "ACTION_ADD", "id": "uuid", "ref": "field", "value": "value"}
```

#### `ACTION_DEL`
Удаление значения из массива.

```json
{"type": "ACTION_DEL", "id": "uuid", "ref": "field", "value": "value"}
```

#### `ACTION_MAKE_BIND` / `ACTION_ADD_BIND`
Создание привязок между объектами.

```json
{"type": "ACTION_MAKE_BIND", "id": "uuid1", "ref": "field", "value": "uuid2"}
```

### Запросы данных

#### `LIST`
Получение списка всех объектов в state.

```json
{"type": "list"}
```

**Ответ:**
```json
{"type": "list", "state": [["uuid1", timestamp1], ["uuid2", timestamp2]], "assets": ["image1.png"]}
```

#### `GET`
Получение данных конкретных объектов.

```json
{"type": "get", "state": ["uuid1", "uuid2"], "assets": ["image.png"]}
```

**Ответ:** Серия сообщений `ACTION_SET` и `ACTION_ASSET`.

### Выполнение команд

Все команды управления отправляются как JSON с полем `type`:

```json
{"type": "ACTION_SITE_LIGHT_ON", "id": "uuid"}
{"type": "ACTION_ON", "id": "uuid"}
{"type": "ACTION_SCRIPT_RUN", "id": "script-uuid"}
```

**Неизвестные типы** автоматически передаются в `run(action)` для обработки.

### Другие типы

- `ACTION_ASSET` - загрузка файлов
- `TOKEN` - регистрация push-токенов
- `ACK`, `BYE`, `INFO` - SIP команды
- `WATCH`, `START`, `STOP`, `PAUSE` - управление камерами
- `KEEPALIVE`, `CANDIDATE` - Janus WebRTC
- `PTY` - терминальные команды
- `navigate`, `state` - синхронизация UI
- `ACTION_ASSIST` - голосовые команды

## Выполнение скриптов

### Команда

```json
{"type": "ACTION_SCRIPT_RUN", "id": "script-uuid"}
```

### Структура скрипта

Скрипт хранится в state с полями:

```json
{
  "id": "script-uuid",
  "type": "script",
  "title": "Название скрипта",
  "disabled": false,
  "action": [
    "action-uuid-1",
    "action-uuid-2",
    "action-uuid-3"
  ]
}
```

### Структура действия

Каждое действие в скрипте:

```json
{
  "id": "action-uuid",
  "type": "ACTION_ON",
  "payload": {"id": "device-uuid"},
  "delay": 0
}
```

### Обработка

1. Получение скрипта из state по ID
2. Проверка `disabled` - если `true`, выполнение прерывается
3. Для каждого действия в массиве `action`:
   - Получение данных действия из state
   - Если `delay > 0` - выполнение с задержкой через `setTimeout`
   - Иначе - немедленное выполнение через `run(action)`

### Код обработки

```javascript
case ACTION_SCRIPT_RUN: {
  const { id } = action;
  const script = get(id);
  if (script && Array.isArray(script.action)) {
    if (script.disabled) return;
    for (const i of script.action) {
      const { type, payload, delay } = get(i);
      const a = { action: i, type, ...payload };
      if (delay > 0) {
        setTimeout(run, delay, a);
      } else {
        run(a);
      }
    }
  }
  break;
}
```

## Поиск скриптов

### По UUID

Если известен UUID скрипта, используйте его напрямую:

```json
{"type": "ACTION_SCRIPT_RUN", "id": "88837baa-fe09-4b4c-aa54-b39c8912b805"}
```

### По названию

1. Отправьте `LIST` для получения всех объектов
2. Отправьте `GET` для каждого объекта с `type: "script"`
3. Найдите скрипт по полю `title`

**Пример:**
```javascript
// 1. LIST
await websocket.send(JSON.stringify({"type": "list"}));

// 2. Получаем ответы ACTION_SET
// 3. Фильтруем по payload.type === "script"
// 4. Ищем по payload.title === "Название"
```

## Примеры использования

### Python

```python
import asyncio
import json
import websockets

async def run_script(script_id: str):
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as websocket:
        command = {
            "type": "ACTION_SCRIPT_RUN",
            "id": script_id
        }
        await websocket.send(json.dumps(command))
        # Ждём обновления состояния
        response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
        print(json.loads(response))

asyncio.run(run_script("88837baa-fe09-4b4c-aa54-b39c8912b805"))
```

### JavaScript/Node.js

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://192.168.88.4:3000');

ws.on('open', () => {
  const command = {
    type: 'ACTION_SCRIPT_RUN',
    id: '88837baa-fe09-4b4c-aa54-b39c8912b805'
  };
  ws.send(JSON.stringify(command));
});

ws.on('message', (data) => {
  console.log(JSON.parse(data.toString()));
});
```

### wscat

```bash
echo '{"type":"ACTION_SCRIPT_RUN","id":"88837baa-fe09-4b4c-aa54-b39c8912b805"}' | \
  npx --yes wscat -c ws://192.168.88.4:3000
```

## Тестирование

### Тест выполнения по UUID

```bash
REACTHOME_SCRIPT_ID="88837baa-fe09-4b4c-aa54-b39c8912b805" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

### Тест выполнения по названию

```bash
REACTHOME_SCRIPT_TITLE="Start" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_title -v
```

### Список всех скриптов

```bash
node scripts/list-scripts.js
```

## Диагностика

### Проверка подключения

```bash
npx --yes wscat -c ws://192.168.88.4:3000
```

### Проверка списка объектов

```bash
echo '{"type":"list"}' | npx --yes wscat -c ws://192.168.88.4:3000
```

### Проверка данных скрипта

```bash
echo '{"type":"get","state":["88837baa-fe09-4b4c-aa54-b39c8912b805"]}' | \
  npx --yes wscat -c ws://192.168.88.4:3000
```

## Безопасность

- Сервер не требует аутентификации для локальных подключений
- Все команды выполняются с правами процесса демона
- Рекомендуется использовать только в доверенной сети
- Для внешнего доступа используйте VPN или туннель

## Производительность

- Подключение устанавливается мгновенно
- Команды обрабатываются синхронно
- Скрипты выполняются последовательно
- Задержки в действиях скрипта обрабатываются через `setTimeout`

## Ограничения

- Максимальный размер сообщения ограничен настройками WebSocket
- Длительные скрипты могут блокировать обработку других команд
- Отключённые скрипты (`disabled: true`) не выполняются

## См. также

- **[WEBSOCKET_API_REFERENCE.md](./WEBSOCKET_API_REFERENCE.md)** - **полное описание API** (все типы сообщений, примеры, лучшие практики)
- [LODGIA_LIGHT_CONTROL_GUIDE.md](./LODGIA_LIGHT_CONTROL_GUIDE.md) - управление освещением
- [SCRIPT_METADATA.md](./SCRIPT_METADATA.md) - метаинформация скриптов
- `tests/integration/test_script_execution.py` - тесты выполнения скриптов
- `scripts/list-scripts.js` - утилита для списка скриптов

