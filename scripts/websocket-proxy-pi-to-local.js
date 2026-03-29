#!/usr/bin/env node

/**
 * ============================================================================
 * WebSocket Proxy: Малинка ↔ Локальный сервер
 * ============================================================================
 * 
 * Версия: 1.2.2
 * 
 * История версий:
 * - 1.2.2 - Повышен порог beep до 60 сообщений в секунду
 * - 1.2.1 - Счётчик блокировок выводится жёлтым цветом через слеш с отправляемыми
 * - 1.2.0 - Добавлена блокировка сообщений local→pi по умолчанию
 * - 1.1.0 - Добавлена защита от дублирования сообщений (дедупликация)
 * - 1.0.0 - Начальная версия
 * 
 * Прокси для двусторонней пересылки сообщений между вебсокетом малинки
 * и локальным вебсокет-сервером (копией умного дома).
 * 
 * Зачем: Создает мост между вебсокетом малинки и локальной копией умного дома,
 *        позволяя синхронизировать состояние и события в обе стороны.
 * 
 * ============================================================================
 * ПРИНЦИП РАБОТЫ
 * ============================================================================
 * 
 * Прокси работает как двусторонний мост:
 * 
 *    Малинка (ws://192.168.88.4:3000)  ↔  Прокси  ↔  Локальный сервер (ws://localhost:3000)
 * 
 * 1. Подключается к вебсокету малинки как клиент
 * 2. Подключается к локальному вебсокет-серверу как клиент
 * 3. Получает все сообщения от малинки и пересылает на локальный сервер
 * 4. Получает все сообщения от локального сервера и пересылает на малинку
 * 5. Логирует все сообщения в файл logs/websocket-proxy.log
 * 
 * ============================================================================
 * ПОЧЕМУ ПРОКСИ ПОЛУЧАЕТ ВСЕ СООБЩЕНИЯ
 * ============================================================================
 * 
 * Вебсокет-сервер на малинке использует паттерн Pub/Sub (публикация/подписка):
 * 
 * - При подключении клиент регистрируется в Map peers с уникальной сессией
 * - При любом изменении состояния вызывается broadcast(), который отправляет
 *   сообщение ВСЕМ подключенным клиентам через peer.send()
 * - Прокси подключается как обычный клиент, поэтому получает все broadcast-сообщения
 * 
 * Когда НЕ происходит broadcast:
 * - Ответы на LIST и GET запросы (отправляются только запросившему клиенту)
 * - ACTION_SET с id === "pool" (внутренние операции)
 * - Персональные потоки (PTY терминал, видео камеры, SIP звонки с call_id)
 * 
 * ============================================================================
 * ФОРМАТ СООБЩЕНИЙ
 * ============================================================================
 * 
 * Все сообщения в формате JSON (UTF-8):
 * 
 * {
 *   "type": "ACTION_SET",           // Тип сообщения (обязательное поле)
 *   "id": "uuid или MAC-адрес",     // ID объекта (обязательное поле)
 *   "payload": {                    // Данные сообщения (обязательное поле)
 *     "field1": "value1",
 *     "timestamp": 1765367435046    // Всегда присутствует в payload
 *   },
 *   "_context": null                // Контекст выполнения (обязательное поле)
 * }
 * 
 * Поле _context:
 * - null - для обычных сообщений
 * - {type: "script", trace_id: "...", ref: "..."} - для сообщений от выполнения скриптов
 * 
 * Типы сообщений:
 * - ACTION_SET - обновление состояния объекта (наиболее частые)
 * - LIST - ответ на запрос списка объектов
 * - GET - ответ на запрос данных объектов
 * - ACTION_ASSIST - ответ голосового ассистента
 * - И другие типы команд управления
 * 
 * ============================================================================
 * ПРИЗНАКИ ВЫПОЛНЕНИЯ СКРИПТОВ
 * ============================================================================
 * 
 * Сообщения от выполнения скриптов имеют:
 * - _context.type == "script"
 * - _context.trace_id - уникальный ID выполнения (группирует все действия скрипта)
 * - _context.ref - UUID скрипта, который выполняется
 * 
 * Последовательности сообщений с одинаковым trace_id - это цепочка выполнения скрипта.
 * 
 * ============================================================================
 * ИСПОЛЬЗОВАНИЕ
 * ============================================================================
 * 
 * БЫСТРЫЙ СТАРТ:
 * 
 * 1. Перейдите в директорию проекта:
 *    cd /Users/evgen/Documents/Work/reacthome-main
 * 
 * 2. Запустите прокси:
 *    node scripts/websocket-proxy-pi-to-local.js
 * 
 * 3. Для остановки нажмите Ctrl+C
 * 
 * ЗАПУСК В ФОНОВОМ РЕЖИМЕ:
 * 
 * Запуск в фоне с перенаправлением вывода:
 *    nohup node scripts/websocket-proxy-pi-to-local.js > logs/websocket-proxy.log 2>&1 &
 * 
 * Или просто в фоне:
 *    node scripts/websocket-proxy-pi-to-local.js &
 * 
 * ОСТАНОВКА:
 * 
 * Остановка по имени процесса:
 *    pkill -f "websocket-proxy-pi-to-local"
 * 
 * Или найти PID и остановить:
 *    ps aux | grep "websocket-proxy-pi-to-local"
 *    kill <PID>
 * 
 * ПРОВЕРКА СТАТУСА:
 * 
 * Проверить, запущен ли прокси:
 *    ps aux | grep "websocket-proxy-pi-to-local" | grep -v grep
 * 
 * Просмотр логов в реальном времени:
 *    tail -f logs/pi-messages.log          # Сообщения от малинки
 *    tail -f logs/to-pi-messages.log      # Сообщения к малинке
 * 
 * ПРОСМОТР СТАТИСТИКИ:
 * 
 * При запуске в интерактивном режиме статистика обновляется в реальном времени
 * в одной строке консоли каждые 500мс в формате:
 * 
 *    📊 Малинка✅: X✅/Y❌ | Локальный✅: X✅/Y❌ | Ошибок: Z [б:N] [попытка:N]
 * 
 * Где:
 *    - X✅ - количество успешно обработанных сообщений
 *    - Y❌ - количество необработанных сообщений (в буфере или ошибка)
 *    - Z - общее количество ошибок
 *    - [б:N] - размер буфера сообщений (если есть)
 *    - [попытка:N] - номер попытки переподключения (если не подключено)
 * 
 * ============================================================================
 * ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
 * ============================================================================
 * 
 * Можно задать в .env файле или экспортировать:
 * 
 *   REACTHOME_PI_HOST      - адрес малинки (по умолчанию: 192.168.88.4)
 *   REACTHOME_PI_WS_PORT   - порт вебсокета малинки (по умолчанию: 3000)
 *   LOCAL_WS_HOST          - адрес локального сервера (по умолчанию: localhost)
 *   LOCAL_WS_PORT          - порт локального сервера (по умолчанию: 3000)
 *   DEVICE_MONITORING_ENABLED - включить мониторинг устройств (по умолчанию: true)
 *   DEVICE_MONITORING_MODE - режим мониторинга устройств:
 *                           'true' - только таблица устройств
 *                           'combined' - устройства + статистика прокси
 *                           не установлено/false - только статистика прокси
 *   DEVICE_DB_PATH        - путь к БД устройств (по умолчанию: ./var/db)
 *   ALLOW_LOCAL_TO_PI     - разрешить пересылку сообщений local→pi (по умолчанию: false, блокировка включена)
 * 
 * ============================================================================
 * ОСОБЕННОСТИ И ВОЗМОЖНОСТИ
 * ============================================================================
 * 
 * ПОДКЛЮЧЕНИЕ И ПЕРЕПОДКЛЮЧЕНИЕ:
 * 
 * - Автоматическое переподключение при разрыве соединения
 * - Умная логика переподключения с учетом типа ошибки:
 *   * Постоянные ошибки (ECONNREFUSED, EHOSTUNREACH) - большая задержка, меньше попыток
 *   * Временные ошибки (ETIMEDOUT, ECONNRESET) - меньшая задержка, больше попыток
 * - Проверка доступности портов перед подключением (экономит ресурсы)
 * - Раздельные таймауты и счетчики для каждого подключения
 * - Экспоненциальная задержка переподключения (от 3 сек до 1 минуты)
 * - Максимум 10 попыток переподключения для постоянных ошибок
 * 
 * БУФЕРИЗАЦИЯ И НАДЕЖНОСТЬ:
 * 
 * - Буферизация сообщений при недоступности одного из сервисов (до 1000 сообщений)
 * - Автоматическая отправка накопленных сообщений при восстановлении соединения
 * - Graceful degradation - работа с одним подключением, если другое недоступно
 * - Защита от переполнения буфера (старые сообщения отбрасываются при переполнении)
 * 
 * ЛОГИРОВАНИЕ И МОНИТОРИНГ:
 * 
 * - Логирование всех сообщений с полным JSON-содержимым в отдельные файлы
 * - Компактный вывод статистики в реальном времени (обновление каждые 500мс)
 * - Статистика показывает успешные и неуспешные обработки
 * - Отображение размеров буферов и попыток переподключения
 * - Корректная обработка сигналов завершения (Ctrl+C) с финальной статистикой
 * 
 * ПРОИЗВОДИТЕЛЬНОСТЬ:
 * 
 * - Асинхронная запись логов (не блокирует основной поток)
 * - Минимальный вывод в консоль (только важная информация)
 * - Оптимизированная обработка ошибок подключения
 * 
 * ============================================================================
 * ВАЖНО
 * ============================================================================
 * 
 * ⚠️  ВНИМАНИЕ: Двусторонняя пересылка означает, что сообщения с локального
 *    сервера будут отправляться на малинку и могут влиять на реальные устройства!
 * 
 *    Используйте с осторожностью, чтобы не конфликтовать с реальными устройствами.
 * 
 * ============================================================================
 * ЛОГИ
 * ============================================================================
 * 
 * Все сообщения логируются в консоль и в отдельные файлы:
 * 
 * - logs/pi-messages.log - все сообщения от малинки
 *   (отдельный файл для анализа сообщений от малинки)
 * 
 * - logs/to-pi-messages.log - все сообщения к малинке
 *   (отдельный файл для анализа команд управления, отправляемых на малинку)
 * 
 * Формат лога в консоли:
 *   [timestamp] 📨 #N Тип: ACTION_SET
 *      Размер: XXX байт
 *      Содержимое: {полный JSON}
 * 
 * Для сообщений от локального сервера:
 *   [timestamp] 📤 #N От локального → малинка Тип: ACTION_SET
 * 
 * Формат лога в файле logs/pi-messages.log:
 *   [timestamp] #N Тип: ACTION_SET
 *   Размер: XXX байт
 *   Содержимое: {полный JSON}
 *   ────────────────────────────────────────────────────────────────
 * 
 * Формат лога в файле logs/to-pi-messages.log:
 *   [timestamp] #N Тип: ACTION_SET
 *   Размер: XXX байт
 *   Содержимое: {полный JSON}
 *   ────────────────────────────────────────────────────────────────
 * 
 * ============================================================================
 * СТАТИСТИКА И МОНИТОРИНГ
 * ============================================================================
 * 
 * СТАТИСТИКА В РЕАЛЬНОМ ВРЕМЕНИ:
 * 
 * При запуске в интерактивном режиме (TTY) статистика обновляется каждые 500мс
 * в одной строке консоли без создания новых строк:
 * 
 *    📊 Малинка✅: 150✅/5❌ | Локальный✅: 120✅/0❌ | Ошибок: 2 [б:5]
 * 
 * Формат статистики:
 *    Малинка✅/❌: X✅/Y❌
 *      - X✅ - успешно отправлено на локальный сервер
 *      - Y❌ - не отправлено (в буфере или ошибка)
 *    
 *    Локальный✅/❌: X✅/Y❌
 *      - X✅ - успешно отправлено на малинку
 *      - Y❌ - не отправлено (в буфере или ошибка)
 *    
 *    Ошибок: Z - общее количество ошибок подключения/отправки
 *    
 *    [б:N] - размер буфера сообщений (если есть накопленные сообщения)
 *    
 *    [попытка:N] - номер попытки переподключения (если сервис недоступен)
 * 
 * ФИНАЛЬНАЯ СТАТИСТИКА:
 * 
 * При завершении (Ctrl+C) выводится подробная финальная статистика:
 *    - Общее количество полученных и отправленных сообщений
 *    - Количество ошибок
 *    - Размеры буферов на момент завершения
 * 
 * ЛОГИРОВАНИЕ В ФАЙЛЫ:
 * 
 * Все сообщения детально логируются в файлы:
 *    - logs/pi-messages.log - все сообщения от малинки
 *    - logs/to-pi-messages.log - все сообщения к малинке
 * 
 * Формат лога в файле:
 *    [timestamp] #N Тип: ACTION_SET
 *    Размер: XXX байт
 *    Содержимое: {полный JSON}
 *    ────────────────────────────────────────────────────────────────
 * 
 * ============================================================================
 * УСТРАНЕНИЕ НЕПОЛАДОК
 * ============================================================================
 * 
 * ПРОБЛЕМА: Прокси не подключается к малинке
 * 
 * Решение:
 *    1. Проверьте доступность малинки: ping 192.168.88.4
 *    2. Проверьте порт: telnet 192.168.88.4 3000
 *    3. Проверьте переменные окружения: echo $REACTHOME_PI_HOST
 *    4. Проверьте логи на ошибки подключения
 * 
 * ПРОБЛЕМА: Локальный сервер недоступен
 * 
 * Решение:
 *    1. Убедитесь, что локальный сервер запущен: ps aux | grep node
 *    2. Проверьте порт: lsof -i :3000
 *    3. Сообщения будут буферизоваться до восстановления соединения
 * 
 * ПРОБЛЕМА: Буфер переполняется
 * 
 * Решение:
 *    1. Буфер ограничен 1000 сообщениями для защиты от утечек памяти
 *    2. При переполнении старые сообщения отбрасываются
 *    3. Восстановите соединение с недоступным сервисом
 *    4. После восстановления новые сообщения будут отправляться сразу
 * 
 * ПРОБЛЕМА: Статистика не отображается
 * 
 * Решение:
 *    1. Убедитесь, что запускаете в интерактивном режиме (не через nohup)
 *    2. Проверьте, что stdout не перенаправлен в файл
 *    3. Статистика работает только в TTY режиме
 * 
 * ============================================================================
 * ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ
 * ============================================================================
 * 
 * ПРИМЕР 1: Запуск с настройками по умолчанию
 * 
 *    cd /Users/evgen/Documents/Work/reacthome-main
 *    node scripts/websocket-proxy-pi-to-local.js
 * 
 * ПРИМЕР 2: Запуск с интерактивным мониторингом устройств
 * 
 *    DEVICE_MONITORING_MODE=true node scripts/websocket-proxy-pi-to-local.js
 * 
 *    В этом режиме экран будет показывать таблицу состояния всех щитовых устройств,
 *    обновляющуюся каждые 5 секунд. Статистика прокси не выводится.
 * 
 * ПРИМЕР 3: Запуск в комбинированном режиме (устройства + статистика прокси)
 * 
 *    DEVICE_MONITORING_MODE=combined node scripts/websocket-proxy-pi-to-local.js
 * 
 *    В этом режиме экран показывает таблицу устройств и статистику прокси одновременно.
 *    Таблица устройств обновляется каждые 5 секунд, статистика прокси - каждые 500мс.
 * 
 * ПРИМЕР 2: Запуск с кастомными настройками
 * 
 *    export REACTHOME_PI_HOST=192.168.1.100
 *    export REACTHOME_PI_WS_PORT=8080
 *    export LOCAL_WS_HOST=127.0.0.1
 *    export LOCAL_WS_PORT=3001
 *    node scripts/websocket-proxy-pi-to-local.js
 * 
 * ПРИМЕР 3: Запуск в фоне с логированием
 * 
 *    nohup node scripts/websocket-proxy-pi-to-local.js > logs/proxy.log 2>&1 &
 *    tail -f logs/proxy.log
 * 
 * ПРИМЕР 4: Мониторинг сообщений от малинки
 * 
 *    # В одном терминале запустите прокси
 *    node scripts/websocket-proxy-pi-to-local.js
 * 
 *    # В другом терминале смотрите логи
 *    tail -f logs/pi-messages.log | grep "ACTION_SET"
 * 
 * ПРИМЕР 5: Анализ команд управления
 * 
 *    # Просмотр всех команд, отправляемых на малинку
 *    tail -f logs/to-pi-messages.log
 * 
 * ============================================================================
 * ТЕХНИЧЕСКИЕ ДЕТАЛИ
 * ============================================================================
 * 
 * КОНФИГУРАЦИЯ ПЕРЕПОДКЛЮЧЕНИЯ:
 * 
 *    RECONNECT_DELAY = 3000 мс (базовая задержка)
 *    MAX_RECONNECT_DELAY = 60000 мс (максимальная задержка)
 *    PORT_CHECK_TIMEOUT = 2000 мс (таймаут проверки порта)
 *    CONNECTION_TIMEOUT = 10000 мс (таймаут подключения WebSocket)
 *    MAX_RECONNECT_ATTEMPTS = 10 (максимум попыток для постоянных ошибок)
 *    BUFFER_MAX_SIZE = 1000 (максимальный размер буфера сообщений)
 * 
 * ТИПЫ ОШИБОК:
 * 
 *    Постоянные (permanent):
 *      - ECONNREFUSED - порт закрыт или сервис не запущен
 *      - EHOSTUNREACH - хост недоступен
 *      - ENETUNREACH - сеть недоступна
 *    
 *    Временные (temporary):
 *      - ETIMEDOUT - таймаут подключения
 *      - ECONNRESET - соединение сброшено
 *      - EPIPE - разрыв канала
 * 
 * АЛГОРИТМ ПЕРЕПОДКЛЮЧЕНИЯ:
 * 
 *    1. При ошибке определяется тип (permanent/temporary)
 *    2. Для permanent ошибок задержка увеличивается быстрее (x2)
 *    3. Для temporary ошибок задержка увеличивается медленнее (x1.5)
 *    4. После MAX_RECONNECT_ATTEMPTS попытки продолжаются с максимальной задержкой
 *    5. Прокси продолжает работать в режиме одного подключения
 * 
 * ============================================================================
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { Level } = require('level');
const net = require('net');
const { exec } = require('child_process');

// Загружаем переменные окружения из .env
const PROJECT_DIR = path.resolve(__dirname, '..');
try {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    });
  }
} catch (e) {
  // Игнорируем ошибки загрузки .env
}

// Конфигурация
const PI_HOST = process.env.REACTHOME_PI_HOST || '192.168.88.4';
const PI_WS_PORT = process.env.REACTHOME_PI_WS_PORT || '3000';
const LOCAL_WS_HOST = process.env.LOCAL_WS_HOST || 'localhost';
const LOCAL_WS_PORT = process.env.LOCAL_WS_PORT || '3000';

const PI_WS_URL = `ws://${PI_HOST}:${PI_WS_PORT}`;
const LOCAL_WS_URL = `ws://${LOCAL_WS_HOST}:${LOCAL_WS_PORT}`;

// Версия прокси-сервиса
// Зачем: Ручной версионинг для отслеживания изменений и отладки
const PROXY_VERSION = '1.2.2';

// Блокировка сообщений от локального сервера к малинке
// Зачем: По умолчанию блокируем пересылку сообщений local→pi для предотвращения случайного воздействия на реальные устройства
// Можно включить через переменную окружения ALLOW_LOCAL_TO_PI=true
const BLOCK_LOCAL_TO_PI = process.env.ALLOW_LOCAL_TO_PI !== 'true'; // По умолчанию блокируем

// Пути к файлам логов
// Зачем: Определяем пути к файлам для логирования всех сообщений в обе стороны
const LOGS_DIR = path.join(PROJECT_DIR, 'logs');
const PI_MESSAGES_LOG_FILE = path.join(LOGS_DIR, 'pi-messages.log'); // Сообщения от малинки
const TO_PI_MESSAGES_LOG_FILE = path.join(LOGS_DIR, 'to-pi-messages.log'); // Сообщения к малинке
const DUPLICATES_LOG_FILE = path.join(LOGS_DIR, 'duplicates.log'); // Лог дубликатов сообщений

// Создаём директорию для логов, если её нет
// Зачем: Обеспечиваем наличие директории для записи логов сообщений от малинки
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    console.log(`📁 Создана директория для логов: ${LOGS_DIR}`);
  }
} catch (error) {
  console.error(`❌ Ошибка создания директории логов: ${error.message}`);
}

// Конфигурация переподключения
// Зачем: Настройки для умного переподключения с учетом типа ошибок
// Конфигурация переподключения
// Зачем: Настройки для умного переподключения с учетом типа ошибок и пауз между попытками
// Конфигурация переподключения
// Зачем: Настройки для умного переподключения с учетом типа ошибок и пауз между попытками
const RECONNECT_DELAY = 10000; // 10 секунд - базовая задержка между попытками переподключения (увеличено для снижения нагрузки)
const MAX_RECONNECT_DELAY = 60000; // 1 минута - максимальная задержка
const PORT_CHECK_TIMEOUT = 2000; // 2 секунды - таймаут проверки порта
const CONNECTION_TIMEOUT = 10000; // 10 секунд - таймаут подключения WebSocket
const MAX_RECONNECT_ATTEMPTS = 10; // Максимум попыток для постоянных ошибок
const BUFFER_MAX_SIZE = 1000; // Максимальный размер буфера сообщений
const INITIAL_CONNECTION_DELAY = 2000; // 2 секунды - пауза перед первой попыткой подключения
const RETRY_CONNECTION_DELAY = 1000; // 1 секунда - пауза перед повторной попыткой подключения
const MIN_RECONNECT_INTERVAL = 10000; // 10 секунд - минимальный интервал между обработкой ошибок (защита от слишком частых попыток)

// Конфигурация дедупликации сообщений
// Зачем: Защита от циклического дублирования сообщений между малинкой и локальным сервером
const DEDUP_WINDOW = 5000; // 5 секунд - окно времени для отслеживания дубликатов
const DEDUP_MAX_ENTRIES = 10000; // Максимальное количество записей в кэше дедупликации

// Состояние подключений
// Зачем: Раздельное состояние для каждого подключения позволяет независимо управлять переподключениями
let piWs = null;
let localWs = null;
let piConnected = false;
let localConnected = false;

// Счетчики сообщений
let messagesFromPi = 0;
let messagesToLocal = 0;
let messagesFromLocal = 0;
let messagesToPi = 0;
let errors = 0; // Счетчик ошибок подключения (не ошибок отправки сообщений)
let duplicatesIgnored = 0; // Счетчик игнорированных дубликатов
let localToPiBlocked = 0; // Счетчик заблокированных сообщений local→pi

// Счетчики для расчета скорости сообщений в секунду
// Зачем: Отслеживаем количество сообщений за последнюю секунду для отображения скорости обработки
let lastMessagesFromPi = 0;
let lastMessagesToLocal = 0;
let lastMessagesFromLocal = 0;
let lastMessagesToPi = 0;
let lastSpeedUpdateTime = Date.now();
let messagesPerSecondFromPi = 0;
let messagesPerSecondToLocal = 0;
let messagesPerSecondFromLocal = 0;
let messagesPerSecondToPi = 0;

// Настройки звукового сигнала при превышении скорости
// Зачем: Предупреждаем о высокой нагрузке звуковым сигналом для привлечения внимания
const SPEED_THRESHOLD = 60; // Порог скорости сообщений в секунду для beep
const BEEP_COOLDOWN = 2000; // Минимальный интервал между beep'ами (2 секунды)
let lastBeepTime = 0; // Время последнего beep'а

/**
 * Воспроизведение звукового сигнала (beep)
 * Зачем: Привлекаем внимание при превышении порога скорости сообщений
 */
function playBeep() {
  const now = Date.now();
  
  // Зачем: Защита от слишком частых beep'ов - не чаще раза в BEEP_COOLDOWN миллисекунд
  if (now - lastBeepTime < BEEP_COOLDOWN) {
    return;
  }
  
  lastBeepTime = now;
  
  // Зачем: Используем системный beep через ANSI escape код и системную команду для надежности
  // На macOS используем afplay для системного звука, на других системах - ANSI beep
  if (process.platform === 'darwin') {
    // macOS: используем системный звук Glass.aiff
    exec('afplay /System/Library/Sounds/Glass.aiff', (error) => {
      // Если системный звук недоступен, используем ANSI beep
      if (error) {
        process.stdout.write('\x07');
      }
    });
  } else {
    // Другие системы: используем ANSI beep код
    process.stdout.write('\x07');
  }
}

// Переподключение для малинки
let piReconnectTimeout = null;
let piReconnectDelay = RECONNECT_DELAY;
let piReconnectAttempts = 0;
let piLastError = null;
let piLastReconnectTime = 0; // Время последней попытки переподключения

// Переподключение для локального сервера
let localReconnectTimeout = null;
let localReconnectDelay = RECONNECT_DELAY;
let localReconnectAttempts = 0;
let localLastError = null;
let localLastReconnectTime = 0; // Время последней попытки переподключения

// Буферы сообщений при недоступности сервисов
// Зачем: Буферизация позволяет не терять сообщения при временной недоступности сервиса
const piToLocalBuffer = []; // Буфер сообщений от малинки к локальному серверу
const localToPiBuffer = []; // Буфер сообщений от локального сервера к малинке

// Кэш для дедупликации сообщений
// Зачем: Отслеживаем последние обработанные сообщения для предотвращения циклического дублирования
// Структура: Map<id, Set<timestamp>>
const dedupCache = new Map();
let lastDedupCleanup = Date.now();
const DEDUP_CLEANUP_INTERVAL = 60000; // 1 минута - интервал очистки кэша

// Флаги для отслеживания предупреждений о переполнении буферов
// Зачем: Предотвращаем засорение консоли повторяющимися предупреждениями
let piToLocalBufferOverflowWarned = false;
let localToPiBufferOverflowWarned = false;

// Мониторинг устройств
// Зачем: Интерактивный мониторинг состояния щитовых устройств в реальном времени
const DEVICE_MONITORING_ENABLED = process.env.DEVICE_MONITORING_ENABLED !== 'false'; // По умолчанию включен
const DEVICE_UPDATE_INTERVAL = 5000; // 5 секунд - интервал обновления мониторинга устройств
const DEVICE_DB_PATH = process.env.DEVICE_DB_PATH || path.join(PROJECT_DIR, 'var', 'db'); // Путь к БД устройств

// Типы щитовых устройств (из monitor-shield-devices-status.js)
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f];
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x0a: 'DO8', 0x0b: 'DO16', 0x0e: 'DIM4', 0x0f: 'DIM8',
  0x20: 'DI_4', 0x23: 'RELAY_2', 0x25: 'SMART_4G', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa3: 'DIM_4', 0xa4: 'DIM_8',
  0xa5: 'LANAMP', 0xa7: 'RELAY_2_DIN', 0xa9: 'AO_4_DIN',
  0xac: 'MIX_1_RS', 0xad: 'DIM_12_LED_RS', 0xae: 'RELAY_12_RS', 0xaf: 'DIM_8_RS',
  0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb5: 'MIX_6x12_RS', 0xb6: 'DIM_1_AC_RS',
};

// Состояние мониторинга устройств
// Зачем: Храним состояние устройств для интерактивного мониторинга в реальном времени
let deviceStates = new Map(); // id -> { device, state, lastUpdate, lastStateChange }
let shieldDevices = []; // Список щитовых устройств
let deviceMonitoringActive = false;
let deviceMonitoringMode = false; // Режим мониторинга устройств: false - отключен, 'true' - только устройства, 'combined' - устройства + прокси
let combinedMode = false; // Комбинированный режим (устройства + статистика прокси)
let lastDeviceMonitoringLines = 0; // Количество строк в последнем выводе мониторинга устройств

/**
 * Проверка, является ли устройство щитовым
 * Зачем: Фильтруем только щитовые устройства для мониторинга
 */
function isShieldDevice(type) {
  return SHIELD_TYPES.includes(type);
}

/**
 * Получение имени устройства
 * Зачем: Используем различные поля для определения имени устройства
 */
function getDeviceName(device) {
  return device.title || device.code || device.name || 'без названия';
}

/**
 * Получение категории устройства
 * Зачем: Группируем устройства по категориям для удобного отображения
 */
function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  return 'Другое';
}

/**
 * Загрузка списка щитовых устройств из БД
 * Зачем: Получаем список устройств для мониторинга из локальной БД
 */
async function loadShieldDevices() {
  if (!fs.existsSync(DEVICE_DB_PATH)) {
    return []; // БД не найдена, возвращаем пустой список
  }
  
  const db = new Level(DEVICE_DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  
  try {
    for await (const [key, value] of db.iterator()) {
      if (value && typeof value === 'object' && typeof value.type === 'number') {
        if (!key.includes('/') && isShieldDevice(value.type)) {
          devices.push({
            id: key,
            name: getDeviceName(value),
            type: value.type,
            typeName: DEVICE_TYPE_NAMES[value.type] || `Тип${value.type}`,
            category: getDeviceCategory(value.type),
          });
        }
      }
    }
  } catch (error) {
    // Игнорируем ошибки чтения БД
  } finally {
    await db.close();
  }
  
  return devices.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

/**
 * Обновление состояния устройства
 * Зачем: Отслеживаем изменения состояния устройств из сообщений ACTION_SET
 */
function updateDeviceState(deviceId, newState) {
  if (!DEVICE_MONITORING_ENABLED) return;
  
  const existing = deviceStates.get(deviceId);
  const now = Date.now();
  
  // Проверяем, изменилось ли состояние устройства
  let stateChanged = false;
  if (existing && existing.state) {
    const oldState = existing.state;
    const keyFields = ['online', 'ip', 'co2', 'temperature', 'humidity', 'illumination'];
    for (const field of keyFields) {
      if (oldState[field] !== newState[field]) {
        stateChanged = true;
        break;
      }
    }
  } else {
    stateChanged = true;
  }
  
  const lastStateChange = stateChanged ? now : (existing?.lastStateChange || now);
  
  deviceStates.set(deviceId, {
    ...existing,
    state: { ...newState, lastUpdate: now },
    lastUpdate: now,
    lastStateChange: lastStateChange,
  });
}

/**
 * Установка информации об устройстве
 * Зачем: Сохраняем метаданные устройства для отображения
 */
function setDeviceInfo(deviceId, deviceInfo) {
  const existing = deviceStates.get(deviceId) || {};
  deviceStates.set(deviceId, {
    ...existing,
    device: deviceInfo,
  });
}

/**
 * Рендеринг мониторинга устройств
 * Зачем: Выводим интерактивную таблицу состояния устройств в реальном времени с правильной очисткой экрана
 */
function renderDeviceMonitoring() {
  if (!DEVICE_MONITORING_ENABLED || !deviceMonitoringMode) return;
  if (!process.stdout.isTTY) return; // Только в интерактивном режиме
  
  // Зачем: Очищаем экран перед каждым обновлением для интерактивного вывода
  // Используем тот же подход, что и в monitor-shield-devices-status.js
  if (process.stdout.isTTY) {
    // Очистить экран и переместить курсор в начало
    process.stdout.write('\x1b[2J\x1b[H');
  } else {
    // Если не терминал, просто выводим разделитель
    console.log('\n' + '═'.repeat(80) + '\n');
  }
  
  // Собираем весь вывод в массив строк
  const lines = [];
  
  // Заголовок
  const statusIcon = piConnected ? '🟢' : '🔴';
  const timeStr = new Date().toLocaleTimeString('ru-RU');
  lines.push(`╔═══════════════════════════════════════════════════════════════════════════╗`);
  lines.push(`║ МОНИТОРИНГ СОСТОЯНИЯ ЩИТОВЫХ УСТРОЙСТВ  ${statusIcon}  ${timeStr.padEnd(20)} ║`);
  lines.push(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  lines.push('');
  
  if (!piConnected) {
    lines.push('⚠️  Ожидание подключения к малинке...');
    lines.push('');
  } else if (deviceStates.size === 0) {
    lines.push('⏳ Ожидание данных об устройствах...');
    lines.push('');
  } else {
    // Группируем по категориям
    const byCategory = {};
    for (const [id, data] of deviceStates.entries()) {
      const category = data.device?.category || 'Неизвестно';
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push({ id, ...data });
    }
    
    // Выводим по категориям
    for (const [category, devices] of Object.entries(byCategory)) {
      lines.push(`📦 ${category.toUpperCase()} (${devices.length} устройств)`);
      lines.push('');
      
      devices.forEach(({ id, device, state, lastStateChange }) => {
        const name = device?.name || id;
        const typeName = device?.typeName || '?';
        
        let onlineIcon = '⚪';
        if (state) {
          onlineIcon = state.online ? '🟢' : '🔴';
        }
        
        const ip = state?.ip || '—';
        
        let extraInfo = '';
        if (state) {
          if (state.co2 !== undefined && state.co2 !== null && typeof state.co2 === 'number') {
            extraInfo = ` CO2: ${state.co2}`;
          } else if (state.temperature !== undefined && state.temperature !== null && typeof state.temperature === 'number' && !isNaN(state.temperature)) {
            extraInfo = ` T: ${state.temperature.toFixed(1)}°C`;
          } else if (state.humidity !== undefined && state.humidity !== null && typeof state.humidity === 'number' && !isNaN(state.humidity)) {
            extraInfo = ` H: ${state.humidity.toFixed(1)}%`;
          }
        }
        
        const stateChangeAge = lastStateChange ? Math.floor((Date.now() - lastStateChange) / 1000) : null;
        let stateChangeStr = '';
        if (stateChangeAge !== null) {
          if (stateChangeAge < 60) {
            stateChangeStr = ` изм: ${stateChangeAge}s`;
          } else if (stateChangeAge < 3600) {
            const minutes = Math.floor(stateChangeAge / 60);
            stateChangeStr = ` изм: ${minutes}м`;
          } else {
            const hours = Math.floor(stateChangeAge / 3600);
            stateChangeStr = ` изм: ${hours}ч`;
          }
        }
        
        lines.push(`  ${onlineIcon} ${name.padEnd(30)} ${typeName.padEnd(15)} ${ip.padEnd(15)}${extraInfo}${stateChangeStr}`);
      });
    }
    
    // Статистика
    const total = deviceStates.size;
    const online = Array.from(deviceStates.values()).filter(d => d.state?.online).length;
    const offline = Array.from(deviceStates.values()).filter(d => d.state && !d.state.online).length;
    const pending = total - online - offline;
    
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`📊 Всего: ${total}  🟢 Онлайн: ${online}  🔴 Оффлайн: ${offline}  ⚪ Ожидание: ${pending}`);
  }
  
  // В комбинированном режиме добавляем разделитель и место для статистики прокси
  // Зачем: Оставляем место внизу экрана для статистики прокси, которая обновляется независимо
  if (combinedMode) {
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════');
    lines.push('📡 СТАТИСТИКА ПРОКСИ:');
    // Статистика будет выведена отдельно после таблицы устройств
  } else {
    lines.push('');
    lines.push('💡 Нажмите Ctrl+C для выхода');
  }
  
  // Зачем: Выводим весь вывод построчно после очистки экрана
  // Используем console.log для каждой строки, как в оригинальном monitor-shield-devices-status.js
  // Это гарантирует правильную работу очистки экрана и интерактивное обновление
  lines.forEach(line => {
    console.log(line);
  });
  
  // Сохраняем количество выведенных строк для информации (может пригодиться в будущем)
  lastDeviceMonitoringLines = lines.length;
}

// Переменная для отслеживания позиции статистики прокси в комбинированном режиме
let proxyStatsLinePosition = 0;

/**
 * Рендеринг статистики прокси (для комбинированного режима)
 * Зачем: Выводим статистику прокси в комбинированном режиме после таблицы устройств интерактивно
 */
function renderProxyStats() {
  if (!combinedMode || !deviceMonitoringMode || !process.stdout.isTTY) return;
  
  // Вычисляем скорость сообщений в секунду
  // Зачем: Показываем скорость обработки сообщений для мониторинга производительности прокси
  const now = Date.now();
  const timeSinceLastUpdate = now - lastSpeedUpdateTime;
  
  // Обновляем скорость каждую секунду или экстраполируем, если прошло меньше секунды
  if (timeSinceLastUpdate >= 1000) {
    // Обновляем скорость каждую секунду
    const deltaFromPi = messagesFromPi - lastMessagesFromPi;
    const deltaToLocal = messagesToLocal - lastMessagesToLocal;
    const deltaFromLocal = messagesFromLocal - lastMessagesFromLocal;
    const deltaToPi = messagesToPi - lastMessagesToPi;
    
    messagesPerSecondFromPi = Math.round((deltaFromPi * 1000) / timeSinceLastUpdate);
    messagesPerSecondToLocal = Math.round((deltaToLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondFromLocal = Math.round((deltaFromLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondToPi = Math.round((deltaToPi * 1000) / timeSinceLastUpdate);
    
    // Зачем: Проверяем превышение порога скорости и воспроизводим beep при необходимости
    const maxSpeed = Math.max(
      messagesPerSecondFromPi,
      messagesPerSecondToLocal,
      messagesPerSecondFromLocal,
      messagesPerSecondToPi
    );
    if (maxSpeed > SPEED_THRESHOLD) {
      playBeep();
    }
    
    lastMessagesFromPi = messagesFromPi;
    lastMessagesToLocal = messagesToLocal;
    lastMessagesFromLocal = messagesFromLocal;
    lastMessagesToPi = messagesToPi;
    lastSpeedUpdateTime = now;
  } else if (timeSinceLastUpdate > 100 && lastSpeedUpdateTime > 0) {
    // Экстраполируем скорость, если прошло больше 100мс, но меньше секунды
    // Используем последние значения для расчета текущей скорости
    const deltaFromPi = messagesFromPi - lastMessagesFromPi;
    const deltaToLocal = messagesToLocal - lastMessagesToLocal;
    const deltaFromLocal = messagesFromLocal - lastMessagesFromLocal;
    const deltaToPi = messagesToPi - lastMessagesToPi;
    
    messagesPerSecondFromPi = Math.round((deltaFromPi * 1000) / timeSinceLastUpdate);
    messagesPerSecondToLocal = Math.round((deltaToLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondFromLocal = Math.round((deltaFromLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondToPi = Math.round((deltaToPi * 1000) / timeSinceLastUpdate);
  }
  
  // Вычисляем статистику
  const piSuccess = messagesToLocal;
  const piInBuffer = piToLocalBuffer.length;
  const localSuccess = messagesToPi;
  const localInBuffer = localToPiBuffer.length;
  const statusPi = piConnected ? '✅' : '❌';
  const statusLocal = localConnected ? '✅' : '❌';
  const bufferPi = piInBuffer > 0 ? ` [б:${piInBuffer}]` : '';
  const bufferLocal = localInBuffer > 0 ? ` [б:${localInBuffer}]` : '';
  const reconnectPi = !piConnected && piReconnectAttempts > 0 ? ` [попытка:${piReconnectAttempts}]` : '';
  const reconnectLocal = !localConnected && localReconnectAttempts > 0 ? ` [попытка:${localReconnectAttempts}]` : '';
  // Зачем: Показываем скорость получения от малинки и отправки на локальный сервер
  // Показываем скорость всегда, если она рассчитана (даже если 0, но есть активность)
  const hasActivityFromPi = messagesFromPi > 0 || piInBuffer > 0;
  const hasActivityToLocal = messagesToLocal > 0 || piInBuffer > 0;
  const hasActivityFromLocal = messagesFromLocal > 0 || localInBuffer > 0;
  const hasActivityToPi = messagesToPi > 0 || localInBuffer > 0;
  
  const speedFromPi = hasActivityFromPi ? ` (${messagesPerSecondFromPi}/с вх)` : '';
  const speedToLocal = hasActivityToLocal ? ` (${messagesPerSecondToLocal}/с исх)` : '';
  const speedFromLocal = hasActivityFromLocal ? ` (${messagesPerSecondFromLocal}/с вх)` : '';
  const speedToPi = hasActivityToPi ? ` (${messagesPerSecondToPi}/с исх)` : '';
  
  // Зачем: Добавляем счётчик дубликатов для мониторинга
  const duplicatesInfo = duplicatesIgnored > 0 ? ` | Дублей: ${duplicatesIgnored}` : '';
  // Зачем: Выводим счётчик блокировок жёлтым цветом через слеш с отправляемыми сообщениями
  const localStats = localToPiBlocked > 0 
    ? `${localSuccess}\x1b[33m/${localToPiBlocked}\x1b[0m` 
    : `${localSuccess}`;
  const statsLine = `📊 Малинка${statusPi}: ${piSuccess}${speedToLocal}${speedFromPi}${bufferPi} | Локальный${statusLocal}: ${localStats}${speedToPi}${speedFromLocal}${bufferLocal} | Ошибок подключения: ${errors}${duplicatesInfo}${reconnectPi}${reconnectLocal}`;
  
  // Зачем: Очищаем предыдущую строку статистики и выводим новую для интерактивного обновления
  // Статистика всегда находится после таблицы устройств в последней строке
  // Используем возврат каретки и очистку строки для обновления на месте
  process.stdout.write('\r\x1b[2K'); // Возврат в начало строки и очистка
  process.stdout.write(statsLine);
  proxyStatsLinePosition = 1; // Отмечаем, что строка статистики выведена
}

/**
 * Инициализация мониторинга устройств
 * Зачем: Загружаем список устройств и запускаем периодическое обновление
 */
async function initDeviceMonitoring() {
  if (!DEVICE_MONITORING_ENABLED) return;
  
  // Проверяем режим мониторинга через переменную окружения
  // Зачем: Поддерживаем три режима: 'true' - только устройства, 'combined' - устройства + прокси, иначе - отключен
  const monitoringModeEnv = process.env.DEVICE_MONITORING_MODE;
  deviceMonitoringMode = monitoringModeEnv === 'true' || monitoringModeEnv === 'combined';
  combinedMode = monitoringModeEnv === 'combined';
  
  if (!deviceMonitoringMode) {
    return; // Мониторинг устройств отключен
  }
  
  try {
    shieldDevices = await loadShieldDevices();
    shieldDevices.forEach(device => {
      setDeviceInfo(device.id, device);
    });
    
    deviceMonitoringActive = true;
    
    // Запускаем периодическое обновление экрана
    // Зачем: Обновляем экран мониторинга устройств с правильным интервалом
    setInterval(() => {
      if (deviceMonitoringMode) {
        renderDeviceMonitoring();
        // В комбинированном режиме также обновляем статистику прокси после таблицы устройств
        if (combinedMode) {
          // Небольшая задержка для правильного позиционирования курсора
          setTimeout(() => {
            renderProxyStats();
          }, 10);
        }
      }
    }, DEVICE_UPDATE_INTERVAL);
    
    // Первый рендер сразу после инициализации
    // Зачем: Показываем начальное состояние сразу, не дожидаясь первого интервала
    if (deviceMonitoringMode) {
      renderDeviceMonitoring();
      if (combinedMode) {
        // Небольшая задержка для правильного позиционирования курсора
        setTimeout(() => {
          renderProxyStats();
        }, 10);
      }
    }
    
    // Периодически запрашиваем состояние устройств через малинку
    if (shieldDevices.length > 0 && piConnected) {
      setInterval(() => {
        if (piWs && piWs.readyState === WebSocket.OPEN && shieldDevices.length > 0) {
          const deviceIds = shieldDevices.map(d => d.id);
          piWs.send(JSON.stringify({ type: 'get', state: deviceIds }));
        }
      }, DEVICE_UPDATE_INTERVAL);
    }
  } catch (error) {
    // Игнорируем ошибки инициализации мониторинга
  }
}

// Зачем: Выводим конфигурацию только если не включен режим мониторинга устройств
// В режиме мониторинга устройств экран будет очищен и заполнен таблицей устройств
const monitoringModeEnv = process.env.DEVICE_MONITORING_MODE;
if (!((monitoringModeEnv === 'true' || monitoringModeEnv === 'combined') && DEVICE_MONITORING_ENABLED)) {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   WebSocket Proxy: Малинка ↔ Локальный сервер               ║');
  console.log(`║   Версия: ${PROXY_VERSION.padEnd(47)} ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📊 Конфигурация:');
  console.log(`   Малинка: ${PI_WS_URL}`);
  console.log(`   Локальный сервер: ${LOCAL_WS_URL}`);
  console.log(`   Блокировка local→pi: ${BLOCK_LOCAL_TO_PI ? '✅ ВКЛЮЧЕНА' : '❌ ОТКЛЮЧЕНА'} ${BLOCK_LOCAL_TO_PI ? '(используйте ALLOW_LOCAL_TO_PI=true для отключения)' : ''}`);
  console.log(`   Лог сообщений от малинки: ${PI_MESSAGES_LOG_FILE}`);
  console.log(`   Лог сообщений к малинке: ${TO_PI_MESSAGES_LOG_FILE}`);
  console.log(`   Лог дубликатов: ${DUPLICATES_LOG_FILE}`);
  console.log('');
}

/**
 * Логирование сообщений от малинки в отдельный файл
 * Зачем: Сохраняет все сообщения от малинки в отдельный файл для последующего анализа,
 *        отладки и мониторинга работы системы умного дома
 * 
 * @param {Buffer|string} data - Данные сообщения
 * @param {number} messageNumber - Номер сообщения
 * @param {string} messageType - Тип сообщения
 * @param {object|null} parsedMessage - Распарсенное JSON сообщение (если есть)
 */
function logPiMessageToFile(data, messageNumber, messageType, parsedMessage) {
  try {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] #${messageNumber} Тип: ${messageType}\n`;
    
    if (parsedMessage) {
      // Логируем полное JSON содержимое
      logEntry += `Размер: ${data.toString('utf8').length} байт\n`;
      logEntry += `Содержимое: ${JSON.stringify(parsedMessage, null, 2)}\n`;
    } else {
      // Логируем бинарные данные в hex формате
      const hexData = data.toString('hex');
      logEntry += `Размер: ${data.length} байт\n`;
      logEntry += `Данные (hex): ${hexData.substring(0, 200)}${hexData.length > 200 ? '...' : ''}\n`;
    }
    
    logEntry += '─'.repeat(80) + '\n';
    
    // Асинхронная запись в файл (не блокирует основной поток)
    fs.appendFile(PI_MESSAGES_LOG_FILE, logEntry, 'utf8', (err) => {
      if (err) {
        console.error(`❌ Ошибка записи в лог-файл: ${err.message}`);
      }
    });
  } catch (error) {
    console.error(`❌ Ошибка логирования сообщения от малинки: ${error.message}`);
  }
}

/**
 * Проверка и очистка кэша дедупликации
 * Зачем: Периодически очищаем старые записи из кэша для предотвращения утечек памяти
 */
function cleanupDedupCache() {
  const now = Date.now();
  
  // Очищаем кэш каждую минуту
  if (now - lastDedupCleanup < DEDUP_CLEANUP_INTERVAL) {
    return;
  }
  
  lastDedupCleanup = now;
  
  // Очищаем старые timestamp'ы для каждого ID
  let totalCleaned = 0;
  for (const [id, timestamps] of dedupCache.entries()) {
    const beforeSize = timestamps.size;
    
    // Удаляем timestamp'ы старше DEDUP_WINDOW
    for (const timestamp of timestamps) {
      if (now - timestamp > DEDUP_WINDOW) {
        timestamps.delete(timestamp);
      }
    }
    
    // Удаляем пустые записи
    if (timestamps.size === 0) {
      dedupCache.delete(id);
    }
    
    totalCleaned += (beforeSize - timestamps.size);
  }
  
  // Если кэш слишком большой, удаляем самые старые записи
  if (dedupCache.size > DEDUP_MAX_ENTRIES) {
    const entriesToRemove = dedupCache.size - DEDUP_MAX_ENTRIES;
    const sortedEntries = Array.from(dedupCache.entries())
      .sort((a, b) => {
        const aMin = Math.min(...a[1]);
        const bMin = Math.min(...b[1]);
        return aMin - bMin;
      });
    
    for (let i = 0; i < entriesToRemove; i++) {
      dedupCache.delete(sortedEntries[i][0]);
    }
  }
}

/**
 * Проверка на дубликат сообщения
 * Зачем: Предотвращаем циклическое дублирование сообщений между малинкой и локальным сервером
 * 
 * @param {string} id - ID устройства или объекта
 * @param {number} timestamp - Timestamp из payload сообщения
 * @returns {boolean} - true если это дубликат, false если новое сообщение
 */
function isDuplicate(id, timestamp) {
  if (!id || !timestamp || typeof timestamp !== 'number') {
    return false; // Не можем проверить, пропускаем
  }
  
  // Периодическая очистка кэша
  cleanupDedupCache();
  
  // Получаем или создаем Set timestamp'ов для этого ID
  if (!dedupCache.has(id)) {
    dedupCache.set(id, new Set());
  }
  
  const timestamps = dedupCache.get(id);
  
  // Проверяем, есть ли такой timestamp в окне DEDUP_WINDOW
  const now = Date.now();
  const windowStart = now - DEDUP_WINDOW;
  
  // Очищаем старые timestamp'ы для этого ID
  for (const ts of timestamps) {
    if (ts < windowStart) {
      timestamps.delete(ts);
    }
  }
  
  // Проверяем дубликат
  if (timestamps.has(timestamp)) {
    return true; // Дубликат
  }
  
  // Добавляем новый timestamp
  timestamps.add(timestamp);
  return false; // Новое сообщение
}

/**
 * Логирование дубликата сообщения
 * Зачем: Записываем каждый дубликат в отдельный лог-файл для анализа и отладки
 * 
 * @param {object} message - Распарсенное JSON сообщение
 * @param {string} direction - Направление: 'pi→local' или 'local→pi'
 */
function logDuplicate(message, direction) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ДУБЛИКАТ [${direction}]\n` +
      `ID: ${message.id || 'N/A'}\n` +
      `Type: ${message.type || 'N/A'}\n` +
      `Timestamp: ${message.payload?.timestamp || 'N/A'}\n` +
      `Содержимое: ${JSON.stringify(message, null, 2)}\n` +
      '─'.repeat(80) + '\n';
    
    // Асинхронная запись в файл (не блокирует основной поток)
    fs.appendFile(DUPLICATES_LOG_FILE, logEntry, 'utf8', (err) => {
      if (err) {
        console.error(`❌ Ошибка записи дубликата в лог-файл: ${err.message}`);
      }
    });
  } catch (error) {
    console.error(`❌ Ошибка логирования дубликата: ${error.message}`);
  }
}

/**
 * Логирование сообщений к малинке в отдельный файл
 * Зачем: Сохраняет все сообщения, отправляемые на малинку, в отдельный файл для анализа
 *        команд управления, отладки и аудита изменений состояния устройств
 * 
 * @param {Buffer|string} data - Данные сообщения
 * @param {number} messageNumber - Номер сообщения
 * @param {string} messageType - Тип сообщения
 * @param {object|null} parsedMessage - Распарсенное JSON сообщение (если есть)
 */
function logToPiMessageToFile(data, messageNumber, messageType, parsedMessage) {
  try {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] #${messageNumber} Тип: ${messageType}\n`;
    
    if (parsedMessage) {
      // Логируем полное JSON содержимое
      logEntry += `Размер: ${data.toString('utf8').length} байт\n`;
      logEntry += `Содержимое: ${JSON.stringify(parsedMessage, null, 2)}\n`;
    } else {
      // Логируем бинарные данные в hex формате
      const hexData = data.toString('hex');
      logEntry += `Размер: ${data.length} байт\n`;
      logEntry += `Данные (hex): ${hexData.substring(0, 200)}${hexData.length > 200 ? '...' : ''}\n`;
    }
    
    logEntry += '─'.repeat(80) + '\n';
    
    // Асинхронная запись в файл (не блокирует основной поток)
    fs.appendFile(TO_PI_MESSAGES_LOG_FILE, logEntry, 'utf8', (err) => {
      if (err) {
        console.error(`❌ Ошибка записи в лог-файл сообщений к малинке: ${err.message}`);
      }
    });
  } catch (error) {
    console.error(`❌ Ошибка логирования сообщения к малинке: ${error.message}`);
  }
}

/**
 * Проверка доступности порта перед подключением
 * Зачем: Избегаем бесполезных попыток подключения к недоступным портам,
 *        экономим ресурсы и улучшаем диагностику проблем
 * 
 * @param {string} host - Хост для проверки
 * @param {number} port - Порт для проверки
 * @returns {Promise<boolean>} - true если порт доступен
 */
function checkPortAvailable(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };
    
    socket.setTimeout(PORT_CHECK_TIMEOUT);
    
    socket.once('connect', () => {
      cleanup();
      resolve(true);
    });
    
    socket.once('timeout', () => {
      cleanup();
      resolve(false);
    });
    
    socket.once('error', (err) => {
      cleanup();
      // ECONNREFUSED означает, что порт закрыт, но это нормально для проверки
      resolve(err.code === 'ECONNREFUSED');
    });
    
    try {
      socket.connect(port, host);
    } catch (err) {
      cleanup();
      resolve(false);
    }
  });
}

/**
 * Определение типа ошибки для умного переподключения
 * Зачем: Разные типы ошибок требуют разной стратегии переподключения
 * 
 * @param {Error} error - Ошибка подключения
 * @returns {string} - Тип ошибки: 'temporary', 'permanent', 'unknown'
 */
function getErrorType(error) {
  if (!error || !error.code) {
    return 'unknown';
  }
  
  // Постоянные ошибки - не стоит часто переподключаться
  const permanentErrors = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'];
  if (permanentErrors.includes(error.code)) {
    return 'permanent';
  }
  
  // Временные ошибки - можно переподключаться чаще
  const temporaryErrors = ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'];
  if (temporaryErrors.includes(error.code)) {
    return 'temporary';
  }
  
  return 'unknown';
}

/**
 * Вычисление задержки переподключения на основе типа ошибки
 * Зачем: Постоянные ошибки требуют большей задержки, временные - меньшей
 * 
 * @param {string} errorType - Тип ошибки
 * @param {number} currentDelay - Текущая задержка
 * @param {number} attempts - Количество попыток
 * @returns {number} - Новая задержка в миллисекундах
 */
function calculateReconnectDelay(errorType, currentDelay, attempts) {
  if (errorType === 'permanent') {
    // Для постоянных ошибок увеличиваем задержку быстрее
    return Math.min(currentDelay * 2, MAX_RECONNECT_DELAY);
  } else if (errorType === 'temporary') {
    // Для временных ошибок увеличиваем медленнее
    return Math.min(currentDelay * 1.5, MAX_RECONNECT_DELAY);
  }
  // Для неизвестных ошибок используем стандартную логику
  return Math.min(currentDelay * 2, MAX_RECONNECT_DELAY);
}

/**
 * Очистка буфера сообщений при успешном подключении
 * Зачем: Отправляем накопленные сообщения после восстановления соединения
 * 
 * @param {Array} buffer - Буфер сообщений
 * @param {WebSocket} ws - WebSocket соединение
 * @param {string} direction - Направление для логирования
 */
function flushBuffer(buffer, ws, direction) {
  if (!ws || ws.readyState !== WebSocket.OPEN || buffer.length === 0) {
    return;
  }
  
  // Зачем: Минимальное логирование - информация будет в статистике
  while (buffer.length > 0 && ws.readyState === WebSocket.OPEN) {
    const message = buffer.shift();
    try {
      ws.send(message);
    } catch (error) {
      // Возвращаем сообщение в начало буфера
      buffer.unshift(message);
      break;
    }
  }
}

// Функция подключения к малинке
function connectToPi() {
  if (piWs && piWs.readyState === WebSocket.OPEN) {
    return;
  }

  // Закрываем предыдущее соединение, если есть
  if (piWs) {
    try {
      piWs.removeAllListeners();
      piWs.terminate();
    } catch (e) {
      // Игнорируем ошибки при закрытии
    }
    piWs = null;
  }

  // Зачем: Добавляем паузу перед попыткой подключения для снижения нагрузки на сервер
  // При первой попытке используем INITIAL_CONNECTION_DELAY, при переподключении - RETRY_CONNECTION_DELAY
  const delayBeforeConnect = piReconnectAttempts === 0 ? INITIAL_CONNECTION_DELAY : RETRY_CONNECTION_DELAY;
  
  setTimeout(() => {
    // Проверяем доступность порта перед подключением
    checkPortAvailable(PI_HOST, parseInt(PI_WS_PORT))
    .then((portAvailable) => {
      if (!portAvailable) {
        const error = new Error(`Порт ${PI_WS_PORT} недоступен на ${PI_HOST}`);
        error.code = 'ECONNREFUSED';
        handlePiConnectionError(error);
        return;
      }
      
      // Порт доступен, создаем WebSocket соединение
      piWs = new WebSocket(PI_WS_URL, {
        handshakeTimeout: CONNECTION_TIMEOUT
      });
      
      setupPiWebSocket();
    })
    .catch((err) => {
      // Зачем: Ошибки проверки порта обрабатываются как обычные ошибки подключения
      handlePiConnectionError(err);
    });
  }, delayBeforeConnect);
}

/**
 * Настройка обработчиков событий WebSocket для малинки
 * Зачем: Вынесено в отдельную функцию для читаемости и переиспользования
 */
function setupPiWebSocket() {

  piWs.on('open', () => {
    // Зачем: Минимальное логирование - только обновление статуса в статистике
    piConnected = true;
    piReconnectDelay = RECONNECT_DELAY; // Сброс задержки при успешном подключении
    piReconnectAttempts = 0; // Сброс счетчика попыток
    piLastError = null;
    piLastReconnectTime = 0; // Сброс времени последней попытки
    
    // Отправляем накопленные сообщения из буфера
    flushBuffer(localToPiBuffer, piWs, 'локальный → малинка');
    
    // Зачем: Сбрасываем флаг предупреждения при успешном подключении
    localToPiBufferOverflowWarned = false;
    
    // Зачем: Запрашиваем состояние устройств при подключении для мониторинга
    if (DEVICE_MONITORING_ENABLED && deviceMonitoringMode && shieldDevices.length > 0) {
      const deviceIds = shieldDevices.map(d => d.id);
      piWs.send(JSON.stringify({ type: 'get', state: deviceIds }));
    }
  });

  piWs.on('message', (data) => {
    messagesFromPi++;
    
    // Пытаемся распарсить сообщение для логирования
    let messageType = 'binary';
    let messageStr = null;
    let parsedMessage = null;
    
    try {
      messageStr = data.toString('utf8');
      parsedMessage = JSON.parse(messageStr);
      messageType = parsedMessage.type || 'unknown';
    } catch (e) {
      // Не JSON, оставляем как binary
      messageType = `binary (${data.length} bytes)`;
    }

    // Логируем все сообщения от малинки в отдельный файл
    // Зачем: Детальное логирование в файл для анализа, без засорения консоли
    logPiMessageToFile(data, messagesFromPi, messageType, parsedMessage);

    // Зачем: Обновляем состояние устройств из сообщений ACTION_SET для мониторинга
    if (DEVICE_MONITORING_ENABLED && parsedMessage && parsedMessage.type === 'ACTION_SET' && parsedMessage.id && parsedMessage.payload) {
      updateDeviceState(parsedMessage.id, parsedMessage.payload);
    }

    // Зачем: Проверяем на дубликаты перед пересылкой для предотвращения циклического дублирования
    if (parsedMessage && parsedMessage.type === 'ACTION_SET' && parsedMessage.id && parsedMessage.payload && typeof parsedMessage.payload.timestamp === 'number') {
      if (isDuplicate(parsedMessage.id, parsedMessage.payload.timestamp)) {
        // Дубликат обнаружен - игнорируем и логируем
        duplicatesIgnored++;
        logDuplicate(parsedMessage, 'pi→local');
        return; // Не пересылаем дубликат
      }
    }

    // Пересылаем на локальный сервер или буферизуем
    if (localConnected && localWs && localWs.readyState === WebSocket.OPEN) {
      try {
        localWs.send(data);
        messagesToLocal++;
      } catch (error) {
        // Зачем: Ошибки отправки сообщений не считаем как ошибки подключения
        // Это нормальная ситуация при временной недоступности сервиса
        // При ошибке отправки добавляем в буфер
        if (piToLocalBuffer.length < BUFFER_MAX_SIZE) {
          piToLocalBuffer.push(data);
          // Зачем: Сбрасываем флаг предупреждения, если буфер освободился
          if (piToLocalBufferOverflowWarned && piToLocalBuffer.length < BUFFER_MAX_SIZE * 0.8) {
            piToLocalBufferOverflowWarned = false;
          }
        } else {
          // Зачем: Молча отбрасываем сообщения при переполнении буфера - это нормальная ситуация,
          // когда локальный сервер не запущен. Не выводим предупреждений, чтобы не засорять консоль.
          piToLocalBufferOverflowWarned = true;
        }
      }
      } else {
        // Локальный сервер недоступен - буферизуем сообщение
        if (piToLocalBuffer.length < BUFFER_MAX_SIZE) {
          piToLocalBuffer.push(data);
          // Зачем: Сбрасываем флаг предупреждения, если буфер освободился
          if (piToLocalBufferOverflowWarned && piToLocalBuffer.length < BUFFER_MAX_SIZE * 0.8) {
            piToLocalBufferOverflowWarned = false;
          }
        } else {
          // Зачем: Молча отбрасываем сообщения при переполнении буфера - это нормальная ситуация,
          // когда локальный сервер не запущен. Не выводим предупреждений, чтобы не засорять консоль.
          piToLocalBufferOverflowWarned = true;
        }
      }
  });

  piWs.on('error', (error) => {
    // Зачем: Обрабатываем ошибки только если соединение не установлено, чтобы избежать дублирования
    if (!piConnected) {
      handlePiConnectionError(error);
    }
  });

  piWs.on('close', (code, reason) => {
    const reasonStr = reason ? reason.toString() : 'нет';
    // Зачем: Минимальное логирование - статус обновится в статистике
    piConnected = false;
    
    // Зачем: Планируем переподключение только если это не нормальное закрытие (код 1000)
    // и прошло достаточно времени с последней попытки
    if (code !== 1000) {
      schedulePiReconnect(code, reasonStr);
    }
  });
}

/**
 * Обработка ошибок подключения к малинке
 * Зачем: Централизованная обработка ошибок с умной логикой переподключения
 * 
 * @param {Error} error - Ошибка подключения
 */
function handlePiConnectionError(error) {
  const errorMessage = error.message || error.toString();
  const errorCode = error.code || 'UNKNOWN';
  
  // Зачем: Защита от слишком частых попыток переподключения и дублирования ошибок
  const now = Date.now();
  const timeSinceLastAttempt = now - piLastReconnectTime;
  
  // Если прошло меньше MIN_RECONNECT_INTERVAL с последней попытки, пропускаем эту ошибку
  if (piLastReconnectTime > 0 && timeSinceLastAttempt < MIN_RECONNECT_INTERVAL) {
    return; // Игнорируем слишком частые ошибки
  }
  
  // Зачем: Не увеличиваем счетчик ошибок повторно для той же попытки подключения
  // Ошибка уже была обработана, если соединение уже помечено как отключенное и время совпадает
  if (!piConnected && piLastReconnectTime > 0 && timeSinceLastAttempt < 1000) {
    return; // Игнорируем дублирующие ошибки от той же попытки подключения
  }
  
  // Зачем: Логируем только критичные ошибки, остальное будет в статистике
  // В режиме только устройств не выводим в консоль, чтобы не мешать интерактивному обновлению
  if (piReconnectAttempts === 0 && !(deviceMonitoringMode && DEVICE_MONITORING_ENABLED && !combinedMode)) {
    console.error(`\n❌ Ошибка подключения к малинке: ${errorMessage}${errorCode !== 'UNKNOWN' ? ` (${errorCode})` : ''}`);
  }
  
  // Зачем: Увеличиваем счетчик ошибок только один раз за попытку подключения
  if (piConnected || piReconnectAttempts === 0) {
    errors++;
  }
  
  piConnected = false;
  piLastError = error;
  piLastReconnectTime = now;
  
  // Определяем тип ошибки для умного переподключения
  const errorType = getErrorType(error);
  piReconnectAttempts++;
  
  // Для постоянных ошибок увеличиваем задержку быстрее
  // В режиме только устройств не выводим в консоль, чтобы не мешать интерактивному обновлению
  if (errorType === 'permanent' && piReconnectAttempts >= MAX_RECONNECT_ATTEMPTS && !(deviceMonitoringMode && DEVICE_MONITORING_ENABLED && !combinedMode)) {
    console.error(`\n⚠️  Достигнуто максимальное количество попыток (${MAX_RECONNECT_ATTEMPTS}) для малинки`);
  }
  
  schedulePiReconnect(null, errorMessage);
}

/**
 * Планирование переподключения к малинке
 * Зачем: Умное планирование переподключения с учетом типа ошибки и количества попыток
 * 
 * @param {number|null} code - Код закрытия соединения
 * @param {string} reason - Причина закрытия
 */
function schedulePiReconnect(code, reason) {
  if (piReconnectTimeout) {
    clearTimeout(piReconnectTimeout);
  }
  
  // Зачем: Защита от слишком частых попыток переподключения
  const now = Date.now();
  const timeSinceLastAttempt = now - piLastReconnectTime;
  
  // Если прошло меньше MIN_RECONNECT_INTERVAL с последней попытки, увеличиваем задержку
  let actualDelay = piReconnectDelay;
  if (piLastReconnectTime > 0 && timeSinceLastAttempt < MIN_RECONNECT_INTERVAL) {
    actualDelay = Math.max(actualDelay, MIN_RECONNECT_INTERVAL - timeSinceLastAttempt);
  }
  
  const errorType = piLastError ? getErrorType(piLastError) : 'unknown';
  piReconnectDelay = calculateReconnectDelay(errorType, piReconnectDelay, piReconnectAttempts);
  
  // Зачем: Минимальное логирование - информация будет в статистике
  // Логируем только критичные ситуации
  // В режиме только устройств не выводим в консоль, чтобы не мешать интерактивному обновлению
  if (piReconnectAttempts >= MAX_RECONNECT_ATTEMPTS && !(deviceMonitoringMode && DEVICE_MONITORING_ENABLED && !combinedMode)) {
    console.error(`⚠️  Достигнуто максимальное количество попыток переподключения к малинке (${MAX_RECONNECT_ATTEMPTS})`);
  }
  
  piReconnectTimeout = setTimeout(() => {
    connectToPi();
  }, actualDelay);
}

// Функция подключения к локальному серверу
function connectToLocal() {
  if (localWs && localWs.readyState === WebSocket.OPEN) {
    return;
  }

  // Закрываем предыдущее соединение, если есть
  if (localWs) {
    try {
      localWs.removeAllListeners();
      localWs.terminate();
    } catch (e) {
      // Игнорируем ошибки при закрытии
    }
    localWs = null;
  }

  // Зачем: Добавляем паузу перед попыткой подключения для снижения нагрузки на сервер
  // При первой попытке используем INITIAL_CONNECTION_DELAY, при переподключении - RETRY_CONNECTION_DELAY
  const delayBeforeConnect = localReconnectAttempts === 0 ? INITIAL_CONNECTION_DELAY : RETRY_CONNECTION_DELAY;
  
  setTimeout(() => {
    // Проверяем доступность порта перед подключением
    checkPortAvailable(LOCAL_WS_HOST, parseInt(LOCAL_WS_PORT))
    .then((portAvailable) => {
      if (!portAvailable) {
        const error = new Error(`Порт ${LOCAL_WS_PORT} недоступен на ${LOCAL_WS_HOST}`);
        error.code = 'ECONNREFUSED';
        handleLocalConnectionError(error);
        return;
      }
      
      // Порт доступен, создаем WebSocket соединение
      localWs = new WebSocket(LOCAL_WS_URL, {
        handshakeTimeout: CONNECTION_TIMEOUT
      });
      
      setupLocalWebSocket();
    })
    .catch((err) => {
      // Зачем: Ошибки проверки порта обрабатываются как обычные ошибки подключения
      handleLocalConnectionError(err);
    });
  }, delayBeforeConnect);
}

/**
 * Настройка обработчиков событий WebSocket для локального сервера
 * Зачем: Вынесено в отдельную функцию для читаемости и переиспользования
 */
function setupLocalWebSocket() {

  localWs.on('open', () => {
    // Зачем: Минимальное логирование - только обновление статуса в статистике
    localConnected = true;
    localReconnectDelay = RECONNECT_DELAY; // Сброс задержки при успешном подключении
    localReconnectAttempts = 0; // Сброс счетчика попыток
    localLastError = null;
    localLastReconnectTime = 0; // Сброс времени последней попытки
    
    // Отправляем накопленные сообщения из буфера
    flushBuffer(piToLocalBuffer, localWs, 'малинка → локальный');
    
    // Зачем: Сбрасываем флаг предупреждения при успешном подключении
    piToLocalBufferOverflowWarned = false;
  });

  localWs.on('error', (error) => {
    // Зачем: Обрабатываем ошибки только если соединение не установлено, чтобы избежать дублирования
    if (!localConnected) {
      handleLocalConnectionError(error);
    }
  });

  localWs.on('close', (code, reason) => {
    const reasonStr = reason ? reason.toString() : 'нет';
    // Зачем: Минимальное логирование - статус обновится в статистике
    localConnected = false;
    
    // Зачем: Планируем переподключение только если это не нормальное закрытие (код 1000)
    // и прошло достаточно времени с последней попытки
    if (code !== 1000) {
      scheduleLocalReconnect(code, reasonStr);
    }
  });

  // Обрабатываем сообщения от локального сервера и пересылаем на малинку
  // Зачем: Обработка сообщений от локального сервера с буферизацией при недоступности малинки
  localWs.on('message', (data) => {
    messagesFromLocal++;
    
    // Пытаемся распарсить сообщение для логирования
    let messageType = 'binary';
    let messageStr = null;
    let parsedMessage = null;
    
    try {
      messageStr = data.toString('utf8');
      parsedMessage = JSON.parse(messageStr);
      messageType = parsedMessage.type || 'unknown';
    } catch (e) {
      messageType = `binary (${data.length} bytes)`;
    }

    // Логируем все сообщения к малинке в отдельный файл
    // Зачем: Детальное логирование в файл для анализа, без засорения консоли
    logToPiMessageToFile(data, messagesFromLocal, messageType, parsedMessage);

    // Зачем: Блокируем сообщения local→pi по умолчанию для предотвращения случайного воздействия на реальные устройства
    if (BLOCK_LOCAL_TO_PI) {
      localToPiBlocked++;
      // Логируем заблокированное сообщение
      if (parsedMessage) {
        logDuplicate(parsedMessage, 'local→pi [ЗАБЛОКИРОВАНО]');
      }
      return; // Не пересылаем заблокированное сообщение
    }

    // Зачем: Проверяем на дубликаты перед пересылкой для предотвращения циклического дублирования
    if (parsedMessage && parsedMessage.type === 'ACTION_SET' && parsedMessage.id && parsedMessage.payload && typeof parsedMessage.payload.timestamp === 'number') {
      if (isDuplicate(parsedMessage.id, parsedMessage.payload.timestamp)) {
        // Дубликат обнаружен - игнорируем и логируем
        duplicatesIgnored++;
        logDuplicate(parsedMessage, 'local→pi');
        return; // Не пересылаем дубликат
      }
    }

    // Пересылаем на малинку или буферизуем
    if (piConnected && piWs && piWs.readyState === WebSocket.OPEN) {
      try {
        piWs.send(data);
        messagesToPi++;
      } catch (error) {
        // Зачем: Ошибки отправки сообщений не считаем как ошибки подключения
        // Это нормальная ситуация при временной недоступности сервиса
        // При ошибке отправки добавляем в буфер
        if (localToPiBuffer.length < BUFFER_MAX_SIZE) {
          localToPiBuffer.push(data);
          // Зачем: Сбрасываем флаг предупреждения, если буфер освободился
          if (localToPiBufferOverflowWarned && localToPiBuffer.length < BUFFER_MAX_SIZE * 0.8) {
            localToPiBufferOverflowWarned = false;
          }
        } else {
          // Зачем: Молча отбрасываем сообщения при переполнении буфера - это нормальная ситуация,
          // когда малинка недоступна. Не выводим предупреждений, чтобы не засорять консоль.
          localToPiBufferOverflowWarned = true;
        }
      }
      } else {
        // Малинка недоступна - буферизуем сообщение
        if (localToPiBuffer.length < BUFFER_MAX_SIZE) {
          localToPiBuffer.push(data);
          // Зачем: Сбрасываем флаг предупреждения, если буфер освободился
          if (localToPiBufferOverflowWarned && localToPiBuffer.length < BUFFER_MAX_SIZE * 0.8) {
            localToPiBufferOverflowWarned = false;
          }
        } else {
          // Зачем: Молча отбрасываем сообщения при переполнении буфера - это нормальная ситуация,
          // когда малинка недоступна. Не выводим предупреждений, чтобы не засорять консоль.
          localToPiBufferOverflowWarned = true;
        }
      }
  });
}

/**
 * Обработка ошибок подключения к локальному серверу
 * Зачем: Централизованная обработка ошибок с умной логикой переподключения
 * 
 * @param {Error} error - Ошибка подключения
 */
function handleLocalConnectionError(error) {
  const errorMessage = error.message || error.toString();
  const errorCode = error.code || 'UNKNOWN';
  
  // Зачем: Защита от слишком частых попыток переподключения и дублирования ошибок
  const now = Date.now();
  const timeSinceLastAttempt = now - localLastReconnectTime;
  
  // Если прошло меньше MIN_RECONNECT_INTERVAL с последней попытки, пропускаем эту ошибку
  if (localLastReconnectTime > 0 && timeSinceLastAttempt < MIN_RECONNECT_INTERVAL) {
    return; // Игнорируем слишком частые ошибки
  }
  
  // Зачем: Не увеличиваем счетчик ошибок повторно для той же попытки подключения
  // Ошибка уже была обработана, если соединение уже помечено как отключенное и время совпадает
  if (!localConnected && localLastReconnectTime > 0 && timeSinceLastAttempt < 1000) {
    return; // Игнорируем дублирующие ошибки от той же попытки подключения
  }
  
  // Зачем: Не выводим ошибки подключения к локальному серверу - это нормальная ситуация,
  // когда локальный сервер не запущен. Статус подключения отображается в статистике.
  
  // Зачем: Увеличиваем счетчик ошибок только один раз за попытку подключения
  if (localConnected || localReconnectAttempts === 0) {
    errors++;
  }
  
  localConnected = false;
  localLastError = error;
  localLastReconnectTime = now;
  
  // Определяем тип ошибки для умного переподключения
  const errorType = getErrorType(error);
  localReconnectAttempts++;
  
  // Зачем: Не выводим предупреждения о максимальном количестве попыток для локального сервера -
  // это нормальная ситуация, когда локальный сервер не запущен. Статус отображается в статистике.
  
  scheduleLocalReconnect(null, errorMessage);
}

/**
 * Планирование переподключения к локальному серверу
 * Зачем: Умное планирование переподключения с учетом типа ошибки и количества попыток
 * 
 * @param {number|null} code - Код закрытия соединения
 * @param {string} reason - Причина закрытия
 */
function scheduleLocalReconnect(code, reason) {
  if (localReconnectTimeout) {
    clearTimeout(localReconnectTimeout);
  }
  
  // Зачем: Защита от слишком частых попыток переподключения
  const now = Date.now();
  const timeSinceLastAttempt = now - localLastReconnectTime;
  
  // Если прошло меньше MIN_RECONNECT_INTERVAL с последней попытки, увеличиваем задержку
  let actualDelay = localReconnectDelay;
  if (localLastReconnectTime > 0 && timeSinceLastAttempt < MIN_RECONNECT_INTERVAL) {
    actualDelay = Math.max(actualDelay, MIN_RECONNECT_INTERVAL - timeSinceLastAttempt);
  }
  
  const errorType = localLastError ? getErrorType(localLastError) : 'unknown';
  localReconnectDelay = calculateReconnectDelay(errorType, localReconnectDelay, localReconnectAttempts);
  
  // Зачем: Не выводим предупреждения о максимальном количестве попыток для локального сервера -
  // это нормальная ситуация, когда локальный сервер не запущен. Статус отображается в статистике.
  
  localReconnectTimeout = setTimeout(() => {
    connectToLocal();
  }, actualDelay);
}

// Периодический вывод статистики в одну строку в реальном времени
// Зачем: Компактный вывод статистики с перезаписью одной строки для минимального мусора в консоли
let lastStatsMessages = { fromPi: 0, fromLocal: 0, errors: 0, piConnected: undefined, localConnected: undefined };
let statsLineLength = 0; // Длина последней строки для правильной очистки

setInterval(() => {
  // Зачем: Не выводим статистику пока нет активности, чтобы не засорять консоль нулями
  // Статистика выводится только если есть реальная активность: сообщения, ошибки, буферы или активные попытки переподключения
  const hasActivity = messagesFromPi > 0 || messagesFromLocal > 0 || errors > 0 || 
                      piToLocalBuffer.length > 0 || localToPiBuffer.length > 0 ||
                      (piReconnectAttempts > 0) || (localReconnectAttempts > 0);
  
  if (!hasActivity) {
    return; // Пропускаем вывод статистики если нет активности
  }
  
  // Вычисляем успешные обработки и сообщения в буфере
  // Зачем: Показываем только успешно отправленные сообщения и размер буфера, чтобы не путать буфер с ошибками
  const piSuccess = messagesToLocal; // Успешно отправлено на локальный
  const piInBuffer = piToLocalBuffer.length; // Сообщения в буфере (не ошибки!)
  const localSuccess = messagesToPi; // Успешно отправлено на малинку
  const localInBuffer = localToPiBuffer.length; // Сообщения в буфере (не ошибки!)
  
  // Вычисляем скорость сообщений в секунду
  // Зачем: Показываем скорость обработки сообщений для мониторинга производительности прокси
  const now = Date.now();
  const timeSinceLastUpdate = now - lastSpeedUpdateTime;
  
  // Обновляем скорость каждую секунду или экстраполируем, если прошло меньше секунды
  if (timeSinceLastUpdate >= 1000) {
    // Обновляем скорость каждую секунду
    const deltaFromPi = messagesFromPi - lastMessagesFromPi;
    const deltaToLocal = messagesToLocal - lastMessagesToLocal;
    const deltaFromLocal = messagesFromLocal - lastMessagesFromLocal;
    const deltaToPi = messagesToPi - lastMessagesToPi;
    
    messagesPerSecondFromPi = Math.round((deltaFromPi * 1000) / timeSinceLastUpdate);
    messagesPerSecondToLocal = Math.round((deltaToLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondFromLocal = Math.round((deltaFromLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondToPi = Math.round((deltaToPi * 1000) / timeSinceLastUpdate);
    
    // Зачем: Проверяем превышение порога скорости и воспроизводим beep при необходимости
    const maxSpeed = Math.max(
      messagesPerSecondFromPi,
      messagesPerSecondToLocal,
      messagesPerSecondFromLocal,
      messagesPerSecondToPi
    );
    if (maxSpeed > SPEED_THRESHOLD) {
      playBeep();
    }
    
    lastMessagesFromPi = messagesFromPi;
    lastMessagesToLocal = messagesToLocal;
    lastMessagesFromLocal = messagesFromLocal;
    lastMessagesToPi = messagesToPi;
    lastSpeedUpdateTime = now;
  } else if (timeSinceLastUpdate > 100 && lastSpeedUpdateTime > 0) {
    // Экстраполируем скорость, если прошло больше 100мс, но меньше секунды
    // Используем последние значения для расчета текущей скорости
    const deltaFromPi = messagesFromPi - lastMessagesFromPi;
    const deltaToLocal = messagesToLocal - lastMessagesToLocal;
    const deltaFromLocal = messagesFromLocal - lastMessagesFromLocal;
    const deltaToPi = messagesToPi - lastMessagesToPi;
    
    messagesPerSecondFromPi = Math.round((deltaFromPi * 1000) / timeSinceLastUpdate);
    messagesPerSecondToLocal = Math.round((deltaToLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondFromLocal = Math.round((deltaFromLocal * 1000) / timeSinceLastUpdate);
    messagesPerSecondToPi = Math.round((deltaToPi * 1000) / timeSinceLastUpdate);
  }
  
  // Формируем компактную строку статистики
  const statusPi = piConnected ? '✅' : '❌';
  const statusLocal = localConnected ? '✅' : '❌';
  const bufferPi = piInBuffer > 0 ? ` [б:${piInBuffer}]` : '';
  const bufferLocal = localInBuffer > 0 ? ` [б:${localInBuffer}]` : '';
  const reconnectPi = !piConnected && piReconnectAttempts > 0 ? ` [попытка:${piReconnectAttempts}]` : '';
  const reconnectLocal = !localConnected && localReconnectAttempts > 0 ? ` [попытка:${localReconnectAttempts}]` : '';
  // Зачем: Показываем скорость получения от малинки и отправки на локальный сервер
  // Показываем скорость всегда, если она рассчитана (даже если 0, но есть активность)
  const hasActivityFromPi = messagesFromPi > 0 || piInBuffer > 0;
  const hasActivityToLocal = messagesToLocal > 0 || piInBuffer > 0;
  const hasActivityFromLocal = messagesFromLocal > 0 || localInBuffer > 0;
  const hasActivityToPi = messagesToPi > 0 || localInBuffer > 0;
  
  const speedFromPi = hasActivityFromPi ? ` (${messagesPerSecondFromPi}/с вх)` : '';
  const speedToLocal = hasActivityToLocal ? ` (${messagesPerSecondToLocal}/с исх)` : '';
  const speedFromLocal = hasActivityFromLocal ? ` (${messagesPerSecondFromLocal}/с вх)` : '';
  const speedToPi = hasActivityToPi ? ` (${messagesPerSecondToPi}/с исх)` : '';
  
  // Зачем: Показываем успешно отправленные сообщения, размер буфера и скорость обработки отдельно
  // Добавляем счётчик дубликатов для мониторинга
  const duplicatesInfo = duplicatesIgnored > 0 ? ` | Дублей: ${duplicatesIgnored}` : '';
  // Зачем: Выводим счётчик блокировок жёлтым цветом через слеш с отправляемыми сообщениями
  const localStats = localToPiBlocked > 0 
    ? `${localSuccess}\x1b[33m/${localToPiBlocked}\x1b[0m` 
    : `${localSuccess}`;
  const statsLine = `📊 Малинка${statusPi}: ${piSuccess}${speedToLocal}${speedFromPi}${bufferPi} | Локальный${statusLocal}: ${localStats}${speedToPi}${speedFromLocal}${bufferLocal} | Ошибок: ${errors}${duplicatesInfo}${reconnectPi}${reconnectLocal}`;
  
  // Зачем: Обновляем статистику в реальном времени в одной строке консоли
  // Используем ANSI escape-коды для очистки строки и возврат каретки
  // В режиме только устройств статистика прокси не выводится
  // В комбинированном режиме статистика выводится в отдельной строке внизу экрана
  if (deviceMonitoringMode && DEVICE_MONITORING_ENABLED && !combinedMode) {
    return; // В режиме только устройств статистика прокси не выводится
  }
  
  // В комбинированном режиме статистика выводится через renderProxyStats() вместе с таблицей устройств
  // Здесь не выводим, чтобы избежать дублирования
  if (combinedMode && deviceMonitoringMode) {
    return; // Статистика будет выведена через renderProxyStats()
  }
  
  if (process.stdout.isTTY) {
    // ANSI escape-код для очистки строки: \x1b[2K - очистить всю строку, \r - вернуться в начало
    process.stdout.write(`\r\x1b[2K${statsLine}`);
    statsLineLength = statsLine.length;
  } else {
    // Если stdout не TTY (перенаправлен в файл), выводим с новой строки
    // Но добавляем проверку, чтобы не создавать слишком много строк
    const hasChanges = 
      messagesFromPi !== lastStatsMessages.fromPi ||
      messagesFromLocal !== lastStatsMessages.fromLocal ||
      errors !== lastStatsMessages.errors ||
      piConnected !== (lastStatsMessages.piConnected !== undefined ? lastStatsMessages.piConnected : true) ||
      localConnected !== (lastStatsMessages.localConnected !== undefined ? lastStatsMessages.localConnected : true);
    
    if (hasChanges) {
      console.log(statsLine);
      lastStatsMessages.piConnected = piConnected;
      lastStatsMessages.localConnected = localConnected;
    }
  }
  
  lastStatsMessages = {
    fromPi: messagesFromPi,
    fromLocal: messagesFromLocal,
    errors: errors,
    piConnected: piConnected,
    localConnected: localConnected
  };
}, 500); // Каждые 500мс для плавного обновления в реальном времени

// Обработка сигналов завершения
// Зачем: Корректное завершение работы с очисткой ресурсов и буферов
process.on('SIGINT', () => {
  // Переходим на новую строку перед выводом финальной статистики
  console.log('');
  console.log('\n⚠️  Получен сигнал завершения (SIGINT)');
  console.log('');
  
  const piSuccess = messagesToLocal;
  const piFailed = messagesFromPi - messagesToLocal;
  const localSuccess = messagesToPi;
  const localFailed = messagesFromLocal - messagesToPi;
  
  console.log('📊 Финальная статистика:');
  console.log(`   Малинка → Локальный: ${piSuccess}✅/${piFailed}❌ (получено: ${messagesFromPi}, отправлено: ${messagesToLocal})`);
  console.log(`   Локальный → Малинка: ${localSuccess}✅/${localFailed}❌ (получено: ${messagesFromLocal}, отправлено: ${messagesToPi})`);
  console.log(`   Ошибок: ${errors}`);
  if (duplicatesIgnored > 0) {
    console.log(`   Дубликатов игнорировано: ${duplicatesIgnored}`);
  }
  if (localToPiBlocked > 0) {
    console.log(`   Заблокировано сообщений local→pi: ${localToPiBlocked}`);
  }
  if (piToLocalBuffer.length > 0 || localToPiBuffer.length > 0) {
    console.log(`   В буферах: малинка→локальный ${piToLocalBuffer.length}, локальный→малинка ${localToPiBuffer.length}`);
  }
  console.log('');
  
  // Очищаем таймауты переподключения
  if (piReconnectTimeout) {
    clearTimeout(piReconnectTimeout);
  }
  if (localReconnectTimeout) {
    clearTimeout(localReconnectTimeout);
  }
  
  // Закрываем соединения
  if (piWs) {
    piWs.close();
  }
  if (localWs) {
    localWs.close();
  }
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  // Очищаем таймауты переподключения
  if (piReconnectTimeout) {
    clearTimeout(piReconnectTimeout);
  }
  if (localReconnectTimeout) {
    clearTimeout(localReconnectTimeout);
  }
  
  // Закрываем соединения
  if (piWs) {
    piWs.close();
  }
  if (localWs) {
    localWs.close();
  }
  
  process.exit(0);
});

// Запуск подключений
// Зачем: Выводим информацию о запуске только если не включен режим мониторинга устройств
const startupMonitoringMode = process.env.DEVICE_MONITORING_MODE;
if (!((startupMonitoringMode === 'true' || startupMonitoringMode === 'combined') && DEVICE_MONITORING_ENABLED)) {
  console.log('🚀 Прокси запущен. Статистика обновляется каждые 2 секунды.');
  console.log('💡 Нажмите Ctrl+C для остановки.\n');
} else if (startupMonitoringMode === 'combined') {
  console.log('🚀 Прокси запущен в комбинированном режиме (устройства + статистика прокси).');
  console.log('💡 Нажмите Ctrl+C для остановки.\n');
} else {
  // В режиме только устройств информация будет показана в таблице
}

// Инициализация мониторинга устройств
initDeviceMonitoring().catch(() => {
  // Игнорируем ошибки инициализации
});

connectToPi();
connectToLocal();

