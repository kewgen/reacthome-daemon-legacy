# Резолвинг MAC (DUID демона) по ID проекта через WebSocket

## Проблема

Клиент знает только **ID проекта**, но для подключения к демону через gateway нужен **MAC (DUID демона)**.

**Пример:**
- Известно: `projectId = "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4"`
- Нужно найти: `mac = "d31775ae-19e8-40c9-81df-d6d672379563"`
- Для подключения: `wss://gate.reacthome.net/d31775ae-19e8-40c9-81df-d6d672379563`

## Текущая реализация

### В коде демона

Демон **не предоставляет** API для резолвинга mac по project ID. Связь односторонняя:

```
mac (демон) → project (ID проекта)
```

Обратная связь есть в объекте проекта:
```json
{
  "type": "project",
  "daemon": "d31775ae-19e8-40c9-81df-d6d672379563"  ← обратная ссылка
}
```

### В gateway сервере

Gateway сервер (`gate.reacthome.net`) должен иметь API для резолвинга, но это **внешний сервис**, код которого не находится в этом репозитории.

## Возможные решения

### 1. API на gateway сервере (рекомендуется)

Gateway сервер должен предоставлять REST API:

```http
GET https://gate.reacthome.net/api/daemon/by-project/{projectId}
```

**Ответ:**
```json
{
  "daemonMac": "d31775ae-19e8-40c9-81df-d6d672379563",
  "projectId": "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4",
  "online": true
}
```

### 2. WebSocket запрос к gateway

Gateway может поддерживать WebSocket команду для поиска:

```javascript
// Подключение к gateway
const ws = new WebSocket('wss://gate.reacthome.net/discovery', ['listen']);

// Запрос демона по project ID
ws.send(JSON.stringify({
  type: 'FIND_DAEMON_BY_PROJECT',
  projectId: 'ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4'
}));

// Ответ
{
  "type": "DAEMON_FOUND",
  "daemonMac": "d31775ae-19e8-40c9-81df-d6d672379563"
}
```

### 3. Перебор известных демонов (текущая реализация)

Скрипт `scripts/resolve-mac-by-project-id.js` перебирает известные mac адреса и проверяет project ID каждого демона.

**Ограничения:**
- Требует знания всех mac адресов заранее
- Медленно (последовательные запросы)
- Не масштабируется

## Использование скрипта

```bash
node scripts/resolve-mac-by-project-id.js <PROJECT_ID>
```

**Пример:**
```bash
node scripts/resolve-mac-by-project-id.js ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4
```

**С переменной окружения:**
```bash
REACTHOME_WS_URI="wss://gate.reacthome.net" \
node scripts/resolve-mac-by-project-id.js ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4
```

## Структура данных в БД

### Демон → Проект
```json
{
  "mac": "d31775ae-19e8-40c9-81df-d6d672379563",
  "d31775ae-19e8-40c9-81df-d6d672379563": {
    "type": "daemon",
    "project": "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4"  ← прямая ссылка
  }
}
```

### Проект → Демон
```json
{
  "ee1a67a7-427a-4d9c-a0ec-cbd4b1e567e4": {
    "type": "project",
    "daemon": "d31775ae-19e8-40c9-81df-d6d672379563",  ← обратная ссылка
    "title": "Миндальный"
  }
}
```

## Рекомендации

1. **Реализовать API на gateway сервере** для резолвинга mac по project ID
2. **Добавить индексацию** project → mac на gateway сервере
3. **Кешировать** результаты резолвинга для производительности
4. **Документировать** API endpoint для клиентов

## Связанные файлы

- `scripts/resolve-mac-by-project-id.js` - скрипт для резолвинга
- `scripts/get-daemon-project-duids.js` - получение duid из БД
- `src/websocket/gate.js` - подключение демона к gateway
- `docs/DAEMON_PROJECT_STORAGE.md` - структура хранения в БД
