# Запуск скрипта по коду (code)

**Дата создания:** 2025-11-16  
**Статус:** ✅ Поддерживается через двухэтапный процесс

## Ответ на вопрос

**Запуск скрипта по коду возможен через двухэтапный процесс:**
1. Найти скрипт по коду через WebSocket API
2. Выполнить скрипт по найденному UUID

**Прямой запуск по коду невозможен** - команда `ACTION_SCRIPT_RUN` требует UUID.

### Технические ограничения

1. **Команда `ACTION_SCRIPT_RUN` требует UUID**
   - Поле `id` в команде должно содержать UUID скрипта
   - Код (code) не может быть использован напрямую в команде
   - Функция `get(id)` в `src/controllers/service.js:3160` ожидает UUID

2. **Поле `code` передаётся через WebSocket API**
   - ✅ При запросе `GET` поле `code` **включается** в payload
   - WebSocket API возвращает данные из state через `get(id)`
   - Поле `code` доступно в payload скрипта

3. **Поиск по коду через WebSocket API возможен**
   - ✅ Можно найти скрипт по коду через двухэтапный процесс:
     1. Получить список всех объектов через `LIST`
     2. Запросить данные через `GET`
     3. Найти скрипт с совпадающим полем `code` в payload
   - ⚠️ Это медленнее, чем поиск по UUID
   - ⚠️ Требует обработки всех объектов в системе

## Решение: Двухэтапный процесс

Для запуска скрипта по коду необходимо:

1. **Найти скрипт по коду** (через WebSocket API или БД)
2. **Получить UUID скрипта**
3. **Выполнить скрипт по UUID**

### Способ 1: Поиск через WebSocket API (рекомендуется)

Используйте тест `test_script_can_be_executed_by_code`:

```bash
REACTHOME_SCRIPT_CODE="Лоджия спот" \
python3 -m pytest tests/integration/test_script_execution_by_code.py::test_script_can_be_executed_by_code -v
```

**Как это работает:**
1. Отправляет `LIST` для получения всех ID объектов
2. Отправляет `GET` для получения данных всех объектов
3. Ищет скрипт с совпадающим полем `code` в payload
4. Выполняет скрипт по найденному UUID

### Способ 2: Использование известного UUID

Если UUID скрипта уже известен (например, из документации):

```bash
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

**Пример для скрипта "Лоджия спот":**
```bash
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

### Способ 3: Поиск через БД + выполнение

1. **Найти UUID через поиск в БД:**
   ```bash
   REACTHOME_USE_SSH=true \
   node scripts/search-script-in-db.js "Лоджия спот"
   ```

2. **Выполнить скрипт по найденному UUID:**
   ```bash
   REACTHOME_SCRIPT_ID="<найденный-uuid>" \
   python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
   ```

### Способ 4: Использование обёртки (Node.js)

Создан скрипт `scripts/run-script-by-code.js`, который пытается найти скрипт по коду и выполнить его:

```bash
node scripts/run-script-by-code.js "Лоджия спот"
```

**Ограничения:**
- Работает только если поле `code` передаётся через WebSocket API
- Для большинства скриптов поле `code` не передаётся
- Рекомендуется использовать поиск в БД

## Технические детали

### Структура команды выполнения

```json
{
  "type": "ACTION_SCRIPT_RUN",
  "id": "uuid-скрипта"  // Только UUID, не код!
}
```

### Обработка команды

В `src/controllers/service.js:3158-3173`:

```javascript
case ACTION_SCRIPT_RUN: {
  const { id } = action;  // Ожидается UUID
  const script = get(id); // Получение скрипта из state по UUID
  // ...
}
```

**Важно:** Функция `get(id)` ожидает UUID, а не код.

### Почему поле `code` не передаётся

1. **WebSocket API возвращает данные из state**
   - `src/init/get.js` возвращает `get(id)` - весь объект из state
   - Но поле `code` может отсутствовать в некоторых объектах

2. **LIST возвращает только ID и timestamp**
   - `src/init/list.js` возвращает только `list()` - массив `[id, timestamp]`
   - Для получения данных нужен отдельный запрос `GET`

3. **Поле `code` не всегда заполнено**
   - Не все скрипты имеют поле `code`
   - Поле `code` может быть пустым

## Рекомендации

1. **Используйте UUID для выполнения скриптов**
   - UUID - наиболее надёжный способ идентификации
   - Сохраняйте UUID найденных скриптов

2. **Для поиска по коду используйте БД**
   - Поиск в БД находит скрипты по полю `code`
   - WebSocket API не поддерживает поиск по коду

3. **Создайте справочник UUID скриптов**
   - Документируйте UUID часто используемых скриптов
   - Используйте переменные окружения для хранения UUID

## Примеры

### Пример 1: Выполнение скрипта "Лоджия спот"

```bash
# Прямое выполнение по известному UUID
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

### Пример 2: Поиск и выполнение

```bash
# Шаг 1: Найти UUID через БД
REACTHOME_USE_SSH=true \
node scripts/search-script-in-db.js "Лоджия спот"

# Шаг 2: Выполнить по найденному UUID
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

### Пример 3: Python обёртка

```python
import asyncio
import json
import websockets

async def run_script_by_code(code: str):
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as ws:
        # Шаг 1: Получить список всех скриптов
        await ws.send(json.dumps({"type": "list"}))
        
        # Шаг 2: Найти скрипт по коду (требует поиска в БД)
        # ... код поиска ...
        
        # Шаг 3: Выполнить по UUID
        script_id = "83db5b75-fa69-42f9-bd57-ee9f33d59ed7"  # Найденный UUID
        command = {"type": "ACTION_SCRIPT_RUN", "id": script_id}
        await ws.send(json.dumps(command))

asyncio.run(run_script_by_code("Лоджия спот"))
```

## Выводы

1. **Запуск по коду возможен через двухэтапный процесс** ✅
   - Найти скрипт по коду через WebSocket API (LIST + GET)
   - Выполнить скрипт по найденному UUID

2. **Поле `code` передаётся через WebSocket API** ✅
   - Поле `code` доступно в payload при запросе `GET`
   - Можно найти скрипт по коду без обращения к БД

3. **Прямой запуск по коду невозможен** ❌
   - Команда `ACTION_SCRIPT_RUN` требует UUID в поле `id`
   - Код не может быть использован напрямую

4. **Рекомендуется использовать UUID** - наиболее быстрый способ
5. **Для поиска по коду используйте тест** - автоматизированный процесс

## См. также

- [LODGIA_SPOT_SCRIPT.md](./LODGIA_SPOT_SCRIPT.md) - документация скрипта "Лоджия спот"
- [SCRIPT_SEARCH_METHODOLOGY.md](./SCRIPT_SEARCH_METHODOLOGY.md) - методика поиска скриптов
- [SCRIPT_EXECUTION_QUICK_START.md](./SCRIPT_EXECUTION_QUICK_START.md) - быстрый старт выполнения скриптов

