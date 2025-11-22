# Скрипт "Лоджия спот" - Документация

**Дата создания:** 2025-11-16  
**Версия:** 1.0  
**Статус:** ✅ Найден и протестирован

## Информация о скрипте

### Основные данные

- **UUID:** `83db5b75-fa69-42f9-bd57-ee9f33d59ed7`
- **Название (title):** "6.D.L.3 Toggle"
- **Код (code):** "Лоджия спот"
- **Тип:** `script`
- **Статус:** включён (disabled: false)
- **Действий в скрипте:** 1

### Функционал

Скрипт переключает состояние освещения в Лоджии (включает/выключает).

**Действие:**
- Тип: `ACTION_TOGGLE`
- Устройство: `34731215-af9b-4847-b2f9-67c8940271c0`
- Название устройства: "Освещение 6.D.L.3 Лоджия"

### Родительская локация

- **UUID локации:** `a5b0a8f3-fe41-4235-b602-3a09e1eeddbb`
- **Название:** Лоджия

## Связанные скрипты

1. **6.D.L.3 on** (включение)
   - UUID: `41e5974e-d302-4eef-93c9-9d24231f7a41`

2. **6.D.L.3 off** (выключение)
   - UUID: `66fdc34c-ac73-4f73-8262-1beb80cb95fa`

3. **6.D.L.3 Toggle** (переключение) ← текущий скрипт
   - UUID: `83db5b75-fa69-42f9-bd57-ee9f33d59ed7`

## Выполнение скрипта

### Команда WebSocket

```json
{"type":"ACTION_SCRIPT_RUN","id":"83db5b75-fa69-42f9-bd57-ee9f33d59ed7"}
```

### Python пример

```python
import asyncio
import json
import websockets

async def toggle_lodgia_spot():
    uri = "ws://192.168.88.4:3000"
    async with websockets.connect(uri) as websocket:
        command = {
            "type": "ACTION_SCRIPT_RUN",
            "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7"
        }
        await websocket.send(json.dumps(command))
        print("Команда отправлена")

asyncio.run(toggle_lodgia_spot())
```

### wscat

```bash
echo '{"type":"ACTION_SCRIPT_RUN","id":"83db5b75-fa69-42f9-bd57-ee9f33d59ed7"}' | \
  npx --yes wscat -c ws://192.168.88.4:3000
```

## Тестирование

### Тест двойного выполнения

```bash
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
REACTHOME_EXECUTION_INTERVAL=1.0 \
python3 -m pytest tests/integration/test_script_double_execution.py::test_script_double_execution_with_interval -v
```

**Результаты теста:**
- ✅ Статус: PASSED
- ⏱️ Время выполнения: ~7 сек
- 📊 Обновлений состояния: ~191
- 🔄 Интервал между выполнениями: ~2 сек

### Тест одиночного выполнения

```bash
REACTHOME_SCRIPT_ID="83db5b75-fa69-42f9-bd57-ee9f33d59ed7" \
python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

## История поиска

### Проблема

Скрипт "Лоджия спот" не был найден через WebSocket API при поиске по названию, так как:
- В системе скрипт хранится с названием "6.D.L.3 Toggle"
- Код "Лоджия спот" используется как дополнительное поле
- Поиск через WebSocket API ищет только по полю `title`, а не по `code`

### Решение

Скрипт был найден через прямой поиск в базе данных LevelDB, где хранится полная информация, включая поле `code`.

### Выводы

1. **Поиск по названию может не работать**, если скрипт имеет другое название в поле `title`
2. **Для новых скриптов** рекомендуется использовать поиск в БД
3. **UUID скрипта** - наиболее надёжный способ идентификации
4. **Поле `code`** может отличаться от поля `title` в системе

## Рекомендации

1. **Используйте UUID** для надёжной идентификации скрипта
2. **Сохраняйте UUID** найденных скриптов для быстрого доступа
3. **При поиске** учитывайте, что название может отличаться от кода
4. **Для новых скриптов** используйте поиск в БД, если WebSocket API не находит

## См. также

- [SCRIPT_EXECUTION_QUICK_START.md](./SCRIPT_EXECUTION_QUICK_START.md) - быстрый старт выполнения скриптов
- [SCRIPT_SEARCH_METHODOLOGY.md](./SCRIPT_SEARCH_METHODOLOGY.md) - методика поиска скриптов
- [LODGIA_LIGHT_CONTROL_GUIDE.md](./LODGIA_LIGHT_CONTROL_GUIDE.md) - управление освещением в Лоджии

