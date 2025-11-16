# Структура скриптов проекта

## Обзор

Проект состоит из:
1. **Исходники сервера** (`src/`, `daemon.js`) - основной код демона ReactHome
2. **Управляющие скрипты** (`scripts/`) - утилиты для работы с системой
3. **Тесты** (`tests/`) - интеграционные тесты
4. **Архив** (`archive/`) - временные и аналитические скрипты

## 📁 scripts/ - Рабочие скрипты

### 🔍 Поиск и работа со скриптами
- `list-scripts.js` - Получение списка всех скриптов через WebSocket API
- `find-script-by-name.js` - Простой поиск скрипта по названию (title)
- `find-script-advanced.js` - Продвинутый поиск с нечётким совпадением (Levenshtein)
- `search-script-in-db.js` - Поиск скриптов напрямую в LevelDB (по полю code)
- `run-script-by-code.js` - Выполнение скрипта по коду (code) через WebSocket API

### 🔧 Диагностика и отладка
- `check-lodgia-id.js` - Проверка UUID локации "Лоджия"
- `check-light-channel.js` - Проверка состояния канала освещения
- `check-light-channels-scripts.js` - Проверка скриптов, привязанных к каналам освещения
- `check-device-bind.js` - Проверка привязок устройств
- `trace-applysite.js` - Трассировка выполнения функции applySite
- `test-light-direct.js` - Прямой тест управления освещением

### 📊 Сбор данных
- `collect-devices.js` - Сбор информации об устройствах через WebSocket API

### 🔐 SSH и доступ
- `check_pi_access.expect` - Проверка доступа к Raspberry Pi через SSH
- `ws_lodgia_off.expect` - Выключение освещения в лоджии через WebSocket (expect)

**См. подробности:** [scripts/README.md](./scripts/README.md)

## 🧪 tests/ - Интеграционные тесты

- `test_script_execution.py` - Тесты выполнения скриптов (по UUID и title)
- `test_script_execution_by_code.py` - Тест выполнения скрипта по коду
- `test_script_double_execution.py` - Тест двойного выполнения скрипта с интервалом
- `test_lodgia_lighting.py` - Тесты управления освещением в лоджии
- `test_http_script_server.js` - Тесты HTTP скрипт-сервера

## 📦 archive/ - Архив временных скриптов

### analysis/ - Аналитические скрипты
- `analyze_db_log.py` - Анализ логов БД
- `analyze_lodgia.py` - Анализ лоджии
- `create_scripts_report.py` - Создание отчёта по скриптам
- `extract_device_names.py` - Извлечение имён устройств
- `extract_scripts.py` - Извлечение скриптов
- `generate_db_report.py` - Генерация отчёта по БД
- `match_script_names.py` - Сопоставление имён скриптов

### ssh/ - Expect скрипты для SSH
- `ssh_collect_3000.exp` - Сбор данных через SSH
- `ssh_expect_run.exp` - Запуск команд через expect
- `ssh_pi_collect.exp` - Сбор данных с Pi
- `ssh_pi_inventory.exp` - Инвентаризация Pi
- `ssh_pi2_inventory.exp` - Инвентаризация Pi2

### shell/ - Временные shell скрипты
- `test_ping_bypass_vpn.sh` - Тест ping
- `fetch_omada_clients.sh` - Получение клиентов Omada
- `fetch_omada_northbound.sh` - Получение Omada northbound

**Примечание:** Эти скрипты сохранены для справки, но не используются в текущей работе.

## 🗂️ Корень проекта

### Основные файлы
- `daemon.js` - Точка входа демона
- `http-script-server.js` - HTTP сервер для выполнения скриптов
- `rbus.js` - Утилита для работы с RBUS (если используется)

### Скрипты развёртывания
- `deploy-http-server.sh` - Развёртывание HTTP сервера
- `deploy-remote-options.sh` - Опции удалённого развёртывания

## Использование

### Быстрый старт

```bash
# Список всех скриптов
node scripts/list-scripts.js

# Поиск скрипта
node scripts/find-script-by-name.js "Лоджия спот"

# Выполнение скрипта
node scripts/run-script-by-code.js "Лоджия спот"

# Запуск тестов
python3 -m pytest tests/integration/ -v
```

### Переменные окружения

- `REACTHOME_WS_URI` - URI WebSocket сервера (по умолчанию: `ws://192.168.88.4:3000`)
- `REACTHOME_USE_SSH` - Использовать SSH для доступа к БД
- `REACTHOME_SSH_HOST` - Хост для SSH
- `REACTHOME_DB_PATH` - Путь к БД на сервере

## Документация

- [scripts/README.md](./scripts/README.md) - Документация по скриптам
- [docs/WEBSOCKET_API_REFERENCE.md](./docs/WEBSOCKET_API_REFERENCE.md) - Полное описание WebSocket API
- [docs/SCRIPT_SEARCH_METHODOLOGY.md](./docs/SCRIPT_SEARCH_METHODOLOGY.md) - Методика поиска скриптов
