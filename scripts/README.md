# Скрипты управления и тестирования

Эта папка содержит утилиты для работы с системой ReactHome Daemon.

## Категории скриптов

### 🔍 Поиск и работа со скриптами

- **`list-scripts.js`** - Получение списка всех скриптов через WebSocket API
- **`find-script-by-name.js`** - Простой поиск скрипта по названию (title)
- **`find-script-advanced.js`** - Продвинутый поиск скриптов с нечётким совпадением (Levenshtein)
- **`search-script-in-db.js`** - Поиск скриптов напрямую в LevelDB (по полю code)
- **`run-script-by-code.js`** - Выполнение скрипта по коду (code) через WebSocket API

### 🔧 Диагностика и отладка

- **`check-lodgia-id.js`** - Проверка UUID локации "Лоджия"
- **`check-light-channel.js`** - Проверка состояния канала освещения
- **`check-light-channels-scripts.js`** - Проверка скриптов, привязанных к каналам освещения
- **`check-device-bind.js`** - Проверка привязок устройств
- **`trace-applysite.js`** - Трассировка выполнения функции applySite
- **`test-light-direct.js`** - Прямой тест управления освещением

### 📊 Сбор данных

- **`collect-devices.js`** - Сбор информации об устройствах через WebSocket API

### 🔐 SSH и доступ

- **`check_pi_access.expect`** - Проверка доступа к Raspberry Pi через SSH
- **`ws_lodgia_off.expect`** - Выключение освещения в лоджии через WebSocket (expect)

## Использование

### Поиск скрипта

```bash
# По названию
node scripts/find-script-by-name.js "Лоджия спот"

# Продвинутый поиск
node scripts/find-script-advanced.js "лоджия"

# Поиск в БД
REACTHOME_USE_SSH=true node scripts/search-script-in-db.js "Лоджия спот"
```

### Выполнение скрипта

```bash
# По коду
node scripts/run-script-by-code.js "Лоджия спот"

# По UUID (через тесты)
REACTHOME_SCRIPT_ID="uuid" python3 -m pytest tests/integration/test_script_execution.py::test_script_can_be_executed_by_id -v
```

### Диагностика

```bash
# Проверка локации
node scripts/check-lodgia-id.js

# Проверка канала
node scripts/check-light-channel.js "uuid-канала"

# Сбор устройств
node scripts/collect-devices.js
```

## Переменные окружения

- `REACTHOME_WS_URI` - URI WebSocket сервера (по умолчанию: `ws://192.168.88.4:3000`)
- `REACTHOME_USE_SSH` - Использовать SSH для доступа к БД (по умолчанию: `false`)
- `REACTHOME_SSH_HOST` - Хост для SSH (по умолчанию: `pi@192.168.88.4`)
- `REACTHOME_DB_PATH` - Путь к БД на сервере (по умолчанию: `/home/pi/reacthome-daemon/var/db`)

## См. также

- [WEBSOCKET_API_REFERENCE.md](../docs/WEBSOCKET_API_REFERENCE.md) - Полное описание WebSocket API
- [SCRIPT_SEARCH_METHODOLOGY.md](../docs/SCRIPT_SEARCH_METHODOLOGY.md) - Методика поиска скриптов
- [SCRIPT_EXECUTION_QUICK_START.md](../docs/SCRIPT_EXECUTION_QUICK_START.md) - Быстрый старт выполнения скриптов
