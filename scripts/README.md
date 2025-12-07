# Скрипты управления и тестирования

Эта папка содержит утилиты для работы с системой ReactHome Daemon.

## Структура директорий

```
scripts/
├── archive/                    # Архивные/устаревшие скрипты
├── device-registry/            # Скрипты для реестра устройств
├── system/                     # Системные скрипты для Raspberry Pi
├── utils/                      # Утилиты
└── [корневые скрипты]          # Основные скрипты работы со скриптами
```

## Категории скриптов

### 🔍 Поиск и работа со скриптами

- **`list-scripts.js`** - Получение списка всех скриптов через WebSocket API
- **`find-script-by-name.js`** - Простой поиск скрипта по названию (title)
- **`find-script-advanced.js`** - Продвинутый поиск скриптов с нечётким совпадением (Levenshtein)
- **`search-script-in-db.js`** - Поиск скриптов напрямую в LevelDB (по полю code)
- **`run-script-by-code.js`** - Выполнение скрипта по коду (code) через WebSocket API
- **`external-run-script.js`** - Выполнение скрипта через внешний шлюз (gate.reacthome.net)
- **`trace-applysite.js`** - Трассировка выполнения функции applySite

### 🔧 Инспекция и диагностика

- **`inspect-lodgia-location-id.js`** - Проверка UUID локации "Лоджия"
- **`inspect-light-channel.js`** - Проверка состояния канала освещения
- **`inspect-light-channels-scripts.js`** - Проверка скриптов, привязанных к каналам освещения
- **`inspect-device-bindings.js`** - Проверка привязок устройств
- **`inspect-database-content.js`** - Инспекция содержимого базы данных
- **`test-light-direct.js`** - Прямой тест управления освещением
- **`test-toggle-bra-gostinaya.js`** - Тест переключения бра в гостиной

### 📊 Сбор данных

- **`collect-devices.js`** - Сбор информации об устройствах через WebSocket API
- **`read-database-from-server.js`** - Чтение базы данных с сервера
- **`get-opensearch-ip-address.js`** - Получение IP-адреса OpenSearch

### 🔐 SSH и доступ

- **`check_pi_access.expect`** - Проверка доступа к Raspberry Pi через SSH
- **`ws_lodgia_off.expect`** - Выключение освещения в лоджии через WebSocket (expect)

### 🖥️ Системные скрипты (Raspberry Pi)

#### Применение исправлений
- **`system/apply-critical-fix-to-pi.sh`** - Применение критического исправления на Raspberry Pi
- **`system/apply-fix-commit-and-push-on-pi.sh`** - Применение исправления, коммит и push на Raspberry Pi
- **`system/fix-action-script-run-context-on-pi.sh`** - Исправление контекста выполнения скриптов на Raspberry Pi

#### Проверка состояния
- **`system/check-branch-status-on-pi.sh`** - Проверка статуса ветки на Raspberry Pi
  - Использование: `./scripts/system/check-branch-status-on-pi.sh [--simple]`
  - Флаг `--simple` для простой проверки актуальности ветки
- **`system/check-logs-on-pi.sh`** - Проверка логов на Raspberry Pi
- **`system/check-logs-detailed-on-pi.sh`** - Детальная проверка логов на Raspberry Pi
- **`system/check-event-logger-status.sh`** - Проверка статуса event-logger
- **`system/check-migration-status-on-pi.sh`** - Проверка статуса миграции

#### Копирование данных
- **`system/copy-logs-from-pi.sh`** - Копирование всех логов с Raspberry Pi
- **`system/fetch-logs-from-pi.sh`** - Получение логов с Raspberry Pi (альтернативный метод)

#### Управление демоном
- **`system/restart-daemon-and-check.sh`** - Перезапуск демона и проверка
- **`restart-daemon-on-pi.sh`** - Перезапуск демона на Raspberry Pi

#### Экстренные операции
- **`system/emergency-restore-server.sh`** - Экстренное восстановление сервера из бэкапа
- **`system/emergency-restore-interactive.sh`** - Интерактивное экстренное восстановление (с запросом пароля)
- **`system/emergency-rollback.sh`** - Экстренный откат изменений

#### Управление Git
- **`system/git-pull-on-pi.sh`** - Выполнение git pull на Raspberry Pi
- **`system/commit-and-push-on-pi.sh`** - Коммит и push изменений на Raspberry Pi
- **`system/switch-pi-branch.sh`** - Переключение ветки на Raspberry Pi
- **`system/show-pi-changes.sh`** - Показать изменения на Raspberry Pi
  - Использование: `./scripts/system/show-pi-changes.sh [--files file1 file2 ...]`
  - Флаг `--files` для проверки конкретных файлов
- **`system/list-untracked-files-on-pi.sh`** - Список неотслеживаемых файлов на Raspberry Pi

#### Развёртывание
- **`system/deploy-event-logger.sh`** - Развёртывание event-logger на Raspberry Pi
- **`system/stop-event-logger-on-pi.sh`** - Остановка event-logger на Raspberry Pi
- **`system/cleanup-and-restart-pi.sh`** - Очистка и перезапуск на Raspberry Pi

#### База данных
- **`restore-database-from-backup.sh`** - Восстановление базы данных из бэкапа

### 🛠️ Утилиты

- **`utils/check-pi-state.sh`** - Проверка состояния Raspberry Pi
- **`utils/cleanup-pi-files.sh`** - Очистка файлов на Raspberry Pi
- **`utils/count-db-entries.js`** - Подсчёт записей в базе данных
- **`utils/count-db-pi.sh`** - Подсчёт записей в базе данных на Raspberry Pi

### 📦 Архивные скрипты

- **`archive/temp-*.sh`** - Временные скрипты (перемещены в архив)
- **`archive/generate-device-registry-*.js`** - Генераторы реестра устройств (устаревшие версии)

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

# Через внешний шлюз
node scripts/external-run-script.js <script-id>
```

### Диагностика

```bash
# Проверка локации
node scripts/inspect-lodgia-location-id.js

# Проверка канала
node scripts/inspect-light-channel.js "uuid-канала"

# Инспекция базы данных
node scripts/inspect-database-content.js

# Сбор устройств
node scripts/collect-devices.js
```

### Работа с Raspberry Pi

```bash
# Проверка статуса ветки (простая)
./scripts/system/check-branch-status-on-pi.sh --simple

# Проверка статуса ветки (детальная)
./scripts/system/check-branch-status-on-pi.sh

# Проверка изменений (все файлы)
./scripts/system/show-pi-changes.sh

# Проверка изменений (конкретные файлы)
./scripts/system/show-pi-changes.sh --files src/actions/create.js src/assist/lang/ru.js

# Копирование логов
./scripts/system/copy-logs-from-pi.sh

# Экстренное восстановление (интерактивно)
./scripts/system/emergency-restore-interactive.sh

# Экстренное восстановление (с параметрами)
./scripts/system/emergency-restore-server.sh /path/to/backup.tar.gz
```

## Переменные окружения

### Общие
- `REACTHOME_WS_URI` - URI WebSocket сервера (по умолчанию: `ws://192.168.88.4:3000`)
- `REACTHOME_USE_SSH` - Использовать SSH для доступа к БД (по умолчанию: `false`)
- `REACTHOME_SSH_HOST` - Хост для SSH (по умолчанию: `pi@192.168.88.4`)
- `REACTHOME_DB_PATH` - Путь к БД на сервере (по умолчанию: `/home/pi/reacthome-daemon/var/db`)

### Для работы с Raspberry Pi
- `REACTHOME_PI_HOST` - IP адрес Raspberry Pi (по умолчанию: `192.168.88.4`)
- `REACTHOME_PI_USER` - Пользователь для SSH (по умолчанию: `pi`)
- `REACTHOME_PI_PASS` - Пароль для SSH (обязательно для большинства скриптов)

### Для внешнего шлюза
- `REACTHOME_MAC` - MAC-адрес устройства (по умолчанию: `e4:5f:01:20:44:0a`)
- `REACTHOME_GATE_URL` - URL шлюза (по умолчанию: `wss://gate.reacthome.net/<mac>`)

## История изменений

### 2025-01-28: Реорганизация скриптов

- ✅ Удалены дубликаты из `scripts/scripts-management/`
- ✅ Объединены похожие скрипты:
  - `copy-logs-from-pi.sh` и `copy-all-logs-from-pi.sh` → `copy-logs-from-pi.sh`
  - `check-branch-simple.sh` и `check-branch-status-on-pi.sh` → `check-branch-status-on-pi.sh` (с флагом `--simple`)
  - `utils/check-pi-changes.sh` и `system/show-pi-changes.sh` → `system/show-pi-changes.sh` (с флагом `--files`)
- ✅ Переименованы скрипты с улучшенными названиями:
  - `check-*` → `inspect-*` (для скриптов инспекции)
  - `read_db_server.js` → `read-database-from-server.js`
  - `get_opensearch_ip.js` → `get-opensearch-ip-address.js`
  - `restart_daemon.sh` → `restart-daemon-on-pi.sh`
  - `fetch_logs.sh` → `fetch-logs-from-pi.sh`
  - `restore-db-from-backup.sh` → `restore-database-from-backup.sh`
  - Системные скрипты получили суффикс `-on-pi.sh` для ясности
- ✅ Временные скрипты перемещены в `archive/`
- ✅ Удалена пустая директория `scripts-management/`

## См. также

- [WEBSOCKET_API_REFERENCE.md](../docs/WEBSOCKET_API_REFERENCE.md) - Полное описание WebSocket API
- [SCRIPT_SEARCH_METHODOLOGY.md](../docs/SCRIPT_SEARCH_METHODOLOGY.md) - Методика поиска скриптов
- [SCRIPT_EXECUTION_QUICK_START.md](../docs/SCRIPT_EXECUTION_QUICK_START.md) - Быстрый старт выполнения скриптов
- [reports/scripts-reorganization-plan.md](../reports/scripts-reorganization-plan.md) - План реорганизации скриптов
