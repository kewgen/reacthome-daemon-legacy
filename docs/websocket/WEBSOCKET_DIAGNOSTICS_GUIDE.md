# Руководство по диагностике и исправлению WebSocket на Raspberry Pi

**Дата создания:** 2025-12-07  
**Версия:** 1.0

## Обзор

Это руководство описывает процесс диагностики и исправления проблем с WebSocket на Raspberry Pi.

## Быстрый старт

### 1. Локальный тест WebSocket

Перед диагностикой на Raspberry Pi, проверьте соединение локально:

```bash
# Тест подключения к локальному демону
node tests/websocket/test-websocket-connection.js

# Тест подключения к Raspberry Pi
node tests/websocket/test-websocket-connection.js ws://192.168.88.4:3000
```

**Что проверяет тест:**
- ✅ Установление соединения
- ✅ Отправка тестовых сообщений (LIST, GET, ACTION_SET)
- ✅ Получение ответов от сервера
- ✅ Обработка ошибок и закрытия соединения

### 2. Настройка логирования на Raspberry Pi

Для детальной диагностики настройте расширенное логирование:

```bash
# Настройка логирования через SSH
./scripts/system/setup-websocket-logging-on-pi.sh
```

**Что делает скрипт:**
- ✅ Создаёт резервную копию `server.js`
- ✅ Добавляет детальное логирование всех событий WebSocket
- ✅ Логирует IP адреса клиентов
- ✅ Логирует детали ошибок
- ✅ Перезапускает демон

### 3. Диагностика проблем

Запустите полную диагностику:

```bash
# Полная диагностика WebSocket на Raspberry Pi
./scripts/system/diagnose-websocket-on-pi.sh
```

**Что проверяет скрипт:**
- ✅ Доступность хоста
- ✅ Открыт ли порт 3000
- ✅ Статус PM2 процессов
- ✅ Версии Node.js и библиотеки ws
- ✅ Активные подключения
- ✅ Логи WebSocket
- ✅ Ошибки в логах
- ✅ Тест локального подключения на Pi

## Детальное описание

### Тест WebSocket соединения

**Файл:** `tests/websocket/test-websocket-connection.js`

**Параметры:**
- `REACTHOME_WS_URI` - URL WebSocket (по умолчанию: `ws://localhost:3000`)
- Аргумент командной строки: `ws://host:port`

**Примеры использования:**

```bash
# Локальный тест
node tests/websocket/test-websocket-connection.js

# Тест удалённого подключения
node tests/websocket/test-websocket-connection.js ws://192.168.88.4:3000

# С переменной окружения
REACTHOME_WS_URI=ws://192.168.88.4:3000 node tests/websocket/test-websocket-connection.js
```

**Вывод теста:**
- ✅ Успешное подключение
- 📨 Количество полученных сообщений
- ❌ Ошибки (если есть)
- ⏱️ Длительность теста

### Настройка логирования

**Файл:** `scripts/system/setup-websocket-logging-on-pi.sh`

**Требования:**
- Переменная `REACTHOME_PI_PASS` в `.env` файле
- Доступ к Raspberry Pi по SSH

**Что добавляется в логирование:**

1. **Событие подключения:**
   ```
   [WEBSOCKET] DEBUG: Событие connection получено
   [WEBSOCKET] DEBUG: req.socket?.remoteAddress = ...
   [WEBSOCKET] DEBUG: req.connection?.remoteAddress = ...
   [WEBSOCKET] DEBUG: req.socket?.remoteFamily = ...
   [WEBSOCKET] Новое подключение: <session> IP: <ip>
   ```

2. **Получение сообщений:**
   ```
   [WEBSOCKET] DEBUG: Получено сообщение от <session>: <message>
   ```

3. **Ошибки:**
   ```
   [WEBSOCKET] Ошибка сокета <session> (<ip>): <error>
   [WEBSOCKET] DEBUG: socket error details: { code, errno, syscall, ... }
   ```

4. **Закрытие соединения:**
   ```
   [WEBSOCKET] Соединение закрыто: <session> (<ip>) код: <code> причина: <reason>
   [WEBSOCKET] DEBUG: close event - code=..., reason=..., wasClean=...
   ```

### Диагностика

**Файл:** `scripts/system/diagnose-websocket-on-pi.sh`

**Проверки:**

1. **Сетевая доступность:**
   - Ping хоста
   - Открыт ли порт 3000

2. **Процессы:**
   - Статус PM2
   - Информация о демоне
   - Статус event-logger (если запущен)

3. **Конфигурация:**
   - Версия Node.js
   - Версия библиотеки ws
   - Настройки логирования

4. **Логи:**
   - Последние логи WebSocket
   - Ошибки в логах
   - Логи event-logger

5. **Подключения:**
   - Активные подключения к порту 3000
   - Тест локального подключения

## Типичные проблемы и решения

### Проблема 1: Порт 3000 не открыт

**Симптомы:**
- Тест не может подключиться
- `netstat` не показывает порт 3000

**Решение:**
```bash
# Проверьте, запущен ли демон
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 status'

# Если не запущен, запустите
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 start daemon.js --name daemon'
```

### Проблема 2: Соединение закрывается сразу

**Симптомы:**
- Подключение устанавливается, но сразу закрывается
- В логах: `[WEBSOCKET] Соединение закрыто: ... код: 1006`

**Решение:**
1. Проверьте логи с расширенным логированием
2. Ищите ошибки перед закрытием
3. Проверьте обработчик `close` в `server.js`

### Проблема 3: Нет ответов на сообщения

**Симптомы:**
- Подключение установлено
- Сообщения отправляются, но ответов нет

**Решение:**
1. Проверьте логи обработки сообщений
2. Проверьте функцию `handle()` в `src/websocket/handle.js`
3. Убедитесь, что сообщения в правильном формате JSON

### Проблема 4: Event-logger не может подключиться

**Симптомы:**
- Event-logger запущен, но не получает события
- В логах event-logger: ошибки подключения

**Решение:**
1. Проверьте URL в `event-logger.js` или `ecosystem.config.js`
2. Убедитесь, что используется IP адрес Pi, а не `localhost`
3. Проверьте логи демона на предмет подключений от event-logger

## Переменные окружения

Создайте файл `.env` в корне проекта:

```bash
# Raspberry Pi настройки
REACTHOME_PI_HOST=192.168.88.4
REACTHOME_PI_USER=pi
REACTHOME_PI_PASS=ваш_пароль

# WebSocket URL (для тестов)
REACTHOME_WS_URI=ws://192.168.88.4:3000
```

## Полезные команды

### Просмотр логов на Raspberry Pi

```bash
# Все логи демона
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 logs daemon --lines 100'

# Только логи WebSocket
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 logs daemon --lines 200 | grep -i websocket'

# Логи event-logger
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 logs events --lines 50'
```

### Перезапуск демона

```bash
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && pm2 restart daemon'
```

### Проверка порта

```bash
ssh pi@192.168.88.4 'netstat -tuln | grep 3000'
# или
ssh pi@192.168.88.4 'ss -tuln | grep 3000'
```

## Следующие шаги

После диагностики:

1. **Если проблема найдена:**
   - Исправьте проблему
   - Перезапустите демон
   - Повторите тест

2. **Если проблема не найдена:**
   - Увеличьте уровень логирования
   - Проверьте сетевые настройки
   - Проверьте firewall на Raspberry Pi

3. **Если всё работает:**
   - Сохраните рабочую конфигурацию
   - Обновите документацию

---

**Версия документа:** 1.0  
**Последнее обновление:** 2025-12-07

