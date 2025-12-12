# Система логирования изменений актуаторов

**Версия:** 1.1  
**Дата:** 2025-11-24  
**Статус:** Реализовано, оптимизировано и исправлено для Raspberry Pi

## Содержание

1. [Суть системы](#суть-системы)
2. [Технические характеристики сервера](#технические-характеристики-сервера)
3. [Архитектура решения](#архитектура-решения)
4. [Структура логов](#структура-логов)
5. [Фильтрация событий](#фильтрация-событий)
6. [Интеграция с OpenSearch](#интеграция-с-opensearch)
7. [Оптимизации для Raspberry Pi](#оптимизации-для-raspberry-pi)
8. [Нюансы реализации](#нюансы-реализации)
9. [Примеры использования](#примеры-использования)
10. [Сбор и анализ логов](#сбор-и-анализ-логов)

---

## Суть системы

### Цель

Получить event log, отражающий **кто, когда, что и почему** выполнил каждое изменение актуаторов системы.

### Что логируется

Логируются **изменения актуаторов и сенсоров**:

**Актуаторы** (устройства, которые управляют состоянием):
- `value` - включено/выключено (только для актуаторов)
- `brightness` - яркость
- `r`, `g`, `b` - компоненты RGB
- `fan_speed` - скорость вентилятора
- `mode` - режим работы
- `direction` - направление
- `setpoint` - уставка температуры

**Сенсоры** (устройства, которые измеряют состояние):
- `temperature` - температура
- `humidity` - влажность
- `co2` - уровень CO2

**Не логируются:**
- Системные поля (timestamp, initialized, online, ready)
- Изменения без фактического изменения значения

### Формат хранения

- **Формат:** JSON Lines (каждая строка - отдельный JSON объект)
- **Расположение:** `var/log/events-YYYY-MM-DD.jsonl`
- **Ротация:** Автоматическая при достижении 10MB
- **Хранение:** Логи старше 7 дней автоматически удаляются
- **Лимит:** Максимальный размер папки логов - 50MB

### Потеря данных

- **При падении процесса:** До 50 событий (не критично)
- **При ошибках записи:** События сохраняются в памяти до восстановления доступа
- **При переполнении:** События отбрасываются с логированием ошибки

---

## Технические характеристики сервера

### Устройство

- **Модель:** Raspberry Pi Compute Module 4 Rev 1.0
- **Hardware:** BCM2835
- **Архитектура:** aarch64 (ARM64)

### Процессор

- **Ядра:** 4
- **Частота:** 1500 MHz (1.5 GHz)
- **BogoMIPS:** 108.00 (на ядро)

### Память

- **Всего RAM:** 909 MB (~1 GB)
- **Используется:** 188 MB
- **Доступно:** 656 MB
- **Swap:** 99 MB (не используется)

### Диск

- **Файловая система:** /dev/root
- **Размер:** 6.9 GB
- **Используется:** 3.1 GB (46%)
- **Доступно:** 3.6 GB (54%)

### Операционная система

- **ОС:** Debian GNU/Linux 11 (bullseye)
- **Node.js:** v20.19.2 ✅ (полностью поддерживает AsyncLocalStorage)

### Нагрузка системы

- **Uptime:** 101+ дней
- **Load Average:** 0.07, 0.05, 0.06 (очень низкая)
- **Температура:** 67.6°C (нормально для Pi под нагрузкой)

### Влияние на систему логирования

**✅ Положительные факторы:**
- Node.js 20.19.2 поддерживает все необходимые функции
- 4 ядра CPU достаточно для обработки событий
- Низкая нагрузка позволяет добавить логирование без проблем
- 3.6 GB свободного места достаточно для логов (лимит 50MB)

**⚠️ Ограничения:**
- Только 1 GB RAM - требуется контроль использования памяти
- Ограниченное дисковое пространство (6.9 GB) - требуется ротация логов
- Raspberry Pi - ограниченные ресурсы требуют оптимизации

---

## Архитектура решения

### Компоненты

#### 1. Модуль контекста (`src/logging/context.js`)

Использует `AsyncLocalStorage` (Node.js 16+) для передачи контекста через асинхронные операции.

```javascript
const { AsyncLocalStorage } = require('async_hooks');
const contextStore = new AsyncLocalStorage();

module.exports = {
  getStore: () => contextStore.getStore() || {},
  run: (context, callback) => contextStore.run(context, callback)
};
```

**Структура контекста:**
```javascript
{
  type: 'websocket' | 'script' | 'schedule' | 'device' | 'timer',
  ref: '<script_id>' | '<schedule_id>' | null,
  session: '<websocket_session_id>' | null,
  remote_ip: '<ip_address>' | null
}
```

#### 2. Модуль логирования (`src/logging/event-log.js`)

**Основные функции:**
- Батчинг событий (500ms таймер, 50 событий в батче)
- Фильтрация актуаторов и сенсоров по типу устройства
- Асинхронная запись в файл с обработкой ошибок
- Определение названия локации (Site) или проекта (Project) из иерархии state
- Graceful shutdown с flush при завершении процесса
- Резервное хранилище для событий при ошибках записи
- Интеграция с OpenSearch для отправки событий

#### 3. Модуль OpenSearch (`src/logging/opensearch.js`)

**Основные функции:**
- Отправка событий через Bulk API OpenSearch
- Автоматическое создание индексов с маппингом
- Группировка событий по датам
- Резервное хранилище для failed событий
- Повторные попытки при ошибках

**Ключевые алгоритмы:**

1. **Определение типа устройства** - с поддержкой каналов (MAC/do/1, MAC/dim/2)
2. **Fallback определение типа** - для устройств без типа в state
3. **Фильтрация актуаторов** - по списку типов устройств из `src/constants.js`
4. **Получение названия локации/проекта** - рекурсивный обход иерархии state с защитой от циклов:
   - Поддержка обоих регистров: `type === 'site' || type === 'SITE'`
   - Поддержка `site` как строки (ID) или массива
   - Проверка `parent` для каналов и вложенных объектов
   - Приоритет Site над Project
   - Если Site не найден, возвращается Project (например, "pochta", "mindal")
   - По умолчанию используется Project "pochta"
5. **Кеширование** - siteName кешируется на 1 минуту для оптимизации
6. **Глубокое копирование oldState** - предотвращение мутации объекта при сравнении
7. **Передача cleanPayload** - логирование только изменённых параметров

### Точки интеграции

1. **`src/websocket/server.js`** - добавление `remoteAddress` в peer
2. **`src/websocket/handle.js`** - обёртка обработки сообщений в `contextStore.run()`
3. **`src/controllers/service.js`** - исправление `setTimeout` и `CronJob` для сохранения контекста
4. **`src/controllers/device.js`** - добавление контекста для событий от устройств
5. **`src/actions/create.js`** - интеграция логирования в функцию `apply()`

---

## Структура логов

### Формат записи

Каждая запись - JSON объект со следующими полями:

```json
{
  "timestamp": 1763314232510,
  "id": "40:64:06:c0:5d:b5/do/1",
  "device": {
    "type": "DEVICE_TYPE_RELAY_2",
    "human": "Свет Лоджия",
    "code": "light_lodgia",
    "name": "Свет Лоджия"
  },
  "param": "value",
  "old": 0,
  "new": 1,
  "trigger": {
    "type": "script",
    "ref": "002b333c-f189-4c3a-9f36-0a7f6f1d48d3",
    "id": "90:89:d3:f1:2d:0f",
    "human": "Устройство-источник/Название скрипта",
    "session": null,
    "remote_ip": null
  },
  "site": "Лоджия",
  "project": "pochta",
  "extra": {}
}
```

### Описание полей

| Поле | Тип | Описание |
|------|-----|----------|
| `timestamp` | number | Unix timestamp в миллисекундах (время создания события) |
| `id` | string | Идентификатор устройства/канала/скрипта |
| `device.type` | string \| null | Тип устройства (например, "DEVICE_TYPE_RELAY_2") |
| `device.human` | string \| null | Человекочитаемое название устройства (title/code/name через "/") |
| `device.code` | string \| null | Код устройства (если есть) |
| `device.name` | string \| null | Поле name устройства (если есть) |
| `param` | string | Имя изменённого параметра (value, brightness, r, g, b, fan_speed, mode, direction, setpoint, temperature, humidity, co2, executed, last_execution) |
| `old` | any \| null | Предыдущее значение параметра (может быть null для первого значения) |
| `new` | any | Новое значение параметра |
| `trigger.type` | string | Тип триггера (websocket, script, schedule, device, timer, unknown) |
| `trigger.ref` | string \| null | ID скрипта/расписания/таймера, который вызвал изменение |
| `trigger.id` | string \| null | ID устройства-источника (для скриптов, вызванных устройствами) |
| `trigger.human` | string \| null | Человекочитаемое название триггера (title/code/name через "/") |
| `trigger.session` | string \| null | ID WebSocket сессии (для команд через WebSocket) |
| `trigger.remote_ip` | string \| null | IP адрес клиента (для команд через WebSocket) |
| `site` | string \| null | Название локации (Site) или проекта (Project, например "pochta", "mindal") |
| `project` | string | Название проекта (например, "pochta") - всегда присутствует |
| `extra` | object | Дополнительные метаданные (пока пустой объект) |

### Примеры для разных триггеров

**WebSocket команда:**
```json
{
  "trigger": {
    "type": "websocket",
    "ref": null,
    "session": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "remote_ip": "192.168.88.101"
  }
}
```

**Расписание (CronJob):**
```json
{
  "trigger": {
    "type": "schedule",
    "ref": "schedule-id-123",
    "session": null,
    "remote_ip": null
  }
}
```

**Изменение от устройства:**
```json
{
  "trigger": {
    "type": "device",
    "ref": "40:64:06:c0:5d:b5",
    "session": null,
    "remote_ip": null
  }
}
```

---

## Фильтрация событий

### Обзор

Система использует типизированную систему фильтров для определения, какие события отправляются в OpenSearch и файлы.

**Подробная документация:** См. [`EVENT_FILTERS_REFERENCE.md`](./EVENT_FILTERS_REFERENCE.md)

### Основные фильтры

1. **Системные поля** - пропускает `initialized`, `online`, `ready`, `timestamp`
2. **Невалидные значения** - пропускает `undefined`, `null`, `NaN`
3. **Неизменённые значения** - пропускает, если `oldValue === newValue`
4. **Параметр value (актуаторы)** - пропускает `value` для DI каналов и не-актуаторов
5. **Числовые параметры сенсоров** - пропускает, если значение не является валидным числом

### Управление фильтрами

Фильтры можно включать/выключать программно:

```javascript
const filters = require('./logging/filters');

// Получить список фильтров
const filterList = filters.getFilters();

// Включить/выключить фильтр
filters.setFilterEnabled('unchangedValues', false);

// Получить конфигурацию
const config = filters.getFiltersConfig();
```

### Специальные случаи

**События запуска скрипта** (`executed`, `last_execution`) всегда логируются и не проходят через фильтры.

---

## Интеграция с OpenSearch

### Обзор

События автоматически отправляются в **Managed Service for OpenSearch** (Yandex Cloud) для централизованного хранения и анализа.

**Кластер:** `pochta_kl_os`  
**Версия:** OpenSearch 3.3  
**Статус:** Production-ready

### Настройка подключения

#### 1. Установка сертификата

На сервере (Raspberry Pi) выполните:

**Автоматическая установка (рекомендуется):**
```bash
./scripts/install_opensearch_cert.sh
```

**Ручная установка:**
```bash
mkdir -p ~/.opensearch && \
wget "https://storage.yandexcloud.net/cloud-certs/CA.pem" \
     --output-document ~/.opensearch/root.crt && \
chmod 0600 ~/.opensearch/root.crt
```

Сертификат будет сохранён в `~/.opensearch/root.crt` и автоматически использован модулем.

#### 2. Конфигурация через переменные окружения

Интеграция настраивается через переменные окружения:

```bash
# Включить отправку в OpenSearch
export OPENSEARCH_ENABLED=true

# URL кластера OpenSearch (получить в консоли Yandex Cloud)
# Формат: https://<hostname>:9200
# Пример: https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200
export OPENSEARCH_URL=https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200

# Учетные данные (Basic Auth)
export OPENSEARCH_USER=admin
export OPENSEARCH_PASSWORD=your_password

# Префикс индексов (опционально, по умолчанию: reacthome-events)
export OPENSEARCH_INDEX_PREFIX=reacthome-events

# Путь к CA сертификату (опционально, по умолчанию: ~/.opensearch/root.crt)
export OPENSEARCH_CA_CERT=~/.opensearch/root.crt
```

#### 3. Настройка в systemd или pm2

Для постоянной работы добавьте переменные окружения в конфигурацию:

**Для pm2 (`ecosystem.config.js`):**
```javascript
module.exports = {
  apps: [{
    name: 'reacthome-daemon',
    script: 'daemon.js',
    env: {
      OPENSEARCH_ENABLED: 'true',
      OPENSEARCH_URL: 'https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200',
      OPENSEARCH_USER: 'admin',
      OPENSEARCH_PASSWORD: 'your_password',
      OPENSEARCH_INDEX_PREFIX: 'reacthome-events'
    }
  }]
};
```

**Для systemd (`.service` файл):**
```ini
[Service]
Environment="OPENSEARCH_ENABLED=true"
Environment="OPENSEARCH_URL=https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200"
Environment="OPENSEARCH_USER=admin"
Environment="OPENSEARCH_PASSWORD=your_password"
Environment="OPENSEARCH_INDEX_PREFIX=reacthome-events"
```

#### 4. Проверка подключения

После настройки перезапустите демон и проверьте логи:

```bash
# Перезапустить демон
pm2 restart reacthome-daemon

# Проверить логи инициализации
pm2 logs reacthome-daemon | grep opensearch

# Ожидаемый вывод при успешной настройке:
# [opensearch] Используется CA сертификат: /home/pi/.opensearch/root.crt
# [opensearch] OpenSearch интеграция включена: https://...
# [opensearch] Индекс reacthome-events-2025-11-23 создан (при первом событии)
```

**Проверка отправки событий:**

После создания события (например, включения света) проверьте:

```bash
# Проверить логи отправки
pm2 logs reacthome-daemon | grep -E "opensearch|event-log"

# Проверить наличие событий в OpenSearch (требуется доступ к кластеру)
curl -u admin:password \
  --cacert ~/.opensearch/root.crt \
  https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/reacthome-events-*/_count
```

### Архитектура интеграции

#### Модуль OpenSearch (`src/logging/opensearch.js`)

**Функционал:**
- Отправка событий через Bulk API OpenSearch
- Автоматическое создание индексов с маппингом
- Группировка событий по датам (индексы `reacthome-events-YYYY-MM-DD`)
- Резервное хранилище для failed событий
- Повторные попытки при ошибках

**Особенности:**
- **Асинхронная отправка** - не блокирует запись в файл
- **Bulk API** - эффективная отправка батчей событий
- **Автоматический маппинг** - правильные типы полей для поиска
- **Дедупликация** - уникальные ID событий (`id_timestamp_param`)

#### Интеграция с event-log

События отправляются в OpenSearch **параллельно** с записью в файл:

```javascript
// Запись в файл
await fs.promises.appendFile(currentLogFile, lines);

// Отправка в OpenSearch (асинхронно, не блокирует)
if (opensearch.isEnabled()) {
  opensearch.sendBatch(eventsToWrite).catch(err => {
    console.error('[event-log] Ошибка отправки в OpenSearch:', err.message);
  });
}
```

### Структура индексов

**Формат имени индекса:** `reacthome-events-YYYY-MM-DD`

**Примеры:**
- `reacthome-events-2025-11-23`
- `reacthome-events-2025-11-24`

**Маппинг полей:**

```json
{
  "mappings": {
    "properties": {
      "timestamp": { "type": "date" },
      "id": { "type": "keyword" },
      "device": {
        "properties": {
          "type": { "type": "keyword" },
          "human": { 
            "type": "text",
            "fields": { "keyword": { "type": "keyword" } }
          },
          "code": { "type": "keyword" },
          "name": { "type": "keyword" }
        }
      },
      "param": { "type": "keyword" },
      "old": { "type": "text" },
      "new": { "type": "text" },
      "trigger": {
        "properties": {
          "type": { "type": "keyword" },
          "ref": { "type": "keyword" },
          "id": { "type": "keyword" },
          "human": { 
            "type": "text",
            "fields": { "keyword": { "type": "keyword" } }
          },
          "session": { "type": "keyword" },
          "remote_ip": { "type": "ip" }
        }
      },
      "site": { "type": "keyword" },
      "extra": { "type": "object", "enabled": false }
    }
  }
}
```

### Обработка ошибок

**Резервное хранилище:**
- События при ошибках сохраняются в памяти
- Максимальный размер: 100 событий
- Автоматическая повторная отправка через 30 секунд
- Периодическая повторная отправка раз в минуту

**Логирование:**
- Ошибки отправки логируются в консоль
- Не блокирует запись в файл
- Не блокирует основной поток демона

### Производительность

**Оптимизации:**
- Bulk API для батчевой отправки
- Группировка по датам для эффективной индексации
- Асинхронная отправка (не блокирует файловую запись)
- Автоматическое создание индексов при первом использовании

**Нагрузка на Raspberry Pi:**
- Минимальная - отправка происходит асинхронно
- При недоступности OpenSearch события сохраняются в файл
- Не влияет на производительность основной системы

### Примеры запросов в OpenSearch

**Все события за сегодня:**
```json
GET /reacthome-events-2025-11-23/_search
{
  "query": { "match_all": {} },
  "sort": [{ "timestamp": "desc" }],
  "size": 100
}
```

**События конкретного устройства:**
```json
GET /reacthome-events-*/_search
{
  "query": {
    "term": { "id": "40:64:06:c0:5d:b5" }
  }
}
```

**События от скриптов:**
```json
GET /reacthome-events-*/_search
{
  "query": {
    "term": { "trigger.type": "script" }
  }
}
```

**События по локации:**
```json
GET /reacthome-events-*/_search
{
  "query": {
    "term": { "site": "Лоджия" }
  }
}
```

**Агрегация по типам триггеров:**
```json
GET /reacthome-events-*/_search
{
  "size": 0,
  "aggs": {
    "trigger_types": {
      "terms": { "field": "trigger.type" }
    }
  }
}
```

**Временной анализ (по часам):**
```json
GET /reacthome-events-*/_search
{
  "size": 0,
  "aggs": {
    "events_by_hour": {
      "date_histogram": {
        "field": "timestamp",
        "calendar_interval": "hour"
      }
    }
  }
}
```

### Мониторинг

**OpenSearch Dashboards:**

Для визуального просмотра и анализа событий используйте OpenSearch Dashboards:

**URL дашборда:**
```
https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net/app/home#/
```

**Авторизация:**
- Используйте те же учетные данные, что и для API
- Пользователь: `admin` (или значение из `OPENSEARCH_USER`)
- Пароль: значение из переменной окружения `OPENSEARCH_PASSWORD`

**Создание Index Pattern:**
1. Перейдите в **Management** → **Stack Management** → **Index Patterns**
2. Создайте pattern: `reacthome-events-*`
3. Выберите поле `timestamp` как Time field

**Проверка статуса:**
```bash
# Проверить доступность OpenSearch (с сертификатом)
curl -u admin:password \
  --cacert ~/.opensearch/root.crt \
  https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/_cluster/health

# Список индексов
curl -u admin:password \
  --cacert ~/.opensearch/root.crt \
  https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/_cat/indices/reacthome-events-*

# Статистика индекса
curl -u admin:password \
  --cacert ~/.opensearch/root.crt \
  https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/reacthome-events-2025-11-23/_stats

# Проверка последних событий
curl -u admin:password \
  --cacert ~/.opensearch/root.crt \
  https://c-c9q1p4fggl654fni7le4.rw.mdb.yandexcloud.net:9200/reacthome-events-*/_search?size=10&sort=timestamp:desc
```

**Логи демона:**
- `[opensearch] OpenSearch интеграция включена` - успешная инициализация
- `[opensearch] Индекс создан` - создание нового индекса
- `[opensearch] Ошибка отправки` - ошибки отправки
- `[opensearch] Recovered N failed events` - успешное восстановление

---

## Оптимизации для Raspberry Pi

### 1. Уменьшена частота операций записи

- **Батч-таймер:** 100ms → **500ms** (в 5 раз реже)
- **Периодический flush:** 5s → **10s** (в 2 раза реже)
- **Результат:** Снижена нагрузка на диск и CPU

### 2. Ограничение использования памяти

- **Размер failedBatch:** 100 → **50 событий**
- **Кеш siteName:** TTL 1 минута с автоматической очисткой
- **Результат:** Контроль использования RAM (важно для 1GB памяти)

### 3. Ротация и очистка логов

- **Автоматическое удаление:** Логи старше 7 дней
- **Ротация файлов:** При превышении 10MB
- **Лимит размера папки:** Максимум 50MB
- **Периодическая очистка:** Раз в час
- **Результат:** Защита от переполнения диска (6.9GB всего)

### 4. Оптимизация производительности

- **Кеширование getSiteName:** Избегаем рекурсивных обходов
- **Упрощённая проверка дискового пространства:** Не блокирует запись
- **Оптимизированная сериализация JSON:** Один проход для батча
- **Результат:** Меньше нагрузка на CPU

### 5. Защита от переполнения

- **Проверка доступного места:** Перед записью
- **Пропуск записи:** При нехватке места (не расходует память)
- **Автоматическая очистка:** При превышении лимитов
- **Результат:** Система не упадёт из-за нехватки ресурсов

---

## Нюансы реализации

### 1. AsyncLocalStorage не покрывает setTimeout с delay

**Проблема:** `setTimeout` с задержкой теряет контекст AsyncLocalStorage.

**Решение:** Явная передача контекста через замыкание:

```javascript
const currentContext = contextStore.getStore();
const scriptContext = { ...currentContext, type: 'script', ref: id };
setTimeout(() => {
  contextStore.run(scriptContext, () => {
    run(a);
  });
}, delay);
```

### 2. WebSocket - получение IP адреса клиента

**Проблема:** `socket._socket?.remoteAddress` - приватное поле, может быть недоступно.

**Решение:** Проверка нескольких способов получения IP:

```javascript
remoteAddress: socket._socket?.remoteAddress 
  || socket.remoteAddress 
  || socket._socket?.socket?.remoteAddress
  || socket.upgradeReq?.connection?.remoteAddress
  || socket.upgradeReq?.socket?.remoteAddress
  || 'unknown'
```

### 3. Потеря контекста в CronJob расписаниях

**Проблема:** Callback CronJob выполняется вне контекста AsyncLocalStorage.

**Решение:** Сохранение контекста при создании CronJob:

```javascript
const scriptContext = { type: 'schedule', ref: id };
schedules[id] = new CronJob(schedule, () => {
  contextStore.run(scriptContext, () => {
    run({ type: ACTION_SCRIPT_RUN, id: script });
  });
}, ...);
```

### 4. Фильтрация актуаторов - поддержка каналов

**Проблема:** Каналы устройств (MAC/do/1, MAC/dim/2) не имеют типа напрямую.

**Решение:** Извлечение типа из родительского устройства:

```javascript
const getDeviceType = (id) => {
  const dev = state.get(id);
  if (dev && dev.type !== undefined) return dev.type;
  
  // Извлечь MAC-адрес из ID канала
  const parts = id.split('/');
  if (parts.length >= 2 && parts[0].includes(':')) {
    const parentId = parts[0]; // MAC-адрес
    const parent = state.get(parentId);
    return parent?.type;
  }
  return null;
};
```

### 5. Защита от циклов в getSiteName

**Проблема:** Рекурсивный обход иерархии state может попасть в бесконечный цикл.

**Решение:** Защита через `visited` Set и `maxDepth`, приоритет Site над Project:

```javascript
const getSiteName = (id, maxDepth = 10, visited = new Set()) => {
  if (visited.has(id) || maxDepth <= 0) return null;
  visited.add(id);
  
  // Проверить, является ли текущий элемент локацией (Site)
  // Поддержка обоих регистров: 'site' и 'SITE'
  if (current.type === 'site' || current.type === 'SITE') {
    return current.title || current.code || null;
  }
  
  // Проверить, является ли текущий элемент проектом (Project)
  // Поддержка обоих регистров: 'project' и 'PROJECT'
  if (current.type === 'project' || current.type === 'PROJECT') {
    return current.title || current.code || null; // pochta, mindal
  }
  
  // Приоритет site над project
  // Поддержка site как строки (ID) или массива
  if (current.site) {
    let siteId = Array.isArray(current.site) ? current.site[0] : current.site;
    if (siteId) {
      return getSiteName(siteId, maxDepth - 1, visited);
    }
  }
  
  // Проверить parent для каналов и вложенных объектов
  if (current.parent) {
    return getSiteName(current.parent, maxDepth - 1, visited);
  }
  
  // ... fallback на project (pochta, mindal)
};
```

### 6. Наследование контекста для вложенных скриптов

**Проблема:** Если скрипт запускает другой скрипт, контекст может теряться.

**Решение:** Наследование контекста от родительского скрипта:

```javascript
const currentContext = contextStore.getStore() || {};
const scriptContext = {
  ...currentContext, // Наследовать все поля
  type: currentContext.type || 'script',
  ref: id // Обновить ref на текущий скрипт
};
```

### 7. Graceful shutdown

**Проблема:** При падении процесса теряются события в батче.

**Решение:** Обработка сигналов SIGTERM/SIGINT с flush батча:

```javascript
process.on('SIGTERM', async () => {
  isShuttingDown = true;
  await flush(); // Немедленный flush всех событий
  process.exit(0);
});
```

### 8. Резервное хранилище при ошибках записи

**Проблема:** При ошибках записи (диск переполнен) события теряются.

**Решение:** Сохранение событий в памяти с повторными попытками:

```javascript
try {
  await fs.promises.appendFile(currentLogFile, lines);
} catch (err) {
  failedBatch.push(...eventsToWrite);
  // Повторная попытка через 10 секунд
  setTimeout(() => writeBatch(), 10000);
}
```

### 9. Глубокое копирование oldState

**Проблема:** `state.get(id)` возвращает ссылку на объект, а не копию. При вызове `state.set(id, payload)` объект мутируется через `Object.assign`, поэтому `oldState` и `newState` указывают на один объект, и сравнение значений становится некорректным.

**Решение:** Глубокое копирование `oldState` перед изменением:

```javascript
const oldStateRaw = state.get(id);
const oldState = oldStateRaw ? JSON.parse(JSON.stringify(oldStateRaw)) : {};
state.set(id, payload);
const newState = state.get(id);
```

### 10. Передача cleanPayload для правильного сравнения

**Проблема:** `state.set` делает merge через `Object.assign`, поэтому `newState` содержит все поля, а не только изменённые. Это приводит к тому, что для параметров, не переданных в `payload`, `old` и `new` будут одинаковыми.

**Решение:** Передача `cleanPayload` (без системных полей) в `eventLog.add` для сравнения только изменённых параметров:

```javascript
const cleanPayload = { ...payload };
delete cleanPayload.timestamp; // timestamp - системное поле
eventLog.add(id, oldState, newState, context, cleanPayload);
```

---

## Примеры использования

### Базовые запросы с jq

**Все события за сегодня:**
```bash
cat var/log/events-2025-11-23.jsonl | jq '.'
```

**События конкретного устройства:**
```bash
cat var/log/events-2025-11-23.jsonl | jq 'select(.id == "40:64:06:c0:5d:b5")'
```

**События от скриптов:**
```bash
cat var/log/events-2025-11-23.jsonl | jq 'select(.trigger.type == "script")'
```

**События по локации:**
```bash
cat var/log/events-2025-11-23.jsonl | jq 'select(.site == "Лоджия")'
```

**Кто включил свет в Лоджии:**
```bash
cat var/log/events-*.jsonl | \
  jq 'select(.site == "Лоджия" and .param == "value" and .new == 1) | 
      {time: .timestamp, device: .device.human, trigger: .trigger}'
```

**Изменения температуры в Лоджии:**
```bash
cat var/log/events-*.jsonl | \
  jq 'select(.site == "Лоджия" and .param == "temperature") | 
      {time: .timestamp, device: .device.human, old: .old, new: .new}'
```

**Какие скрипты выполнялись сегодня:**
```bash
cat var/log/events-2025-11-23.jsonl | \
  jq 'select(.trigger.type == "script") | .trigger.ref' | \
  sort | uniq -c | sort -rn
```

---

## Сбор и анализ логов

### Сбор логов с сервера

**Скрипт для сбора:** `scripts/collect_event_logs.expect` (планируется)

**Ручной сбор через SSH:**
```bash
scp pi@192.168.88.4:/home/pi/reacthome-daemon-legacy-main/var/log/events-*.jsonl ./logs/events/
```

### Анализ логов

**Python скрипт для анализа:** `scripts/analyze_event_logs.py` (планируется)

**Базовый анализ с jq:**
```bash
# Статистика по типам триггеров
cat var/log/events-*.jsonl | jq -r '.trigger.type' | sort | uniq -c

# Статистика по устройствам
cat var/log/events-*.jsonl | jq -r '.id' | sort | uniq -c | sort -rn | head -10

# Статистика по часам
cat var/log/events-*.jsonl | \
  jq -r '.timestamp | tostring | .[0:10] | strptime("%s") | strftime("%H")' | \
  sort | uniq -c
```

---

## Связанные документы

- **Справочник по структуре событий:** [`EVENT_STRUCTURE_REFERENCE.md`](./EVENT_STRUCTURE_REFERENCE.md) - подробное описание всех полей события
- **Детальный план:** [`docs/Observability.Plan.md`](./Observability.Plan.md)
- **Характеристики сервера:** [`reports/hardware-info-2025-11-23.md`](../reports/hardware-info-2025-11-23.md)
- **Структура проекта:** [`docs/PROJECT_DESCRIPTION.md`](./PROJECT_DESCRIPTION.md)

---

## Статус реализации

✅ **Реализовано:**
- Модуль контекста (`src/logging/context.js`)
- Модуль логирования (`src/logging/event-log.js`)
- Интеграция во все точки входа
- Оптимизации для Raspberry Pi
- Graceful shutdown
- Резервное хранилище
- Ротация и очистка логов

✅ **Готово к тестированию:**
- Все файлы созданы и проверены
- Синтаксис корректен
- Ошибок линтера нет
- Оптимизации применены

📋 **Планируется:**
- Скрипты для сбора логов
- Python утилиты для анализа
- Визуализация данных

