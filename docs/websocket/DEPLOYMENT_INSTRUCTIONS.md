# Инструкции по развертыванию event-logger на Raspberry Pi

**Дата:** 2025-12-07  
**Ветка:** `websocket-logger`  
**Последний коммит:** `015dcbc` (fix: безопасная инициализация SQLite в ru.js)

## Подготовка

Все компоненты готовы в ветке `websocket-logger`:
- ✅ `event-logger.js` - основной сервис
- ✅ `ecosystem.config.js` - конфигурация PM2
- ✅ `src/logging/*` - модули логирования
- ✅ `src/assist/lang/ru.js` - исправлен (безопасная инициализация SQLite)
- ✅ `tests/integration/test_event_logging_compatibility.js` - тест совместимости

## Шаг 1: Подключение к Raspberry Pi

```bash
ssh pi@192.168.88.4
cd /home/pi/reacthome-daemon
```

## Шаг 2: Проверка текущего состояния

```bash
# Проверить текущую ветку
git branch --show-current

# Проверить статус
git status

# Проверить незакоммиченные изменения
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  Обнаружены незакоммиченные изменения!"
  git status --short
  # Решить: commit, stash или discard
fi
```

## Шаг 3: Обновление ветки websocket-logger

```bash
# Обновить информацию о remote ветках
git fetch origin

# Переключиться на ветку websocket-logger (или создать, если не существует)
if git show-ref --verify --quiet refs/heads/websocket-logger; then
  echo "✅ Локальная ветка websocket-logger существует"
  git checkout websocket-logger
else
  echo "Создаю локальную ветку от remote..."
  git checkout -b websocket-logger origin/websocket-logger
fi

# Получить последние изменения
git pull origin websocket-logger

# Проверить, что мы на правильной ветке
git log --oneline -3
# Должен быть виден коммит: "015dcbc fix: безопасная инициализация SQLite в ru.js"
```

## Шаг 4: Проверка наличия файлов

```bash
echo "Проверяю наличие файлов:"
test -f event-logger.js && echo "✅ event-logger.js" || echo "❌ event-logger.js отсутствует"
test -f ecosystem.config.js && echo "✅ ecosystem.config.js" || echo "❌ ecosystem.config.js отсутствует"
test -d src/logging && echo "✅ src/logging/" || echo "❌ src/logging/ отсутствует"
test -f src/logging/event-log.js && echo "✅ src/logging/event-log.js" || echo "❌ src/logging/event-log.js отсутствует"
test -f src/logging/filters.js && echo "✅ src/logging/filters.js" || echo "❌ src/logging/filters.js отсутствует"
test -f src/logging/opensearch.js && echo "✅ src/logging/opensearch.js" || echo "❌ src/logging/opensearch.js отсутствует"
test -f src/assist/lang/ru.js && echo "✅ src/assist/lang/ru.js" || echo "❌ src/assist/lang/ru.js отсутствует"
```

## Шаг 5: Установка зависимостей

```bash
# Проверить package.json
if [ -f package.json ]; then
  echo "Устанавливаю зависимости..."
  npm install
  echo "✅ Зависимости установлены"
else
  echo "⚠️  package.json не найден"
fi
```

## Шаг 6: Настройка переменных окружения

**Критично:** Проверьте настройки OpenSearch в файле `.env`:

```bash
# Проверить текущие настройки
cat .env | grep OPENSEARCH

# Если переменных нет, добавьте их в .env:
# OPENSEARCH_ENABLED=true
# OPENSEARCH_URL=<ваш URL OpenSearch>
# OPENSEARCH_USER=<ваш пользователь>
# OPENSEARCH_PASSWORD=<ваш пароль>
# OPENSEARCH_INDEX_PREFIX=reacthome-events-test
# OPENSEARCH_CA_CERT=~/.opensearch/root.crt  # если требуется SSL/TLS
```

**Важно:** Для тестирования используется префикс `reacthome-events-test`, чтобы не смешивать с production событиями.

## Шаг 7: Запуск event-logger в тестовом режиме

```bash
# Проверить текущие процессы PM2
pm2 status

# Запустить event-logger (только event-logger, не весь ecosystem)
pm2 start ecosystem.config.js --only reacthome-event-logger

# Проверить статус
pm2 status

# Посмотреть логи (первые 50 строк)
pm2 logs reacthome-event-logger --lines 50

# Следить за логами в реальном времени
pm2 logs reacthome-event-logger
```

## Шаг 8: Проверка работы event-logger

### Проверка подключения к WebSocket

В логах должна быть строка:
```
[EVENT-LOGGER] Подключение к WebSocket: ws://localhost:3000
[EVENT-LOGGER] ✅ WebSocket подключен
```

### Проверка отправки событий в OpenSearch

В логах должны быть сообщения о батчах:
```
[EVENT-LOGGER] Отправлено событий в OpenSearch: 50
```

### Проверка ошибок

Если есть ошибки подключения к OpenSearch:
```
[EVENT-LOGGER] ❌ Ошибка отправки в OpenSearch: ...
[EVENT-LOGGER] События буферизованы (X/100)
```

## Шаг 9: Мониторинг (Этап 5 - параллельная работа)

После успешного запуска event-logger должен работать параллельно со встроенным логированием **минимум 3-7 дней**.

### Ежедневные проверки

```bash
# Проверить статус процессов
pm2 status

# Проверить логи за последние 100 строк
pm2 logs reacthome-event-logger --lines 100

# Проверить использование памяти
pm2 monit

# Проверить события в OpenSearch (на локальной машине)
node tests/integration/test_event_logging_compatibility.js --date $(date +%Y-%m-%d)
```

### Проверка формата событий

Запустить тест совместимости (с локальной машины):
```bash
cd /Users/evgen/Documents/Work/reacthome-daemon-legacy-main
git checkout websocket-logger
node tests/integration/test_event_logging_compatibility.js --date 2025-12-07
```

## Управление процессом

### Остановка event-logger

```bash
pm2 stop reacthome-event-logger
```

### Перезапуск event-logger

```bash
pm2 restart reacthome-event-logger
```

### Удаление event-logger из PM2

```bash
pm2 delete reacthome-event-logger
```

### Просмотр логов

```bash
# Последние N строк
pm2 logs reacthome-event-logger --lines N

# Следить за логами
pm2 logs reacthome-event-logger

# Логи ошибок
pm2 logs reacthome-event-logger --err

# Логи вывода
pm2 logs reacthome-event-logger --out
```

## Возможные проблемы

### Event-logger не подключается к WebSocket

1. Проверьте, что демон запущен:
   ```bash
   pm2 status
   # Должен быть процесс reacthome-daemon
   ```

2. Проверьте, что WebSocket порт 3000 доступен:
   ```bash
   netstat -tuln | grep 3000
   ```

3. Проверьте логи демона:
   ```bash
   pm2 logs reacthome-daemon --lines 50
   ```

### Ошибки подключения к OpenSearch

1. Проверьте переменные окружения в `.env`
2. Проверьте доступность OpenSearch URL
3. Проверьте сертификаты (если используется SSL/TLS)
4. Проверьте логи event-logger на детали ошибки

### Высокое использование памяти

1. Проверить текущее использование:
   ```bash
   pm2 monit
   ```

2. При необходимости перезапустить:
   ```bash
   pm2 restart reacthome-event-logger
   ```

## Следующие этапы

После успешной работы event-logger в тестовом режиме (3-7 дней):

1. **Этап 6: Переключение на production**
   - Изменить `OPENSEARCH_INDEX_PREFIX=reacthome-events` в ecosystem.config.js
   - Отключить встроенное логирование: `EVENT_LOGGING_ENABLED=false`
   - Мониторинг работы в production режиме

2. **Этап 7: Очистка**
   - Удалить тестовые индексы из OpenSearch
   - Удалить неиспользуемый код (опционально)

## Откат

В случае критических проблем (см. план миграции, раздел "План отката"):

```bash
# Остановить event-logger
pm2 stop reacthome-event-logger
pm2 delete reacthome-event-logger

# Включить встроенное логирование
# В ecosystem.config.js или .env установить:
# EVENT_LOGGING_ENABLED=true

# Перезапустить демон
pm2 restart reacthome-daemon
```

---

**Важно:** Все изменения должны быть закоммичены и запушены в ветку `websocket-logger` перед развертыванием на Raspberry Pi.
