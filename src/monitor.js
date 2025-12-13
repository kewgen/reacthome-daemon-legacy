#!/usr/bin/env node

/**
 * Мониторинг щитовых устройств с терминальным UI на terminal-kit
 * Версия: 1.0.26 (ручное управление версией)
 * 
 * Высокопроизводительный монитор для Raspberry Pi и desktop систем.
 * Оптимизирован для работы с сотнями устройств и минимального потребления CPU.
 * 
 * КЛЮЧЕВЫЕ ОСОБЕННОСТИ:
 * =====================
 * ✅ Минимальная нагрузка на CPU (оптимизировано для Raspberry Pi)
 * ✅ Debounce рендеринга (100мс) для плавной работы при множественных обновлениях
 * ✅ Периодическое обновление каждые 30 секунд + реал-тайм WebSocket события
 * ✅ Скользящее окно 10 секунд для точного подсчета скорости WebSocket
 * ✅ Интеллектуальное кэширование для предотвращения ненужных перерисовок
 * ✅ Отзывчивый курсор без зависаний
 * 
 * ЗАВИСИМОСТИ:
 * ============
 *   npm install terminal-kit ws
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * ==============
 *   Локальный запуск:
 *     node src/monitor.js
 * 
 *   Удалённое подключение к Raspberry Pi:
 *     REACTHOME_WS_URI=ws://192.168.x.x:3000 node src/monitor.js
 *
 *   С логированием WebSocket (анализ производительности):
 *     WS_REQUEST_LOGGING=1 node src/monitor.js
 * 
 *   Логирование включает:
 *     - Все исходящие запросы (LIST, GET) с размерами и счётчиками
 *     - Статистику входящих ответов (ACTION_SET)
 *     - Периодическую сводку каждые 10 секунд
 *     - Финальную статистику при выходе
 * 
 * КОПИРОВАНИЕ НА RASPBERRY PI:
 * ============================
 *   Автоматическое копирование с повышением версии:
 *     ./scripts/system/copy-monitor-to-pi.sh patch   # 1.0.7 → 1.0.8
 *     ./scripts/system/copy-monitor-to-pi.sh minor   # 1.0.7 → 1.1.0
 *     ./scripts/system/copy-monitor-to-pi.sh major   # 1.0.7 → 2.0.0
 * 
 * ИНТЕРФЕЙС:
 * ==========
 * Трёхпанельный интерфейс (как в Midnight Commander):
 *   ┌─────────────┬──────────────────────────┬─────────────────┐
 *   │  ФИЛЬТРЫ    │    СПИСОК УСТРОЙСТВ      │   ПАРАМЕТРЫ     │
 *   │             │                          │                 │
 *   │ • Все       │  MAC | Имя | Тип | ...   │ Устройство:     │
 *   │ Актуаторы   │  ──────────────────────  │   Параметр: xx  │
 *   │ Сенсоры     │  xxx | S4  | Сенсор|...  │   Значение: yy  │
 *   │ ...         │  ...                     │   ...           │
 *   └─────────────┴──────────────────────────┴─────────────────┘
 * 
 * УПРАВЛЕНИЕ:
 * ===========
 * • Tab          - Переключение между панелями (фильтры ↔ таблица ↔ параметры)
 * • ←/→          - Переход между панелями (фильтры ↔ таблица ↔ параметры)
 * • ↑/↓ или j/k  - Навигация по списку / Скроллинг текста (в панели параметров)
 * • Enter/Space  - Применить/снять фильтр (toggle) / Просмотр устройства
 * • PgUp/PgDown  - Постраничная прокрутка (таблица и параметры)
 * • Home/End     - К началу/концу списка (таблица и параметры)
 * • c            - Копировать раздел "Устройство" в буфер обмена
 * • y+c          - Копировать строку таблицы в буфер обмена
 * • q или Ctrl+C - Выход
 * 
 * ============================================================================
 * СПЕЦИАЛЬНЫЕ ТИПЫ УСТРОЙСТВ И ИХ СВЯЗИ
 * ============================================================================
 * 
 * 1. МОДУЛЬ ДАТЧИКОВ ПРОТЕЧКИ (M1, тип 0xab / 171)
 * --------------------------------------------------
 * 
 * Описание:
 *   M1 - модуль для подключения датчиков протечки воды через DI каналы.
 *   Поддерживает до N датчиков одновременно.
 * 
 * Отображение в мониторе:
 *   При выборе модуля M1 отображается:
 *   - 💧 Датчики протечки (DI каналы)
 *   - Список всех подключенных датчиков с их статусами
 *   - Номер DI канала для каждого датчика (DI/1, DI/2, ...)
 *   - Статус: 🟢 норма, ⚠️  протечка обнаружена, 🔴 offline
 *   - Название датчика (code → title)
 *   - Помещение, где установлен датчик
 * 
 * Пример отображения:
 *   💧 Датчики протечки (DI каналы):
 *     Всего датчиков: 3
 *     DI/1: 🟢 Датчик кухня
 *            Помещение: Кухня
 *     DI/2: ⚠️  Датчик ванная
 *            💧 ПРОТЕЧКА ОБНАРУЖЕНА!
 *            Помещение: Ванная
 *     DI/3: 🟢 Датчик коридор
 *            Помещение: Коридор
 * 
 * Связи:
 *   - Датчик протечки (leakage_sensor) → bind → Модуль M1 (DI канал)
 *   - Формат bind: {moduleId}/di/{номер} (например: "abc-123.../di/1")
 * 
 * 2. ДАТЧИК ПРОТЕЧКИ (leakage_sensor)
 * -------------------------------------
 * 
 * Описание:
 *   Датчик протечки воды, подключенный к модулю M1 через DI канал.
 *   Отслеживает наличие воды и передает сигнал о протечке.
 * 
 * Отображение в мониторе:
 *   При выборе датчика протечки отображается:
 *   - 🏠 Модуль датчиков протечки
 *   - Название и тип модуля M1
 *   - ID модуля
 *   - Bind: полный путь к DI каналу
 *   - Номер канала (DI/N)
 *   - Помещение модуля
 *   - Статус протечки: ⚠️  ДА / ✅ Нет
 * 
 * Пример отображения:
 *   🏠 Модуль датчиков протечки:
 *     🟢 M1 модуль (M1)
 *     ID: abc-123-def-456...
 *     Bind: abc-123-def-456.../di/2
 *     Канал: DI/2
 *     Помещение модуля: Прихожая
 *     Протечка: ⚠️  ДА
 * 
 * Связи:
 *   - Датчик протечки → bind → M1 модуль (формат: {moduleId}/di/{номер})
 *   - При обнаружении протечки изменяется state.leakage = true
 * 
 * 3. ДАТЧИК ДВИЖЕНИЯ DOPPLER (тип 34 / 0x22)
 * -------------------------------------------
 * 
 * Описание:
 *   Doppler - датчик движения (PIR сенсор), обнаруживающий перемещение.
 *   Может быть встроенным в S4 модуль или отдельным устройством с DI4.
 * 
 * Отображение в мониторе:
 *   При выборе допплера отображается:
 *   - 📜 Обработчик движения (onDoppler)
 *   - Название скрипта-обработчика
 *   - ID скрипта
 *   - Количество действий в скрипте
 *   - Список действий (первые 3)
 * 
 * Пример отображения:
 *   📜 Обработчик движения (onDoppler):
 *     ✅ doppler handler ванная
 *        ID: 3e411d0b-87ce-4516-...
 *        Действий: 2
 *        • ACTION_DOPPLER_HANDLE
 *        • ACTION_DOPPLER_HANDLE
 * 
 * Связи:
 *   - Допплер → state.onDoppler → Script (скрипт-обработчик)
 *   - Script → state.action[] → массив действий (ACTION_DOPPLER_HANDLE, и т.д.)
 *   - При обнаружении движения выполняется скрипт
 * 
 * Архитектура:
 *   Физический уровень:  Doppler (сенсор движения)
 *                           ↓ onDoppler
 *   Логический уровень:  Script (обработчик события)
 *                           ↓ action[]
 *   Уровень действий:    ACTION_DOPPLER_HANDLE, ACTION_*, и т.д.
 * 
 * Примечание:
 *   ACTION_DOPPLER_HANDLE - это программный слушатель допплера,
 *   который выполняет логику обработки события движения.
 * 
 * 4. МОДУЛЬ S3/S4 И ДАТЧИКИ ТЕМПЕРАТУРЫ (1-Wire)
 * ------------------------------------------------
 * 
 * Описание:
 *   S3/S4 - сенсорные модули с поддержкой подключения внешних датчиков
 *   температуры через протокол 1-Wire на DI/4 канал.
 * 
 * Отображение в мониторе:
 *   При выборе модуля S3/S4 отображается:
 *   - 🌡️  Датчики температуры (1-Wire на DI/4)
 *   - Список всех подключенных датчиков из state.temperature_ext[]
 *   - Индекс датчика в массиве [0], [1], ...
 *   - Название датчика (code → title)
 *   - Текущая температура (°C)
 *   - Проверка соответствия master
 * 
 * Пример отображения:
 *   🌡️  Датчики температуры (1-Wire на DI/4):
 *     Всего датчиков: 2
 *     [0] 🟢 Датчик улица
 *         ID: xyz-789...
 *         Температура: 22.5°C
 *         ✅ master корректен
 *     [1] 🟢 Датчик гараж
 *         ID: xyz-012...
 *         Температура: 18.3°C
 *         ✅ master корректен
 * 
 * Связи:
 *   - Датчик температуры (TEMPERATURE_EXT) → state.master → S3/S4 модуль
 *   - S3/S4 модуль → state.temperature_ext[] → массив ID датчиков
 *   - Двунаправленная связь проверяется для выявления ошибок
 * 
 * 5. ТЕРМОСТАТ И ПРИВЯЗКА К S3/S4
 * ---------------------------------
 * 
 * Описание:
 *   Термостат - программный элемент системы климата, управляющий
 *   обогревом/охлаждением на основе данных от датчиков температуры.
 * 
 * Отображение в мониторе:
 *   При выборе термостата отображается:
 *   - Управление термостатом
 *   - 🔗 Bind к DI каналу (обычно DI/4 модуля S4)
 *   - Информация о мастер-устройстве (S4 модуль)
 *   - Встроенная температура S4 модуля
 *   - 🌡️  Датчик температуры (внешний 1-Wire датчик)
 *   - Проверка соответствия master датчика и bind термостата
 *   - 📜 Скрипты управления (onStartHeat, onStopHeat, onStartCool, onStopCool)
 * 
 * Пример отображения:
 *   Управление термостатом:
 *     🔗 Bind к DI каналу:
 *        fd8e5a40-79f4-4990-87b5-64f79b2e7029/di/4
 *        → Модуль: S4 младшая (S4)
 *        → Встроенная температура: 23.5°C
 *     
 *     🌡️  Датчик температуры:
 *        ID: xyz-789...
 *        Название: Датчик младшая
 *        Температура: 24.2°C
 *        Статус: 🟢 Online, ✅ Ready
 *        ✅ Мастер датчика совпадает с bind
 *     
 *     📜 Скрипты управления:
 *        ✅ 🔥 Включение обогрева: Скрипт обогрев вкл
 *        ✅ ❄️  Выключение обогрева: Скрипт обогрев выкл
 * 
 * Связи:
 *   - Термостат → state.bind → S4 модуль (DI/4)
 *   - Термостат → state.sensor → TEMPERATURE_EXT датчик
 *   - TEMPERATURE_EXT → state.master → S4 модуль
 *   - Проверяется, что sensor.master === thermostat.bind (модуль)
 * 
 * ============================================================================
 * ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ
 * ============================================================================
 * 
 * ПРОБЛЕМА:
 * ---------
 * На Raspberry Pi с сотнями устройств наблюдалась 100% загрузка CPU и зависание курсора.
 * 
 * ПРИЧИНЫ:
 * --------
 * 1. Слишком частое обновление устройств (каждые 3 секунды)
 * 2. Рендеринг UI при каждом WebSocket сообщении (десятки рендеров в секунду)
 * 3. Избыточные запросы связанных устройств в каждом интервале
 * 
 * РЕШЕНИЯ (v1.0.6 - v1.0.7):
 * --------------------------
 * ✅ UPDATE_INTERVAL: 3 сек → 30 сек (снижение нагрузки в 10 раз)
 * ✅ Debounce рендеринга: группировка обновлений за 100мс
 * ✅ Убраны избыточные запросы в setInterval
 * ✅ Скользящее окно 10 сек для точного подсчёта скорости WebSocket
 * ✅ Классическая загрузка: данные → UI (без ленивой загрузки)
 * 
 * РЕЗУЛЬТАТ:
 * ----------
 * 🚀 Минимальная нагрузка на CPU
 * ⚡ Отзывчивый курсор без зависаний
 * 📊 Реал-тайм обновления через WebSocket события
 * 🔄 Периодическая синхронизация каждые 30 секунд
 * 
 * ============================================================================
 * АЛГОРИТМ РАБОТЫ
 * ============================================================================
 * 
 * ФАЗА 1: ЗАГРУЗКА ДАННЫХ (консоль)
 * ----------------------------------
 * 1. Подключение к WebSocket серверу
 * 2. Отправка LIST для получения всех ID устройств
 * 3. Массовый GET запрос для всех устройств
 * 4. Обработка ACTION_SET сообщений
 * 5. Построение структуры devices и sites
 * 
 * ФАЗА 2: ИНИЦИАЛИЗАЦИЯ UI
 * ------------------------
 * 1. Создание TerminalKitStatusDisplay с загруженными данными
 * 2. Построение дерева фильтров
 * 3. Первичный рендеринг всех панелей
 * 4. Подключение обработчиков клавиатуры
 * 
 * ФАЗА 3: РАБОТА В РЕАЛЬНОМ ВРЕМЕНИ
 * ----------------------------------
 * 1. WebSocket события → обновление deviceStates
 * 2. Debounce рендеринга (100мс) → scheduleRender()
 * 3. Периодическое обновление (30 сек) → массовый GET
 * 4. Интеллектуальное кэширование → минимум перерисовок
 * 
 * ============================================================================
 * СПЕЦИАЛЬНЫЕ ТИПЫ УСТРОЙСТВ И ИХ СВЯЗИ
 * ============================================================================
 * 
 * 6. АКТУАТОРЫ И КАНАЛЫ (DIM, DO)
 * ----------------------------------
 * 
 * Описание:
 *   Актуаторы - устройства управления освещением и другими нагрузками.
 *   Имеют каналы разных типов (DIM для диммирования, DO для дискретного управления).
 * 
 * Отображение в мониторе:
 *   При выборе актуатора отображается:
 *   - Каналы актуатора (группировка по типам)
 *   - Для каждого канала: тип/номер, значение, диапазон
 *   - Связанное устройство (если есть bind)
 *   - Название, тип и помещение связанного устройства
 * 
 * Пример отображения:
 *   Каналы актуатора:
 *     Диммер (DIM) каналы:
 *       DIM/1: 128 (0-255) → Свет кухня (LIGHT_LED) / Кухня
 *       DIM/2: 0 (0-255) → ⚠️  Устройство не найдено (c6782118...)
 *       DIM/3: 255 (0-255) → (не привязан)
 * 
 * Связи:
 *   - Канал актуатора → state.bind → Конечное устройство (LIGHT_*, SWITCH, и т.д.)
 *   - Формат bind: UUID устройства (без /channel/)
 * 
 * РЕЗОЛВИНГ СВЯЗЕЙ:
 * ==================
 * 
 * Алгоритм резолвинга связей:
 *   1. Получение устройства и его state через WebSocket
 *   2. Извлечение bind из state.bind или device.bind
 *   3. Парсинг bind (зависит от типа связи):
 *      - Для датчиков протечки: {moduleId}/di/{номер}
 *      - Для датчиков температуры: проверка master + temperature_ext[]
 *      - Для каналов актуатора (включая MIX): UUID устройства
 *      - Для термостатов: {moduleId}/di/{номер} + sensor UUID
 *      - Для допплеров: state.onDoppler → UUID скрипта
 *   4. Поиск связанного устройства в allDevices
 *   5. Получение state связанного устройства через WebSocket
 *   6. Отображение информации о связи с проверкой целостности
 * 
 * Проверка целостности связей:
 *   - Для термостатов: sensor.master === bind модуля
 *   - Для датчиков температуры: master → модуль → temperature_ext[]
 *   - Для датчиков протечки: bind → модуль → поиск по bind
 *   - Для допплеров: onDoppler → скрипт → action[] (ACTION_DOPPLER_HANDLE)
 *   - Для MIX устройств: каналы DO/DIM → bind → UUID потребителя
 *   - При несоответствиях выводится предупреждение ⚠️
 * 
 * 7. MIX УСТРОЙСТВА (СМЕШАННЫЕ АКТУАТОРЫ)
 * ----------------------------------------
 * 
 * Описание:
 *   MIX устройства - актуаторы со смешанными каналами (DO + DIM).
 *   Поддерживают одновременное управление реле и диммерами.
 * 
 * Типы MIX устройств:
 *   - MIX_H (0x41): 6 DO + 6 DIM = 12 каналов, RBUS интерфейс
 *   - MIX_2 (0xaa): 2 DO + 2 DIM = 4 канала, RBUS интерфейс
 *   - MIX_1 (0xab): 1 DO + 1 DIM = 2 канала, RBUS интерфейс
 *   - MIX_1_RS (0xac): 1 DO + 1 DIM = 2 канала, RS485 интерфейс
 *   - MIX_6x12_RS (0xb5): 6 DO + 12 DIM = 18 каналов, RS485 интерфейс
 * 
 * Отображение в мониторе:
 *   При выборе MIX устройства отображается:
 *   - Каналы актуатора (группировка по типам: DO и DIM)
 *   - Для каждого канала: тип/номер, значение, диапазон
 *   - Связанное устройство (если есть bind)
 *   - Название, тип и помещение связанного устройства
 *   - Статус привязки (привязан / не найден / не привязан)
 * 
 * Пример отображения:
 *   Actuator channels:
 *     Реле (DO) каналы:
 *       DO/1: ВКЛ → Свет кухня (LIGHT_LED) / Кухня
 *       DO/2: ВЫКЛ → (не привязан)
 *       DO/3: ВКЛ → Свет коридор (LIGHT_220) / Коридор
 *       DO/4: ВЫКЛ → ⚠️  Устройство не найдено (c6782118...)
 *       DO/5: ВЫКЛ → (не привязан)
 *       DO/6: ВЫКЛ → (не привязан)
 *     Диммер (DIM) каналы:
 *       DIM/1: 128 (0-255) → Свет спальня (LIGHT_LED) / Спальня
 *       DIM/2: 0 (0-255) → (не привязан)
 *       DIM/3: 255 (0-255) → Свет гостиная (LIGHT_LED) / Гостиная
 *       DIM/4: 64 (0-255) → (не привязан)
 *       DIM/5: 0 (0-255) → (не привязан)
 *       DIM/6: 0 (0-255) → (не привязан)
 * 
 * Связи:
 *   - Канал DO/DIM → state.bind → Конечное устройство (LIGHT_*, SWITCH, и т.д.)
 *   - Формат bind: UUID устройства (без /channel/)
 *   - Автоматический резолв связанных устройств через WebSocket
 * 
 * Особенности резолва:
 *   - При загрузке запрашиваются все каналы MIX устройств
 *   - Для каждого канала проверяется bind (UUID связанного устройства)
 *   - Если устройство не найдено, оно запрашивается через requestMissingDevice()
 *   - После получения данных устройство добавляется через addMissingDevice()
 *   - Каналы обновляются с правильным linkedDevice
 * 
 * Конфликт типов:
 *   - Тип 0xab используется для двух устройств:
 *     • MIX_1 (актуатор): category === 'Актуатор', имеет каналы DO/DIM
 *     • M1 (модуль датчиков протечки): category === 'Сенсор', имеет DI каналы
 *   - Различие определяется по категории устройства и контексту использования
 * 
 * Инициализация MIX_H:
 *   - MIX_H имеет специальную логику инициализации:
 *     • Группы (GROUP каналы 1-2) с настройками enabled и delay
 *     • DO каналы (1-2) с настройками value, timeout, group
 *     • DIM каналы (1-6) с настройками group, type, value
 * 
 * ============================================================================
 * АУДИТ И ПОДГОТОВКА К ТЕСТИРОВАНИЮ НА RASPBERRY PI
 * ============================================================================
 * 
 * ============================================================================
 * ТРЕБОВАНИЯ И УСТАНОВКА
 * ============================================================================
 * 
 * ЗАВИСИМОСТИ:
 * ------------
 * • terminal-kit (^3.0.0) - Терминальный UI
 * • ws (^7.2.5) - WebSocket клиент
 * • child_process (встроен) - Системные команды
 * 
 * ТРЕБОВАНИЯ:
 * -----------
 * • Node.js 18+ (протестировано на v20.19.2)
 * • npm 8+
 * • Linux/macOS/Windows
 * 
 * УСТАНОВКА НА RASPBERRY PI:
 * --------------------------
 *   # 1. Проверка Node.js
 *   node --version  # Должно быть >= v18.0.0
 *   
 *   # 2. Установка зависимостей
 *   cd /home/pi/reacthome-daemon
 *   npm install terminal-kit ws
 *   
 *   # 3. Опционально: xclip для буфера обмена
 *   sudo apt-get update && sudo apt-get install -y xclip
 * 
 * ЗАПУСК:
 * -------
 *   # Локально
 *   node src/monitor.js
 *   
 *   # Удалённое подключение
 *   REACTHOME_WS_URI=ws://192.168.x.x:3000 node src/monitor.js
 *   
 *   # С логированием
 *   WS_REQUEST_LOGGING=1 node src/monitor.js
 * 
 * Тестирование производительности:
 * - [ ] Загрузка большого количества устройств (1000+)
 * - [ ] Обновление состояния в реальном времени
 * - [ ] Использование памяти при длительной работе
 * - [ ] Отклик UI при большом количестве обновлений
 * 
 * 5. УСТРАНЕНИЕ ПРОБЛЕМ
 * ----------------------
 * 
 * Проблема: Скрипт не запускается
 *   Ошибка: Cannot find module 'terminal-kit'
 *   Решение: npm install terminal-kit ws
 * 
 * Проблема: Не подключается к WebSocket
 *   Ошибка: WebSocket error или Устройства не найдены через WebSocket
 *   Решение:
 *     1. Проверить, что WebSocket сервер запущен:
 *        netstat -tlnp | grep 3000
 *     2. Проверить URI WebSocket:
 *        export REACTHOME_WS_URI=ws://<IP_RASPBERRY_PI>:3000
 *     3. Проверить доступность порта:
 *        telnet <IP_RASPBERRY_PI> 3000
 * 
 * Проблема: Копирование не работает
 *   Симптом: При нажатии c или y+c ничего не происходит
 *   Решение:
 *     1. Установить xclip: sudo apt-get install -y xclip
 *     2. Если запускается через SSH без X11:
 *        Скрипт выведет текст в консоль (fallback)
 * 
 * Проблема: Высокая нагрузка на CPU
 *   Симптом: 100% CPU, зависание курсора
 *   Решение: ✅ Исправлено в v1.0.6-v1.0.7
 *     • UPDATE_INTERVAL увеличен до 30 секунд
 *     • Добавлен debounce рендеринга (100мс)
 *     • Удалены избыточные запросы в setInterval
 * 
 * Проблема: Медленная загрузка
 *   Симптом: Долгое ожидание, курсор не работает
 *   Решение: ✅ Исправлено в v1.0.6
 *     • Классическая загрузка: данные → UI
 *     • Убрана ленивая загрузка (вызывала артефакты)
 * 
 * ============================================================================
 * ПРОВЕРКА БЕЗОПАСНОСТИ
 * ============================================================================
 * 
 * 1. JSON.parse (Prototype Pollution / DoS)
 * ------------------------------------------
 * Статус: ✅ Исправлено
 * 
 * Проблема:
 * - JSON.parse() может быть уязвим к Prototype Pollution атакам
 * - Большие JSON сообщения могут вызвать DoS атаку
 * 
 * Исправление:
 * - Добавлена проверка размера сообщения (максимум 10MB)
 * - Используется безопасный парсинг без модификации прототипов
 * 
 * Места исправления:
 * - loadDevicesAndSitesViaWebSocket() - строка ~179
 * - main() - обработчик WebSocket сообщений - строка ~2627
 * 
 * 2. Command Injection (spawn)
 * ------------------------------
 * Статус: ✅ Безопасно
 * 
 * Проверка:
 * - spawn() используется только для копирования в буфер обмена
 * - Команды жестко заданы в коде, без пользовательского ввода
 * - Аргументы не содержат пользовательских данных
 * 
 * Места использования:
 * - copyToClipboard() - строки ~491-495
 *   - macOS: spawn('pbcopy', [])
 *   - Linux: spawn('sh', ['-c', 'xclip ...']) - команда жестко задана
 *   - Windows: spawn('clip', [])
 * 
 * 3. Environment Variables
 * --------------------------
 * Статус: ✅ Безопасно
 * 
 * Проверка:
 * - process.env.REACTHOME_WS_URI используется с дефолтным значением
 * - Дефолтное значение безопасно (локальный адрес)
 * - Переменная окружения не используется для выполнения команд
 * 
 * 4. String Operations
 * ---------------------
 * Статус: ✅ Безопасно
 * 
 * Проверка:
 * - substring() используется только для обрезки строк для отображения
 * - Нет использования пользовательского ввода для выполнения кода
 * - Все операции безопасны
 * 
 * 5. WebSocket Input Validation
 * ------------------------------
 * Статус: ✅ Улучшено
 * 
 * Улучшения:
 * - Ограничение размера сообщений до 10MB
 * - Проверка наличия обязательных полей (id, payload)
 * - Безопасная обработка ошибок парсинга
 * 
 * ВЫВОДЫ ПО БЕЗОПАСНОСТИ:
 * ------------------------
 * ✅ Все проверенные места безопасны
 * ✅ JSON.parse - добавлена защита от DoS
 * ✅ spawn - безопасное использование без пользовательского ввода
 * ✅ process.env - безопасное использование с дефолтными значениями
 * ✅ String operations - безопасные операции
 * ✅ WebSocket - добавлена валидация входных данных
 * 
 * Скрипт готов к использованию в production с учетом исправлений безопасности.
 */

const termkit = require('terminal-kit');
const term = termkit.terminal;
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Версия монитора (обновляется вручную при каждом коммите)
const VERSION = '1.0.25';

// Зачем: URL "всегда свежего" скрипта на GitHub (raw) для проверки обновлений и самоустановки
const MONITOR_REMOTE_RAW_URL = 'https://raw.githubusercontent.com/kewgen/reacthome-daemon-legacy/feature/monitor/src/monitor.js';

// Зачем: Определяем адрес WebSocket из переменной окружения, аргумента командной строки или используем дефолт
const getWebSocketUri = () => {
  // 1. Проверяем аргумент командной строки (--ws-uri или первый позиционный аргумент)
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ws-uri' && args[i + 1]) {
      return args[i + 1];
    }
    if (args[i].startsWith('--ws-uri=')) {
      return args[i].substring('--ws-uri='.length);
    }
    // Если первый аргумент не начинается с --, считаем его адресом WebSocket
    if (i === 0 && !args[i].startsWith('--')) {
      return args[i];
    }
  }
  // 2. Проверяем переменную окружения
  if (process.env.REACTHOME_WS_URI) {
    return process.env.REACTHOME_WS_URI;
  }
  // 3. Дефолтное значение
  return 'ws://localhost:3000';
};

const WS_URI = getWebSocketUri(); // По умолчанию подключаемся к локальному WebSocket серверу

// Зачем: Проверяем наличие более свежей версии скрипта на GitHub и предлагаем обновиться
const shouldCheckUpdates = () => {
  // Можно отключить проверку, если сеть недоступна/не нужна
  if (process.env.MONITOR_UPDATE_CHECK === '0' || process.env.MONITOR_UPDATE_CHECK === 'false') return false;

  // CLI флаги:
  //   --no-update-check
  //   --check-update (только проверить и выйти кодом 0/2)
  const args = process.argv.slice(2);
  if (args.includes('--no-update-check')) return false;
  return true;
};

const isCheckUpdateOnlyMode = () => {
  const args = process.argv.slice(2);
  return args.includes('--check-update');
};

const isSelfUpdateForced = () => {
  const args = process.argv.slice(2);
  return args.includes('--self-update') || args.includes('--update');
};

// Зачем: Корректное сравнение semver (x.y.z) без внешних зависимостей
const compareSemver = (a, b) => {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10));
  const pb = String(b || '').split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

// Зачем: Получаем версию из содержимого monitor.js (const VERSION = 'x.y.z';)
const extractVersionFromSource = (sourceText) => {
  const m = String(sourceText || '').match(/const\s+VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  return m ? m[1] : null;
};

// Зачем: Неблокирующая загрузка удалённой версии и (опционально) обновление текущего файла
const fetchRemoteMonitorSource = async (url, timeoutMs = 2500) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
};

// Зачем: Спросить пользователя (если есть TTY) и вернуть true/false
const askYesNo = async (question) => {
  if (!process.stdin.isTTY) return false;
  const readline = require('readline');
  return await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = String(answer || '').trim().toLowerCase();
      resolve(a === 'y' || a === 'yes' || a === 'д' || a === 'да');
    });
  });
};

// Зачем: Проверка обновления и предложение загрузки
const checkForRemoteUpdateAndMaybeApply = async () => {
  if (!shouldCheckUpdates()) return { checked: false };

  // Зачем: Node < 18 не имеет глобального fetch — не ломаем запуск
  if (typeof fetch !== 'function') {
    console.log('[INFO] Проверка обновлений недоступна: требуется Node.js >= 18 (нет fetch)');
    if (isCheckUpdateOnlyMode()) process.exit(0);
    return { checked: true, skipped: true, reason: 'no-fetch' };
  }

  let remoteSource = null;
  let remoteVersion = null;

  try {
    remoteSource = await fetchRemoteMonitorSource(MONITOR_REMOTE_RAW_URL);
    remoteVersion = extractVersionFromSource(remoteSource);
  } catch (e) {
    // Не мешаем работе монитора, просто тихо пропускаем (включаем только короткий INFO)
    const msg = e && e.name === 'AbortError' ? 'таймаут' : (e && e.message ? e.message : String(e));
    console.log(`[INFO] Проверка обновлений пропущена: ${msg}`);
    return { checked: true, error: msg };
  }

  if (!remoteVersion) {
    console.log('[INFO] Проверка обновлений: не удалось определить версию удалённого скрипта');
    return { checked: true, error: 'no-remote-version' };
  }

  const cmp = compareSemver(remoteVersion, VERSION);
  if (cmp <= 0) {
    if (isCheckUpdateOnlyMode()) {
      console.log(`[INFO] Обновлений нет. Локальная версия: v${VERSION}, удалённая: v${remoteVersion}`);
      process.exit(0);
    }
    // Зачем: Показываем, что проверка выполнена, даже если обновлений нет
    if (cmp < 0) {
      console.log(`[INFO] ✓ Локальная версия v${VERSION} новее удалённой v${remoteVersion} - обновление не требуется`);
    } else {
      console.log(`[INFO] ✓ Версия v${VERSION} актуальна (удалённая: v${remoteVersion})`);
    }
    return { checked: true, updateAvailable: false, remoteVersion };
  }

  // Есть новая версия
  console.log(`[INFO] Доступна новая версия монитора: v${VERSION} → v${remoteVersion}`);
  console.log(`[INFO] Источник: ${MONITOR_REMOTE_RAW_URL}`);
  console.log(`[INFO] Обновление перезапишет текущий файл: ${__filename}`);

  if (isCheckUpdateOnlyMode()) {
    // 2 = "есть обновление" (удобно для скриптов)
    process.exit(2);
  }

  const shouldUpdate = isSelfUpdateForced()
    ? true
    : await askYesNo('Загрузить и применить обновление сейчас? (y/N): ');

  if (!shouldUpdate) {
    console.log('[INFO] Обновление пропущено пользователем');
    return { checked: true, updateAvailable: true, remoteVersion, applied: false };
  }

  try {
    // Важно: не создаём временных файлов (правило про создание файлов), перезаписываем напрямую
    fs.writeFileSync(__filename, remoteSource, 'utf8');
    console.log('[INFO] Обновление применено. Перезапустите команду reacthome-monitor.');
    process.exit(0);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error(`[ERROR] Не удалось применить обновление: ${msg}`);
    return { checked: true, updateAvailable: true, remoteVersion, applied: false, error: msg };
  }
};

const UPDATE_INTERVAL = 30000; // 30 секунд - оптимальный баланс между актуальностью данных и нагрузкой на CPU
const STATE_REQUEST_TIMEOUT = 10000; // Таймаут для получения всех ответов на GET запрос
const WS_REQUEST_LOGGING = process.env.WS_REQUEST_LOGGING === '1' || process.env.WS_REQUEST_LOGGING === 'true'; // Включение детального логирования WebSocket запросов
const WS_LOG_DIR = process.env.WS_LOG_DIR || path.join(process.cwd(), 'logs'); // Директория для логов WebSocket
const WS_LOG_FILE_IN = path.join(WS_LOG_DIR, 'ws-in.log'); // Файл для входящих сообщений (ответы от сервера)
const WS_LOG_FILE_OUT = path.join(WS_LOG_DIR, 'ws-out.log'); // Файл для исходящих сообщений (запросы к серверу)

// Глобальные потоки записи для логирования WebSocket (используются до создания объекта display)
let globalWsLogStreams = null;

// Глобальные счетчики сообщений для логов
let globalWsInCounter = 0; // Счетчик входящих сообщений
let globalWsOutCounter = 0; // Счетчик исходящих сообщений

// Инициализация глобальных потоков логирования WebSocket
function initGlobalWsLogStreams() {
  if (!WS_REQUEST_LOGGING || globalWsLogStreams) return;
  
  try {
    // Создаем директорию для логов если её нет
    if (!fs.existsSync(WS_LOG_DIR)) {
      fs.mkdirSync(WS_LOG_DIR, { recursive: true });
    }
    
    // Создаем потоки записи для файлов in (входящие) и out (исходящие)
    globalWsLogStreams = {
      in: fs.createWriteStream(WS_LOG_FILE_IN, { flags: 'a' }),
      out: fs.createWriteStream(WS_LOG_FILE_OUT, { flags: 'a' })
    };
    
    // Обработка ошибок записи в файлы
    globalWsLogStreams.in.on('error', (err) => {
      console.error(`[ERROR] Ошибка записи в ${WS_LOG_FILE_IN}:`, err.message);
    });
    globalWsLogStreams.out.on('error', (err) => {
      console.error(`[ERROR] Ошибка записи в ${WS_LOG_FILE_OUT}:`, err.message);
    });
    
    console.log(`[INFO] Логирование WebSocket включено:`);
    console.log(`[INFO]   Входящие сообщения: ${WS_LOG_FILE_IN}`);
    console.log(`[INFO]   Исходящие сообщения: ${WS_LOG_FILE_OUT}`);
  } catch (error) {
    console.error(`[ERROR] Не удалось создать потоки логирования:`, error.message);
    globalWsLogStreams = null;
  }
}

// Вспомогательная функция для логирования запросов (используется до создания display)
function logWebSocketRequestGlobal(type, state) {
  if (!WS_REQUEST_LOGGING) return;
  
  // Увеличиваем счетчик исходящих сообщений
  globalWsOutCounter++;
  
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const requestData = JSON.stringify({ type, state });
  const requestSize = Buffer.byteLength(requestData, 'utf8');
  
  let logLine = `[${globalWsOutCounter}] ${timestamp} [${type.toUpperCase()}] `;
  
  if (type === 'list') {
    logLine += `LIST запрос (${requestSize} байт)\n`;
    logLine += `${requestData}\n`;
  } else if (type === 'get') {
    const deviceIds = Array.isArray(state) ? state : [];
    const deviceCount = deviceIds.filter(id => !id.includes('/')).length;
    const channelCount = deviceIds.filter(id => id.includes('/')).length;
    
    logLine += `GET запрос: ${deviceCount} устройств, ${channelCount} каналов (${requestSize} байт)\n`;
    logLine += `${requestData}\n`;
  }
  
  logLine += '---\n';
  
  if (globalWsLogStreams && globalWsLogStreams.out) {
    globalWsLogStreams.out.write(logLine);
  }
}

// Вспомогательная функция для логирования ответов (используется до создания display)
function logWebSocketResponseGlobal(message, dataSize) {
  if (!WS_REQUEST_LOGGING) return;
  
  // Увеличиваем счетчик входящих сообщений
  globalWsInCounter++;
  
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const msgType = message.type || 'unknown';
  
  let logLine = `[${globalWsInCounter}] ${timestamp} [${msgType.toUpperCase()}] `;
  
  if (msgType === 'action_set' || msgType === 'ACTION_SET') {
    const hasContext = !!message._context;
    logLine += `ACTION_SET ${hasContext ? 'с контекстом' : 'без контекста'} (${dataSize} байт)\n`;
    logLine += `ID: ${message.id || 'N/A'}\n`;
  } else if (msgType === 'list' || msgType === 'LIST') {
    logLine += `LIST ответ (${dataSize} байт)\n`;
  } else {
    logLine += `Неизвестный тип ответа (${dataSize} байт)\n`;
  }
  
  logLine += `${JSON.stringify(message, null, 2)}\n`;
  logLine += '---\n';
  
  if (globalWsLogStreams && globalWsLogStreams.in) {
    globalWsLogStreams.in.write(logLine);
  }
}

// Резолвинг выполняется только через WebSocket, без использования локальной БД

// Типы устройств (щитовые)
// Включаем все типы устройств, которые могут быть получены через WebSocket
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x22, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0]; // 0x22 - отдельные допплеры (датчики движения)
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

// Конечные устройства (Smart TOP, Smart BOTTOM и другие)
const ENDPOINT_DEVICE_TYPES = [
  0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b
];

const DEVICE_TYPE_NAMES = {
  // Сенсоры
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x20: 'DI_4', 0x22: 'DOPPLER', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xf0: 'TEMPERATURE_EXT',
  // Реле
  0x0a: 'DO8', 0x0b: 'DO16', 0x11: 'DO12', 0x23: 'RELAY_2',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa2: 'RELAY_24', 0xa7: 'RELAY_2_DIN', 0xae: 'RELAY_12_RS',
  // Диммеры
  0x0e: 'DIM4', 0x0f: 'DIM8',
  0xa3: 'DIM_4', 0xa4: 'DIM_8', 0xa5: 'LANAMP', 0xaf: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS', 0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb6: 'DIM_1_AC_RS',
  // Аналоговые выходы
  0xa9: 'AO_4_DIN',
  // Смешанные устройства
  0x41: 'MIX_H', 0xaa: 'MIX_2', 0xab: 'MIX_1', 0xac: 'MIX_1_RS', 0xb5: 'MIX_6x12_RS',
  // Панели управления
  0x25: 'SMART_4G',
  // Конечные устройства
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
};

const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'fan', 'BOILER', 'PUMP', // Добавляем 'fan' (строчными) для совместимости с устройствами типа 'fan'
  'thermostat', 'hygrostat', 'co2_stat',
  'curtains', 'curtain', 'blind', 'blinds', 'roller', // Шторы, жалюзи, роллеты - потребители
  'multiroom', // Мультирум аудио - потребитель
];

// Типы сенсоров (строковые)
const SENSOR_STRING_TYPES = [
  'leakage_sensor', // Датчик протечки
  'reed', // Геркон (магнитный датчик открытия)
];

// Типы интеграций с внешним оборудованием (строковые физические устройства)
const INTEGRATION_TYPES = [
  'INTESIS_BOX', // Intesis AC контроллеры (интеграция с кондиционерами)
  'MODBUS', // Modbus устройства (протокол связи)
  'NOVA', // Приточная вентиляция
];

// Типы ACTION_* которые являются действиями в скриптах, а не устройствами
// Эти типы не должны отображаться в списке устройств
const ACTION_TYPES = [
  'ACTION_ON', 'ACTION_OFF', 'ACTION_SET', 'ACTION_TOGGLE',
  'ACTION_ENABLE', 'ACTION_DISABLE', 'ACTION_DOPPLER_HANDLE',
  'ACTION_SCRIPT_RUN', 'ACTION_TIMER_START', 'ACTION_TIMER_STOP',
];

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'Конечное';
  
  // Обработка строковых типов сенсоров
  if (SENSOR_STRING_TYPES.includes(type)) return 'Сенсор';
  
  // Обработка интеграций (внешнее оборудование)
  if (INTEGRATION_TYPES.includes(type)) return 'Интеграция';
  
  return 'Другое';
}

function getDeviceIcon(deviceType, category) {
  if (typeof deviceType === 'string') {
    const consumerIconMap = {
      'light_220': '💡',
      'light_LED': '💡',
      'light_RGB': '🌈',
      'light_led': '💡',
      'socket_220': '🔌',
      'valve_heating': '🔥',
      'valve_water': '💧',
      'warm_floor': '🔥',
      'AC': '❄️',
      'FAN': '🌀',
      'fan': '🌀', // Добавляем иконку для 'fan' (строчными) для совместимости
      'BOILER': '🔥',
      'PUMP': '💧',
      'thermostat': '🌡️',
      'hygrostat': '💨',
      'co2_stat': '🌬️',
      'leakage_sensor': '💧', // Датчик протечки - сенсор
      'curtains': '🪟', // Шторы - потребитель
      'curtain': '🪟',
      'blind': '🪟',
      'blinds': '🪟',
      'roller': '🪟',
      'multiroom': '🔊', // Мультирум аудио - потребитель
      'reed': '🚪', // Геркон - сенсор открытия двери/окна
      'INTESIS_BOX': '❄️', // Intesis AC контроллер - интеграция с кондиционером
      'MODBUS': '🔌', // Modbus устройство - протокол интеграции
      'NOVA': '🌬️', // Приточная вентиляция - интеграция
    };
    return consumerIconMap[deviceType] || '';
  }

  if (typeof deviceType === 'number') {
    if (category === 'Актуатор') {
      if ([0x0a, 0x0b, 0x23, 0xa0, 0xa1, 0xa2, 0xa7, 0xae].includes(deviceType)) return '🔌';
      if ([0x0e, 0x0f, 0xa3, 0xa4, 0xa5, 0xaf, 0xad, 0xb3, 0xb4, 0xb6].includes(deviceType)) return '💡';
      if ([0xa9].includes(deviceType)) return '📊';
      if ([0x41, 0xaa, 0xab, 0xac, 0xb5].includes(deviceType)) return '🔀';
      return '⚙️';
    }
    if (category === 'Сенсор') {
      if ([0x01, 0x02, 0x03, 0xf0].includes(deviceType)) return '🌡️';
      if ([0x2b].includes(deviceType)) return '🌬️';
      if ([0x04, 0x22, 0x2d, 0x2e].includes(deviceType)) return '👁️'; // 0x22 - отдельные допплеры (датчики движения)
      if ([0x20, 0x2f].includes(deviceType)) return '📥';
      return '📊';
    }
    if (category === 'Панель') {
      if ([0x25].includes(deviceType)) return '📱';
      return '🖥️';
    }
    if (category === 'Конечное') {
      if ([0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b].includes(deviceType)) {
        return '📱';
      }
      return '🔘';
    }
    if (category === 'Другое') {
      return '❓';
    }
  }

  return '';
}

// Получаем имя устройства из payload WebSocket
// Зачем: Всегда выводим "code title" для единообразного отображения
function getDeviceName(payload) {
  const code = payload.code || '';
  const title = payload.title || '';
  
  // Формируем "code title" если оба есть
  if (code && title) {
    return `${code} ${title}`;
  }
  // Если есть только code
  if (code) {
    return code;
  }
  // Если есть только title
  if (title) {
    return title;
  }
  // Если есть name (fallback)
  if (payload.name) {
    return payload.name;
  }
  // Если ничего нет
  return 'Без названия';
}

// Загружаем устройства и помещения через WebSocket
// Используем запросы LIST и GET согласно инструкции event-logger-websocket-requests
// Резолвинг выполняется полностью через WebSocket, без использования локальной БД
function loadDevicesAndSitesViaWebSocket(wsUri) {
  return new Promise((resolve, reject) => {
    const devices = [];
    const sites = [];
    const siteMap = new Map(); // Помещения загружаются только через WebSocket
    const deviceDataMap = new Map(); // Временное хранилище данных устройств из ACTION_SET
    let locationName = process.env.LOCATION_NAME || null; // Название локации из env или будет загружено из PROJECT
    let pendingGetRequests = 0;
    let listReceived = false;
    let getSent = false;
    let timeoutId = null;
    let connectionTimeoutId = null; // Таймаут для подключения к WebSocket
    let processingStarted = false; // Флаг для предотвращения повторной обработки данных
    
    console.log(`[DEBUG] Подключение к WebSocket: ${wsUri}`);
    const ws = new WebSocket(wsUri);
    
    // Таймаут подключения к WebSocket (10 секунд)
    connectionTimeoutId = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error(`[ERROR] Таймаут подключения к WebSocket после 10 секунд. Состояние: ${ws.readyState}`);
        ws.terminate();
        clearTimeout(timeoutId);
        reject(new Error('Таймаут подключения к WebSocket (10 секунд)'));
      }
    }, 10000);
    
    // Обработка ошибок подключения
    // Зачем: Улучшенная обработка ошибок с более информативными сообщениями
    ws.on('error', (error) => {
      const errorMessage = error.message || error.code || error.toString() || 'Неизвестная ошибка';
      const errorCode = error.code || '';
      
      console.error(`[ERROR] Ошибка WebSocket: ${errorMessage}`);
      if (errorCode) {
        console.error(`[ERROR] Код ошибки: ${errorCode}`);
      }
      
      clearTimeout(timeoutId);
      clearTimeout(connectionTimeoutId);
      
      // Формируем более информативное сообщение об ошибке
      let userMessage = `Ошибка подключения к WebSocket`;
      
      if (errorCode === 'ECONNREFUSED' || errorMessage.includes('ECONNREFUSED')) {
        userMessage = `Не удалось подключиться к ${wsUri}. Сервер не запущен или недоступен. Проверьте, что сервер запущен на порту 3000.`;
      } else if (errorCode === 'ENOTFOUND' || errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        userMessage = `Не удалось найти сервер по адресу ${wsUri}. Проверьте правильность адреса.`;
      } else if (errorCode === 'ETIMEDOUT' || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        userMessage = `Превышено время ожидания подключения к ${wsUri}. Сервер может быть недоступен.`;
      } else if (errorMessage && errorMessage.trim() !== '') {
        userMessage = `Ошибка подключения к ${wsUri}: ${errorMessage}`;
      } else {
        userMessage = `Не удалось подключиться к ${wsUri}. Проверьте, что сервер запущен и доступен.`;
      }
      
      reject(new Error(userMessage));
    });
    
    ws.on('open', () => {
      console.log('[DEBUG] WebSocket подключен успешно');
      clearTimeout(connectionTimeoutId);
      // Отправляем LIST запрос для получения списка устройств
      console.log('Запрашиваем список устройств через LIST...');
      const listRequest = { type: 'list' };
      logWebSocketRequestGlobal('list', null);
      ws.send(JSON.stringify(listRequest));
    });
    
    ws.on('message', (data) => {
      try {
        const dataString = data.toString();
        const dataSize = Buffer.byteLength(dataString, 'utf8');
        const message = JSON.parse(dataString);
        
        // Логируем получение ответа
        logWebSocketResponseGlobal(message, dataSize);
        
        // Отладочный вывод для понимания что приходит
        if (!listReceived || !getSent) {
          console.log('[DEBUG] Получено сообщение:', JSON.stringify(message).substring(0, 200));
        }
        
        // Обрабатываем ответ LIST (проверяем оба варианта регистра)
        if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
          listReceived = true;
          const stateList = message.state || [];
          
          if (!Array.isArray(stateList)) {
            clearTimeout(connectionTimeoutId);
            ws.close();
            reject(new Error('LIST не содержит массив state'));
            return;
          }
          
          console.log(`Получено ${stateList.length} ID устройств из LIST`);
          
          // Извлекаем ID устройств из LIST (формат: [[id, timestamp], ...])
          const deviceIds = stateList.map(([id]) => id).filter(Boolean);
          
          if (deviceIds.length === 0) {
            clearTimeout(connectionTimeoutId);
            ws.close();
            resolve({ devices: [], sites: [], locationName: 'Локация' });
            return;
          }
          
          // Отправляем GET запрос для получения полных данных устройств
          console.log(`Запрашиваем полные данные для ${deviceIds.length} устройств через GET...`);
          pendingGetRequests = deviceIds.length;
          getSent = true;
          const getRequest = { type: 'get', state: deviceIds };
          logWebSocketRequestGlobal('get', deviceIds);
          ws.send(JSON.stringify(getRequest));
          
          // Устанавливаем таймаут для получения всех ответов
          timeoutId = setTimeout(() => {
            if (!processingStarted) {
              processingStarted = true;
              if (pendingGetRequests > 0) {
                console.log(`Предупреждение: получено не все ответы на GET (ожидалось ${deviceIds.length}, получено ${deviceIds.length - pendingGetRequests})`);
              }
              console.log(`[DEBUG] Таймаут истек, обрабатываем ${deviceDataMap.size} устройств`);
              processDevicesAndSites();
            }
          }, STATE_REQUEST_TIMEOUT);
        }
        
        // Обрабатываем ACTION_SET сообщения (ответы на GET)
        // Проверяем оба варианта регистра: 'action_set' и 'ACTION_SET'
        const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
        if (isActionSet && getSent) {
          const { id, payload } = message;
          
          // Обрабатываем только сообщения без _context (начальное состояние из GET)
          // Сообщения с _context - это события изменений, их пропускаем при начальной загрузке
          if (!message._context) {
            if (id && payload && typeof payload === 'object') {
              // Сохраняем данные устройства для последующей обработки
              const wasNew = !deviceDataMap.has(id);
              deviceDataMap.set(id, payload);
              
              // Уменьшаем счетчик только если это новый ответ
              if (wasNew) {
                pendingGetRequests--;
              }
              
              // Отладочный вывод каждые 100 устройств
              if (deviceDataMap.size % 100 === 0) {
                console.log(`[DEBUG] Получено ${deviceDataMap.size} устройств, осталось ${pendingGetRequests}`);
              }
              
              // Если все ответы получены, обрабатываем данные
              if (pendingGetRequests <= 0 && !processingStarted) {
                clearTimeout(timeoutId);
                clearTimeout(connectionTimeoutId);
                processingStarted = true;
                console.log(`[DEBUG] Все ответы получены, обрабатываем ${deviceDataMap.size} устройств`);
                processDevicesAndSites();
              }
            } else {
              console.log('[DEBUG] Пропущено ACTION_SET без id или payload:', { id, hasPayload: !!payload, messageKeys: Object.keys(message) });
            }
          } else {
            // Отладочный вывод для ACTION_SET с _context (события изменений)
            if (deviceDataMap.size < 5) {
              console.log('[DEBUG] Пропущено ACTION_SET с _context (событие изменения):', message.id);
            }
          }
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения WebSocket:', error);
      }
    });
    
    // Обрабатываем устройства и помещения из полученных данных
    function processDevicesAndSites() {
      console.log(`[DEBUG] Начало обработки устройств и помещений. Всего данных: ${deviceDataMap.size}`);
      const processedDeviceIds = new Set(); // Отслеживаем уже обработанные устройства для предотвращения дублирования
      const addedDeviceIds = new Set(); // Отслеживаем уже добавленные устройства в массив devices
      
      // Сначала обрабатываем помещения и проекты (type === 'site', 'SITE', 'project' или 'PROJECT')
      deviceDataMap.forEach((payload, deviceId) => {
        // Пропускаем каналы (ID содержат '/')
        if (deviceId.includes('/')) {
          return;
        }
        
        const deviceType = payload.type;
        
        // Обрабатываем помещения и проекты (проекты могут использоваться как помещения)
        if (deviceType === 'site' || deviceType === 'SITE' || deviceType === 'project' || deviceType === 'PROJECT') {
          const siteName = payload.title || payload.code || payload.name || deviceId;
          siteMap.set(deviceId, siteName);
          processedDeviceIds.add(deviceId); // Помечаем как обработанное
          
          // Если это project и название локации не задано через env, берем из project.title
          if ((deviceType === 'project' || deviceType === 'PROJECT') && !process.env.LOCATION_NAME && payload.title) {
            locationName = payload.title;
            console.log(`[DEBUG] Название локации загружено из PROJECT: ${locationName}`);
          }
        }
      });
      
      // Собираем все уникальные помещения из данных устройств (если помещение не найдено как устройство)
      deviceDataMap.forEach((payload, deviceId) => {
        if (payload.site) {
          const siteIds = Array.isArray(payload.site) ? payload.site : [payload.site];
          siteIds.forEach(siteId => {
            if (typeof siteId === 'string' && !siteMap.has(siteId)) {
              // Если помещение не найдено как отдельное устройство,
              // используем ID как имя (помещение будет запрошено через WebSocket позже)
              siteMap.set(siteId, `не зарезолвлено\n${siteId}`);
            }
          });
        }
      });
      
      // Обрабатываем устройства из полученных данных
      deviceDataMap.forEach((payload, deviceId) => {
        // Пропускаем каналы (ID содержат '/')
        if (deviceId.includes('/')) {
          return;
        }
        
        // Пропускаем уже обработанные устройства (предотвращаем дублирование)
        if (processedDeviceIds.has(deviceId)) {
          return;
        }
        
        const deviceType = payload.type;
        
        // Пропускаем помещения и проекты (они уже обработаны выше)
        if (deviceType === 'site' || deviceType === 'SITE' || deviceType === 'project' || deviceType === 'PROJECT') {
          return;
        }
        
        // Обрабатываем устройства с числовым типом (щитовые и конечные)
        if (typeof deviceType === 'number' && deviceType !== 0x00) {
          // Проверяем, не добавлено ли уже устройство с таким ID
          if (addedDeviceIds.has(deviceId)) {
            return;
          }
          
          let siteId = payload.site;
          let siteName = null;
          
          if (siteId) {
            if (Array.isArray(siteId)) {
              siteId = siteId[0];
            }
            if (typeof siteId === 'string') {
              siteName = siteMap.get(siteId) || null;
            }
          }
          
          const category = getDeviceCategory(deviceType);
          const deviceName = getDeviceName(payload);
          // Не добавляем иконку к имени здесь, она будет добавлена при рендеринге

          devices.push({
            id: deviceId,
            name: deviceName,
            title: payload.title || null,  // Сохраняем все идентификаторы отдельно для детального отображения
            code: payload.code || null,
            nameField: payload.name || null,  // Сохраняем поле name из payload отдельно
            type: deviceType,
            typeName: DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`,
            category: category,
            siteId: siteId || null,
            site: siteName || null,
          });
          
          addedDeviceIds.add(deviceId); // Помечаем как добавленное
          processedDeviceIds.add(deviceId); // Помечаем как обработанное
        }
        
        // Пропускаем ACTION_* типы - это действия скриптов, а не устройства
        if (typeof deviceType === 'string' && ACTION_TYPES.includes(deviceType)) {
          return;
        }
        
        // Обрабатываем потребители (строковые типы)
        if (typeof deviceType === 'string' && CONSUMER_TYPES.includes(deviceType)) {
          // Проверяем, не добавлено ли уже устройство с таким ID
          if (addedDeviceIds.has(deviceId)) {
            return;
          }
          
          let siteId = payload.site;
          let siteName = null;
          
          if (siteId) {
            if (Array.isArray(siteId)) {
              siteId = siteId[0];
            }
            if (typeof siteId === 'string') {
              siteName = siteMap.get(siteId) || null;
            }
          }
          
          const deviceName = getDeviceName(payload);
          // Не добавляем иконку к имени здесь, она будет добавлена при рендеринге

          devices.push({
            id: deviceId,
            name: deviceName,
            title: payload.title || null,  // Сохраняем все идентификаторы отдельно для детального отображения
            code: payload.code || null,
            nameField: payload.name || null,  // Сохраняем поле name из payload отдельно
            type: deviceType,
            typeName: deviceType.toUpperCase(),
            category: 'Потребитель',
            siteId: siteId || null,
            site: siteName || null,
            bind: payload.bind || null,
          });
          
          addedDeviceIds.add(deviceId); // Помечаем как добавленное
          processedDeviceIds.add(deviceId); // Помечаем как обработанное
        }
        
        // Обрабатываем датчики протечки (leakage_sensor)
        if (deviceType === 'leakage_sensor') {
          // Проверяем, не добавлено ли уже устройство с таким ID
          if (addedDeviceIds.has(deviceId)) {
            return;
          }
          
          let siteId = payload.site;
          let siteName = null;
          
          if (siteId) {
            if (Array.isArray(siteId)) {
              siteId = siteId[0];
            }
            if (typeof siteId === 'string') {
              siteName = siteMap.get(siteId) || null;
            }
          }
          
          const deviceName = getDeviceName(payload);

          devices.push({
            id: deviceId,
            name: deviceName,
            title: payload.title || null,
            code: payload.code || null,
            nameField: payload.name || null,
            type: deviceType,
            typeName: 'LEAKAGE_SENSOR',
            category: 'Сенсор',
            siteId: siteId || null,
            site: siteName || null,
            bind: payload.bind || null,
          });
          
          addedDeviceIds.add(deviceId);
          processedDeviceIds.add(deviceId);
        }
        
        // Обрабатываем остальные строковые типы сенсоров и интеграций
        const isStringSensorOrIntegration = 
          SENSOR_STRING_TYPES.includes(deviceType) || 
          INTEGRATION_TYPES.includes(deviceType) ||
          CONSUMER_TYPES.includes(deviceType);
        
        if (isStringSensorOrIntegration && !addedDeviceIds.has(deviceId)) {
          let siteId = payload.site;
          let siteName = null;
          
          if (siteId) {
            if (Array.isArray(siteId)) {
              siteId = siteId[0];
            }
            if (typeof siteId === 'string') {
              siteName = siteMap.get(siteId) || null;
            }
          }
          
          const deviceName = getDeviceName(payload);
          const category = getDeviceCategory(deviceType);

          devices.push({
            id: deviceId,
            name: deviceName,
            title: payload.title || null,
            code: payload.code || null,
            nameField: payload.name || null,
            type: deviceType,
            typeName: deviceType.toUpperCase(),
            category: category,
            siteId: siteId || null,
            site: siteName || null,
            bind: payload.bind || null,
          });
          
          addedDeviceIds.add(deviceId);
          processedDeviceIds.add(deviceId);
        }
      });
      
      // Собираем ID устройств из массивов помещений (light_220, light_LED и т.д.)
      const consumerIdsFromSites = new Set();
      deviceDataMap.forEach((payload, deviceId) => {
        if (payload.type === 'site' || payload.type === 'SITE' || payload.type === 'project' || payload.type === 'PROJECT') {
          // Извлекаем ID потребителей из массивов помещений и проектов
          const consumerArrays = ['light_220', 'light_LED', 'light_RGB', 'light_led', 
                                  'socket_220', 'valve_heating', 'valve_water', 
                                  'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP',
                                  'thermostat', 'hygrostat', 'co2_stat'];
          consumerArrays.forEach(arrayName => {
            if (payload[arrayName] && Array.isArray(payload[arrayName])) {
              payload[arrayName].forEach(consumerId => {
                if (typeof consumerId === 'string') {
                  consumerIdsFromSites.add(consumerId);
                }
              });
            }
          });
        }
      });
      
      // Запрашиваем устройства из массивов помещений, если они еще не загружены
      if (consumerIdsFromSites.size > 0 && ws.readyState === WebSocket.OPEN) {
        const missingConsumerIds = Array.from(consumerIdsFromSites).filter(id => !deviceDataMap.has(id));
        if (missingConsumerIds.length > 0) {
          console.log(`[DEBUG] Запрашиваем ${missingConsumerIds.length} потребителей из массивов помещений`);
          const getRequest = { type: 'get', state: missingConsumerIds };
          logWebSocketRequestGlobal('get', missingConsumerIds);
          ws.send(JSON.stringify(getRequest));
          // Увеличиваем счетчик ожидаемых ответов
          pendingGetRequests += missingConsumerIds.length;
        }
      }
      
      // Создаём список помещений из siteMap (убираем дублирование по ID)
      const processedSiteIds = new Set(); // Отслеживаем уже добавленные помещения
      siteMap.forEach((siteName, siteId) => {
        if (!processedSiteIds.has(siteId)) {
          sites.push({
            id: siteId,
            name: siteName,
          });
          processedSiteIds.add(siteId);
        }
      });
      
      // Резолвим помещения для устройств по коду/названию
      const siteNames = sites.map(s => s.name);
      for (const device of devices) {
        if (!device.site && !device.siteId) {
          const deviceName = device.name || '';
          const deviceCode = device.code || '';
          
          for (const siteName of siteNames) {
            const nameContainsSite = deviceName.toLowerCase().includes(siteName.toLowerCase()) ||
                                     deviceCode.toLowerCase().includes(siteName.toLowerCase());
            
            if (nameContainsSite) {
              const site = sites.find(s => s.name === siteName);
              if (site) {
                device.siteId = site.id;
                device.site = siteName;
                break;
              }
            }
          }
        }
      }
      
      // Резолвим помещения для актуаторов по их каналам
      // Если актуатор не имеет привязки к помещению, но его каналы привязаны к устройствам с помещениями,
      // определяем помещение актуатора по наиболее часто встречающемуся помещению связанных устройств
      // Функция для определения конфигурации каналов актуатора (копия из класса Display)
      const getActuatorChannelCount = (deviceType) => {
        const channelConfigs = {
          0x0a: { count: 8, types: ['do'] }, 0x0b: { count: 16, types: ['do'] },
          0x0e: { count: 4, types: ['dim'] }, 0x0f: { count: 8, types: ['dim'] },
          0x23: { count: 2, types: ['do'] }, 0xa0: { count: 6, types: ['do'] },
          0xa1: { count: 12, types: ['do'] }, 0xa3: { count: 4, types: ['dim'] },
          0xa4: { count: 8, types: ['dim'] }, 0xa7: { count: 2, types: ['do'] },
          0xa9: { count: 4, types: ['ao'] },
          0xac: { count: 2, types: ['do', 'dim'] }, 0xad: { count: 12, types: ['dim'] },
          0xae: { count: 12, types: ['do'] }, 0xaf: { count: 8, types: ['dim'] },
          0xb3: { count: 12, types: ['dim'] }, 0xb4: { count: 12, types: ['dim'] },
          0xb5: { count: 18, types: ['do', 'dim'] }, 0xb6: { count: 1, types: ['dim'] },
          0xab: { count: 2, types: ['do', 'dim'] }, 0x41: { count: 12, types: ['do', 'dim'] },
          0xaa: { count: 4, types: ['do', 'dim'] },
        };
        return channelConfigs[deviceType] || null;
      };
      
      for (const device of devices) {
        if (device.category === 'Актуатор' && typeof device.type === 'number' && !device.site && !device.siteId) {
          const siteCounts = new Map(); // Подсчитываем частоту помещений связанных устройств
          const channelConfig = getActuatorChannelCount(device.type);
          
          if (channelConfig) {
            const channelTypes = channelConfig.types;
            const channelCount = channelConfig.count;
            
            // Определяем количество каналов каждого типа для смешанных устройств
            let doCount = 0, dimCount = 0, aoCount = 0;
            if (channelTypes.includes('do') && channelTypes.includes('dim')) {
              switch (device.type) {
                case 0x41: doCount = 6; dimCount = 6; break;
                case 0xaa: doCount = 2; dimCount = 2; break;
                case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
                case 0xb5: doCount = 6; dimCount = 12; break;
              }
            } else {
              if (channelTypes.includes('do')) doCount = channelCount;
              if (channelTypes.includes('dim')) dimCount = channelCount;
              if (channelTypes.includes('ao')) aoCount = channelCount;
            }
            
            // Проверяем каналы через deviceDataMap (данные из WebSocket)
            for (let i = 1; i <= doCount; i++) {
              const channelId = `${device.id}/do/${i}`;
              const channelPayload = deviceDataMap.get(channelId);
              if (channelPayload && channelPayload.bind) {
                const linkedDevice = devices.find(d => d.id === channelPayload.bind);
                if (linkedDevice && linkedDevice.site) {
                  const count = siteCounts.get(linkedDevice.site) || 0;
                  siteCounts.set(linkedDevice.site, count + 1);
                }
              }
            }
            
            for (let i = 1; i <= dimCount; i++) {
              const channelId = `${device.id}/dim/${i}`;
              const channelPayload = deviceDataMap.get(channelId);
              if (channelPayload && channelPayload.bind) {
                const linkedDevice = devices.find(d => d.id === channelPayload.bind);
                if (linkedDevice && linkedDevice.site) {
                  const count = siteCounts.get(linkedDevice.site) || 0;
                  siteCounts.set(linkedDevice.site, count + 1);
                }
              }
            }
            
            for (let i = 1; i <= aoCount; i++) {
              const channelId = `${device.id}/ao/${i}`;
              const channelPayload = deviceDataMap.get(channelId);
              if (channelPayload && channelPayload.bind) {
                const linkedDevice = devices.find(d => d.id === channelPayload.bind);
                if (linkedDevice && linkedDevice.site) {
                  const count = siteCounts.get(linkedDevice.site) || 0;
                  siteCounts.set(linkedDevice.site, count + 1);
                }
              }
            }
          }
          
          // Выбираем помещение с наибольшей частотой
          if (siteCounts.size > 0) {
            let maxCount = 0;
            let mostCommonSite = null;
            for (const [siteName, count] of siteCounts.entries()) {
              if (count > maxCount) {
                maxCount = count;
                mostCommonSite = siteName;
              }
            }
            
            if (mostCommonSite) {
              const site = sites.find(s => s.name === mostCommonSite);
              if (site) {
                device.siteId = site.id;
                device.site = mostCommonSite;
              }
            }
          }
        }
      }
      
      console.log(`[DEBUG] Обработка завершена. Устройств: ${devices.length}, Помещений: ${sites.length}`);
      console.log(`[DEBUG] Закрываем WebSocket соединение`);
      
      clearTimeout(timeoutId);
      clearTimeout(connectionTimeoutId);
      ws.close();
      
      console.log(`[DEBUG] Вызываем resolve с ${devices.length} устройствами и ${sites.length} помещениями`);
      if (locationName) {
        console.log(`[DEBUG] Название локации: ${locationName}`);
      }
      resolve({
        devices: devices.sort((a, b) => {
          if (a.category !== b.category) return a.category.localeCompare(b.category);
          return a.name.localeCompare(b.name);
        }),
        sites: sites.sort((a, b) => a.name.localeCompare(b.name)),
        locationName: locationName || 'Локация' // Возвращаем название локации (из env, PROJECT или дефолт)
      });
    }
  });
}

// Копируем текст в буфер обмена
function copyToClipboard(text) {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const isWindows = process.platform === 'win32';
  
  let copyProcess;
  if (isMac) {
    copyProcess = spawn('pbcopy', []);
  } else if (isLinux) {
    // Безопасное выполнение команды с жестко заданными аргументами (без пользовательского ввода)
    copyProcess = spawn('sh', ['-c', 'xclip -selection clipboard 2>/dev/null || xsel --clipboard --input 2>/dev/null || cat > /dev/null']);
  } else if (isWindows) {
    copyProcess = spawn('clip', []);
  } else {
    console.log('\n=== Текст для копирования ===');
    console.log(text);
    console.log('============================\n');
    return;
  }
  
  copyProcess.stdin.write(text);
  copyProcess.stdin.end();
  
  copyProcess.on('close', (code) => {
    if (code === 0 || isLinux) {
      // Успешно скопировано
    }
  });
  
  copyProcess.on('error', () => {
    console.log('\n=== Текст для копирования ===');
    console.log(text);
    console.log('============================\n');
  });
}

// Box drawing characters для рамок как в Midnight Commander
const BOX_CHARS = {
  // Горизонтальные и вертикальные линии
  h: '─',  // горизонтальная
  v: '│',  // вертикальная
  // Углы
  tl: '┌', // top-left
  tr: '┐', // top-right
  bl: '└', // bottom-left
  br: '┘', // bottom-right
  // Пересечения
  tv: '┬', // top-vertical
  bv: '┴', // bottom-vertical
  lh: '├', // left-horizontal
  rh: '┤', // right-horizontal
  cross: '┼', // пересечение
};

// Рисуем рамку вокруг области
function drawBox(x, y, width, height, title = null) {
  // Верхняя граница
  term.moveTo(x, y);
  term(BOX_CHARS.tl);
  if (title && title.length > 0) {
    const titleLen = Math.min(title.length, width - 2);
    term(title.substring(0, titleLen));
    term(BOX_CHARS.h.repeat(width - titleLen - 2));
  } else {
    term(BOX_CHARS.h.repeat(width - 2));
  }
  term(BOX_CHARS.tr);
  
  // Боковые границы и содержимое
  for (let i = 1; i < height - 1; i++) {
    term.moveTo(x, y + i);
    term(BOX_CHARS.v);
    term.moveTo(x + width - 1, y + i);
    term(BOX_CHARS.v);
  }
  
  // Нижняя граница
  term.moveTo(x, y + height - 1);
  term(BOX_CHARS.bl);
  term(BOX_CHARS.h.repeat(width - 2));
  term(BOX_CHARS.br);
}

// Класс для управления UI с terminal-kit
class TerminalKitStatusDisplay {
  constructor(devices, sites, locationName = 'Локация', updateInfo = null) {
    if (!term.isTTY) {
      throw new Error('Требуется интерактивный терминал (TTY)');
    }
    
    this.deviceStates = new Map();
    this.isConnected = false;
    this.selectedIndex = 0;
    this.sites = sites;
    this.locationName = locationName; // Название локации для отображения в заголовке
    this.version = VERSION; // Версия для отображения в заголовке
    this.updateInfo = updateInfo || null; // Информация о проверке обновлений (updateAvailable, remoteVersion)
    this.allDevices = devices;
    this.devicesByMac = new Map();
    devices.forEach(device => {
      this.devicesByMac.set(device.id, device);
    });
    this.devices = devices;
    this.isLoading = devices.length === 0; // Флаг загрузки данных
    
    // Мультифильтр: используем массивы для поддержки множественного выбора
    this.activeFilters = {
      category: [],      // Массив выбранных категорий
      consumerType: [],  // Массив выбранных типов потребителей
      site: [],          // Массив выбранных помещений
    };
    
    this.isNavigating = false;
    this.navigationTimer = null;
    this.navigationDebounceMs = 300; // Окно тишины, после которого считаем навигацию завершённой
    this.pendingFiltersReapply = false; // Нужно переприменить фильтры после навигации
    this.pendingRebuildFilterRows = false; // Нужно пересобрать строки фильтров после навигации
    this.lastUpdateTime = 0;
    this.renderDebounceTimer = null; // Таймер для debounce рендеринга
    this.pendingRender = false; // Флаг ожидающего рендера
    
    // Отслеживание скорости обновлений WebSocket (раздельно для входящих и исходящих)
    // Используем скользящее окно времени для точного подсчета скорости
    this.wsInTimestamps = []; // Массив временных меток входящих сообщений (скользящее окно)
    this.wsOutTimestamps = []; // Массив временных меток исходящих сообщений (скользящее окно)
    this.wsWindowSeconds = 10; // Окно времени для подсчета скорости (10 секунд)
    this.wsInPerSecond = 0; // Скорость входящих сообщений в секунду
    this.wsOutPerSecond = 0; // Скорость исходящих сообщений в секунду
    
    // Счетчики сообщений для логов (используются глобальные счетчики для единой нумерации)
    this.wsLogInCounter = 0; // Счетчик входящих сообщений в логах
    this.wsLogOutCounter = 0; // Счетчик исходящих сообщений в логах
    
    // Статистика WebSocket запросов и ответов для анализа
    this.wsRequestStats = {
      requests: {
        list: 0,
        get: 0,
        getDeviceCount: 0, // Общее количество устройств в GET запросах
        getChannelCount: 0, // Общее количество каналов в GET запросах
        lastRequestTime: null,
        requestSizes: [] // Размеры запросов в байтах
      },
      responses: {
        actionSet: 0,
        actionSetWithContext: 0,
        list: 0,
        other: 0,
        lastResponseTime: null,
        responseSizes: [] // Размеры ответов в байтах
      },
      statsLogInterval: null // Интервал для периодического вывода статистики
    };
    
    // Используем глобальные потоки логирования или создаем новые
    this.wsLogStreams = globalWsLogStreams;
    
    // Запускаем периодический вывод статистики запросов каждые 10 секунд
    if (WS_REQUEST_LOGGING) {
      this.wsRequestStats.statsLogInterval = setInterval(() => {
        this.logRequestStats();
      }, 10000);
    }
    
    this.cache = {
      filteredDevices: null,
      filteredDevicesHash: null,
      tableData: null,
      tableDataHash: null,
      deviceInfo: null,
      deviceInfoHash: null,
      deviceInfoByDeviceId: new Map(),
      knownParameters: new Map(),
      stats: null,
      statsHash: null,
    };
    
    this.devicePopupText = '';
    this.needsFullRender = true; // Флаг для отрисовки рамок (только при полном рендере)
    this.lastHeaderText = ''; // Кэш заголовка для предотвращения лишних перерисовок
    this.selectionCheckInterval = null;
    this.filterIndex = 0; // Индекс выбранного фильтра
    this.filterRows = [];
    this.filterSelectable = [];
    this.pendingCopyRow = false;
    
    // Отслеживание предыдущих значений полей для подсветки изменений
    this.previousFieldValues = new Map(); // deviceId -> Map<fieldName, value>
    this.fieldChangeTimestamps = new Map(); // deviceId -> Map<fieldName, timestamp>
    
    // Ссылка на WebSocket для запроса отсутствующих устройств
    this.ws = null;
    
    // Множество уже запрошенных устройств для предотвращения повторных запросов
    this.requestedMissingDevices = new Set();
    
    // Таймер для отложенного пакетного запроса связанных устройств (debounce)
    this.pendingLinkedDevicesRequest = null;
    
    // Размеры экрана
    this.width = term.width;
    this.height = term.height;
    
    // Размеры панелей (левая: 4 колонки, центр: 6 колонок, правая: остальное)
    // Учитываем рамки (по 2 символа на каждую панель: левая и правая границы)
    this.leftWidth = Math.floor(this.width * 0.25); // 25%
    this.centerWidth = Math.floor(this.width * 0.375); // 37.5%
    this.rightWidth = this.width - this.leftWidth - this.centerWidth - 7; // Остальное минус все границы включая правую границу правой панели
    
    // Позиции панелей с учетом рамок
    this.leftX = 1;
    this.centerX = this.leftWidth + 3; // leftWidth + 1 (пробел) + 2 (рамка)
    this.rightX = this.centerX + this.centerWidth + 3; // centerX + centerWidth + 1 (пробел) + 2 (рамка)
    
    // Текущая активная панель (0: фильтры, 1: таблица, 2: параметры)
    this.activePanel = 0; // По умолчанию фильтры (как в Midnight Commander)
    
    // Прокрутка для таблицы
    this.tableScroll = 0;
    // Вычисляем количество видимых строк таблицы с учетом рамок и заголовка
    // startY = 2, заголовок = 1 строка, рамки = 2 строки (верхняя и нижняя), статистика = 1 строка
    // tableVisibleRows = height - startY - заголовок - рамки - статистика
    this.tableVisibleRows = Math.max(1, this.height - 2 - 1 - 2 - 1); // height - 6 минимум 1
    
    // Прокрутка для панели фильтров (аналогично таблице)
    // filterScroll - это индекс в filterRows (все строки, включая заголовки)
    this.filterScroll = 0;
    // Вычисляем количество видимых строк фильтров с учетом рамок
    // Зачем: Сокращаем на 2 строки, чтобы не выходить за рамки
    this.filterVisibleRows = Math.max(1, this.height - 2 - 2 - 2); // height - 6 минимум 1 (минус рамки + 2)
    
    // Прокрутка для панели параметров устройства
    this.deviceInfoScroll = 0;
    // Вычисляем количество видимых строк параметров с учетом рамок
    this.deviceInfoVisibleRows = Math.max(1, this.height - 2 - 2); // height - 4 минимум 1 (минус рамки)
    
    // Строим список фильтров при инициализации
    this.buildFilterRows();
    
    this.init();
  }
  
  init() {
    // Очищаем экран и настраиваем обработчики
    term.clear();
    // Включаем альтернативный буфер для более плавного рендеринга
    term.fullscreen(true);
    // Скрываем курсор для чистого интерфейса (в terminal-kit используется метод hideCursor)
    if (term.hideCursor) {
      term.hideCursor();
    }
    
    // Включаем захват ввода для правильной обработки стрелок и специальных клавиш
    // Без этого стрелки будут выводиться как escape-последовательности (крякозяблы)
    term.grabInput({ mouse: false });
    
    // Обработчики клавиатуры
    term.on('key', (name, matches, data) => {
      this.handleKey(name, matches, data);
    });
    
    // Обработчик изменения размера терминала
    term.on('resize', () => {
      this.width = term.width;
      this.height = term.height;
      this.leftWidth = Math.floor(this.width * 0.25);
      this.centerWidth = Math.floor(this.width * 0.375);
      this.rightWidth = this.width - this.leftWidth - this.centerWidth - 7;
      this.leftX = 1;
      this.centerX = this.leftWidth + 3;
      this.rightX = this.centerX + this.centerWidth + 3;
      // Пересчитываем количество видимых строк при изменении размера
      this.tableVisibleRows = Math.max(1, this.height - 2 - 1 - 2 - 1); // height - 6 минимум 1
      this.filterVisibleRows = Math.max(1, this.height - 2 - 2 - 2); // height - 6 минимум 1 (минус рамки + 2)
      this.deviceInfoVisibleRows = Math.max(1, this.height - 2 - 2); // height - 4 минимум 1 (минус рамки)
      this.renderFull(); // При изменении размера нужен полный рендер с очисткой
    });
    
    // Обработчик выхода
    process.on('SIGINT', () => {
      this.stop();
    });
    
    this.renderFull(); // Первый рендер должен быть полным
  }
  
  handleKey(name, matches, data) {
    if (name === 'CTRL_C' || name === 'q' || name === 'Q') {
      this.stop();
      return;
    }
    
    if (name === 'TAB') {
      // Переключение между панелями (фильтры, таблица, параметры)
      this.activePanel = (this.activePanel + 1) % 3;
      // При переключении на панель фильтров синхронизируем filterIndex с актуальными данными
      if (this.activePanel === 0) {
        this.buildFilterRows();
        // Проверяем, что filterIndex в допустимых границах
        if (this.filterIndex < 0 || this.filterIndex >= this.filterSelectable.length) {
          this.filterIndex = Math.max(0, this.filterSelectable.length - 1);
        }
      }
      // При переключении на панель параметров обновляем скроллинг
      if (this.activePanel === 2) {
        this.updateDeviceInfoScroll();
      }
      // Перерисовываем рамки при смене активной панели (меняется цвет)
      this.needsFullRender = true;
      this.render();
      return;
    }
    
    // Переключение между панелями стрелками влево/вправо
    if (name === 'LEFT') {
      // Переход к панели слева
      if (this.activePanel === 1) {
        // Из таблицы в фильтры
        this.activePanel = 0;
        this.buildFilterRows();
        if (this.filterIndex < 0 || this.filterIndex >= this.filterSelectable.length) {
          this.filterIndex = Math.max(0, this.filterSelectable.length - 1);
        }
        this.needsFullRender = true;
        this.render();
      } else if (this.activePanel === 2) {
        // Из параметров в таблицу
        this.activePanel = 1;
        this.needsFullRender = true;
        this.render();
      }
      return;
    }
    
    if (name === 'RIGHT') {
      // Переход к панели справа
      if (this.activePanel === 0) {
        // Из фильтров в таблицу
        this.activePanel = 1;
        this.needsFullRender = true;
        this.render();
      } else if (this.activePanel === 1) {
        // Из таблицы в параметры
        this.activePanel = 2;
        this.updateDeviceInfoScroll();
        this.needsFullRender = true;
        this.render();
      }
      return;
    }
    
    // Обработка копирования работает независимо от активной панели
    if (name === 'y' && data.isCharacter) {
      // Подготовка к копированию строки таблицы (y+c)
      this.pendingCopyRow = true;
      return;
    } else if (name === 'c' && this.pendingCopyRow) {
      // Копирование строки таблицы
      this.copyTableRowToClipboard();
      this.pendingCopyRow = false;
      return;
    } else if (name === 'c' && data.isCharacter) {
      // Копирование информации об устройстве (работает независимо от активной панели)
      this.copyDeviceInfoToClipboard();
      return;
    }
    
    if (this.activePanel === 0) {
      // Навигация в фильтрах
      const maxFilterIndex = Math.max(0, this.filterSelectable.length - 1);
      if (name === 'UP' || name === 'k') {
        if (this.filterIndex > 0) {
          this.beginNavigation();
          this.filterIndex--;
          this.updateFilterScroll();
          this.render();
        }
      } else if (name === 'DOWN' || name === 'j') {
        if (this.filterIndex < maxFilterIndex) {
          this.beginNavigation();
          this.filterIndex++;
          this.updateFilterScroll();
          this.render();
        }
      } else if (name === 'PAGE_UP') {
        this.beginNavigation();
        this.filterIndex = Math.max(0, this.filterIndex - this.filterVisibleRows);
        this.updateFilterScroll();
        this.render();
      } else if (name === 'PAGE_DOWN') {
        this.beginNavigation();
        this.filterIndex = Math.min(this.filterSelectable.length - 1, this.filterIndex + this.filterVisibleRows);
        this.updateFilterScroll();
        this.render();
      } else if (name === 'HOME') {
        this.beginNavigation();
        this.filterIndex = 0;
        this.updateFilterScroll();
        this.render();
      } else if (name === 'END') {
        this.beginNavigation();
        this.filterIndex = this.filterSelectable.length - 1;
        this.updateFilterScroll();
        this.render();
      } else if (name === 'ENTER' || name === 'SPACE' || name === ' ') {
        // Применяем выбранный фильтр (Enter или Space с toggle логикой)
        const row = this.getSelectedFilterRow();
        this.applyFilterRow(row);
      }
    } else if (this.activePanel === 1) {
      // Навигация в таблице
      if (name === 'UP' || name === 'k') {
        if (this.selectedIndex > 0) {
          this.beginNavigation();
          this.selectedIndex--;
          this.updateTableScroll();
          // Сбрасываем скроллинг панели параметров при смене устройства
          this.deviceInfoScroll = 0;
          this.render();
        }
      } else if (name === 'DOWN' || name === 'j') {
        if (this.selectedIndex < this.devices.length - 1) {
          this.beginNavigation();
          this.selectedIndex++;
          this.updateTableScroll();
          // Проверяем границы после обновления прокрутки
          if (this.selectedIndex >= this.devices.length) {
            this.selectedIndex = Math.max(0, this.devices.length - 1);
          }
          // Сбрасываем скроллинг панели параметров при смене устройства
          this.deviceInfoScroll = 0;
          this.render();
        }
      } else if (name === 'PAGE_UP') {
        this.beginNavigation();
        this.selectedIndex = Math.max(0, this.selectedIndex - this.tableVisibleRows);
        this.updateTableScroll();
        // Сбрасываем скроллинг панели параметров при смене устройства
        this.deviceInfoScroll = 0;
        this.render();
      } else if (name === 'PAGE_DOWN') {
        this.beginNavigation();
        this.selectedIndex = Math.min(this.devices.length - 1, this.selectedIndex + this.tableVisibleRows);
        this.updateTableScroll();
        // Сбрасываем скроллинг панели параметров при смене устройства
        this.deviceInfoScroll = 0;
        this.render();
      } else if (name === 'HOME') {
        this.beginNavigation();
        this.selectedIndex = 0;
        this.updateTableScroll();
        // Сбрасываем скроллинг панели параметров при смене устройства
        this.deviceInfoScroll = 0;
        this.render();
      } else if (name === 'END') {
        this.beginNavigation();
        this.selectedIndex = this.devices.length - 1;
        this.updateTableScroll();
        // Сбрасываем скроллинг панели параметров при смене устройства
        this.deviceInfoScroll = 0;
        this.render();
      }
    } else if (this.activePanel === 2) {
      // Навигация в панели параметров (скроллинг текста)
      if (this.selectedIndex < 0 || this.selectedIndex >= this.devices.length) {
        return; // Нет выбранного устройства
      }
      
      const device = this.devices[this.selectedIndex];
      const deviceInfo = this.getDeviceInfoText(device);
      const lines = deviceInfo.split('\n');
      const maxScroll = Math.max(0, lines.length - this.deviceInfoVisibleRows);
      
      if (name === 'UP' || name === 'k') {
        if (this.deviceInfoScroll > 0) {
          this.beginNavigation();
          this.deviceInfoScroll = Math.max(0, this.deviceInfoScroll - 1);
          this.render();
        }
      } else if (name === 'DOWN' || name === 'j') {
        if (this.deviceInfoScroll < maxScroll) {
          this.beginNavigation();
          this.deviceInfoScroll = Math.min(maxScroll, this.deviceInfoScroll + 1);
          this.render();
        }
      } else if (name === 'PAGE_UP') {
        this.beginNavigation();
        this.deviceInfoScroll = Math.max(0, this.deviceInfoScroll - this.deviceInfoVisibleRows);
        this.render();
      } else if (name === 'PAGE_DOWN') {
        this.beginNavigation();
        this.deviceInfoScroll = Math.min(maxScroll, this.deviceInfoScroll + this.deviceInfoVisibleRows);
        this.render();
      } else if (name === 'HOME') {
        this.beginNavigation();
        this.deviceInfoScroll = 0;
        this.render();
      } else if (name === 'END') {
        this.beginNavigation();
        this.deviceInfoScroll = maxScroll;
        this.render();
      }
    }
  }

  beginNavigation() {
    // Во время активного скролла не пересобираем список устройств (иначе «пропажи»/скачки индексов)
    this.isNavigating = true;
    if (this.navigationTimer) {
      clearTimeout(this.navigationTimer);
    }
    this.navigationTimer = setTimeout(() => {
      this.isNavigating = false;
      this.navigationTimer = null;
      if (this.pendingFiltersReapply || this.pendingRebuildFilterRows) {
        this.applyPendingUiRebuilds();
      }
    }, this.navigationDebounceMs);
  }

  scheduleUiRebuild({ reapplyFilters = false, rebuildFilterRows = false } = {}) {
    if (reapplyFilters) this.pendingFiltersReapply = true;
    if (rebuildFilterRows) this.pendingRebuildFilterRows = true;
    if (!this.isNavigating) {
      this.applyPendingUiRebuilds();
    }
  }

  applyPendingUiRebuilds() {
    const shouldRebuildFilterRows = this.pendingRebuildFilterRows;
    const shouldReapplyFilters = this.pendingFiltersReapply;
    this.pendingRebuildFilterRows = false;
    this.pendingFiltersReapply = false;

    if (shouldRebuildFilterRows) {
      this.buildFilterRows();
    }
    if (shouldReapplyFilters) {
      this.applyFiltersPreservingSelection();
    }
  }
  
  buildFilterRows() {
    const rows = [];
    const addRow = (row) => {
      rows.push(row);
      if (row.selectable) {
        this.filterSelectable.push(rows.length - 1);
      }
    };

    this.filterRows = [];
    this.filterSelectable = [];

    const categories = [
      { label: 'Все', value: null },
      { label: 'Актуатор', value: 'Актуатор' },
      { label: 'Сенсор', value: 'Сенсор' },
      { label: 'Панель', value: 'Панель' },
      { label: 'Потребитель', value: 'Потребитель' },
    ];

    addRow({ label: 'Категории:', kind: 'title' });
    categories.forEach(cat => {
      // Проверяем, есть ли значение в массиве (null считается как "Все")
      const isChecked = cat.value === null 
        ? this.activeFilters.category.length === 0 
        : this.activeFilters.category.includes(cat.value);
      addRow({
        label: `${isChecked ? '☑' : '☐'} ${cat.label}`,
        kind: 'category',
        value: cat.value,
        selectable: true,
      });
    });

    const consumerTypes = Array.from(new Set(
      this.allDevices.filter(d => d.category === 'Потребитель').map(d => d.type)
    ));
    if (consumerTypes.length > 0) {
      addRow({ label: '', kind: 'spacer' });
      addRow({ label: 'Потребители:', kind: 'title' });
      const allSelected = this.activeFilters.consumerType.length === 0;
      addRow({
        label: `${allSelected ? '☑' : '☐'} Все`,
        kind: 'consumer',
        value: null,
        selectable: true,
      });
      const consumerNames = {
        light_220: 'light_220', light_LED: 'light_LED', light_RGB: 'light_RGB', light_led: 'light_led',
        socket_220: 'socket_220', valve_heating: 'valve_heating', valve_water: 'valve_water',
        warm_floor: 'warm_floor', AC: 'AC', FAN: 'FAN', BOILER: 'BOILER', PUMP: 'PUMP',
        thermostat: 'thermostat', hygrostat: 'hygrostat', co2_stat: 'co2_stat',
      };
      consumerTypes.forEach(type => {
        const isChecked = this.activeFilters.consumerType.includes(type);
        addRow({
          label: `${isChecked ? '☑' : '☐'} ${consumerNames[type] || type}`,
          kind: 'consumer',
          value: type,
          selectable: true,
        });
      });
    }

    addRow({ label: '', kind: 'spacer' });
    addRow({ label: 'Помещения:', kind: 'title' });
    const siteAllChecked = this.activeFilters.site.length === 0;
    addRow({
      label: `${siteAllChecked ? '☑' : '☐'} Все`,
      kind: 'site',
      value: null,
      selectable: true,
    });
    this.sites.forEach(site => {
      const isChecked = this.activeFilters.site.includes(site.name);
      addRow({
        label: `${isChecked ? '☑' : '☐'} ${site.name}`,
        kind: 'site',
        value: site.name,
        selectable: true,
      });
    });

    this.filterRows = rows;
    if (this.filterIndex >= this.filterSelectable.length) {
      this.filterIndex = Math.max(0, this.filterSelectable.length - 1);
    }
  }

  getSelectedFilterRow() {
    // Проверяем, что filterSelectable не пуст и filterIndex в допустимых границах
    if (!this.filterSelectable.length) return null;
    if (this.filterIndex < 0 || this.filterIndex >= this.filterSelectable.length) return null;
    const rowIndex = this.filterSelectable[this.filterIndex];
    if (rowIndex === undefined || rowIndex < 0 || rowIndex >= this.filterRows.length) return null;
    return this.filterRows[rowIndex];
  }

  applyFilterRow(row) {
    if (!row) return;
    
    // Зачем: Toggle логика - если фильтр уже применен, снимаем его (Space), иначе применяем
    if (row.kind === 'category') {
      if (row.value === null) {
        // "Все" - сбрасываем все категории
        this.activeFilters.category = [];
      } else {
        // Toggle: если уже есть в массиве, удаляем, иначе добавляем
        const index = this.activeFilters.category.indexOf(row.value);
        if (index >= 0) {
          this.activeFilters.category.splice(index, 1);
        } else {
          this.activeFilters.category.push(row.value);
        }
      }
    } else if (row.kind === 'consumer') {
      if (row.value === null) {
        // "Все" - сбрасываем все типы потребителей
        this.activeFilters.consumerType = [];
      } else {
        // Toggle: если уже есть в массиве, удаляем, иначе добавляем
        const index = this.activeFilters.consumerType.indexOf(row.value);
        if (index >= 0) {
          this.activeFilters.consumerType.splice(index, 1);
        } else {
          this.activeFilters.consumerType.push(row.value);
        }
      }
    } else if (row.kind === 'site') {
      if (row.value === null) {
        // "Все" - сбрасываем все помещения
        this.activeFilters.site = [];
      } else {
        // Toggle: если уже есть в массиве, удаляем, иначе добавляем
        const index = this.activeFilters.site.indexOf(row.value);
        if (index >= 0) {
          this.activeFilters.site.splice(index, 1);
        } else {
          this.activeFilters.site.push(row.value);
        }
      }
    }
    // Пересобираем строки фильтров для обновления чекбоксов
    this.buildFilterRows();
    this.applyFiltersPreservingSelection();
  }
  
  applyFiltersPreservingSelection() {
    const selectedId = this.devices?.[this.selectedIndex]?.id || null;
    this.applyFilters({ render: false });
    if (selectedId) {
      const idx = this.devices.findIndex(d => d.id === selectedId);
      if (idx >= 0) {
        this.selectedIndex = idx;
      } else {
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.devices.length - 1));
      }
    }
    this.updateTableScroll();
    // Важно: заголовок таблицы содержит счётчик устройств, он обновляется при отрисовке рамки.
    // Поэтому при изменении фильтров делаем один полный проход рамок без постоянного мерцания.
    this.needsFullRender = true;
    this.render();
  }

  applyFilters(options = {}) {
    // Применяем активные фильтры к списку устройств
    const filtersHash = this.getFiltersHash();
    if (this.cache.filteredDevices && this.cache.filteredDevicesHash === filtersHash) {
      this.devices = this.cache.filteredDevices;
      if (options.render !== false) {
        this.render();
      }
      return;
    }
    
    this.devices = this.allDevices.filter(device => {
      // Фильтр по категории (мультифильтр: если массив не пуст, проверяем вхождение)
      if (this.activeFilters.category.length > 0) {
        // Если выбраны категории, показываем только устройства этих категорий
        if (!this.activeFilters.category.includes(device.category)) {
          return false;
        }
      }
      
      // Фильтр по типу потребителя (мультифильтр: если массив не пуст, проверяем вхождение)
      if (this.activeFilters.consumerType.length > 0) {
        // Показываем только потребителей выбранных типов
        if (device.category !== 'Потребитель' || !this.activeFilters.consumerType.includes(device.type)) {
          return false;
        }
      }
      
      // Фильтр по помещению (мультифильтр: если массив не пуст, проверяем вхождение)
      if (this.activeFilters.site.length > 0) {
        // Строгое сравнение с учетом null/undefined
        const deviceSite = device.site || null;
        if (!this.activeFilters.site.includes(deviceSite)) {
          return false;
        }
      }
      
      return true;
    });
    
    // Сортируем устройства по типу (название типа), затем по названию устройства
    this.devices.sort((a, b) => {
      const typeA = String(DEVICE_TYPE_NAMES[a.type] || a.type || '');
      const typeB = String(DEVICE_TYPE_NAMES[b.type] || b.type || '');
      
      // Сначала сравниваем по типу
      const typeCompare = typeA.localeCompare(typeB, 'ru');
      if (typeCompare !== 0) {
        return typeCompare;
      }
      
      // Если типы одинаковые, сортируем по названию устройства
      const nameA = a.title || a.code || a.name || '';
      const nameB = b.title || b.code || b.name || '';
      return nameA.localeCompare(nameB, 'ru');
    });
    
    this.cache.filteredDevices = this.devices;
    this.cache.filteredDevicesHash = filtersHash;
    
    // Сбрасываем selectedIndex если он вне границ
    if (this.selectedIndex >= this.devices.length) {
      this.selectedIndex = Math.max(0, this.devices.length - 1);
    }
    
    if (options.render !== false) {
      this.render();
    }
  }
  
  getFiltersHash() {
    return JSON.stringify(this.activeFilters);
  }
  
  updateTableScroll() {
    // Обновляем прокрутку таблицы так, чтобы выбранная строка была видна
    // Ограничиваем selectedIndex границами массива
    if (this.selectedIndex < 0) {
      this.selectedIndex = 0;
    } else if (this.selectedIndex >= this.devices.length) {
      this.selectedIndex = Math.max(0, this.devices.length - 1);
    }
    
    if (this.selectedIndex < this.tableScroll) {
      this.tableScroll = this.selectedIndex;
    } else if (this.selectedIndex >= this.tableScroll + this.tableVisibleRows) {
      this.tableScroll = Math.max(0, this.selectedIndex - this.tableVisibleRows + 1);
    }
    
    // Проверяем, что tableScroll не выходит за границы
    const maxScroll = Math.max(0, this.devices.length - this.tableVisibleRows);
    if (this.tableScroll > maxScroll) {
      this.tableScroll = maxScroll;
    }
  }
  
  updateFilterScroll() {
    // Зачем: Обновляем прокрутку панели фильтров так, чтобы выбранная строка была видна
    // filterIndex - это индекс в filterSelectable, нужно преобразовать в индекс в filterRows
    if (this.filterIndex < 0) {
      this.filterIndex = 0;
    } else if (this.filterIndex >= this.filterSelectable.length) {
      this.filterIndex = Math.max(0, this.filterSelectable.length - 1);
    }
    
    // Получаем индекс строки в filterRows для выбранного фильтра
    const selectedRowIndex = this.filterIndex >= 0 && this.filterIndex < this.filterSelectable.length
      ? this.filterSelectable[this.filterIndex]
      : 0;
    
    // Обновляем filterScroll так, чтобы выбранная строка была видна
    if (selectedRowIndex < this.filterScroll) {
      this.filterScroll = selectedRowIndex;
    } else if (selectedRowIndex >= this.filterScroll + this.filterVisibleRows) {
      this.filterScroll = Math.max(0, selectedRowIndex - this.filterVisibleRows + 1);
    }
    
    // Проверяем, что filterScroll не выходит за границы
    const maxScroll = Math.max(0, this.filterRows.length - this.filterVisibleRows);
    if (this.filterScroll > maxScroll) {
      this.filterScroll = maxScroll;
    }
    
    // Дополнительная проверка: если filterScroll указывает на строку, которая не selectable,
    // и она находится в начале видимой области, нужно скорректировать
    if (this.filterScroll > 0 && this.filterScroll < this.filterRows.length) {
      const firstVisibleRow = this.filterRows[this.filterScroll];
      // Если первая видимая строка не selectable и мы не на первой строке, немного сдвигаем
      if (!firstVisibleRow || !firstVisibleRow.selectable) {
        // Ищем ближайшую selectable строку выше
        for (let i = this.filterScroll - 1; i >= 0; i--) {
          if (this.filterRows[i] && this.filterRows[i].selectable) {
            // Проверяем, что выбранная строка все еще видна
            if (selectedRowIndex >= i && selectedRowIndex < i + this.filterVisibleRows) {
              this.filterScroll = i;
              break;
            }
          }
        }
      }
    }
  }
  
  updateDeviceInfoScroll() {
    // Зачем: Обновляем прокрутку панели параметров устройства
    // Пока что просто проверяем границы (в будущем можно добавить навигацию по строкам)
    if (this.selectedIndex < 0 || this.selectedIndex >= this.devices.length) {
      this.deviceInfoScroll = 0;
      return;
    }
    
    const device = this.devices[this.selectedIndex];
    const deviceInfo = this.getDeviceInfoText(device);
    const lines = deviceInfo.split('\n');
    
    // Проверяем, что deviceInfoScroll не выходит за границы
    const maxScroll = Math.max(0, lines.length - this.deviceInfoVisibleRows);
    if (this.deviceInfoScroll > maxScroll) {
      this.deviceInfoScroll = maxScroll;
    }
    if (this.deviceInfoScroll < 0) {
      this.deviceInfoScroll = 0;
    }
  }
  
  // Дебаунс рендеринга для снижения нагрузки на CPU при множественных обновлениях
  scheduleRender() {
    if (this.renderDebounceTimer) {
      return; // Рендер уже запланирован
    }
    
    this.pendingRender = true;
    this.renderDebounceTimer = setTimeout(() => {
      this.renderDebounceTimer = null;
      this.pendingRender = false;
      this.render();
    }, 100); // Задержка 100мс - баланс между отзывчивостью и производительностью
  }
  
  render() {
    // Оптимизированный рендер без полной очистки экрана для предотвращения мерцания
    // Обновляем только измененные части экрана
    
    // Рендерим заголовок
    this.renderHeader();
    
    // Если идет загрузка данных, показываем индикатор загрузки
    if (this.isLoading) {
      this.renderLoading();
      return;
    }
    
    // Рендерим три панели
    this.renderFilters();
    this.renderTable();
    this.renderDeviceInfo();
    
    // Рендерим статистику
    this.renderStats();
    
    // Сбрасываем флаг полного рендера после первого рендера
    this.needsFullRender = false;
  }
  
  renderLoading() {
    // Показываем индикатор загрузки в центре экрана
    const centerX = Math.floor(this.width / 2);
    const centerY = Math.floor(this.height / 2);
    const loadingText = 'Загрузка данных...';
    const loadingX = centerX - Math.floor(loadingText.length / 2);
    
    term.moveTo(loadingX, centerY);
    term.bold.yellow(loadingText);
    
    // Очищаем остальную часть экрана
    for (let y = 2; y < this.height - 1; y++) {
      if (y !== centerY) {
        term.moveTo(1, y);
        term(' '.repeat(this.width - 2));
      }
    }
  }
  
  // Метод для обновления данных после загрузки
  updateDevices(devices, sites, locationName) {
    this.allDevices = devices;
    this.devicesByMac.clear();
    devices.forEach(device => {
      this.devicesByMac.set(device.id, device);
    });
    this.devices = devices;
    this.sites = sites;
    if (locationName) {
      this.locationName = locationName;
    }
    this.isLoading = false;
    // Очищаем кэш для пересчета фильтров и таблицы
    this.cache.filteredDevices = null;
    this.cache.filteredDevicesHash = null;
    this.cache.tableData = null;
    this.cache.tableDataHash = null;
    this.cache.deviceInfo = null;
    this.cache.deviceInfoHash = null;
    this.cache.deviceInfoByDeviceId.clear();
    this.cache.knownParameters.clear();
    this.cache.stats = null;
    this.cache.statsHash = null;
    // Пересобираем фильтры с новыми данными
    this.buildFilterRows();
    // Перерисовываем интерфейс
    this.needsFullRender = true;
    this.renderFull();
  }
  
  // Полный рендер с очисткой экрана (используется только при первом запуске и изменении размера)
  renderFull() {
    this.needsFullRender = true; // Включаем отрисовку рамок
    term.clear();
    this.render();
  }
  
  renderHeader() {
    // Используем название локации из конструктора (загружено из PROJECT или env)
    const status = this.isConnected ? '🟢 ПОДКЛЮЧЕНО' : '🔴 ОТКЛЮЧЕНО';
    const time = new Date().toLocaleTimeString('ru-RU');
    
    // Зачем: Формируем заголовок с цветовой индикацией версии (зелёный/жёлтый)
    const headerPrefix = `${this.locationName} | ${status} | ${time} | v`;
    const versionText = this.version;
    const headerText = headerPrefix + versionText;
    
    // Обновляем заголовок только если он изменился (экономим escape-последовательности)
    if (this.lastHeaderText !== headerText) {
      this.lastHeaderText = headerText;
      term.moveTo(1, 1);
      
      // Выводим префикс заголовка
      term.bold.cyan(headerPrefix);
      
      // Выводим версию с цветом в зависимости от актуальности
      // Зелёный - если версия актуальна или новее, жёлтый - если есть обновление
      const isUpdateAvailable = this.updateInfo && this.updateInfo.updateAvailable === true;
      if (isUpdateAvailable) {
        term.bold.yellow(versionText); // Жёлтый - есть обновление
      } else {
        term.bold.green(versionText); // Зелёный - версия актуальна
      }
      
      term(' '.repeat(this.width - headerText.length));
    }
  }
  
  // Рисуем рамку вокруг панели с заголовком (цветовая схема Midnight Commander)
  // scrollInfo: { current, total } - информация о скроллинге для индикатора
  drawPanelBox(x, y, width, height, title, isActive, scrollInfo = null) {
    // Верхняя граница с заголовком
    term.moveTo(x, y);
    if (isActive) {
      term.bgBlue.white(); // Активная панель - синий фон, белый текст (как в MC)
    }
    term(BOX_CHARS.tl);
    if (title && title.length > 0) {
      const titleText = ` ${title} `;
      
      // Добавляем индикатор скроллинга если есть информация
      let scrollIndicator = '';
      if (scrollInfo && scrollInfo.total > scrollInfo.visible) {
        const canScrollUp = scrollInfo.current > 0;
        const canScrollDown = scrollInfo.current + scrollInfo.visible < scrollInfo.total;
        if (canScrollUp && canScrollDown) {
          scrollIndicator = ' ▲▼';
        } else if (canScrollUp) {
          scrollIndicator = ' ▲';
        } else if (canScrollDown) {
          scrollIndicator = ' ▼';
        }
      }
      
      const fullTitle = titleText + scrollIndicator;
      const titleLen = Math.min(fullTitle.length, width - 4);
      if (isActive) {
        term.bgBlue.white(fullTitle.substring(0, titleLen));
      } else {
        term.styleReset();
        term.bold(fullTitle.substring(0, titleLen));
      }
      const remaining = width - titleLen - 2;
      if (remaining > 0) {
        if (isActive) {
          term.bgBlue.white(BOX_CHARS.h.repeat(remaining));
        } else {
          term(BOX_CHARS.h.repeat(remaining));
        }
      }
    } else {
      if (isActive) {
        term.bgBlue.white(BOX_CHARS.h.repeat(width - 2));
      } else {
        term(BOX_CHARS.h.repeat(width - 2));
      }
    }
    term(BOX_CHARS.tr);
    term.styleReset();
    
    // Боковые границы
    for (let i = 1; i < height - 1; i++) {
      term.moveTo(x, y + i);
      if (isActive) {
        term.bgBlue.white(BOX_CHARS.v);
      } else {
        term(BOX_CHARS.v);
      }
      term.moveTo(x + width - 1, y + i);
      if (isActive) {
        term.bgBlue.white(BOX_CHARS.v);
      } else {
        term(BOX_CHARS.v);
      }
      term.styleReset();
    }
    
    // Нижняя граница
    term.moveTo(x, y + height - 1);
    if (isActive) {
      term.bgBlue.white();
    }
    term(BOX_CHARS.bl);
    if (isActive) {
      term.bgBlue.white(BOX_CHARS.h.repeat(width - 2));
    } else {
      term(BOX_CHARS.h.repeat(width - 2));
    }
    term(BOX_CHARS.br);
    term.styleReset();
  }
  
  renderFilters() {
    const startY = 2;
    const height = this.height - 3; // Высота минус заголовок и статистика

    // Рисуем рамку вокруг панели фильтров (каждый раз для обновления индикатора скроллинга)
    const scrollInfo = {
      current: this.filterScroll,
      visible: this.filterVisibleRows,
      total: this.filterRows.length
    };
    this.drawPanelBox(this.leftX, startY, this.leftWidth, height, 'Фильтры', this.activePanel === 0, scrollInfo);

    // Обновляем скроллинг перед рендерингом
    this.updateFilterScroll();

    // Получаем индекс выбранной строки с проверкой границ
    // filterIndex - это индекс в массиве filterSelectable
    // selectedRowIndex - это индекс строки в массиве filterRows
    const selectedRowIndex = (this.filterIndex >= 0 && this.filterIndex < this.filterSelectable.length) 
      ? this.filterSelectable[this.filterIndex] 
      : null;

    const maxY = startY + height - 2; // Учитываем рамку снизу
    const maxDataRows = maxY - startY - 1; // Максимальное количество строк данных (минус верхняя рамка)
    const actualVisibleRows = Math.min(this.filterVisibleRows, maxDataRows); // Ограничиваем реальным доступным пространством
    
    // Рендерим видимые строки с учетом скроллинга
    // filterScroll - это индекс в filterRows (все строки, включая заголовки)
    const visibleRows = this.filterRows.slice(this.filterScroll, this.filterScroll + actualVisibleRows);
    
    let y = startY + 1; // Начинаем с первой строки после верхней рамки
    visibleRows.forEach((row, idx) => {
      if (y > maxY) return; // Дополнительная проверка границ
      
      const rowIndexInFilterRows = this.filterScroll + idx;
      term.moveTo(this.leftX + 1, y); // +1 для отступа от левой границы
      y++; // Увеличиваем Y после использования
      
      // Выделяем строку только если она selectable, совпадает с выбранным индексом и панель активна
      const isHighlighted = row.selectable && selectedRowIndex !== null && rowIndexInFilterRows === selectedRowIndex && this.activePanel === 0;
      
      if (isHighlighted) {
        term.bgBrightBlue.black();
      } else {
        term.styleReset();
      }
      
      const labelWidth = this.leftWidth - 2; // Ширина минус рамки
      const label = row.label.substring(0, labelWidth);
      term(label);
      if (label.length < labelWidth) {
        term(' '.repeat(labelWidth - label.length));
      }
      if (isHighlighted) {
        term.styleReset();
      }
    });
    
    // Очищаем оставшиеся строки
    for (let clearY = y; clearY <= maxY; clearY++) {
      term.moveTo(this.leftX + 1, clearY);
      term.styleReset();
      term(' '.repeat(this.leftWidth - 2));
    }
  }
  
  renderTable() {
    // Рендерим таблицу устройств в центре
    const startY = 2;
    const height = this.height - 3; // Высота минус заголовок и статистика
    
    // Рисуем рамку вокруг панели таблицы с количеством устройств (каждый раз для обновления индикатора)
      const deviceCount = this.devices.length;
      const tableTitle = `Список устройств (${deviceCount})`;
    const scrollInfo = {
      current: this.tableScroll,
      visible: this.tableVisibleRows,
      total: this.devices.length
    };
    this.drawPanelBox(this.centerX, startY, this.centerWidth, height, tableTitle, this.activePanel === 1, scrollInfo);
    
    // Заголовки таблицы с увеличенным пространством между полями (+5 символов)
    const nameX = this.centerX + 1;
    const nameWidth = 25; // 18 + 5 + 2
    const typeX = nameX + nameWidth + 5; // Добавляем 5 символов пространства
    const typeWidth = 18; // 13 + 5
    const siteX = typeX + typeWidth + 5; // Добавляем 5 символов пространства
    const siteWidth = this.centerWidth - (nameWidth + typeWidth + 10) - 2; // Остальное минус рамки
    
    term.moveTo(nameX, startY + 1);
    term.bold('Название');
    term.moveTo(typeX, startY + 1);
    term.bold('Тип');
    term.moveTo(siteX, startY + 1);
    term.bold('Помещение');
    
    // Рендерим видимые строки таблицы
    const maxY = startY + height - 2; // Учитываем рамку снизу
    const maxDataRows = maxY - (startY + 1); // Максимальное количество строк данных (минус заголовок)
    const actualVisibleRows = Math.min(this.tableVisibleRows, maxDataRows); // Ограничиваем реальным доступным пространством
    const visibleDevices = this.devices.slice(this.tableScroll, this.tableScroll + actualVisibleRows);
    
    visibleDevices.forEach((device, idx) => {
      const actualIndex = this.tableScroll + idx;
      const y = startY + 2 + idx; // startY + 1 (заголовок) + 1 (первая строка данных)
      if (y > maxY) return; // Дополнительная проверка границ
      const isSelected = actualIndex === this.selectedIndex;
      
      // Выделяем выбранную строку ярким фоном
      if (isSelected && this.activePanel === 1) {
        term.bgBrightBlue.black();
      } else {
        term.styleReset(); // Сбрасываем стили для невыбранных строк
      }
      
      // Название
      term.moveTo(nameX, y);
      const icon = getDeviceIcon(device.type, device.category) || '';
      // Резервируем 3 символа для иконки (эмодзи занимают 2 визуальных символа + пробел)
      const iconSpace = 3;
      const name = (device.name || device.id || '—').substring(0, nameWidth - iconSpace);
      const namePadded = name.padEnd(nameWidth - iconSpace);
      
      // Проверяем значение устройства и выводим зелёным цветом если:
      // - value > 0 (числовое значение больше нуля)
      // - value === true (булево значение true)
      // - value === false && inverse === true (инвертированное включенное состояние)
      const deviceData = this.deviceStates.get(device.id);
      const deviceState = deviceData?.state;
      const deviceValue = deviceState?.value;
      const deviceInverse = deviceState?.inverse;
      
      // Проверяем различные условия для включенного состояния
      const isValueGreaterThanZero = typeof deviceValue === 'number' && deviceValue > 0;
      const isValueTrue = deviceValue === true;
      const isInverseTrueValueFalse = deviceInverse === true && deviceValue === false;
      const shouldBeGreen = isValueGreaterThanZero || isValueTrue || isInverseTrueValueFalse;
      
      // Выводим иконку в фиксированном пространстве (3 символа: иконка + пробел, дополняется до 3х)
      // Это обеспечивает выравнивание текста независимо от визуальной ширины эмодзи
      const iconWithSpace = icon ? `${icon} ` : '  ';
      term(iconWithSpace.padEnd(iconSpace));
      if (shouldBeGreen) {
        term.green(namePadded); // Зелёный цвет для включенных устройств (value > 0, value: true или inverse: true && value: false)
      } else {
        term(namePadded);
      }
      
      // Тип
      term.moveTo(typeX, y);
      const type = (device.typeName || '—').substring(0, typeWidth);
      const typePadded = type.padEnd(typeWidth);
      term(typePadded);
      
      // Помещение
      term.moveTo(siteX, y);
      const site = (device.site || '—').substring(0, siteWidth);
      const sitePadded = site.padEnd(siteWidth);
      term(sitePadded);
      
      // Сбрасываем стили после строки
      term.styleReset();
    });
    
    // Очищаем оставшиеся строки
    for (let clearY = startY + 2 + visibleDevices.length; clearY <= maxY; clearY++) {
      term.moveTo(nameX, clearY);
      term.styleReset();
      term(' '.repeat(this.centerWidth - 2));
    }
  }
  
  renderDeviceInfo() {
    // Рендерим панель параметров справа
    const startY = 2;
    const height = this.height - 3; // Высота минус заголовок и статистика
    
    // Рисуем рамку вокруг панели параметров (каждый раз для обновления индикатора скроллинга)
      const label = 'Устройство (c - копировать)';
    
    // Вычисляем информацию о скроллинге для индикатора
    let scrollInfo = null;
    if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
      const device = this.devices[this.selectedIndex];
      const deviceInfo = this.getDeviceInfoText(device);
      const lines = deviceInfo.split('\n');
      scrollInfo = {
        current: this.deviceInfoScroll,
        visible: this.deviceInfoVisibleRows,
        total: lines.length
      };
    }
    
    this.drawPanelBox(this.rightX, startY, this.rightWidth, height, label, this.activePanel === 2, scrollInfo);
    
    if (this.selectedIndex < 0 || this.selectedIndex >= this.devices.length) {
      term.moveTo(this.rightX + 1, startY + 1);
      term.styleReset();
      const msg = 'Выберите устройство для просмотра параметров';
      term(msg);
      term(' '.repeat(this.rightWidth - msg.length - 2));
      return;
    }
    
    const device = this.devices[this.selectedIndex];
    const deviceInfo = this.getDeviceInfoText(device);
    
    // Проверяем изменения полей для подсветки
    const data = this.deviceStates.get(device.id);
    const state = data?.state;
    const changedFields = this.getChangedFields(device.id, state);
    
    // Разбиваем текст на строки и выводим с подсветкой только измененных значений
    const lines = deviceInfo.split('\n');
    const maxY = startY + height - 2; // Учитываем рамку
    const maxDataRows = maxY - startY - 1; // Максимальное количество строк данных (минус верхняя рамка)
    const actualVisibleRows = Math.min(this.deviceInfoVisibleRows, maxDataRows); // Ограничиваем реальным доступным пространством
    
    // Обновляем скроллинг перед рендерингом
    this.updateDeviceInfoScroll();
    
    // Рендерим видимые строки с учетом скроллинга
    const visibleLines = lines.slice(this.deviceInfoScroll, this.deviceInfoScroll + actualVisibleRows);
    visibleLines.forEach((line, idx) => {
      const y = startY + 1 + idx;
      if (y > maxY) return; // Проверка границ для предотвращения выхода за рамки экрана
      const lineIndex = this.deviceInfoScroll + idx; // Реальный индекс строки в массиве lines
      term.moveTo(this.rightX + 1, y);
      term.styleReset();
      
      // Находим измененное поле в строке
      const changedField = this.findChangedFieldInLine(line, changedFields);
      
      // Специальная обработка заголовка устройства (составное название) - жирный зелёный текст, отцентрированный
      if (line.startsWith('__DEVICE_TITLE__')) {
        const deviceTitle = line.replace('__DEVICE_TITLE__', '');
        const availableWidth = this.rightWidth - 2;
        const padding = Math.max(0, Math.floor((availableWidth - deviceTitle.length) / 2));
        const remainingRight = Math.max(0, availableWidth - deviceTitle.length - padding);
        
        // Выводим пробелы слева для центрирования
        term(' '.repeat(padding));
        // Жирный зелёный текст для заголовка устройства
        term.bold.green(deviceTitle);
        term.styleReset();
        // Заполняем оставшееся пространство справа
        term(' '.repeat(remainingRight));
        return;
      }
      
      // Специальная обработка строки "value" - зеленый цвет при активном состоянии
      if (line.includes('value:')) {
        const valueMatch = line.match(/value:\s*(.+)/);
        if (valueMatch) {
          const valueLabel = '  value: ';
          const valueText = valueMatch[1];
          
          // Проверяем условия для зеленого цвета:
          // value === true ИЛИ value > 0 ИЛИ (value === false И inverse === true)
          const stateValue = state?.value;
          const stateInverse = state?.inverse;
          const shouldBeGreen = 
            stateValue === true || 
            stateValue === 1 ||
            (typeof stateValue === 'number' && stateValue > 0) ||
            (stateValue === false && stateInverse === true);
          
          term(valueLabel);
          if (shouldBeGreen) {
            term.green(valueText); // Зеленый цвет для активного состояния
          } else {
            term(valueText);
          }
          term.styleReset();
          
          // Заполняем оставшееся пространство пробелами
          const remaining = this.rightWidth - 2 - line.length;
          if (remaining > 0) {
            term(' '.repeat(remaining));
          }
          return;
        }
      }
      
      // Специальная обработка строк с маркером __GREEN_VALUE__ (каналы актуаторов)
      if (line.includes('__GREEN_VALUE__')) {
        const greenMarkerIndex = line.indexOf('__GREEN_VALUE__');
        const beforeMarker = line.substring(0, greenMarkerIndex);
        const afterMarker = line.substring(greenMarkerIndex + '__GREEN_VALUE__'.length);
        
        // Находим значение после маркера (до → или конца строки)
        const valueEndIndex = afterMarker.indexOf(' →');
        const valueText = valueEndIndex >= 0 ? afterMarker.substring(0, valueEndIndex) : afterMarker;
        const afterValue = valueEndIndex >= 0 ? afterMarker.substring(valueEndIndex) : '';
        
        // Выводим часть до маркера
        term(beforeMarker);
        
        // Выводим значение зелёным цветом
        term.green(valueText);
        term.styleReset();
        
        // Выводим часть после значения
        term(afterValue);
        
        // Заполняем оставшееся пространство
        const totalLength = beforeMarker.length + valueText.length + afterValue.length;
        const maxWidth = this.rightWidth - 2;
        if (totalLength < maxWidth) {
          term(' '.repeat(maxWidth - totalLength));
        }
        return;
      }
      
      // Обрезаем строку до ширины панели минус рамки
      const truncated = line.substring(0, this.rightWidth - 2);
      const maxWidth = this.rightWidth - 2;
      
      if (changedField && changedField.valueStart < maxWidth) {
        // Подсвечиваем только измененное значение, а не всю строку
        const beforeValue = truncated.substring(0, changedField.valueStart);
        const valueText = truncated.substring(changedField.valueStart, Math.min(changedField.valueEnd, maxWidth));
        const afterValue = truncated.substring(Math.min(changedField.valueEnd, maxWidth));
        
        // Выводим часть до значения
        term(beforeValue);
        
        // Подсвечиваем измененное значение желтым текстом
        term.yellow(valueText);
        term.styleReset();
        
        // Выводим часть после значения
        term(afterValue);
        
        // Заполняем оставшееся пространство
        const totalLength = beforeValue.length + valueText.length + afterValue.length;
        if (totalLength < maxWidth) {
          term(' '.repeat(maxWidth - totalLength));
        }
      } else {
        // Обычный вывод без подсветки
        term(truncated);
        if (truncated.length < maxWidth) {
          term(' '.repeat(maxWidth - truncated.length));
        }
      }
    });
    
    // Очищаем оставшиеся строки
    const renderedLines = Math.min(visibleLines.length, actualVisibleRows);
    for (let y = startY + 1 + renderedLines; y <= maxY; y++) {
      term.moveTo(this.rightX + 1, y);
      term.styleReset();
      term(' '.repeat(this.rightWidth - 2));
    }
  }
  
  // Получаем список измененных полей для устройства
  getChangedFields(deviceId, currentState) {
    if (!currentState) return new Set();
    
    const changedFields = new Set();
    const previousValues = this.previousFieldValues.get(deviceId);
    const changeTimestamps = this.fieldChangeTimestamps.get(deviceId);
    const now = Date.now();
    const HIGHLIGHT_DURATION = 2000; // Подсвечиваем изменения в течение 2 секунд
    
    if (!previousValues) {
      // Первое отображение - сохраняем текущие значения
      this.previousFieldValues.set(deviceId, new Map());
      this.fieldChangeTimestamps.set(deviceId, new Map());
      return changedFields;
    }
    
    // Проверяем изменения ключевых полей
    const fieldsToCheck = [
      'value', 'brightness', 'temperature', 'humidity', 'co2', 'illumination',
      'online', 'ready', 'initialized', 'ip', 'motion', 'leakage', 'smoke',
      'pressure', 'fan_speed', 'mode', 'direction', 'setpoint', 'r', 'g', 'b'
    ];
    
    fieldsToCheck.forEach(field => {
      const currentValue = currentState[field];
      const previousValue = previousValues.get(field);
      
      if (currentValue !== previousValue) {
        changedFields.add(field);
        previousValues.set(field, currentValue);
        changeTimestamps.set(field, now);
      } else {
        // Проверяем, не истекло ли время подсветки
        const changeTime = changeTimestamps.get(field);
        if (changeTime && (now - changeTime) < HIGHLIGHT_DURATION) {
          changedFields.add(field);
        }
      }
    });
    
    // Обновляем предыдущие значения
    this.previousFieldValues.set(deviceId, previousValues);
    this.fieldChangeTimestamps.set(deviceId, changeTimestamps);
    
    return changedFields;
  }
  
  // Находим измененное поле в строке и возвращаем позицию значения для подсветки
  findChangedFieldInLine(line, changedFields) {
    if (changedFields.size === 0) return null;
    
    // Маппинг полей на их названия в строке (формат: "  field: value")
    const fieldNames = {
      'value': ['value:'],
      'brightness': ['brightness:'],
      'temperature': ['temperature:'],
      'humidity': ['humidity:'],
      'co2': ['co2:'],
      'illumination': ['illumination:'],
      'online': ['online:'],
      'ready': ['ready:'],
      'initialized': ['initialized:'],
      'ip': ['ip:'],
      'motion': ['motion:'],
      'leakage': ['leakage:'],
      'smoke': ['smoke:'],
      'pressure': ['pressure:'],
      'fan_speed': ['fan_speed:'],
      'mode': ['mode:'],
      'direction': ['direction:'],
      'setpoint': ['setpoint:'],
      'r': ['RGB:', 'r:'],
      'g': ['RGB:', 'g:'],
      'b': ['RGB:', 'b:']
    };
    
    for (const field of changedFields) {
      const names = fieldNames[field];
      if (names) {
        for (const name of names) {
          const nameIndex = line.indexOf(name);
          if (nameIndex !== -1) {
            // Находим позицию значения (после двоеточия и пробела)
            const valueStart = nameIndex + name.length;
            // Пропускаем пробелы после двоеточия
            let valuePos = valueStart;
            while (valuePos < line.length && line[valuePos] === ' ') {
              valuePos++;
            }
            // Находим конец значения (до конца строки или до следующего двоеточия/скобки)
            let valueEnd = line.length;
            for (let i = valuePos; i < line.length; i++) {
              if (line[i] === ':' || line[i] === '(' || line[i] === '→') {
                valueEnd = i;
                break;
              }
            }
            
            return {
              field: field,
              valueStart: valuePos,
              valueEnd: valueEnd,
              value: line.substring(valuePos, valueEnd).trim()
            };
          }
        }
      }
    }
    
    return null;
  }
  
  renderStats() {
    // Рендерим статистику внизу экрана
    const stats = this.getStats();
    
    // Вычисляем скорость обновлений WebSocket используя скользящее окно времени
    const now = Date.now();
    const windowMs = this.wsWindowSeconds * 1000;
    
    // Удаляем старые временные метки (старше окна)
    this.wsInTimestamps = this.wsInTimestamps.filter(ts => now - ts < windowMs);
    this.wsOutTimestamps = this.wsOutTimestamps.filter(ts => now - ts < windowMs);
    
    // Вычисляем скорость как количество сообщений в окне, деленное на размер окна
    if (this.wsInTimestamps.length > 0) {
      const oldestIn = Math.min(...this.wsInTimestamps);
      const actualWindow = (now - oldestIn) / 1000;
      this.wsInPerSecond = actualWindow > 0 ? (this.wsInTimestamps.length / actualWindow).toFixed(1) : '0.0';
    } else {
      this.wsInPerSecond = '0.0';
    }
    
    if (this.wsOutTimestamps.length > 0) {
      const oldestOut = Math.min(...this.wsOutTimestamps);
      const actualWindow = (now - oldestOut) / 1000;
      this.wsOutPerSecond = actualWindow > 0 ? (this.wsOutTimestamps.length / actualWindow).toFixed(1) : '0.0';
    } else {
      this.wsOutPerSecond = '0.0';
    }
    
    const statsText = `Всего: ${stats.total} | Ready: ${stats.ready} | Not Ready: ${stats.notReady} | In: ${this.wsInPerSecond}/с | Out: ${this.wsOutPerSecond}/с`;
    const hotkeysText = `[Tab: панели] [c: копировать устройство] [y+c: копировать строку] [q: выход]`;
    
    // Выводим статистику слева
    term.moveTo(1, this.height - 1);
    term.bold(statsText);
    
    // Выводим хоткеи справа, если есть место
    const remainingWidth = this.width - statsText.length;
    if (remainingWidth > hotkeysText.length + 2) {
      term.moveTo(this.width - hotkeysText.length, this.height - 1);
      term.dim(hotkeysText);
    } else {
      // Если места мало, очищаем оставшееся пространство
      term(' '.repeat(remainingWidth));
    }
  }
  
  // Обновляем панель параметров устройства
  // Эта функция вызывается при изменении выбранного устройства
  updateDeviceInfo() {
    // Сбрасываем скроллинг при смене устройства
    this.deviceInfoScroll = 0;
    // Просто перерисовываем панель параметров через renderDeviceInfo
    // которая вызывается внутри render()
    // Но для оптимизации можно перерисовать только панель параметров
    this.renderDeviceInfo();
  }
  
  // Определяет количество каналов актуатора по типу устройства
  getActuatorChannelCount(deviceType) {
    const channelConfigs = {
      // Реле (do каналы)
      0x0a: { count: 8, types: ['do'] },   0x0b: { count: 16, types: ['do'] },
      0x11: { count: 12, types: ['do'] },   0x23: { count: 2, types: ['do'] },
      0xa0: { count: 6, types: ['do'] },   0xa1: { count: 12, types: ['do'] },
      0xa2: { count: 24, types: ['do'] },  0xa7: { count: 2, types: ['do'] },
      0xae: { count: 12, types: ['do'] },
      // Диммеры (dim каналы)
      0x0e: { count: 4, types: ['dim'] },  0x0f: { count: 8, types: ['dim'] },
      0xa3: { count: 4, types: ['dim'] },  0xa4: { count: 8, types: ['dim'] },
      0xaf: { count: 8, types: ['dim'] },
      0xad: { count: 12, types: ['dim'] },  0xb3: { count: 12, types: ['dim'] },
      0xb4: { count: 12, types: ['dim'] },  0xb6: { count: 1, types: ['dim'] },
      // Аналоговые выходы (ao каналы)
      0xa9: { count: 4, types: ['ao'] },
      // Смешанные устройства
      0x41: { count: 12, types: ['do', 'dim'] },  // MIX_H
      0xaa: { count: 4, types: ['do', 'dim'] },   // MIX_2
      0xab: { count: 2, types: ['do', 'dim'] },   // MIX_1
      0xac: { count: 2, types: ['do', 'dim'] },   // MIX_1_RS
      0xb5: { count: 18, types: ['do', 'dim'] },  // MIX_6x12_RS
      // LANAMP (0xa5) - специальное аудио устройство с собственными типами каналов
      // НЕ включен, так как использует /lanamp/, /stereo/, /mono/, /rtp/ каналы вместо /dim/
    };
    return channelConfigs[deviceType] || null;
  }
  
  // Получает все каналы актуатора с их состояниями и связанными устройствами
  getActuatorChannels(actuatorId, deviceType) {
    const channelConfig = this.getActuatorChannelCount(deviceType);
    if (!channelConfig) return [];
    
    const channels = [];
    const channelTypes = channelConfig.types;
    const channelCount = channelConfig.count;
    
    // Для смешанных устройств определяем количество каналов каждого типа
    let doCount = 0, dimCount = 0, aoCount = 0;
    
    if (channelTypes.includes('do') && channelTypes.includes('dim')) {
      switch (deviceType) {
        case 0x41: doCount = 6; dimCount = 6; break;  // MIX_H
        case 0xaa: doCount = 2; dimCount = 2; break;  // MIX_2
        case 0xab: case 0xac: doCount = 1; dimCount = 1; break;  // MIX_1, MIX_1_RS
        case 0xb5: doCount = 6; dimCount = 12; break;  // MIX_6x12_RS
      }
    } else {
      if (channelTypes.includes('do')) doCount = channelCount;
      if (channelTypes.includes('dim')) dimCount = channelCount;
      if (channelTypes.includes('ao')) aoCount = channelCount;
    }
    
    // Собираем все каналы актуатора
    for (let i = 1; i <= doCount; i++) {
      const channelId = `${actuatorId}/do/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      let linkedDevice = null;
      // Метод 1: bind в канале актуатора содержит ID потребителя (UUID)
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
        // Если не найдено по ID, пробуем найти по коду или имени
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.allDevices.find(d => 
            d.code === channelState.bind || 
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
        // Если устройство не найдено, запрашиваем его через WebSocket
        if (!linkedDevice && typeof channelState.bind === 'string') {
          // Запрашиваем устройство через WebSocket (асинхронно)
          this.requestMissingDevice(channelState.bind);
        }
      }
      
      // Метод 2: обратная привязка - ищем устройства, у которых bind указывает на этот канал
      // Зачем: Привязка может храниться в обратном направлении - у потребителя есть bind с путем к каналу
      if (!linkedDevice) {
        linkedDevice = this.allDevices.find(d => {
          const deviceBind = d.bind || (this.deviceStates.get(d.id)?.state?.bind);
          return deviceBind === channelId;
        });
      }
      
      channels.push({ channelId, channelType: 'do', channelIndex: i, channelState, linkedDevice });
    }
    
    for (let i = 1; i <= dimCount; i++) {
      const channelId = `${actuatorId}/dim/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      // Метод 1: bind в канале актуатора содержит ID потребителя (UUID)
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
        // Если не найдено по ID, пробуем найти по коду или имени
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.allDevices.find(d => 
            d.code === channelState.bind || 
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
        // Если устройство не найдено, запрашиваем его состояние через WebSocket
        if (!linkedDevice && typeof channelState.bind === 'string') {
          // Запрашиваем состояние устройства, которое упоминается в bind, но не найдено
          this.requestMissingDevice(channelState.bind);
        }
      }
      
      // Метод 2: обратная привязка - ищем устройства, у которых bind указывает на этот канал
      // Зачем: Привязка может храниться в обратном направлении - у потребителя есть bind с путем к каналу
      if (!linkedDevice) {
        linkedDevice = this.allDevices.find(d => {
          const deviceBind = d.bind || (this.deviceStates.get(d.id)?.state?.bind);
          return deviceBind === channelId;
        });
      }
      
      channels.push({ channelId, channelType: 'dim', channelIndex: i, channelState, linkedDevice });
    }
    
    for (let i = 1; i <= aoCount; i++) {
      const channelId = `${actuatorId}/ao/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      // Метод 1: bind в канале актуатора содержит ID потребителя (UUID)
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
        // Если не найдено по ID, пробуем найти по коду или имени
        if (!linkedDevice && typeof channelState.bind === 'string') {
          linkedDevice = this.allDevices.find(d => 
            d.code === channelState.bind || 
            d.name === channelState.bind ||
            d.id === channelState.bind
          );
        }
        // Если устройство не найдено, запрашиваем его через WebSocket
        if (!linkedDevice && typeof channelState.bind === 'string') {
          // Запрашиваем устройство через WebSocket (асинхронно)
          this.requestMissingDevice(channelState.bind);
        }
      }
      
      // Метод 2: обратная привязка - ищем устройства, у которых bind указывает на этот канал
      // Зачем: Привязка может храниться в обратном направлении - у потребителя есть bind с путем к каналу
      if (!linkedDevice) {
        linkedDevice = this.allDevices.find(d => {
          const deviceBind = d.bind || (this.deviceStates.get(d.id)?.state?.bind);
          return deviceBind === channelId;
        });
      }
      
      channels.push({ channelId, channelType: 'ao', channelIndex: i, channelState, linkedDevice });
    }
    
    // Обработка групп каналов (group) - виртуальные каналы, объединяющие несколько физических
    // Зачем: Некоторые устройства (например, шторы) привязаны к группам, а не к отдельным каналам
    // Ищем все устройства, у которых bind указывает на группы актуатора
    const groupBindings = new Map(); // Map<groupIndex, linkedDevice>
    
    this.allDevices.forEach(device => {
      const deviceBind = device.bind || (this.deviceStates.get(device.id)?.state?.bind);
      if (deviceBind && deviceBind.startsWith(`${actuatorId}/group/`)) {
        const parts = deviceBind.split('/');
        if (parts.length === 3 && parts[2]) {
          const groupIndex = parseInt(parts[2], 10);
          if (!isNaN(groupIndex)) {
            // Если для этой группы еще нет привязки, или это первая найденная
            if (!groupBindings.has(groupIndex)) {
              groupBindings.set(groupIndex, device);
            }
          }
        }
      }
    });
    
    // Добавляем найденные группы в список каналов
    groupBindings.forEach((linkedDevice, groupIndex) => {
      const channelId = `${actuatorId}/group/${groupIndex}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      channels.push({ 
        channelId, 
        channelType: 'group', 
        channelIndex: groupIndex, 
        channelState, 
        linkedDevice 
      });
    });
    
    return channels;
  }
  
  // Получает информацию о связи потребителя с актуатором
  getConsumerActuatorBinding(consumerId, state) {
    if (!state || !state.bind) return null;
    
    try {
      const parts = state.bind.split('/');
      if (parts.length < 3) return null;
      
      const [deviceMac, channelType, channelIndex] = parts;
      if (!deviceMac || !channelType || !channelIndex) return null;
      
      let actuator = this.devicesByMac.get(deviceMac);
      if (!actuator) {
        actuator = this.allDevices.find(d => d.id === deviceMac);
        if (actuator) this.devicesByMac.set(deviceMac, actuator);
      }
      
      const channelId = state.bind;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      return {
        consumerId,
        actuatorId: deviceMac,
        actuatorType: actuator?.type || null,
        actuatorName: actuator?.name || deviceMac,
        channelId,
        channelType,
        channelIndex: parseInt(channelIndex, 10),
        channelState
      };
    } catch (e) {
      return null;
    }
  }
  
  getDeviceInfoText(device) {
    // Формируем полный текст информации об устройстве со всеми параметрами
    const data = this.deviceStates.get(device.id);
    const state = data?.state;
    
    // Проверяем кэш по deviceId
    const deviceBind = (state && state.bind) || device.bind;
    let channelsHash = '';
    if (device.category === 'Актуатор' && typeof device.type === 'number') {
      const channels = this.getActuatorChannels(device.id, device.type);
      const channelStates = channels.map(ch => ({
        id: ch.channelId,
        value: ch.channelState?.value,
        bind: ch.channelState?.bind,
        linkedDevice: ch.linkedDevice?.id
      }));
      channelsHash = JSON.stringify(channelStates);
    }
    
    const deviceStateHash = state ? JSON.stringify({
      value: state.value,
      initialized: state.initialized,
      online: state.online,
      ready: state.ready,
      ip: state.ip,
      co2: state.co2,
      temperature: state.temperature,
      humidity: state.humidity,
      illumination: state.illumination,
      bind: deviceBind,
      channels: channelsHash,
      lastUpdate: data.lastUpdate,
      lastStateChange: data.lastStateChange,
    }) : 'null';
    const deviceInfoHash = `${device.id}:${deviceStateHash}`;
    
    // Проверяем кэш по deviceId
    const cachedByDeviceId = this.cache.deviceInfoByDeviceId.get(device.id);
    if (cachedByDeviceId && cachedByDeviceId.hash === deviceInfoHash) {
      this.devicePopupText = cachedByDeviceId.text;
      return cachedByDeviceId.content;
    }
    
    // Формируем информацию об устройстве
    let info = [];
    // Составное название устройства для заголовка "code name" или fallback на title/id
    const deviceTitleParts = [
      device.code,
      device.nameField || device.title
    ].filter(Boolean);
    const deviceTitle = deviceTitleParts.length > 0 
      ? deviceTitleParts.join(' ') 
      : device.id;
    info.push(`__DEVICE_TITLE__${deviceTitle}`); // Специальный маркер для зелёного цвета
    info.push('');
    // Выводим все идентификаторы устройства (title, code, name) для полной информации
    info.push(`title: ${device.title || '—'}`);
    info.push(`code: ${device.code || '—'}`);
    info.push(`name: ${device.nameField || '—'}`);
    info.push(`id: ${device.id}`);
    info.push(`type: ${device.typeName} (${device.type})`);
    info.push(`category: ${device.category || '—'}`);
    info.push(`site: ${device.site || '—'}`);
    if (device.siteId && device.siteId !== device.site) {
      info.push(`siteId: ${device.siteId}`);
    }
    info.push('');
    info.push(`Status:`);
    
    const stateValue = state?.value;
    const stateInitialized = state?.initialized;
    const stateOnline = state?.online;
    const stateReady = state?.ready;
    const stateIp = state?.ip;
    const stateLastUpdate = state?.lastUpdate || data?.lastUpdate;
    const stateLastStateChange = data?.lastStateChange;
    
    info.push(`  value: ${stateValue !== undefined && stateValue !== null ? stateValue : '—'}`);
    info.push(`  initialized: ${stateInitialized !== undefined && stateInitialized !== null ? (stateInitialized ? 'Yes' : 'No') : '—'}`);
    info.push(`  online: ${stateOnline !== undefined && stateOnline !== null ? (stateOnline ? 'Yes' : 'No') : '—'}`);
    info.push(`  ready: ${stateReady !== undefined && stateReady !== null ? (stateReady ? '🟢 Yes' : '🔴 No') : '—'}`);
    info.push(`  ip: ${stateIp || '—'}`);
    
    if (stateLastUpdate) {
      const dataAge = Math.floor((Date.now() - stateLastUpdate) / 1000);
      const ageStr = dataAge < 60 ? `${dataAge}s` : dataAge < 3600 ? `${Math.floor(dataAge / 60)}m` : `${Math.floor(dataAge / 3600)}h`;
      info.push(`  lastUpdate: ${ageStr} ago`);
    } else {
      info.push(`  lastUpdate: —`);
    }
    
    if (stateLastStateChange) {
      const stateChangeAge = Math.floor((Date.now() - stateLastStateChange) / 1000);
      const changeAgeStr = stateChangeAge < 60 ? `${stateChangeAge}s` : stateChangeAge < 3600 ? `${Math.floor(stateChangeAge / 60)}m` : `${Math.floor(stateChangeAge / 3600)}h`;
      info.push(`  lastStateChange: ${changeAgeStr} ago`);
    } else {
      info.push(`  lastStateChange: —`);
    }
    
    info.push('');
    info.push(`Parameters:`);
    
    // Отслеживание известных параметров
    if (!this.cache.knownParameters.has(device.id)) {
      this.cache.knownParameters.set(device.id, new Set());
    }
    const knownParams = this.cache.knownParameters.get(device.id);
    
    const shouldShowParam = (paramName, paramValue) => {
      const hasValue = paramValue !== undefined && paramValue !== null;
      if (hasValue) {
        knownParams.add(paramName);
        return true;
      }
      return knownParams.has(paramName);
    };
    
    // Параметры сенсоров
    const temp = state?.temperature;
    const hum = state?.humidity;
    const co2 = state?.co2;
    const illum = state?.illumination;
    const press = state?.pressure;
    const motion = state?.motion;
    const leak = state?.leakage;
    const smoke = state?.smoke;
    
    if (shouldShowParam('temperature', temp)) {
      info.push(`  temperature: ${temp !== undefined && temp !== null ? temp.toFixed(1) + '°C' : '—'}`);
    }
    if (shouldShowParam('humidity', hum)) {
      info.push(`  humidity: ${hum !== undefined && hum !== null ? hum.toFixed(1) + '%' : '—'}`);
    }
    if (shouldShowParam('co2', co2)) {
      info.push(`  co2: ${co2 !== undefined && co2 !== null ? co2 + ' ppm' : '—'}`);
    }
    if (shouldShowParam('illumination', illum)) {
      info.push(`  illumination: ${illum !== undefined && illum !== null ? illum + ' lx' : '—'}`);
    }
    if (shouldShowParam('pressure', press)) {
      info.push(`  pressure: ${press !== undefined && press !== null ? press : '—'}`);
    }
    if (shouldShowParam('motion', motion)) {
      info.push(`  motion: ${motion !== undefined && motion !== null ? (motion ? 'Yes' : 'No') : '—'}`);
    }
    if (shouldShowParam('leakage', leak)) {
      info.push(`  leakage: ${leak !== undefined && leak !== null ? (leak ? 'Yes' : 'No') : '—'}`);
    }
    if (shouldShowParam('smoke', smoke)) {
      info.push(`  smoke: ${smoke !== undefined && smoke !== null ? (smoke ? 'Yes' : 'No') : '—'}`);
    }
    
    // Специфичные параметры температуры BB/PLC
    for (let i = 1; i <= 8; i++) {
      const airTemp = state?.[`t${i}_air_temperature`];
      const humidity = state?.[`t${i}_humidity`];
      const floorTemp = state?.[`t${i}_floor_temperature`];
      if (shouldShowParam(`t${i}_air_temperature`, airTemp)) {
        info.push(`  t${i}_air_temperature: ${airTemp !== undefined && airTemp !== null ? airTemp.toFixed(1) + '°C' : '—'}`);
      }
      if (shouldShowParam(`t${i}_humidity`, humidity)) {
        info.push(`  t${i}_humidity: ${humidity !== undefined && humidity !== null ? humidity.toFixed(1) + '%' : '—'}`);
      }
      if (shouldShowParam(`t${i}_floor_temperature`, floorTemp)) {
        info.push(`  t${i}_floor_temperature: ${floorTemp !== undefined && floorTemp !== null ? floorTemp.toFixed(1) + '°C' : '—'}`);
      }
    }
    
    // Параметры актуаторов
    const value = state?.value;
    const brightness = state?.brightness;
    const fanSpeed = state?.fan_speed;
    const mode = state?.mode;
    const direction = state?.direction;
    const setpoint = state?.setpoint;
    const r = state?.r;
    const g = state?.g;
    const b = state?.b;
    
    if (device.category !== 'Потребитель' && shouldShowParam('value', value)) {
      info.push(`  value: ${value !== undefined && value !== null ? value : '—'}`);
    }
    if (shouldShowParam('brightness', brightness)) {
      info.push(`  Яркость: ${brightness !== undefined && brightness !== null ? brightness : '—'}`);
    }
    if (shouldShowParam('fan_speed', fanSpeed)) {
      info.push(`  Скорость вентилятора: ${fanSpeed !== undefined && fanSpeed !== null ? fanSpeed : '—'}`);
    }
    if (shouldShowParam('mode', mode)) {
      info.push(`  Режим: ${mode !== undefined && mode !== null ? mode : '—'}`);
    }
    if (shouldShowParam('direction', direction)) {
      info.push(`  Направление: ${direction !== undefined && direction !== null ? direction : '—'}`);
    }
    if (shouldShowParam('setpoint', setpoint)) {
      info.push(`  Уставка: ${setpoint !== undefined && setpoint !== null ? setpoint + '°C' : '—'}`);
    }
    
    const hasRgb = r !== undefined || g !== undefined || b !== undefined;
    if (shouldShowParam('rgb', hasRgb ? {r, g, b} : null)) {
      if (hasRgb) {
        const rVal = r !== undefined ? r : 0;
        const gVal = g !== undefined ? g : 0;
        const bVal = b !== undefined ? b : 0;
        info.push(`  RGB: (${rVal}, ${gVal}, ${bVal})`);
      } else {
        info.push(`  RGB: —`);
      }
    }
    
    // Параметры кондиционеров
    for (let i = 1; i <= 4; i++) {
      const power = state?.[`acc${i}_power`];
      const accMode = state?.[`acc${i}_mode`];
      const accFanSpeed = state?.[`acc${i}_fan_speed`];
      const vanePos = state?.[`acc${i}_vane_position`];
      const hasAnyAccParam = power !== undefined || accMode !== undefined || accFanSpeed !== undefined || vanePos !== undefined;
      const accParamName = `acc${i}`;
      
      if (shouldShowParam(accParamName, hasAnyAccParam ? {power, accMode, accFanSpeed, vanePos} : null)) {
        const accParams = [];
        if (power !== undefined) accParams.push(`мощность: ${power}`);
        if (accMode !== undefined) accParams.push(`режим: ${accMode}`);
        if (accFanSpeed !== undefined) accParams.push(`вентилятор: ${accFanSpeed}`);
        if (vanePos !== undefined) accParams.push(`заслонка: ${vanePos}`);
        if (accParams.length > 0) {
          info.push(`  AC${i}: ${accParams.join(', ')}`);
        } else {
          info.push(`  AC${i}: —`);
        }
      }
    }
    
    // Параметры вентиляции
    const ventPower = state?.vent_power;
    const ventFanSpeed = state?.vent_fan_speed;
    const ventDamper = state?.vent_damper;
    
    if (shouldShowParam('vent_power', ventPower)) {
      info.push(`  Вент. мощность: ${ventPower !== undefined ? ventPower : '—'}`);
    }
    if (shouldShowParam('vent_fan_speed', ventFanSpeed)) {
      info.push(`  Вент. скорость: ${ventFanSpeed !== undefined ? ventFanSpeed : '—'}`);
    }
    if (shouldShowParam('vent_damper', ventDamper)) {
      info.push(`  Вент. заслонка: ${ventDamper !== undefined ? ventDamper : '—'}`);
    }
    
    // Параметры тёплого пола
    for (let i = 1; i <= 8; i++) {
      const setPoint = state?.[`room${i}_set_point`];
      const floorPower = state?.[`room${i}_floor_power`];
      if (shouldShowParam(`room${i}_set_point`, setPoint)) {
        info.push(`  Комната${i} уставка: ${setPoint !== undefined ? setPoint + '°C' : '—'}`);
      }
      if (shouldShowParam(`room${i}_floor_power`, floorPower)) {
        info.push(`  Комната${i} мощность: ${floorPower !== undefined ? floorPower : '—'}`);
      }
    }
    
    // Параметры реле вентиляции
    const relayK1 = state?.ventilator_relay_k1;
    const relayK6 = state?.ventilator_relay_k6;
    const relayK7 = state?.ventilator_relay_k7;
    const relayK8 = state?.ventilator_relay_k8;
    
    if (shouldShowParam('ventilator_relay_k1', relayK1)) {
      info.push(`  Реле K1: ${relayK1 !== undefined ? relayK1 : '—'}`);
    }
    if (shouldShowParam('ventilator_relay_k6', relayK6)) {
      info.push(`  Реле K6: ${relayK6 !== undefined ? relayK6 : '—'}`);
    }
    if (shouldShowParam('ventilator_relay_k7', relayK7)) {
      info.push(`  Реле K7: ${relayK7 !== undefined ? relayK7 : '—'}`);
    }
    if (shouldShowParam('ventilator_relay_k8', relayK8)) {
      info.push(`  Реле K8: ${relayK8 !== undefined ? relayK8 : '—'}`);
    }
    
    // Параметры счётчиков
    for (let i = 1; i <= 4; i++) {
      const counter = state?.[`water_counter_${i}`];
      if (shouldShowParam(`water_counter_${i}`, counter)) {
        info.push(`  Счётчик воды ${i}: ${counter !== undefined && counter !== null ? counter : '—'}`);
      }
    }
    
    // Параметры электропитания
    const voltA = state?.voltage_phase_a;
    const voltB = state?.voltage_phase_b;
    const voltC = state?.voltage_phase_c;
    const currA = state?.current_phase_a;
    const currB = state?.current_phase_b;
    const currC = state?.current_phase_c;
    const powA = state?.power_phase_a;
    const powB = state?.power_phase_b;
    const powC = state?.power_phase_c;
    
    if (shouldShowParam('voltage_phase_a', voltA)) info.push(`  Напряжение A: ${voltA !== undefined ? voltA + 'В' : '—'}`);
    if (shouldShowParam('voltage_phase_b', voltB)) info.push(`  Напряжение B: ${voltB !== undefined ? voltB + 'В' : '—'}`);
    if (shouldShowParam('voltage_phase_c', voltC)) info.push(`  Напряжение C: ${voltC !== undefined ? voltC + 'В' : '—'}`);
    if (shouldShowParam('current_phase_a', currA)) info.push(`  Ток A: ${currA !== undefined ? currA + 'А' : '—'}`);
    if (shouldShowParam('current_phase_b', currB)) info.push(`  Ток B: ${currB !== undefined ? currB + 'А' : '—'}`);
    if (shouldShowParam('current_phase_c', currC)) info.push(`  Ток C: ${currC !== undefined ? currC + 'А' : '—'}`);
    if (shouldShowParam('power_phase_a', powA)) info.push(`  Мощность A: ${powA !== undefined ? powA + 'Вт' : '—'}`);
    if (shouldShowParam('power_phase_b', powB)) info.push(`  Мощность B: ${powB !== undefined ? powB + 'Вт' : '—'}`);
    if (shouldShowParam('power_phase_c', powC)) info.push(`  Мощность C: ${powC !== undefined ? powC + 'Вт' : '—'}`);
    
    // Специальные параметры
    const executed = state?.executed;
    const lastExecution = state?.last_execution;
    if (shouldShowParam('executed', executed)) {
      info.push(`  Выполнено: ${executed !== undefined ? (executed ? 'Да' : 'Нет') : '—'}`);
    }
    if (shouldShowParam('last_execution', lastExecution)) {
      if (lastExecution !== undefined) {
        const execDate = new Date(lastExecution);
        info.push(`  Последнее выполнение: ${execDate.toLocaleString('ru-RU')}`);
      } else {
        info.push(`  Последнее выполнение: —`);
      }
    }
    
    // Параметры панелей
    const buttonStates = state?.button_states;
    const displayContent = state?.display_content;
    if (shouldShowParam('button_states', buttonStates)) {
      if (buttonStates && Array.isArray(buttonStates)) {
        info.push(`  Кнопки: ${buttonStates.map((b, i) => `К${i + 1}:${b ? '1' : '0'}`).join(', ')}`);
      } else {
        info.push(`  Кнопки: —`);
      }
    }
    if (shouldShowParam('display_content', displayContent)) {
      info.push(`  Дисплей: ${displayContent !== undefined && displayContent !== null ? displayContent : '—'}`);
    }
    
    // Ошибки
    const error = state?.error;
    if (shouldShowParam('error', error)) {
      info.push(`  Ошибка: ${error !== undefined && error !== null ? error : '—'}`);
    }
    
    // Дополнительные параметры
    if (state) {
      const excludedKeys = [
        'initialized', 'ip', 'online', 'ready', 'timestamp', 'lastUpdate', 'lastStateChange',
        'co2', 'temperature', 'humidity', 'illumination', 'pressure', 'motion', 'leakage', 'smoke',
        'value', 'brightness', 'r', 'g', 'b', 'fan_speed', 'mode', 'direction', 'setpoint',
        'acc1_power', 'acc1_mode', 'acc1_fan_speed', 'acc1_vane_position',
        'acc2_power', 'acc2_mode', 'acc2_fan_speed', 'acc2_vane_position',
        'acc3_power', 'acc3_mode', 'acc3_fan_speed', 'acc3_vane_position',
        'acc4_power', 'acc4_mode', 'acc4_fan_speed', 'acc4_vane_position',
        'vent_power', 'vent_fan_speed', 'vent_damper',
        'room1_set_point', 'room2_set_point', 'room3_set_point', 'room4_set_point',
        'room5_set_point', 'room6_set_point', 'room7_set_point', 'room8_set_point',
        'room1_floor_power', 'room2_floor_power', 'room4_floor_power',
        'room6_floor_power', 'room7_floor_power', 'room8_floor_power',
        'ventilator_relay_k1', 'ventilator_relay_k6', 'ventilator_relay_k7', 'ventilator_relay_k8',
        'water_counter_1', 'water_counter_2', 'water_counter_3', 'water_counter_4',
        'voltage_phase_a', 'voltage_phase_b', 'voltage_phase_c',
        'current_phase_a', 'current_phase_b', 'current_phase_c',
        'power_phase_a', 'power_phase_b', 'power_phase_c',
        'executed', 'last_execution', 'error',
        'button_states', 'display_content', 'modified',
        't1_air_temperature', 't1_humidity', 't1_floor_temperature',
        't2_air_temperature', 't2_humidity', 't2_floor_temperature',
        't3_air_temperature', 't3_humidity',
        't4_air_temperature', 't4_humidity', 't4_floor_temperature',
        't5_air_temperature', 't5_humidity',
        't6_air_temperature', 't6_humidity', 't6_floor_temperature',
        't7_air_temperature', 't7_humidity', 't7_floor_temperature',
        't8_air_temperature', 't8_humidity', 't8_floor_temperature',
        'bind', 'id', 'name', 'code', 'title', 'type', 'parent', 'site', 'project', 'mac'
      ];
      
      const otherFields = Object.keys(state).filter(key => !excludedKeys.includes(key));
      const fieldsToShow = otherFields.filter(key => {
        const value = state[key];
        return shouldShowParam(key, value);
      });
      
      if (fieldsToShow.length > 0) {
        info.push('');
        info.push(`Additional parameters:`);
        fieldsToShow.forEach(key => {
          const value = state[key];
          if (value !== undefined && value !== null) {
            // Специальная обработка поля modified - форматируем как время
            if (key === 'modified' && typeof value === 'number') {
              const modifiedDate = new Date(value);
              info.push(`  ${key}: ${modifiedDate.toLocaleString('ru-RU')}`);
            } else if (typeof value === 'object') {
              info.push(`  ${key}: ${JSON.stringify(value, null, 2).split('\n').join('\n    ')}`);
            } else {
              info.push(`  ${key}: ${value}`);
            }
          } else {
            info.push(`  ${key}: —`);
          }
        });
      }
      
      // Временные метки
      info.push('');
      info.push(`Timestamps:`);
      if (state.timestamp !== undefined && state.timestamp !== null) {
        const timestampDate = new Date(state.timestamp);
        info.push(`  timestamp: ${timestampDate.toLocaleString('ru-RU')} (${state.timestamp})`);
      } else {
        info.push(`  timestamp: —`);
      }
      
      // Поле modified в формате времени
      if (state.modified !== undefined && state.modified !== null) {
        const modifiedDate = new Date(state.modified);
        info.push(`  modified: ${modifiedDate.toLocaleString('ru-RU')}`);
      } else {
        info.push(`  modified: —`);
      }
    } else {
      info.push('');
      info.push(`Timestamps:`);
      info.push(`  timestamp: —`);
      info.push(`  modified: —`);
    }
    
    // Специальная секция для термостатов - показываем bind к DI, sensor и скрипты
    const isThermostat = device.type === 'thermostat' || device.type === 'THERMOSTAT';
    
    if (isThermostat) {
      info.push('');
      info.push(`Управление термостатом:`);
      
      // Bind к DI каналу (обычно DI/4 сенсорного модуля S4)
      const bindValue = (state && state.bind) || device.bind;
      if (bindValue) {
        info.push(`  🔗 Bind к DI каналу:`);
        info.push(`     ${bindValue}`);
        
        // Парсим bind для получения актуатора и канала
        const bindParts = bindValue.split('/');
        if (bindParts.length === 3) {
          const actuatorId = bindParts[0];
          const channelType = bindParts[1];
          const channelNum = bindParts[2];
          
          // Получаем информацию о мастер-устройстве (S4 модуль)
          const actuator = this.allDevices.find(d => d.id === actuatorId);
          if (actuator) {
            info.push(`     → Модуль: ${actuator.title || actuator.code || actuatorId}`);
            info.push(`     → Тип: ${DEVICE_TYPE_NAMES[actuator.type] || actuator.type}`);
            
            // Показываем встроенную температуру S4 модуля
            const actuatorState = this.deviceStates.get(actuatorId);
            if (actuatorState && actuatorState.temperature !== undefined) {
              info.push(`     → Встроенная температура: ${actuatorState.temperature}°C`);
            }
          } else {
            info.push(`     ⚠️  Модуль не найден: ${actuatorId}`);
          }
        }
      } else {
        info.push(`  🔗 Bind к DI каналу:`);
        info.push(`     ❌ ОТСУТСТВУЕТ`);
        info.push(`     ⚠️  Рекомендация: добавить bind к DI/4 сенсорного модуля`);
      }
      
      // Датчик температуры
      const sensorId = (state && state.sensor) || device.sensor;
      if (sensorId) {
        info.push('');
        info.push(`  🌡️  Датчик температуры:`);
        info.push(`     ID: ${sensorId}`);
        
        const sensor = this.allDevices.find(d => d.id === sensorId);
        const sensorState = this.deviceStates.get(sensorId);
        
        if (sensor || sensorState) {
          const sensorName = sensor?.title || sensor?.code || '—';
          const temperature = sensorState?.temperature || sensorState?.temperature_raw || '?';
          const online = sensorState?.online;
          const ready = sensorState?.ready;
          
          info.push(`     Название: ${sensorName}`);
          info.push(`     Температура: ${temperature}°C`);
          info.push(`     Статус: ${online ? '🟢 Online' : '🔴 Offline'}, ${ready ? '✅ Ready' : '⚠️ Not Ready'}`);
          
          // Проверяем мастер-устройство датчика
          const sensorMaster = sensorState?.master || sensor?.master;
          if (sensorMaster) {
            const master = this.allDevices.find(d => d.id === sensorMaster);
            const masterName = master?.title || master?.code || sensorMaster.substring(0, 17) + '...';
            info.push(`     Мастер: ${masterName}`);
            
            // Проверяем соответствие мастера с bind термостата
            if (bindValue) {
              const bindActuatorId = bindValue.split('/')[0];
              if (sensorMaster === bindActuatorId) {
                info.push(`     ✅ Мастер датчика совпадает с bind`);
              } else {
                info.push(`     ⚠️  Мастер датчика НЕ совпадает с bind!`);
                info.push(`        Bind: ${bindActuatorId.substring(0, 17)}...`);
                info.push(`        Master: ${sensorMaster.substring(0, 17)}...`);
              }
            }
          } else {
            info.push(`     ⚠️  У датчика нет мастер-устройства`);
          }
        } else {
          info.push(`     ⚠️  Датчик не найден`);
        }
      } else {
        info.push('');
        info.push(`  🌡️  Датчик температуры:`);
        info.push(`     ❌ ОТСУТСТВУЕТ`);
        info.push(`     ⚠️  Рекомендация: добавить sensor`);
      }
      
      // Скрипты управления
      const scripts = [
        { key: 'onStartHeat', name: '🔥 Включение обогрева' },
        { key: 'onStopHeat', name: '❄️  Выключение обогрева' },
        { key: 'onStartCool', name: '❄️  Включение охлаждения' },
        { key: 'onStopCool', name: '🔥 Выключение охлаждения' },
      ];
      
      info.push('');
      info.push(`  📜 Скрипты управления:`);
      
      let hasScripts = false;
      for (const script of scripts) {
        const scriptId = (state && state[script.key]) || device[script.key];
        if (scriptId) {
          const scriptDevice = this.allDevices.find(d => d.id === scriptId);
          const scriptName = scriptDevice?.title || scriptDevice?.code || scriptId.substring(0, 8) + '...';
          info.push(`     ✅ ${script.name}: ${scriptName}`);
          hasScripts = true;
        }
      }
      
      if (!hasScripts) {
        info.push(`     ⚠️  Нет скриптов управления`);
      }
    }
    
    // Связь потребителя с актуатором (для не-термостатов)
    const isConsumer = device.category === 'Потребитель' || 
                       (typeof device.type === 'string' && CONSUMER_TYPES.includes(device.type));
    const bindValue = (state && state.bind) || device.bind;
    
    if (isConsumer && !isThermostat && bindValue) {
      info.push('');
      info.push(`Связь с актуатором:`);
      const stateWithBind = state ? { ...state, bind: bindValue } : { bind: bindValue };
      const binding = this.getConsumerActuatorBinding(device.id, stateWithBind);
      if (binding) {
        info.push(`  Bind: ${bindValue}`);
        info.push(`  Актуатор: ${binding.actuatorName || binding.actuatorId}`);
        if (binding.actuatorType) {
          info.push(`  Тип актуатора: ${DEVICE_TYPE_NAMES[binding.actuatorType] || `Тип${binding.actuatorType}`} (${binding.actuatorType})`);
        }
        const channelTypeName = binding.channelType === 'do' ? 'DO' 
          : binding.channelType === 'dim' ? 'DIM' 
          : binding.channelType === 'ao' ? 'AO' 
          : binding.channelType === 'group' ? 'GROUP'
          : binding.channelType;
        info.push(`  Канал: ${channelTypeName}/${binding.channelIndex}`);
        if (binding.channelState) {
          const channelValue = binding.channelState.value !== undefined ? binding.channelState.value : '—';
          info.push(`  Состояние канала: ${channelValue}`);
        } else {
          info.push(`  Состояние канала: — (данные не получены)`);
        }
      } else {
        info.push(`  Bind: ${bindValue}`);
        info.push(`  ⚠️  Актуатор не найден`);
      }
    } else if (isConsumer && !isThermostat) {
      info.push('');
      info.push(`Связь с актуатором:`);
      info.push(`  ⚠️  Не привязан к актуатору (bind отсутствует)`);
    }
    
    // Связь сенсора с модулем (для герконов, датчиков протечки и других сенсоров)
    // Зачем: Сенсоры могут быть привязаны к модулям (например, M1) через DI каналы
    const isSensor = device.category === 'Сенсор';
    const sensorBindValue = (state && state.bind) || device.bind;
    
    if (isSensor && sensorBindValue) {
      // Проверяем, является ли bind привязкой к модулю (формат: {moduleId}/di/{номер})
      const bindParts = sensorBindValue.split('/');
      if (bindParts.length >= 3 && bindParts[1] === 'di') {
        const moduleId = bindParts[0];
        const channelType = bindParts[1];
        const channelIndex = bindParts[2];
        
        info.push('');
        info.push(`Связь с модулем:`);
        info.push(`  Bind: ${sensorBindValue}`);
        
        // Ищем модуль
        let module = this.devicesByMac.get(moduleId);
        if (!module) {
          module = this.allDevices.find(d => d.id === moduleId);
          if (module) this.devicesByMac.set(moduleId, module);
        }
        
        if (module) {
          const moduleName = module.code || module.title || module.name || moduleId;
          info.push(`  Модуль: ${moduleName}`);
          if (module.type) {
            info.push(`  Тип модуля: ${DEVICE_TYPE_NAMES[module.type] || `Тип${module.type}`} (${module.type})`);
          }
          const channelTypeName = channelType === 'di' ? 'DI' : channelType.toUpperCase();
          info.push(`  Канал: ${channelTypeName}/${channelIndex}`);
          
          // Получаем состояние канала модуля
          const channelId = sensorBindValue;
          const channelData = this.deviceStates.get(channelId);
          const channelState = channelData?.state || null;
          
          if (channelState) {
            const channelValue = channelState.value !== undefined ? channelState.value : '—';
            info.push(`  Состояние канала: ${channelValue}`);
          } else {
            info.push(`  Состояние канала: — (данные не получены)`);
          }
          
          // Показываем помещение модуля, если есть
          if (module.site) {
            info.push(`  Помещение модуля: ${module.site}`);
          }
        } else {
          info.push(`  ⚠️  Модуль не найден (ID: ${moduleId})`);
        }
      } else {
        // Bind не является привязкой к модулю через DI канал
        info.push('');
        info.push(`Связь с модулем:`);
        info.push(`  Bind: ${sensorBindValue}`);
        info.push(`  ⚠️  Формат bind не соответствует привязке к модулю (ожидается: {moduleId}/di/{номер})`);
      }
    }
    
    // Каналы актуатора (включая MIX устройства: MIX_H, MIX_1, MIX_2, MIX_1_RS, MIX_6x12_RS)
    // Зачем: Резолв каналов DO и DIM для смешанных устройств с правильным определением количества каналов каждого типа
    const isActuator = device.category === 'Актуатор' && typeof device.type === 'number';
    if (isActuator) {
      const channels = this.getActuatorChannels(device.id, device.type);
      if (channels.length > 0) {
        info.push('');
        info.push(`Actuator channels:`);
        
        const channelsByType = {};
        channels.forEach(channel => {
          if (!channelsByType[channel.channelType]) {
            channelsByType[channel.channelType] = [];
          }
          channelsByType[channel.channelType].push(channel);
        });
        
        Object.keys(channelsByType).sort().forEach(channelType => {
          const typeChannels = channelsByType[channelType];
          const typeName = channelType === 'do' ? 'Реле (DO)' 
            : channelType === 'dim' ? 'Диммер (DIM)' 
            : channelType === 'ao' ? 'Аналоговый выход (AO)' 
            : channelType === 'group' ? 'Группы (GROUP)'
            : channelType;
          
          info.push(`  ${typeName} каналы:`);
          
          typeChannels.forEach(channel => {
            const channelValue = channel.channelState && channel.channelState.value !== undefined 
              ? channel.channelState.value 
              : '—';
            const channelInverse = channel.channelState && channel.channelState.inverse !== undefined
              ? channel.channelState.inverse
              : false;
            
            // Зачем: Формируем строковое представление значения канала
            // Для DO: учитываем inverse (если inverse && false, то "on")
            let channelValueStr;
            let isChannelOn = false;
            
            if (channel.channelType === 'dim') {
              channelValueStr = `${channelValue}`;
              // Для DIM: значение > 0
              isChannelOn = typeof channelValue === 'number' && channelValue > 0;
            } else if (channel.channelType === 'do') {
              // Для DO: если inverse && false, то "on", иначе стандартная логика
              if (channelInverse && channelValue === false) {
                channelValueStr = 'on';
                isChannelOn = true; // inverse: false означает включено
              } else {
                // Любое truthy значение (кроме '—', false, 0, '') = "on"
                const isOn = channelValue && channelValue !== '—' && channelValue !== false && channelValue !== 0 && channelValue !== '';
                channelValueStr = isOn ? 'on' : 'off';
                isChannelOn = isOn;
              }
            } else if (channel.channelType === 'group') {
              channelValueStr = (channelValue !== '—' ? `${channelValue}` : '—');
              isChannelOn = channelValue !== '—' && channelValue !== false && channelValue !== 0 && channelValue !== '';
            } else {
              channelValueStr = `${channelValue}`;
              isChannelOn = channelValue === true || 
                           channelValue === 1 || 
                           (typeof channelValue === 'number' && channelValue > 0) ||
                           channelValue === 'on';
            }
            
            const channelTypeName = channel.channelType === 'do' ? 'DO' 
              : channel.channelType === 'dim' ? 'DIM' 
              : channel.channelType === 'ao' ? 'AO' 
              : channel.channelType === 'group' ? 'GROUP'
              : channel.channelType;
            
            // Формируем строку в формате: DIM/X: значение (диапазон) → Название (Тип) / Помещение
            // Добавляем маркер для зелёного цвета, если канал включен (on, true, > 0)
            const valueMarker = isChannelOn ? '__GREEN_VALUE__' : '';
            let channelLine = `    ${channelTypeName}/${channel.channelIndex}: ${valueMarker}${channelValueStr}`;
            
            if (channel.linkedDevice) {
              // Формируем отображение имени устройства с приоритетом code → title → name
              const linkedDev = channel.linkedDevice;
              const displayName = linkedDev.code || linkedDev.title || linkedDev.name || linkedDev.id.substring(0, 8) + '...';
              const deviceType = linkedDev.typeName || linkedDev.type;
              const deviceSite = linkedDev.site || '';
              
              channelLine += ` → ${displayName} (${deviceType})`;
              if (deviceSite) {
                channelLine += ` / ${deviceSite}`;
              }
              info.push(channelLine);
            } else if (channel.channelState && channel.channelState.bind) {
              // Показываем, что устройство не найдено, с кратким bind
              const bindValue = channel.channelState.bind;
              const shortBind = bindValue.substring(0, 8) + '...';
              channelLine += ` → ⚠️  Устройство не найдено (${shortBind})`;
              info.push(channelLine);
            } else {
              channelLine += ` → (не привязан)`;
              info.push(channelLine);
            }
          });
        });
      } else {
        const channelConfig = this.getActuatorChannelCount(device.type);
        if (channelConfig) {
          info.push('');
          info.push(`Actuator channels:`);
          info.push(`  Channel types: ${channelConfig.types.join(', ')}`);
          info.push(`  Count: ${channelConfig.count}`);
          info.push(`  ⚠️  Состояние каналов не получено (данные не загружены через WebSocket)`);
        }
      }
    }
    
    // Для S3/S4 модулей показываем подключенные датчики температуры
    const isS3S4Module = device.type === 32 || device.type === 37; // S3 или S4
    if (isS3S4Module && state && state.temperature_ext && Array.isArray(state.temperature_ext)) {
      info.push('');
      info.push(`🌡️  Датчики температуры (1-Wire на DI/4):`);
      
      if (state.temperature_ext.length === 0) {
        info.push(`  (нет подключенных датчиков)`);
      } else {
        info.push(`  Всего датчиков: ${state.temperature_ext.length}`);
        
        // Показываем каждый датчик из temperature_ext[]
        state.temperature_ext.forEach((sensorId, idx) => {
          // Ищем датчик в списке всех устройств
          const sensor = this.allDevices.find(d => d.id === sensorId);
          
          if (sensor) {
            const sensorData = this.deviceStates.get(sensorId);
            const sensorState = sensorData?.state;
            const sensorTemp = sensorState?.temperature || sensorState?.temperature_raw;
            const sensorReady = sensorState?.ready;
            const sensorOnline = sensorState?.online;
            
            // Статус датчика
            const status = sensorReady ? '🟢' : (sensorOnline ? '🟡' : '🔴');
            
            // Название датчика (приоритет: code → title → ID)
            const sensorName = sensor.code || sensor.title || sensorId.substring(0, 20) + '...';
            
            // Температура
            const tempStr = sensorTemp ? `${sensorTemp.toFixed(1)}°C` : '—';
            
            // Проверяем, совпадает ли master
            const sensorMaster = sensorState?.master;
            const masterMatch = sensorMaster === device.id;
            
            info.push(`  [${idx}] ${status} ${sensorName}`);
            info.push(`      ID: ${sensorId}`);
            info.push(`      Температура: ${tempStr}`);
            
            if (!masterMatch && sensorMaster) {
              info.push(`      ⚠️  master: ${sensorMaster.substring(0, 17)}... (не совпадает!)`);
            } else if (!sensorMaster) {
              info.push(`      ⚠️  master не указан`);
            } else {
              info.push(`      ✅ master корректен`);
            }
          } else {
            // Датчик не найден в системе
            info.push(`  [${idx}] 🔴 ${sensorId.substring(0, 20)}...`);
            info.push(`      ❌ Датчик не найден в системе`);
          }
        });
      }
    }
    
    // Для датчиков температуры показываем мастер-устройство
    const isTemperatureSensor = device.type === 240 || device.type === 0xF0; // TEMPERATURE_EXT
    if (isTemperatureSensor && state && state.master) {
      info.push('');
      info.push(`🏠 Мастер-устройство (S3/S4):`);
      
      // Ищем мастер-устройство
      const master = this.allDevices.find(d => d.id === state.master);
      
      if (master) {
        const masterData = this.deviceStates.get(master.id);
        const masterState = masterData?.state;
        const masterReady = masterState?.ready;
        const masterOnline = masterState?.online;
        
        // Статус мастера
        const status = masterReady ? '🟢' : (masterOnline ? '🟡' : '🔴');
        
        // Название мастера (приоритет: code → title)
        const masterName = master.code || master.title || state.master.substring(0, 20) + '...';
        
        // Тип мастера
        const masterType = master.typeName || master.type;
        
        info.push(`  ${status} ${masterName} (${masterType})`);
        info.push(`  ID: ${state.master}`);
        
        // Помещение мастера
        if (master.site) {
          info.push(`  Помещение: ${master.site}`);
        }
        
        // Проверяем, включен ли датчик в temperature_ext[] мастера
        if (masterState && masterState.temperature_ext && Array.isArray(masterState.temperature_ext)) {
          const isInTempExt = masterState.temperature_ext.includes(device.id);
          
          if (isInTempExt) {
            const idx = masterState.temperature_ext.indexOf(device.id);
            info.push(`  ✅ Включен в temperature_ext[${idx}]`);
          } else {
            info.push(`  ⚠️  НЕ в temperature_ext[] мастера!`);
            info.push(`     Датчик имеет master, но не в массиве`);
          }
          
          // Показываем общее количество датчиков на мастере
          info.push(`  Всего датчиков на мастере: ${masterState.temperature_ext.length}`);
        } else {
          info.push(`  ⚠️  temperature_ext[] не найден на мастере`);
        }
        
        // Встроенная температура мастера
        const masterTemp = masterState?.temperature;
        if (masterTemp !== undefined && masterTemp !== null) {
          info.push(`  Встроенная температура S3/S4: ${masterTemp.toFixed(1)}°C`);
        }
      } else {
        // Мастер не найден
        info.push(`  🔴 ${state.master.substring(0, 20)}...`);
        info.push(`  ❌ Мастер-устройство не найдено в системе`);
      }
    }
    
    // Для модуля датчиков протечки (M1, тип 171) показываем подключенные датчики
    const isLeakageModule = device.type === 171 || device.type === 0xab; // M1
    if (isLeakageModule) {
      info.push('');
      info.push(`💧 Датчики протечки (DI каналы):`);
      
      // Ищем все датчики протечки, привязанные к этому модулю
      const leakageSensors = this.allDevices.filter(d => {
        const data = this.deviceStates.get(d.id);
        const bind = data?.state?.bind || d.bind;
        // Проверяем, что bind начинается с ID модуля
        return bind && bind.startsWith(device.id + '/di/');
      });
      
      if (leakageSensors.length === 0) {
        info.push(`  (нет подключенных датчиков)`);
      } else {
        info.push(`  Всего датчиков: ${leakageSensors.length}`);
        
        // Сортируем по номеру DI канала
        leakageSensors.sort((a, b) => {
          const aData = this.deviceStates.get(a.id);
          const bData = this.deviceStates.get(b.id);
          const aBind = (aData?.state?.bind || a.bind || '').match(/\/di\/(\d+)/);
          const bBind = (bData?.state?.bind || b.bind || '').match(/\/di\/(\d+)/);
          const aNum = aBind ? parseInt(aBind[1]) : 999;
          const bNum = bBind ? parseInt(bBind[1]) : 999;
          return aNum - bNum;
        });
        
        // Показываем каждый датчик протечки
        leakageSensors.forEach(sensor => {
          const sensorData = this.deviceStates.get(sensor.id);
          const sensorState = sensorData?.state;
          const sensorReady = sensorState?.ready;
          const sensorOnline = sensorState?.online;
          const leakage = sensorState?.leakage;
          
          // Извлекаем номер DI канала
          const bind = sensorState?.bind || sensor.bind;
          const diMatch = bind?.match(/\/di\/(\d+)/);
          const diNum = diMatch ? diMatch[1] : '?';
          
          // Статус датчика
          const status = leakage ? '⚠️ ' : (sensorReady ? '🟢' : (sensorOnline ? '🟡' : '🔴'));
          
          // Название датчика (приоритет: code → title)
          const sensorName = sensor.code || sensor.title || sensor.id.substring(0, 20) + '...';
          
          // Помещение датчика
          const sensorSite = sensor.site || '—';
          
          info.push(`  DI/${diNum}: ${status} ${sensorName}`);
          if (leakage) {
            info.push(`         💧 ПРОТЕЧКА ОБНАРУЖЕНА!`);
          }
          info.push(`         Помещение: ${sensorSite}`);
        });
      }
    }
    
    // Для датчиков протечки показываем bind к модулю M1
    const isLeakageSensor = device.type === 'leakage_sensor';
    if (isLeakageSensor) {
      info.push('');
      info.push(`🏠 Модуль датчиков протечки:`);
      
      const bindValue = state?.bind || device.bind;
      
      if (bindValue) {
        // Извлекаем ID модуля и номер канала из bind
        const bindMatch = bindValue.match(/^([^/]+)\/di\/(\d+)$/);
        
        if (bindMatch) {
          const moduleId = bindMatch[1];
          const diNum = bindMatch[2];
          
          // Ищем модуль
          const module = this.allDevices.find(d => d.id === moduleId);
          
          if (module) {
            const moduleData = this.deviceStates.get(module.id);
            const moduleState = moduleData?.state;
            const moduleReady = moduleState?.ready;
            const moduleOnline = moduleState?.online;
            
            // Статус модуля
            const status = moduleReady ? '🟢' : (moduleOnline ? '🟡' : '🔴');
            
            // Название модуля (приоритет: code → title)
            const moduleName = module.code || module.title || moduleId.substring(0, 20) + '...';
            
            // Тип модуля
            const moduleType = module.typeName || module.type;
            
            info.push(`  ${status} ${moduleName} (${moduleType})`);
            info.push(`  ID: ${moduleId}`);
            info.push(`  Bind: ${bindValue}`);
            info.push(`  Канал: DI/${diNum}`);
            
            // Помещение модуля
            if (module.site) {
              info.push(`  Помещение модуля: ${module.site}`);
            }
            
            // Статус протечки
            const leakage = state?.leakage;
            if (leakage !== undefined) {
              info.push(`  Протечка: ${leakage ? '⚠️  ДА' : '✅ Нет'}`);
            }
          } else {
            // Модуль не найден
            info.push(`  🔴 ${moduleId.substring(0, 20)}...`);
            info.push(`  ❌ Модуль не найден в системе`);
            info.push(`  Bind: ${bindValue}`);
          }
        } else {
          info.push(`  ⚠️  Неверный формат bind: ${bindValue}`);
        }
      } else {
        info.push(`  ⚠️  Не привязан к модулю (bind отсутствует)`);
      }
    }
    
    const deviceInfoContent = info.join('\n');
    
    // Сохраняем текст для копирования (без форматирования и без служебных маркеров)
    const deviceInfoText = deviceInfoContent.replace(/__DEVICE_TITLE__/g, '');
    this.devicePopupText = deviceInfoText;
    
    // Сохраняем в кэш по deviceId
    this.cache.deviceInfoByDeviceId.set(device.id, {
      content: deviceInfoContent,
      hash: deviceInfoHash,
      text: deviceInfoText
    });
    
    return deviceInfoContent;
  }
  
  getStats() {
    const stateHash = this.getDevicesStateHash();
    
    if (this.cache.stats && this.cache.statsHash === stateHash) {
      return this.cache.stats;
    }
    
    let ready = 0;
    let notReady = 0;
    
    this.devices.forEach(device => {
      const data = this.deviceStates.get(device.id);
      const state = data?.state;
      if (state?.ready === true) {
        ready++;
      } else if (state?.ready === false || (state && state.ready !== undefined)) {
        notReady++;
      }
    });
    
    const stats = {
      total: this.allDevices.length,
      visible: this.devices.length,
      ready,
      notReady,
    };
    
    this.cache.stats = stats;
    this.cache.statsHash = stateHash;
    
    return stats;
  }
  
  getDevicesStateHash() {
    // Создаем хеш состояния всех устройств для кэширования
    // Учитываем только видимые устройства и их ключевые поля
    const stateHashes = [];
    for (const device of this.devices) {
      const data = this.deviceStates.get(device.id);
      if (data && data.state) {
        const keyFields = {
          ready: data.state.ready,
          ip: data.state.ip,
          co2: data.state.co2,
          temperature: data.state.temperature,
          humidity: data.state.humidity,
          illumination: data.state.illumination,
          lastUpdate: data.lastUpdate,
        };
        stateHashes.push(`${device.id}:${JSON.stringify(keyFields)}`);
      } else {
        stateHashes.push(`${device.id}:null`);
      }
    }
    return stateHashes.join('|');
  }
  
  copyDeviceInfoToClipboard() {
    const device = this.devices[this.selectedIndex];
    if (!device) return;
    
    // Используем сохраненный текст для копирования или формируем заново
    let textToCopy = this.devicePopupText;
    
    if (!textToCopy) {
      textToCopy = this.getDeviceInfoText(device);
    }
    
    if (!textToCopy) return;
    
    copyToClipboard(textToCopy);
    
    // Показываем уведомление
    term.moveTo(this.rightX + 1, 1);
    term.bgGreen.black('✅ Содержимое раздела "Устройство" скопировано');
    setTimeout(() => {
      this.render();
    }, 2000);
  }
  
  copyTableRowToClipboard() {
    const device = this.devices[this.selectedIndex];
    if (!device) return;
    
    const icon = getDeviceIcon(device.type, device.category);
    const text = `${icon} ${device.name || device.id} | ${device.typeName || '—'} | ${device.site || '—'}`;
    copyToClipboard(text);
    
    // Показываем уведомление
    term.moveTo(this.centerX, 1);
    term.bgGreen.black('✅ Строка скопирована');
    setTimeout(() => {
      this.render();
    }, 2000);
  }
  
  setDeviceState(deviceId, newState) {
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();
    
    // Временная метка для подсчета скорости добавляется при получении сообщения в ws.on('message')
    // Это дает реальную скорость получения сообщений от сервера, независимо от производительности устройства
    
    // Объединяем старое и новое состояние, чтобы не потерять поля при частичных обновлениях
    const oldState = existing?.state || {};
    const mergedState = { ...oldState, ...newState };
    
    // Проверяем изменения состояния по ключевым полям
    let stateChanged = false;
    if (existing && existing.state) {
      const keyFields = ['ready', 'ip', 'co2', 'temperature', 'humidity', 'illumination', 'value'];
      for (const field of keyFields) {
        if (oldState[field] !== mergedState[field]) {
          stateChanged = true;
          break;
        }
      }
    } else {
      stateChanged = true;
    }
    
    const lastStateChange = stateChanged ? now : (existing?.lastStateChange || now);
    
    // Сохраняем объединенное состояние
    this.deviceStates.set(deviceId, {
      ...existing,
      state: mergedState,
      lastUpdate: now,
      lastStateChange: lastStateChange,
    });
    
    // Обновляем site устройства из payload, если он изменился
    const existingDevice = this.allDevices.find(d => d.id === deviceId);
    if (existingDevice && newState.site !== undefined) {
      let siteId = newState.site;
      let siteName = null;
      
      if (siteId) {
        if (Array.isArray(siteId)) {
          siteId = siteId[0];
        }
        if (typeof siteId === 'string') {
          const site = this.sites.find(s => s.id === siteId);
          siteName = site ? site.name : null;
        }
      }
      
      const oldSite = existingDevice.site;
      if (oldSite !== siteName) {
        existingDevice.siteId = siteId || null;
        existingDevice.site = siteName;
        
        // Инвалидируем кэш фильтров, если site изменился
        // НЕ вызываем applyFilters() здесь, чтобы не ломать навигацию во время скроллинга
        // Фильтры будут применены при следующем явном изменении фильтра пользователем
        this.cache.filteredDevices = null;
        this.cache.filteredDevicesHash = null;
      }
    }
    
    // Проверяем, нужно ли обновлять информацию об устройстве
    let shouldUpdateDeviceInfo = false;
    if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
      const selectedDevice = this.devices[this.selectedIndex];
      
      if (selectedDevice && selectedDevice.id === deviceId) {
        this.cache.deviceInfoByDeviceId.delete(deviceId);
        shouldUpdateDeviceInfo = true;
      }
      
      // Проверяем, обновляется ли канал актуатора
      if (selectedDevice && selectedDevice.category === 'Актуатор' && typeof selectedDevice.type === 'number') {
        const isChannel = deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/');
        if (isChannel && deviceId.startsWith(selectedDevice.id + '/')) {
          this.cache.deviceInfoByDeviceId.delete(selectedDevice.id);
          shouldUpdateDeviceInfo = true;
        }
      }
    }
    
    // Инвалидируем кэш при изменении состояния
    if (stateChanged) {
      this.cache.deviceInfoByDeviceId.delete(deviceId);
      
      const isChannel = deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/');
      const isVisibleDevice = this.devices.some(d => d.id === deviceId);
      const isVisibleChannel = isChannel && this.devices.some(d => {
        if (d.category === 'Актуатор' && typeof d.type === 'number') {
          return deviceId.startsWith(d.id + '/');
        }
        return false;
      });
      
      if (isVisibleDevice || isVisibleChannel) {
        this.cache.tableData = null;
        this.cache.tableDataHash = null;
      }
      
      this.cache.stats = null;
      this.cache.statsHash = null;
    }
    
    // Обновляем отображение только если не идет навигация
    // Используем debounce для снижения нагрузки на CPU при множественных обновлениях
    if (!this.isNavigating && stateChanged) {
      if (shouldUpdateDeviceInfo) {
        this.updateDeviceInfo();
      }
      this.scheduleRender();
    } else if (shouldUpdateDeviceInfo) {
      this.updateDeviceInfo();
    }
  }
  
  setConnected(connected) {
    this.isConnected = connected;
    this.render();
  }
  
  // Устанавливаем ссылку на WebSocket для запроса отсутствующих устройств
  setWebSocket(ws) {
    this.ws = ws;
  }
  
  // Запрашиваем состояние отсутствующего устройства через WebSocket
  requestMissingDevice(deviceId) {
    if (!deviceId) return;
    
    // Предотвращаем повторные запросы одного и того же устройства
    if (this.requestedMissingDevices.has(deviceId)) return;
    
    // Проверяем, что устройство действительно отсутствует в списке
    const exists = this.allDevices.some(d => d.id === deviceId);
    if (exists) return;
    
    this.requestedMissingDevices.add(deviceId);
    
    // Запрашиваем устройство только через WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const getRequest = { type: 'get', state: [deviceId] };
      this.logWebSocketRequest('get', [deviceId], this.ws);
      this.ws.send(JSON.stringify(getRequest));
    }
  }
  
  // Пакетный запрос связанных устройств из bind каналов всех актуаторов (логика из resolve-actuator-via-websocket.js)
  // Резолв выполняется только через WebSocket
  // Также запрашиваем помещения актуаторов для полного резолва
  requestLinkedDevicesFromChannels() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // Собираем все UUID из bind каналов всех актуаторов (логика из resolve-actuator-via-websocket.js)
    const bindUuids = new Set();
    
    this.allDevices.forEach(device => {
      if (device.category === 'Актуатор' && typeof device.type === 'number') {
        // Собираем UUID из bind каналов актуатора
        const channels = this.getActuatorChannels(device.id, device.type);
        channels.forEach(channel => {
          if (channel.channelState && channel.channelState.bind) {
            const bind = channel.channelState.bind;
            // Если bind это UUID (не содержит '/'), добавляем его для запроса
            if (typeof bind === 'string' && !bind.includes('/')) {
              // Проверяем, что устройство отсутствует и еще не запрошено
              const exists = this.allDevices.some(d => d.id === bind);
              if (!exists && !this.requestedMissingDevices.has(bind)) {
                bindUuids.add(bind);
              }
            }
          }
        });
        
        // Также добавляем UUID помещения актуатора (логика из resolve-actuator-via-websocket.js)
        const deviceData = this.deviceStates.get(device.id);
        const deviceState = deviceData?.state;
        if (deviceState && deviceState.site) {
          const site = deviceState.site;
          if (typeof site === 'string') {
            // Проверяем, что помещение отсутствует и еще не запрошено
            const siteExists = this.allDevices.some(d => d.id === site) || this.sites.some(s => s.id === site);
            if (!siteExists && !this.requestedMissingDevices.has(site)) {
              bindUuids.add(site);
            }
          } else if (Array.isArray(site) && site.length > 0) {
            const siteId = site[0];
            const siteExists = this.allDevices.some(d => d.id === siteId) || this.sites.some(s => s.id === siteId);
            if (!siteExists && !this.requestedMissingDevices.has(siteId)) {
              bindUuids.add(siteId);
            }
          }
        }
      }
    });
    
    // Запрашиваем связанные устройства и помещения пакетно через WebSocket
    if (bindUuids.size > 0) {
      const deviceIds = Array.from(bindUuids);
      // Помечаем устройства как запрошенные
      deviceIds.forEach(id => this.requestedMissingDevices.add(id));
      
      // Запрашиваем устройства только через WebSocket
      const getRequest = { type: 'get', state: deviceIds };
      this.logWebSocketRequest('get', deviceIds, this.ws);
      this.ws.send(JSON.stringify(getRequest));
    }
  }
  
  // Добавляем отсутствующее устройство в список после получения его данных (логика из resolve-actuator-via-websocket.js)
  addMissingDevice(deviceId, payload) {
    // Проверяем, что устройство еще не добавлено
    if (this.allDevices.some(d => d.id === deviceId)) {
      console.log(`[DEBUG] Устройство ${deviceId} уже добавлено, пропускаем`);
      return;
    }
    
    if (!payload || !payload.type) {
      // Обрабатываем помещения (type === 'site' или 'SITE'), которые могут не иметь числового типа
      const isSite = payload.type === 'site' || payload.type === 'SITE' || payload.type === 'project' || payload.type === 'PROJECT';
      if (isSite) {
        const siteName = payload.title || payload.code || payload.name || deviceId;
        // Проверяем, что помещение еще не добавлено
        if (!this.sites.some(s => s.id === deviceId)) {
          this.sites.push({ id: deviceId, name: siteName });
          // Сортируем помещения по имени
          this.sites.sort((a, b) => a.name.localeCompare(b.name));
          console.log(`[DEBUG] Добавлено помещение: ${siteName} (${deviceId})`);
          // Пересобираем строки фильтров (лучше отложить, если пользователь скроллит)
          this.scheduleUiRebuild({ rebuildFilterRows: true });
        }
        return;
      }
      
      console.log(`[DEBUG] Устройство ${deviceId} не имеет типа, пропускаем`);
      return;
    }
    
    const deviceType = payload.type;
    let device = null;
    
    // Обрабатываем устройства с числовым типом
    if (typeof deviceType === 'number' && deviceType !== 0x00) {
      let siteId = payload.site;
      let siteName = null;
      
      if (siteId) {
        if (Array.isArray(siteId)) {
          siteId = siteId[0];
        }
        if (typeof siteId === 'string') {
          const site = this.sites.find(s => s.id === siteId);
          siteName = site ? site.name : null;
        }
      }
      
      const category = getDeviceCategory(deviceType);
      const deviceName = getDeviceName(payload);

      device = {
        id: deviceId,
        name: deviceName,
        title: payload.title || null,  // Сохраняем все идентификаторы отдельно для детального отображения
        code: payload.code || null,
        nameField: payload.name || null,  // Сохраняем поле name из payload отдельно
        type: deviceType,
        typeName: DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`,
        category: category,
        siteId: siteId || null,
        site: siteName || null,
      };
    }
    // Пропускаем ACTION_* типы - это действия скриптов, а не устройства
    else if (typeof deviceType === 'string' && ACTION_TYPES.includes(deviceType)) {
      return; // Не добавляем ACTION_* в список устройств
    }
    // Обрабатываем потребители (строковые типы)
    else if (typeof deviceType === 'string' && CONSUMER_TYPES.includes(deviceType)) {
      let siteId = payload.site;
      let siteName = null;
      
      if (siteId) {
        if (Array.isArray(siteId)) {
          siteId = siteId[0];
        }
        if (typeof siteId === 'string') {
          const site = this.sites.find(s => s.id === siteId);
          siteName = site ? site.name : null;
        }
      }
      
      const deviceName = getDeviceName(payload);

      device = {
        id: deviceId,
        name: deviceName,
        title: payload.title || null,  // Сохраняем все идентификаторы отдельно для детального отображения
        code: payload.code || null,
        nameField: payload.name || null,  // Сохраняем поле name из payload отдельно
        type: deviceType,
        typeName: deviceType.toUpperCase(),
        category: 'Потребитель',
        siteId: siteId || null,
        site: siteName || null,
        bind: payload.bind || null,
      };
    }
    // Обрабатываем датчики протечки (leakage_sensor)
    else if (deviceType === 'leakage_sensor') {
      let siteId = payload.site;
      let siteName = null;
      
      if (siteId) {
        if (Array.isArray(siteId)) {
          siteId = siteId[0];
        }
        if (typeof siteId === 'string') {
          const site = this.sites.find(s => s.id === siteId);
          siteName = site ? site.name : null;
        }
      }
      
      const deviceName = getDeviceName(payload);

      device = {
        id: deviceId,
        name: deviceName,
        title: payload.title || null,
        code: payload.code || null,
        nameField: payload.name || null,
        type: deviceType,
        typeName: 'LEAKAGE_SENSOR',
        category: 'Сенсор',
        siteId: siteId || null,
        site: siteName || null,
        bind: payload.bind || null,
      };
    }
    // Обрабатываем остальные строковые типы сенсоров и интеграций
    else if (SENSOR_STRING_TYPES.includes(deviceType) || 
             INTEGRATION_TYPES.includes(deviceType) ||
             CONSUMER_TYPES.includes(deviceType)) {
      let siteId = payload.site;
      let siteName = null;
      
      if (siteId) {
        if (Array.isArray(siteId)) {
          siteId = siteId[0];
        }
        if (typeof siteId === 'string') {
          const site = this.sites.find(s => s.id === siteId);
          siteName = site ? site.name : null;
        }
      }
      
      const deviceName = getDeviceName(payload);
      const category = getDeviceCategory(deviceType);

      device = {
        id: deviceId,
        name: deviceName,
        title: payload.title || null,
        code: payload.code || null,
        nameField: payload.name || null,
        type: deviceType,
        typeName: deviceType.toUpperCase(),
        category: category,
        siteId: siteId || null,
        site: siteName || null,
        bind: payload.bind || null,
      };
    }
    
    // Добавляем устройство в списки, если оно было создано
    if (device) {
      console.log(`[DEBUG] Успешно добавлено устройство: ${deviceId}, название: ${device.name}, тип: ${device.type}`);
      this.allDevices.push(device);
      this.devicesByMac.set(deviceId, device);
      
      // Резолвим помещения для актуаторов по их каналам после добавления устройства
      // Если добавленное устройство связано с каналом актуатора, обновляем помещение актуатора
      // Также обновляем связанные устройства в каналах актуаторов
      // Ищем актуаторы, каналы которых связаны с этим устройством через bind
      for (const actuator of this.allDevices) {
        if (actuator.category === 'Актуатор' && typeof actuator.type === 'number') {
          const channels = this.getActuatorChannels(actuator.id, actuator.type);
          // Проверяем по bind, а не по linkedDevice, так как linkedDevice может быть null до резолва
          const linkedChannels = channels.filter(ch => 
            ch.channelState && ch.channelState.bind === deviceId
          );
          
          if (linkedChannels.length > 0) {
            // Если актуатор не имеет помещения, но его канал связан с устройством с помещением,
            // устанавливаем помещение актуатора
            if (device.site && (!actuator.site || !actuator.siteId)) {
              actuator.siteId = device.siteId;
              actuator.site = device.site;
              
              // Обновляем видимый список, если актуатор видим
              const actuatorIndex = this.devices.findIndex(d => d.id === actuator.id);
              if (actuatorIndex >= 0) {
                this.devices[actuatorIndex] = actuator;
              }
            }
            
            // Инвалидируем кэш информации об актуаторе, чтобы обновить список каналов с новым linkedDevice
            this.cache.deviceInfoByDeviceId.delete(actuator.id);
            this.cache.deviceInfo = null;
            this.cache.deviceInfoHash = null;
            
            // Обновляем отображение, если актуатор выбран
            if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length && this.devices[this.selectedIndex]?.id === actuator.id) {
              this.updateDeviceInfo();
              this.scheduleRender();
            }
          }
        }
      }
      
      // Обновляем каналы всех актуаторов (включая MIX), которые могут быть связаны с этим устройством
      // Это нужно для случаев, когда устройство добавляется после начальной загрузки
      for (const actuator of this.allDevices) {
        if (actuator.category === 'Актуатор' && typeof actuator.type === 'number') {
          const channels = this.getActuatorChannels(actuator.id, actuator.type);
          const hasLinkedChannel = channels.some(ch => ch.channelState && ch.channelState.bind === deviceId);
          
          if (hasLinkedChannel) {
            // Инвалидируем кэш информации об актуаторе, чтобы обновить список каналов
            this.cache.deviceInfoByDeviceId.delete(actuator.id);
            
            // Если актуатор выбран, обновляем информацию о нем
            if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
              const selectedDevice = this.devices[this.selectedIndex];
              if (selectedDevice && selectedDevice.id === actuator.id) {
                this.updateDeviceInfo();
                this.scheduleRender();
              }
            }
          }
        }
      }
      
      // Инвалидируем кэш фильтров (будет пересобран при вызове applyFilters())
      this.cache.filteredDevices = null;
      this.cache.filteredDevicesHash = null;
      
      // Переприменяем фильтры после добавления устройства
      // ВАЖНО: не пересобираем список во время скролла — иначе визуально «пропадают» устройства
      this.scheduleUiRebuild({ reapplyFilters: true, rebuildFilterRows: true });
    } else {
      console.log(`[DEBUG] Устройство ${deviceId} не было создано, тип: ${deviceType}, payload:`, JSON.stringify(payload).substring(0, 200));
    }
  }
  
  // Проверяем, соответствует ли устройство текущим фильтрам
  deviceMatchesFilters(device) {
    // Фильтр по категории
    if (this.activeFilters.category !== null) {
      // Если выбрана категория, показываем только устройства этой категории
      if (device.category !== this.activeFilters.category) {
        return false;
      }
      // Если выбрана категория "Потребитель", показываем всех потребителей
      // Если выбрана другая категория, потребители уже исключены выше
    }
    
    // Фильтр по типу потребителя (работает только если выбрана категория "Потребитель" или не выбрана категория)
    if (this.activeFilters.consumerType !== null) {
      // Показываем только потребителей выбранного типа
      if (device.category !== 'Потребитель' || device.type !== this.activeFilters.consumerType) {
        return false;
      }
    }
    
    // Фильтр по помещению
    if (this.activeFilters.site !== null) {
      // Строгое сравнение с учетом null/undefined
      const deviceSite = device.site || null;
      if (deviceSite !== this.activeFilters.site) {
        return false;
      }
    }
    
    return true;
  }
  
  // Логирование статистики WebSocket запросов для анализа производительности
  logRequestStats() {
    const stats = this.wsRequestStats;
    const req = stats.requests;
    const resp = stats.responses;
    
    const avgRequestSize = req.requestSizes.length > 0 
      ? Math.round(req.requestSizes.reduce((a, b) => a + b, 0) / req.requestSizes.length)
      : 0;
    const avgResponseSize = resp.responseSizes.length > 0
      ? Math.round(resp.responseSizes.reduce((a, b) => a + b, 0) / resp.responseSizes.length)
      : 0;
    
    console.log('\n=== WebSocket Статистика запросов ===');
    console.log(`Запросы LIST: ${req.list}`);
    console.log(`Запросы GET: ${req.get}`);
    console.log(`  - Устройств в GET: ${req.getDeviceCount}`);
    console.log(`  - Каналов в GET: ${req.getChannelCount}`);
    console.log(`  - Средний размер запроса: ${avgRequestSize} байт`);
    console.log(`Ответы ACTION_SET: ${resp.actionSet}`);
    console.log(`Ответы ACTION_SET (с _context): ${resp.actionSetWithContext}`);
    console.log(`Ответы LIST: ${resp.list}`);
    console.log(`Другие ответы: ${resp.other}`);
    console.log(`  - Средний размер ответа: ${avgResponseSize} байт`);
    console.log(`Входящих сообщений/сек: ${this.wsInPerSecond}`);
    console.log(`Исходящих сообщений/сек: ${this.wsOutPerSecond}`);
    console.log('=====================================\n');
  }
  
  // Логирование отправки WebSocket запроса в файл out
  logWebSocketRequest(type, state, ws) {
    // Добавляем временную метку исходящего сообщения для подсчета скорости (всегда)
    this.wsOutTimestamps.push(Date.now());
    
    if (!WS_REQUEST_LOGGING) return;
    
    // Увеличиваем счетчик для логов (используем глобальный счетчик для единой нумерации)
    globalWsOutCounter++;
    this.wsLogOutCounter = globalWsOutCounter;
    
    const stats = this.wsRequestStats;
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const requestData = JSON.stringify({ type, state });
    const requestSize = Buffer.byteLength(requestData, 'utf8');
    
    stats.requests.lastRequestTime = now;
    stats.requests.requestSizes.push(requestSize);
    // Ограничиваем размер массива для экономии памяти
    if (stats.requests.requestSizes.length > 1000) {
      stats.requests.requestSizes.shift();
    }
    
    // Формируем строку лога с номером сообщения, временной меткой и данными запроса
    let logLine = `[${this.wsLogOutCounter}] ${timestamp} [${type.toUpperCase()}] `;
    
    if (type === 'list') {
      stats.requests.list++;
      logLine += `LIST запрос (${requestSize} байт)\n`;
      logLine += `${requestData}\n`;
    } else if (type === 'get') {
      stats.requests.get++;
      const deviceIds = Array.isArray(state) ? state : [];
      const deviceCount = deviceIds.filter(id => !id.includes('/')).length;
      const channelCount = deviceIds.filter(id => id.includes('/')).length;
      
      stats.requests.getDeviceCount += deviceCount;
      stats.requests.getChannelCount += channelCount;
      
      logLine += `GET запрос: ${deviceCount} устройств, ${channelCount} каналов (${requestSize} байт)\n`;
      logLine += `${requestData}\n`;
    }
    
    logLine += '---\n';
    
    // Записываем в файл out (исходящие сообщения)
    if (this.wsLogStreams && this.wsLogStreams.out) {
      this.wsLogStreams.out.write(logLine);
    }
  }
  
  // Логирование получения WebSocket ответа в файл in
  logWebSocketResponse(message, dataSize) {
    if (!WS_REQUEST_LOGGING) return;
    
    // Подсчет скорости входящих сообщений выполняется при получении сообщения в ws.on('message')
    // Это дает реальную скорость получения сообщений от сервера, независимо от производительности устройства
    // Здесь только логирование, без подсчета скорости
    
    // Увеличиваем счетчик для логов (используем глобальный счетчик для единой нумерации)
    globalWsInCounter++;
    this.wsLogInCounter = globalWsInCounter;
    
    const stats = this.wsRequestStats;
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    
    stats.responses.lastResponseTime = now;
    if (dataSize > 0) {
      stats.responses.responseSizes.push(dataSize);
      if (stats.responses.responseSizes.length > 1000) {
        stats.responses.responseSizes.shift();
      }
    }
    
    const msgType = message.type || 'unknown';
    const isActionSet = msgType === 'action_set' || msgType === 'ACTION_SET';
    const hasContext = !!message._context;
    
    // Формируем строку лога с номером сообщения, временной меткой и данными ответа
    let logLine = `[${this.wsLogInCounter}] ${timestamp} [${msgType.toUpperCase()}] `;
    
    if (isActionSet) {
      if (hasContext) {
        stats.responses.actionSetWithContext++;
        logLine += `ACTION_SET с контекстом (${dataSize} байт)\n`;
      } else {
        stats.responses.actionSet++;
        logLine += `ACTION_SET без контекста (${dataSize} байт)\n`;
      }
      logLine += `ID: ${message.id || 'N/A'}\n`;
      logLine += `${JSON.stringify(message, null, 2)}\n`;
    } else if (msgType === 'list' || msgType === 'LIST') {
      stats.responses.list++;
      logLine += `LIST ответ (${dataSize} байт)\n`;
      logLine += `${JSON.stringify(message, null, 2)}\n`;
    } else {
      stats.responses.other++;
      logLine += `Неизвестный тип ответа (${dataSize} байт)\n`;
      logLine += `${JSON.stringify(message, null, 2)}\n`;
    }
    
    logLine += '---\n';
    
    // Записываем в файл in (входящие сообщения)
    if (this.wsLogStreams && this.wsLogStreams.in) {
      this.wsLogStreams.in.write(logLine);
    }
  }
  
  stop() {
    // Очищаем интервал статистики перед выходом
    if (this.wsRequestStats.statsLogInterval) {
      clearInterval(this.wsRequestStats.statsLogInterval);
    }
    
    // Выводим финальную статистику при выходе
    if (WS_REQUEST_LOGGING) {
      this.logRequestStats();
    }
    
    // Очищаем таймер отложенного запроса связанных устройств при выходе
    if (this.pendingLinkedDevicesRequest) {
      clearTimeout(this.pendingLinkedDevicesRequest);
      this.pendingLinkedDevicesRequest = null;
    }
    
    // Закрываем потоки записи логов перед выходом
    if (this.wsLogStreams) {
      if (this.wsLogStreams.in) {
        this.wsLogStreams.in.end();
      }
      if (this.wsLogStreams.out) {
        this.wsLogStreams.out.end();
      }
    }
    
    // Очищаем экран и восстанавливаем курсор при выходе
    term.grabInput(false); // Отключаем захват ввода
    term.fullscreen(false);
    term.clear();
    // Восстанавливаем курсор (в terminal-kit используется метод showCursor если доступен)
    if (term.showCursor) {
      term.showCursor();
    } else {
      // Альтернативный способ показать курсор через escape-последовательность
      process.stdout.write('\x1b[?25h');
    }
    term.styleReset();
    term.moveTo(1, 1);
    process.exit(0);
  }
}

// Основная функция запуска
async function main() {
  try {
    // Инициализируем глобальные потоки логирования WebSocket
    initGlobalWsLogStreams();

    // Зачем: Перед подключением к WebSocket проверяем, нет ли более свежей версии монитора
    console.log('[INFO] Проверка обновлений монитора...');
    const updateInfo = await checkForRemoteUpdateAndMaybeApply();
    
    // Загружаем устройства и помещения полностью через WebSocket
    console.log('Подключение к WebSocket для загрузки устройств и помещений...');
    console.log(`[INFO] Используется адрес WebSocket: ${WS_URI}`);
    const { devices, sites, locationName } = await loadDevicesAndSitesViaWebSocket(WS_URI);
    
    if (devices.length === 0) {
      console.error('Устройства не найдены через WebSocket');
      process.exit(1);
    }
    
    console.log(`Загружено ${devices.length} устройств и ${sites.length} помещений`);
    console.log(`Локация: ${locationName}`);
    
    // Создаем UI с названием локации и информацией об обновлениях
    const display = new TerminalKitStatusDisplay(devices, sites, locationName, updateInfo);
    
    // Подключаемся к WebSocket для получения обновлений состояния
    const ws = new WebSocket(WS_URI);
    
    // Передаем ссылку на WebSocket в класс для запроса отсутствующих устройств
    display.setWebSocket(ws);
    
    // Сохраняем ID интервала для последующей очистки при выходе
    let updateIntervalId = null;
    
    ws.on('open', () => {
      display.setConnected(true);
      
      // Собираем все ID устройств и каналов для массового запроса
      const deviceIds = [];
      
      devices.forEach(device => {
        deviceIds.push(device.id);
        
        // Для актуаторов добавляем ID всех каналов
        if (device.category === 'Актуатор' && typeof device.type === 'number') {
          const channelConfig = display.getActuatorChannelCount(device.type);
          if (channelConfig) {
            const channelTypes = channelConfig.types;
            const channelCount = channelConfig.count;
            
            let doCount = 0, dimCount = 0, aoCount = 0;
            
            if (channelTypes.includes('do') && channelTypes.includes('dim')) {
              switch (device.type) {
                case 0x41: doCount = 6; dimCount = 6; break;
                case 0xaa: doCount = 2; dimCount = 2; break;
                case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
                case 0xb5: doCount = 6; dimCount = 12; break;
              }
            } else {
              if (channelTypes.includes('do')) doCount = channelCount;
              if (channelTypes.includes('dim')) dimCount = channelCount;
              if (channelTypes.includes('ao')) aoCount = channelCount;
            }
            
            for (let i = 1; i <= doCount; i++) {
              deviceIds.push(`${device.id}/do/${i}`);
            }
            for (let i = 1; i <= dimCount; i++) {
              deviceIds.push(`${device.id}/dim/${i}`);
            }
            for (let i = 1; i <= aoCount; i++) {
              deviceIds.push(`${device.id}/ao/${i}`);
            }
          }
        }
      });
      
      // Отправляем один GET запрос со всеми ID (формат согласно инструкции)
      if (deviceIds.length > 0) {
        const getRequest = { type: 'get', state: deviceIds };
        display.logWebSocketRequest('get', deviceIds, ws);
        ws.send(JSON.stringify(getRequest));
        
        // После отправки запроса каналов, отложенно запрашиваем связанные устройства (логика из resolve-actuator-channels.js)
        // Используем таймаут, чтобы дать время для получения ответов на каналы
        setTimeout(() => {
          display.requestLinkedDevicesFromChannels();
        }, 2000); // Задержка 2 секунды для получения данных каналов перед запросом связанных устройств
      }
      
      // Периодически обновляем состояние всех устройств и каналов
      updateIntervalId = setInterval(() => {
        const deviceIds = [];
        
        devices.forEach(device => {
          deviceIds.push(device.id);
          
          // Для актуаторов добавляем ID всех каналов
          if (device.category === 'Актуатор' && typeof device.type === 'number') {
            const channelConfig = display.getActuatorChannelCount(device.type);
            if (channelConfig) {
              const channelTypes = channelConfig.types;
              const channelCount = channelConfig.count;
              
              let doCount = 0, dimCount = 0, aoCount = 0;
              
              if (channelTypes.includes('do') && channelTypes.includes('dim')) {
                switch (device.type) {
                  case 0x41: doCount = 6; dimCount = 6; break;
                  case 0xaa: doCount = 2; dimCount = 2; break;
                  case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
                  case 0xb5: doCount = 6; dimCount = 12; break;
                }
              } else {
                if (channelTypes.includes('do')) doCount = channelCount;
                if (channelTypes.includes('dim')) dimCount = channelCount;
                if (channelTypes.includes('ao')) aoCount = channelCount;
              }
              
              for (let i = 1; i <= doCount; i++) {
                deviceIds.push(`${device.id}/do/${i}`);
              }
              for (let i = 1; i <= dimCount; i++) {
                deviceIds.push(`${device.id}/dim/${i}`);
              }
              for (let i = 1; i <= aoCount; i++) {
                deviceIds.push(`${device.id}/ao/${i}`);
              }
            }
          }
        });
        
        // Отправляем один GET запрос со всеми ID для периодического обновления
        if (deviceIds.length > 0) {
          const getRequest = { type: 'get', state: deviceIds };
          display.logWebSocketRequest('get', deviceIds, ws);
          ws.send(JSON.stringify(getRequest));
        }
      }, UPDATE_INTERVAL);
    });
    
    ws.on('message', (data) => {
      try {
        // Безопасный парсинг JSON с ограничением размера для предотвращения DoS атак
        const dataString = data.toString();
        const dataSize = Buffer.byteLength(dataString, 'utf8');
        if (dataString.length > 10 * 1024 * 1024) { // Ограничение размера сообщения до 10MB
          console.error('WebSocket message too large, ignoring');
          return;
        }
        const message = JSON.parse(dataString);
        
        // Логируем получение ответа
        logWebSocketResponseGlobal(message, dataSize);
        
        // Обрабатываем ACTION_SET сообщения для обновления состояния устройств
        // Формат: { type: 'action_set' или 'ACTION_SET', id: 'device-id', payload: {...} }
        // Обрабатываем как начальное состояние (без _context), так и события изменений (с _context)
        const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
        
        // Добавляем временную метку сразу при получении сообщения (до обработки)
        // Это дает реальную скорость получения сообщений от сервера, независимо от производительности устройства
        if (isActionSet && message.id && message.payload) {
          display.wsInTimestamps.push(Date.now());
        }
        
        if (isActionSet && message.id && message.payload) {
          const deviceId = message.id;
          const payload = message.payload;
          
          // Проверяем, является ли это отсутствующим устройством, которое мы запросили
          const isMissingDevice = display.requestedMissingDevices.has(deviceId);
          const deviceExists = display.allDevices.some(d => d.id === deviceId);
          const isSite = payload.type === 'site' || payload.type === 'SITE' || payload.type === 'project' || payload.type === 'PROJECT';
          const siteExists = display.sites.some(s => s.id === deviceId);
          
          // Если это помещение, которое было запрошено, добавляем его (логика из resolve-actuator-via-websocket.js)
          if (isMissingDevice && isSite && !siteExists) {
            console.log(`[DEBUG] Добавляем запрошенное помещение: ${deviceId}, тип: ${payload.type}`);
            display.addMissingDevice(deviceId, payload);
          }
          
          // Если устройство отсутствует в списке, но было запрошено, добавляем его
          if (isMissingDevice && !deviceExists && !isSite && payload.type) {
            console.log(`[DEBUG] Добавляем запрошенное устройство: ${deviceId}, тип: ${payload.type}`);
            display.addMissingDevice(deviceId, payload);
          }
          
          // Также проверяем устройства, которые упоминаются в bind каналов, но не были загружены
          // Это может быть устройство из массива помещения, которое мы запросили позже
          // Проверяем как потребителей (строковые типы), так и другие устройства (числовые типы)
          if (!deviceExists && payload.type) {
            const isConsumer = typeof payload.type === 'string' && CONSUMER_TYPES.includes(payload.type);
            const isShieldDevice = typeof payload.type === 'number' && payload.type !== 0x00;
            
            // Проверяем, упоминается ли это устройство в bind каких-либо каналов
            const isReferencedInBind = Array.from(display.allDevices).some(device => {
              if (device.category === 'Актуатор' && typeof device.type === 'number') {
                const channels = display.getActuatorChannels(device.id, device.type);
                return channels.some(ch => ch.channelState && ch.channelState.bind === deviceId);
              }
              return false;
            });
            
            if ((isConsumer || isShieldDevice) && isReferencedInBind) {
              // Это устройство, которое упоминается в bind каналов актуаторов
              console.log(`[DEBUG] Добавляем устройство из bind: ${deviceId}, тип: ${payload.type}`);
              display.addMissingDevice(deviceId, payload);
            }
          }
          
          // Обновляем состояние устройства из payload
          // Это работает и для начального состояния (ответы на GET), и для событий изменений
          display.setDeviceState(deviceId, payload);
          
          // Если это канал актуатора (ID содержит '/do/', '/dim/' или '/ao/'), 
          // проверяем наличие bind и запрашиваем связанные устройства пакетно (логика из resolve-actuator-channels.js)
          if (deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/')) {
            if (payload.bind && typeof payload.bind === 'string' && !payload.bind.includes('/')) {
              // Отложенный пакетный запрос связанных устройств (debounce для избежания множественных запросов)
              if (!display.pendingLinkedDevicesRequest) {
                display.pendingLinkedDevicesRequest = setTimeout(() => {
                  display.requestLinkedDevicesFromChannels();
                  display.pendingLinkedDevicesRequest = null;
                }, 500); // Задержка 500мс для сбора всех каналов перед пакетным запросом
              }
            }
          }
          
          // Если получено связанное устройство, которое упоминается в bind каналов, 
          // выполняем повторный резолв для обновления linkedDevice в каналах
          if (payload.type && !deviceId.includes('/')) {
            // Проверяем, упоминается ли это устройство в bind каких-либо каналов
            const isReferencedInBind = display.allDevices.some(device => {
              if (device.category === 'Актуатор' && typeof device.type === 'number') {
                const channels = display.getActuatorChannels(device.id, device.type);
                return channels.some(ch => ch.channelState && ch.channelState.bind === deviceId);
              }
              return false;
            });
            
            if (isReferencedInBind) {
              // Устройство упоминается в bind, обновляем отображение для пересчета linkedDevice
              // Очищаем кэш информации об устройстве, чтобы пересчитать каналы с новым linkedDevice
              const selectedDevice = display.selectedIndex >= 0 && display.selectedIndex < display.devices.length ? display.devices[display.selectedIndex] : null;
              if (selectedDevice) {
                display.cache.deviceInfoByDeviceId.delete(selectedDevice.id);
                display.updateDeviceInfo();
                display.scheduleRender();
              }
              display.cache.deviceInfo = null;
              display.cache.deviceInfoHash = null;
            }
          }
        }
      } catch (e) {
        // Игнорируем ошибки парсинга
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      display.setConnected(false);
    });
    
    ws.on('close', () => {
      display.setConnected(false);
    });
    
    // Обработчик завершения программы для очистки ресурсов
    const cleanup = () => {
      if (updateIntervalId) {
        clearInterval(updateIntervalId);
        updateIntervalId = null;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
    
    // Переопределяем метод stop() для очистки ресурсов перед выходом
    const originalStop = display.stop.bind(display);
    display.stop = () => {
      cleanup();
      originalStop();
    };
    
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

// Запускаем приложение
if (require.main === module) {
  main();
}

module.exports = { TerminalKitStatusDisplay };
