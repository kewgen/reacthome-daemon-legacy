# Быстрый старт: Выполнение скриптов

## 🚀 За 30 секунд

### По UUID

```bash
REACTHOME_SCRIPT_ID="88837baa-fe09-4b4c-aa54-b39c8912b805" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

**Пример: Скрипт "Лоджия спот"**
```bash
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

### По названию

```bash
REACTHOME_SCRIPT_TITLE="Start" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_title -v
```

**Примечание:** Поиск по названию работает только по полю `title`, а не по `code`. Если скрипт не найден, используйте поиск в БД.

## 📋 Команда WebSocket

```json
{"type": "ACTION_SCRIPT_RUN", "id": "script-uuid"}
```

## 🔍 Поиск скриптов

```bash
# Список всех скриптов
node scripts/list-scripts.js

# Простой поиск по названию (через WebSocket API)
node scripts/find-script-by-name.js "название скрипта"

# Расширенный поиск с оценкой схожести (через WebSocket API)
node scripts/find-script-advanced.js "название скрипта"

# Поиск в базе данных (для новых скриптов, не синхронизированных с API)
REACTHOME_USE_SSH=true \
node scripts/search-script-in-db.js "название скрипта"
```

**Примеры:**
```bash
# Поиск через WebSocket API
node scripts/find-script-advanced.js "Лоджия спот"

# Поиск в БД (если скрипт новый)
REACTHOME_USE_SSH=true \
node scripts/search-script-in-db.js "Лоджия спот"
```

## 💡 Примеры

### Python

```python
import asyncio
import json
import websockets

async def run_script(script_id: str):
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as websocket:
        command = {"type": "ACTION_SCRIPT_RUN", "id": script_id}
        await websocket.send(json.dumps(command))

asyncio.run(run_script("88837baa-fe09-4b4c-aa54-b39c8912b805"))
```

### wscat

```bash
echo '{"type":"ACTION_SCRIPT_RUN","id":"88837baa-fe09-4b4c-aa54-b39c8912b805"}' | \
  npx --yes wscat -c ws://192.168.88.4:3000
```

## ✅ Запуск по коду

**Запуск скрипта по коду возможен через двухэтапный процесс.**

**Использование:**
```bash
REACTHOME_SCRIPT_CODE="Лоджия спот" \
python3 -m pytest tests/integration/test_script_execution_by_code.py::test_script_can_be_executed_by_code -v
```

**Как это работает:**
1. Находит скрипт по коду через WebSocket API (LIST + GET)
2. Выполняет скрипт по найденному UUID

**Ограничения:**
- Прямой запуск по коду невозможен (требуется UUID)
- Поиск по коду медленнее, чем по UUID (обрабатывает все объекты)

**См. подробности:** [SCRIPT_EXECUTION_BY_CODE.md](./SCRIPT_EXECUTION_BY_CODE.md)

## 📚 Полная документация

- [SCRIPT_METADATA.md](./SCRIPT_METADATA.md) - **полная метаинформация скриптов** (структура, поля, примеры)
- [WEBSOCKET_PORT_3000_GUIDE.md](./WEBSOCKET_PORT_3000_GUIDE.md) - руководство по WebSocket API
- [SCRIPT_SEARCH_METHODOLOGY.md](./SCRIPT_SEARCH_METHODOLOGY.md) - методика поиска скриптов
- [SCRIPT_EXECUTION_BY_CODE.md](./SCRIPT_EXECUTION_BY_CODE.md) - запуск скрипта по коду
- [LODGIA_SPOT_SCRIPT.md](./LODGIA_SPOT_SCRIPT.md) - документация скрипта "Лоджия спот"

