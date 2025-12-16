#!/usr/bin/env node

/**
 * Улучшенная версия мониторинга с интерактивным терминальным UI
 * 
 * Этот файл использует библиотеки blessed и blessed-contrib для создания
 * интерактивного терминального интерфейса, похожего на PM2 dashboard.
 * 
 * Алгоритм получения устройств основан на документации:
 * @see docs/ENDPOINT_DEVICES_ALGORITHM.md
 * 
 * Для использования установите зависимости:
 *   npm install blessed blessed-contrib
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * ==============
 *   node scripts/monitor-shield-devices-status-ui-example.js
 * 
 * ИНТЕРФЕЙС:
 * ==========
 * Экран разделен на две вертикальные части:
 * - Слева: Дерево фильтров (типы устройств и помещения)
 * - Справа: Список устройств с параметрами
 * 
 * УПРАВЛЕНИЕ:
 * ===========
 * - Tab: Переключение между панелями (фильтры / устройства)
 * - Стрелки вверх/вниз или j/k: Навигация по списку
 * - Enter: Выбор фильтра в дереве / Показать попап с информацией об устройстве
 * - q или Ctrl+C: Выход
 * 
 * АЛГОРИТМ ПОЛУЧЕНИЯ УСТРОЙСТВ:
 * ==============================
 * 1. Загрузка из LevelDB: базовая информация (id, name, type, category, site)
 * 2. Подключение к WebSocket: получение актуального состояния (ready, ip, параметры)
 * 3. Обновление в реальном времени: периодические запросы GET каждые 3 секунды
 * 
 * ЛОГИКА ОБНОВЛЕНИЯ СТАТУСА:
 * ===========================
 * 
 * 1. ОТСЛЕЖИВАНИЕ ИЗМЕНЕНИЙ СОСТОЯНИЯ (метод updateDeviceState):
 *    - Сравнивает новое состояние со старым по ключевым полям:
 *      * ready, ip, co2, temperature, humidity, illumination
 *    - Если хотя бы одно поле изменилось → фиксируется изменение (lastStateChange обновляется)
 *    - Если состояние не изменилось → lastStateChange сохраняется (показывает время последнего реального изменения)
 *    - lastUpdate всегда обновляется при получении данных (даже если ничего не изменилось)
 * 
 * 2. ОПРЕДЕЛЕНИЕ СТАТУСА READY (методы updateTable и updateStats):
 *    - Логика: используется только поле state.ready
 *    - 🟢 Ready: state.ready === true
 *    - 🔴 Not ready: state.ready !== true (false, undefined, null)
 *    - ⚪ Ожидание: state отсутствует (данные еще не получены)
 * 
 *    ПРИМЕЧАНИЕ: Статус определяется по полю ready.
 *                Если устройство отправляет данные, но state.ready=false, оно будет
 *                показано как not ready.
 * 
 * 3. ОПТИМИЗАЦИЯ ОБНОВЛЕНИЙ:
 *    - Обновление таблицы происходит только если:
 *      * Устройство видимо (прошло активные фильтры)
 *      * Не идет навигация (флаг isNavigating === false)
 *    - Частота обновлений ограничена: не чаще раза в 100мс (throttling)
 *    - При обновлении сохраняется позиция курсора (selectedIndex)
 * 
 * 4. ОБНОВЛЕНИЕ СТАТИСТИКИ:
 *    - Считается только по отфильтрованным устройствам
 *    - Использует ту же упрощенную логику определения статуса
 *    - Показывает общее количество устройств в системе и количество показанных
 * 
 * ЗАЧЕМ:
 * ======
 * Интерактивный UI позволяет:
 * - Фильтровать устройства по типам (Актуатор, Сенсор, Панель, Конечное)
 * - Фильтровать устройства по помещениям
 * - Прокручивать список устройств (если их много)
 * - Выделять выбранное устройство
 * - Использовать клавиатуру для навигации
 * - Обновлять только измененные части экрана (без полной перерисовки)
 * - Видеть статистику по отфильтрованным устройствам
 * - Просматривать полную информацию об устройстве в попапе
 */

// Зачем: Откладываем загрузку blessed до проверки их наличия
let blessed, contrib;
const WebSocket = require('ws');
// Зачем: LevelDB используется как источник статической конфигурации устройств и помещений
// Это первый этап алгоритма получения устройств (см. docs/ENDPOINT_DEVICES_ALGORITHM.md):
// 1. LevelDB содержит базовую информацию: id, name, type, category, site (UUID помещения)
// 2. WebSocket предоставляет динамическое состояние: ready, ip, параметры (co2, temperature и т.д.)
// 3. Разделение источников позволяет: загрузить список всех устройств из БД один раз при старте,
//    а затем получать только изменяющиеся данные через WebSocket в реальном времени
const { Level } = require('level');
const path = require('path');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const UPDATE_INTERVAL = 3000;

// Типы устройств (щитовые)
// Зачем: Включаем все типы устройств, которые могут быть в БД
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab]; // Добавлен MIX_1 (0xab)
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0]; // Добавлен TEMPERATURE_EXT (0xf0)
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

// Зачем: Конечные устройства (Smart TOP, Smart BOTTOM и другие)
// Используем список из документации ENDPOINT_DEVICES_ALGORITHM.md
// Примечание: 0x25 (SMART_4G) относится к категории "Панель" (SHIELD_CONTROL_TYPES), а не к конечным устройствам
const ENDPOINT_DEVICE_TYPES = [
  0x26, // SMART_4GD
  0x27, // SMART_4A
  0x2a, // SMART_4AM
  0x2c, // SMART_6_PUSH
  0x30, // SMART_TOP_A6P
  0x31, // SMART_TOP_G4D
  0x32, // SMART_TOP_A4T
  0x33, // SMART_TOP_A6T
  0x34, // SMART_TOP_G6
  0x35, // SMART_TOP_G4
  0x36, // SMART_TOP_G2
  0x37, // SMART_TOP_A4P
  0x38, // SMART_TOP_A4TD
  0x39, // SMART_TOP_A4TD_7S
  0x3a, // SMART_BOTTOM_1
  0x3b, // SMART_BOTTOM_2
];

// Зачем: Все типы устройств для фильтрации
const ALL_DEVICE_TYPES = [...SHIELD_TYPES, ...ENDPOINT_DEVICE_TYPES];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x0a: 'DO8', 0x0b: 'DO16', 0x0e: 'DIM4', 0x0f: 'DIM8',
  0x20: 'DI_4', 0x23: 'RELAY_2', 0x25: 'SMART_4G', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa3: 'DIM_4', 0xa4: 'DIM_8',
  0xa5: 'LANAMP', 0xa7: 'RELAY_2_DIN', 0xa9: 'AO_4_DIN',
  0xac: 'MIX_1_RS', 0xad: 'DIM_12_LED_RS', 0xae: 'RELAY_12_RS', 0xaf: 'DIM_8_RS',
  0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb5: 'MIX_6x12_RS', 0xb6: 'DIM_1_AC_RS',
  // Зачем: Добавляем названия для конечных устройств
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
  // Зачем: Добавляем названия для дополнительных типов устройств, найденных в БД
  0xab: 'MIX_1', 0xf0: 'TEMPERATURE_EXT',
};

function isShieldDevice(type) {
  return SHIELD_TYPES.includes(type);
}

function isEndpointDevice(type) {
  return ENDPOINT_DEVICE_TYPES.includes(type);
}

function getDeviceName(device) {
  return device.title || device.code || device.name || 'без названия';
}

// Зачем: Получаем иконку для типа устройства для визуального отображения
// Поддерживает все категории: актуаторы, сенсоры, панели, конечные устройства, потребители
function getDeviceIcon(deviceType, category) {
  // Зачем: Для потребителей (строковые типы)
  if (typeof deviceType === 'string') {
    const consumerIconMap = {
      // Освещение
      'light_220': '💡',
      'light_LED': '💡',
      'light_led': '💡',
      'light_RGB': '🌈',
      
      // Розетки
      'socket_220': '🔌',
      
      // Клапаны
      'valve_heating': '🔧',
      'valve_water': '💧',
      
      // Тёплый пол
      'warm_floor': '🔥',
      
      // Кондиционер
      'AC': '❄️',
      
      // Вентилятор
      'FAN': '🌪️',
      'fan': '🌪️', // Зачем: Добавляем иконку для 'fan' (строчными) для совместимости
      
      // Котёл
      'BOILER': '🔥',
      
      // Насос
      'PUMP': '💧',
      
      // Статы
      'thermostat': '🌡️',
      'hygrostat': '💨',
      'co2_stat': '🌬️',
    };
    return consumerIconMap[deviceType] || '';
  }
  
  // Зачем: Для числовых типов устройств
  if (typeof deviceType === 'number') {
    // Зачем: Актуаторы (реле, диммеры, аналоговые выходы)
    if (category === 'Актуатор') {
      // Реле
      if ([0x0a, 0x0b, 0x23, 0xa0, 0xa1, 0xa2, 0xa7, 0xae].includes(deviceType)) {
        return '🔌'; // Реле
      }
      // Диммеры
      if ([0x0e, 0x0f, 0xa3, 0xa4, 0xa5, 0xaf, 0xad, 0xb3, 0xb4, 0xb6].includes(deviceType)) {
        return '💡'; // Диммер
      }
      // Аналоговые выходы
      if ([0xa9].includes(deviceType)) {
        return '📊'; // Аналоговый выход
      }
      // Смешанные устройства
      if ([0x41, 0xaa, 0xab, 0xac, 0xb5].includes(deviceType)) {
        return '🔀'; // Смешанное устройство
      }
      return '⚙️'; // Общая иконка для актуаторов
    }
    
    // Зачем: Сенсоры
    if (category === 'Сенсор') {
      // Температура/влажность
      if ([0x01, 0x02, 0x03, 0xf0].includes(deviceType)) {
        return '🌡️'; // Температура
      }
      // CO2
      if ([0x2b].includes(deviceType)) {
        return '🌬️'; // CO2
      }
      // Движение (Doppler)
      if ([0x04, 0x2d, 0x2e].includes(deviceType)) {
        return '👁️'; // Движение
      }
      // Цифровые входы
      if ([0x20, 0x2f].includes(deviceType)) {
        return '📥'; // Цифровой вход
      }
      return '📊'; // Общая иконка для сенсоров
    }
    
    // Зачем: Панели управления
    if (category === 'Панель') {
      if ([0x25].includes(deviceType)) {
        return '📱'; // SMART_4G
      }
      return '🖥️'; // Общая иконка для панелей
    }
    
    // Зачем: Конечные устройства (Smart TOP, Smart BOTTOM)
    if (category === 'Конечное') {
      if ([0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b].includes(deviceType)) {
        return '📱'; // Smart устройства
      }
      return '🔘'; // Общая иконка для конечных устройств
    }
    
    // Зачем: Другие устройства
    if (category === 'Другое') {
      return '❓'; // Иконка для неизвестных устройств
    }
  }
  
  return '';
}

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'Конечное';
  // Зачем: Если тип не определен, но это число - все равно показываем как "Другое"
  // Это позволит видеть все устройства, даже с неизвестными типами
  return 'Другое';
}

// Зачем: Типы потребителей (согласно документации ENDPOINT_DEVICES_ALGORITHM.md)
// Потребители имеют строковые типы, а не числовые
const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'fan', 'BOILER', 'PUMP', // Зачем: Добавляем 'fan' (строчными) для совместимости с устройствами типа 'fan'
  'thermostat', 'hygrostat', 'co2_stat'
];

// Зачем: Загружаем устройства и помещения за один проход по БД
// Используем алгоритм из ENDPOINT_DEVICES_ALGORITHM.md
// Согласно документации: поле site в устройстве содержит UUID помещения, а не название
async function getDevicesAndSitesFromDB() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const sites = [];
  const siteMap = new Map(); // Зачем: Маппинг UUID помещения -> название для быстрого поиска
  
  try {
    // Зачем: Сначала загружаем ВСЕ помещения, чтобы siteMap был заполнен
    // Это гарантирует, что при обработке устройств мы сможем найти название помещения по UUID
    // Исправление проблемы: если устройство обрабатывается раньше, чем его помещение попадает в siteMap,
    // siteName оставался null, и устройство не находилось по привязке к site
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Зачем: Загружаем помещения (Этап 1 из документации)
      // Согласно документации: Site имеет type === 'site' или 'SITE'
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || key;
        sites.push({
          id: key,
          name: siteName,
        });
        // Зачем: Сохраняем маппинг UUID -> название для резолвинга названия помещения у устройств
        siteMap.set(key, siteName);
      }
    }
    
    // Зачем: Теперь загружаем устройства, когда siteMap уже заполнен
    // Это гарантирует корректное определение названия помещения по UUID
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Зачем: Загружаем устройства (щитовые и конечные)
      // Фильтруем только устройства с числовым типом, которые не являются каналами (не содержат '/')
      // Исключаем тип 0x00 (DEVICE_TYPE_UNKNOWN) - это не реальные устройства
      if (typeof type === 'number' && !key.includes('/') && type !== 0x00) {
        // Зачем: Согласно документации, поле site в устройстве содержит UUID помещения
        // Может быть строкой (UUID одного помещения) или массивом (UUID нескольких помещений)
        let siteId = value.site;
        let siteName = null;
        
        // Зачем: Резолвим название помещения по UUID
        if (siteId) {
          if (Array.isArray(siteId)) {
            // Зачем: Если site - массив, берем первое помещение
            siteId = siteId[0];
          }
          if (typeof siteId === 'string') {
            // Зачем: Ищем название помещения по UUID в маппинге (теперь siteMap уже заполнен)
            siteName = siteMap.get(siteId) || null;
          }
        }
        
        const category = getDeviceCategory(type);
        const deviceIcon = getDeviceIcon(type, category);
        const deviceName = getDeviceName(value);
        const nameWithIcon = deviceIcon ? `${deviceIcon} ${deviceName}` : deviceName;
        
        devices.push({
          id: key,
          name: nameWithIcon, // Зачем: Добавляем иконку к имени устройства
          code: value.code || null, // Зачем: Сохраняем код устройства для поиска по помещению
          type: type,
          typeName: DEVICE_TYPE_NAMES[type] || `Тип0x${type.toString(16)}`,
          category: category,
          siteId: siteId || null, // UUID помещения (для фильтрации)
          site: siteName || null, // Название помещения (для отображения)
        });
      }
      
      // Зачем: Загружаем потребители (согласно документации ENDPOINT_DEVICES_ALGORITHM.md)
      // Потребители имеют строковые типы (light_220, warm_floor и т.д.), а не числовые
      if (typeof type === 'string' && CONSUMER_TYPES.includes(type) && !key.includes('/')) {
        let siteId = value.site;
        let siteName = null;
        
        // Зачем: Резолвим название помещения по UUID (аналогично обычным устройствам)
        if (siteId) {
          if (Array.isArray(siteId)) {
            siteId = siteId[0];
          }
          if (typeof siteId === 'string') {
            // Зачем: Ищем название помещения по UUID в маппинге (теперь siteMap уже заполнен)
            siteName = siteMap.get(siteId) || null;
          }
        }
        
        // Зачем: Получаем иконку для потребителя и добавляем к имени устройства
        const consumerIcon = getDeviceIcon(type, 'Потребитель');
        const deviceName = getDeviceName(value);
        const nameWithIcon = consumerIcon ? `${consumerIcon} ${deviceName}` : deviceName;
        
        devices.push({
          id: key,
          name: nameWithIcon, // Зачем: Добавляем иконку к имени устройства
          code: value.code || null, // Зачем: Сохраняем код устройства для поиска по помещению
          type: type,
          typeName: type.toUpperCase(), // Зачем: Для потребителей используем тип как название
          category: 'Потребитель',
          siteId: siteId || null,
          site: siteName || null,
          bind: value.bind || null, // Зачем: Сохраняем bind из БД для всех потребителей
        });
      }
    }
  } finally {
    await db.close();
  }
  
  // Зачем: Резолвим помещения для устройств, у которых нет привязки к помещению (site отсутствует)
  // но код/название устройства содержит название помещения
  // Это решает проблему, когда устройство не было привязано к помещению в БД, но имеет код/название с названием помещения
  // Пример: устройство с кодом "6.D.L.3 Лоджия" должно быть привязано к помещению "Лоджия"
  const siteNames = sites.map(s => s.name);
  for (const device of devices) {
    if (!device.site && !device.siteId) {
      // Зачем: Ищем помещение по коду/названию устройства
      const deviceName = device.name || '';
      const deviceCode = device.code || '';
      
      // Зачем: Проверяем, содержит ли код/название устройства название какого-либо помещения
      // Используем регистронезависимое сравнение
      for (const siteName of siteNames) {
        const nameContainsSite = deviceName.toLowerCase().includes(siteName.toLowerCase()) ||
                                 deviceCode.toLowerCase().includes(siteName.toLowerCase());
        
        if (nameContainsSite) {
          // Зачем: Находим UUID помещения по названию
          const site = sites.find(s => s.name === siteName);
          if (site) {
            device.siteId = site.id;
            device.site = siteName;
            // Зачем: Прерываем цикл после первого совпадения (берем первое найденное помещение)
            break;
          }
        }
      }
    }
  }
  
  // Зачем: Сортируем результаты для удобного отображения (как в документации)
  const sortedDevices = devices.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
  
  const sortedSites = sites.sort((a, b) => a.name.localeCompare(b.name));
  
  return { devices: sortedDevices, sites: sortedSites };
}

// Зачем: Функция для подсчета визуальной ширины строки в терминале
// Эмодзи и широкие символы (например, китайские иероглифы) занимают 2 символа
function getStringWidth(str) {
  if (!str) return 0;
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    // Зачем: Проверяем, является ли символ эмодзи или широким символом
    // Эмодзи обычно находятся в диапазонах:
    // - 0x1F300-0x1F9FF (Miscellaneous Symbols and Pictographs)
    // - 0x2600-0x26FF (Miscellaneous Symbols)
    // - 0x2700-0x27BF (Dingbats)
    // - 0xFE00-0xFE0F (Variation Selectors)
    // - 0x1F900-0x1F9FF (Supplemental Symbols and Pictographs)
    // - 0x1FA00-0x1FA6F (Chess Symbols)
    // - 0x1FA70-0x1FAFF (Symbols and Pictographs Extended-A)
    // Широкие символы (CJK): 0x1100-0x115F, 0x2329-0x232A, 0x2E80-0x303E, 0x3040-0xA4CF, 0xAC00-0xD7A3, 0xF900-0xFAFF, 0xFE10-0xFE19, 0xFE30-0xFE6F, 0xFF00-0xFF60, 0xFFE0-0xFFE6, 0x20000-0x2FFFD, 0x30000-0x3FFFD
    if (code >= 0x1F300 && code <= 0x1F9FF) {
      width += 2; // Эмодзи
      // Зачем: Пропускаем суррогатную пару для эмодзи
      if (code > 0xFFFF) i++;
    } else if (code >= 0x2600 && code <= 0x27BF) {
      width += 2; // Символы и эмодзи
    } else if (code >= 0xFE00 && code <= 0xFE0F) {
      width += 0; // Вариационные селекторы не добавляют ширину
    } else if ((code >= 0x1100 && code <= 0x115F) ||
               (code >= 0x2329 && code <= 0x232A) ||
               (code >= 0x2E80 && code <= 0x303E) ||
               (code >= 0x3040 && code <= 0xA4CF) ||
               (code >= 0xAC00 && code <= 0xD7A3) ||
               (code >= 0xF900 && code <= 0xFAFF) ||
               (code >= 0xFE10 && code <= 0xFE19) ||
               (code >= 0xFE30 && code <= 0xFE6F) ||
               (code >= 0xFF00 && code <= 0xFF60) ||
               (code >= 0xFFE0 && code <= 0xFFE6)) {
      width += 2; // Широкие символы (CJK)
    } else {
      width += 1; // Обычные символы
    }
  }
  return width;
}

// Зачем: Функция для обрезания строки с учетом визуальной ширины
// Обрезает строку до указанной ширины, учитывая что эмодзи занимают 2 символа
function truncateString(str, maxWidth) {
  if (!str) return '';
  if (getStringWidth(str) <= maxWidth) return str;
  
  let width = 0;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    let charWidth = 1;
    
    if (code >= 0x1F300 && code <= 0x1F9FF) {
      charWidth = 2;
      if (code > 0xFFFF) i++;
    } else if (code >= 0x2600 && code <= 0x27BF) {
      charWidth = 2;
    } else if ((code >= 0x1100 && code <= 0x115F) ||
               (code >= 0x2329 && code <= 0x232A) ||
               (code >= 0x2E80 && code <= 0x303E) ||
               (code >= 0x3040 && code <= 0xA4CF) ||
               (code >= 0xAC00 && code <= 0xD7A3) ||
               (code >= 0xF900 && code <= 0xFAFF) ||
               (code >= 0xFE10 && code <= 0xFE19) ||
               (code >= 0xFE30 && code <= 0xFE6F) ||
               (code >= 0xFF00 && code <= 0xFF60) ||
               (code >= 0xFFE0 && code <= 0xFFE6)) {
      charWidth = 2;
    }
    
    if (width + charWidth > maxWidth - 3) {
      // Зачем: Оставляем место для "..."
      result += '...';
      break;
    }
    
    if (code > 0xFFFF) {
      result += String.fromCodePoint(code);
      i++; // Пропускаем суррогатную пару
    } else {
      result += str[i];
    }
    width += charWidth;
  }
  
  return result;
}

// Зачем: Функция для заполнения строки пробелами до нужной визуальной ширины
// Это гарантирует полную перезапись старых данных и предотвращает артефакты
function padStringToWidth(str, targetWidth) {
  if (!str) str = '';
  const currentWidth = getStringWidth(str);
  if (currentWidth >= targetWidth) {
    return str;
  }
  // Зачем: Добавляем пробелы до нужной ширины для полной очистки старых данных
  return str + ' '.repeat(targetWidth - currentWidth);
}

// Класс для управления UI с blessed
class BlessedStatusDisplay {
  constructor(devices, sites) {
    // Зачем: Проверяем, что мы в интерактивном терминале
    if (!process.stdout.isTTY) {
      throw new Error('Требуется интерактивный терминал (TTY)');
    }
    
    this.deviceStates = new Map();
    this.isConnected = false;
    this.selectedIndex = 0;
    this.sites = sites;
    // Зачем: Сохраняем все загруженные устройства (только щитовые, уже отфильтрованы при загрузке)
    this.allDevices = devices;
    // Зачем: Кэш устройств по MAC-адресу для быстрого поиска актуаторов
    this.devicesByMac = new Map();
    devices.forEach(device => {
      // Зачем: MAC-адрес может быть в формате "xx:xx:xx:xx:xx:xx" или UUID
      // Сохраняем устройства по ID (который может быть MAC-адресом)
      this.devicesByMac.set(device.id, device);
    });
    // Зачем: Изначально показываем все устройства (фильтры не применены)
    this.devices = devices;
    
    // Зачем: Фильтры - выбранные категории, типы потребителей и помещения
    this.activeFilters = {
      category: null, // Актуатор, Сенсор, Панель или null (все)
      consumerType: null, // Тип потребителя (light_LED, light_RGB и т.д.) или null (все)
      site: null, // Название помещения или null (все)
    };
    
    // Зачем: Флаг для предотвращения обновления таблицы во время навигации
    this.isNavigating = false;
    this.lastUpdateTime = 0;
    
    // Зачем: Кэши для оптимизации производительности
    this.cache = {
      // Кэш отфильтрованных устройств (ключ - хеш фильтров)
      filteredDevices: null,
      filteredDevicesHash: null,
      
      // Кэш данных таблицы (ключ - хеш состояния устройств)
      tableData: null,
      tableDataHash: null,
      
      // Кэш информации об устройстве (ключ - deviceId + хеш состояния)
      deviceInfo: null,
      deviceInfoHash: null,
      
      // Зачем: Кеш информации об устройствах по deviceId для быстрого доступа при перемещении между устройствами
      // Ключ: deviceId, значение: { content: string, hash: string }
      deviceInfoByDeviceId: new Map(),
      
      // Зачем: Отслеживание параметров, которые когда-либо имели значения для каждого устройства
      // Ключ: deviceId, значение: Set<string> - множество имен параметров, которые когда-либо имели значения
      knownParameters: new Map(),
      
      // Кэш статистики (ключ - хеш состояния устройств)
      stats: null,
      statsHash: null,
    };
    
    // Создаем экран
    // Зачем: Отключаем перехват мыши (mouse: false), чтобы разрешить стандартное выделение текста в терминале
    // Навигация будет работать через клавиатуру (стрелки, j/k, Tab)
    // Зачем: Отключаем smartCSR и fastCSR для предотвращения артефактов букв на экране
    // smartCSR и fastCSR - оптимизации, которые могут вызывать "залипание" символов при частичном обновлении
    this.screen = blessed.screen({
      smartCSR: false, // Зачем: Отключаем оптимизацию для предотвращения артефактов - будет полный рендер
      fastCSR: false,  // Зачем: Отключаем быструю оптимизацию CSR для гарантированной полной перезаписи
      title: 'Мониторинг щитовых устройств',
      fullUnicode: true,
      autoPadding: true,
      mouse: false, // Зачем: Отключаем перехват мыши для разрешения стандартного выделения текста в терминале
    });
    
    // Зачем: Создаем grid layout - разделяем на три вертикальные части
    // Используем 16 колонок для точного распределения:
    // - Первая часть (фильтры): 2 колонки (2/16 = 1/8)
    // - Вторая часть (таблица): 9 колонок (9/16)
    // - Третья часть (параметры): 5 колонок (5/16 ≈ 1/3 экрана)
    this.grid = new contrib.grid({ rows: 12, cols: 16, screen: this.screen });
    
    // Заголовок с статусом подключения (на всю ширину)
    this.header = this.grid.set(0, 0, 1, 16, blessed.box, {
      content: '🟢 ПОДКЛЮЧЕНИЕ...',
      tags: true,
      style: {
        fg: 'green',
        bold: true,
      },
      border: {
        type: 'line',
      },
    });
    
    // Зачем: Левая панель - список фильтров (2 колонки из 16 = 1/8 экрана)
    // Используем list вместо tree для надежности
    this.filterList = this.grid.set(1, 0, 10, 2, blessed.list, {
      label: 'Фильтры',
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue', // Зачем: По умолчанию синий (будет обновляться при переключении)
      interactive: true,
      mouse: false, // Зачем: Отключаем перехват мыши для разрешения стандартного выделения текста в терминале
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        item: {
          fg: 'white',
        },
      },
    });
    
    // Зачем: Средняя панель - список устройств (6 колонок из 16)
    // Зачем: columnWidth должен соответствовать количеству столбцов (3: Название, Тип, Помещение)
    this.table = this.grid.set(1, 2, 10, 6, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue', // Зачем: По умолчанию синий для активной панели
      interactive: true,
      mouse: false, // Зачем: Отключаем перехват мыши для разрешения стандартного выделения текста в терминале
      label: 'Список устройств (y/c/Ctrl+C - копировать строку)',
      columnSpacing: 2,
      columnWidth: [30, 15, 15], // 3 столбца: Название, Тип, Помещение
      alwaysScroll: true, // Зачем: Включаем прокрутку для больших списков
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
          bold: true,
        },
      },
    });
    
    // Зачем: Отслеживаем изменения фокуса для обновления стилей
    this.filterList.on('focus', () => {
      this.updateFocusStyles('filterList');
    });
    
    this.filterList.on('blur', () => {
      // При потере фокуса фильтров, фокус переходит на таблицу
      if (this.screen.focused === this.table) {
        this.updateFocusStyles('table');
      }
    });
    
    this.table.on('focus', () => {
      this.updateFocusStyles('table');
    });
    
    this.table.on('blur', () => {
      // При потере фокуса таблицы, фокус переходит на фильтры
      if (this.screen.focused === this.filterList) {
        this.updateFocusStyles('filterList');
      }
    });
    
    // Зачем: Правая панель - параметры выбранного устройства (8 колонок из 16 = 1/2 экрана)
    this.deviceInfo = this.grid.set(1, 8, 10, 8, blessed.box, {
      label: 'Устройство (c - копировать всё)',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        inverse: true
      },
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'blue',
        },
      },
      keys: true,
      content: 'Выберите устройство для просмотра параметров',
    });
    
    // Зачем: Прокрутка в панели параметров
    this.deviceInfo.key(['up', 'k'], () => {
      this.deviceInfo.scroll(-1);
      this.screen.render();
    });
    
    this.deviceInfo.key(['down', 'j'], () => {
      this.deviceInfo.scroll(1);
      this.screen.render();
    });
    
    this.deviceInfo.key(['pageup'], () => {
      this.deviceInfo.scroll(-10);
      this.screen.render();
    });
    
    this.deviceInfo.key(['pagedown'], () => {
      this.deviceInfo.scroll(10);
      this.screen.render();
    });
    
    // Зачем: Копирование текста из панели параметров
    this.deviceInfo.key(['c'], () => {
      this.copyDeviceInfoToClipboard();
    });
    
    // Статистика внизу (на всю ширину)
    this.stats = this.grid.set(11, 0, 1, 16, blessed.box, {
      content: 'Загрузка...',
      tags: true,
      style: {
        fg: 'cyan',
      },
      border: {
        type: 'line',
      },
    });
    
    // Зачем: Панель параметров создается в grid выше, не нужно инициализировать здесь
    
    // Зачем: Строим дерево фильтров из категорий и помещений
    // Не вызываем render() здесь, он будет вызван в buildFilterTree
    this.buildFilterTree();
    
    // Обработка клавиш на уровне экрана
    // Зачем: C-c обрабатывается на уровне таблицы для копирования, здесь только для выхода когда фокус не на таблице
    this.screen.key(['escape', 'q'], () => {
      // Зачем: Очищаем интервал проверки выделения перед уничтожением экрана
      if (this.selectionCheckInterval) {
        clearInterval(this.selectionCheckInterval);
        this.selectionCheckInterval = null;
      }
      return this.screen.destroy();
    });
    
    // Зачем: Обработка C-c на уровне экрана - копируем если фокус на таблице, иначе выходим
    this.screen.key(['C-c'], () => {
      // Зачем: Если фокус на таблице, копируем строку
      if (this.screen.focused === this.table) {
        this.copyTableRowToClipboard();
        return;
      }
      // Зачем: Очищаем интервал проверки выделения перед уничтожением экрана
      if (this.selectionCheckInterval) {
        clearInterval(this.selectionCheckInterval);
        this.selectionCheckInterval = null;
      }
      return this.screen.destroy();
    });
    
    // Зачем: Обработка клавиш y и c на уровне экрана для копирования строки таблицы
    // Это резервный вариант на случай, если обработка на уровне таблицы не сработает
    this.screen.key(['y', 'c'], () => {
      if (this.screen.focused === this.table) {
        this.copyTableRowToClipboard();
      }
    });
    
    // Зачем: Добавляем глобальную обработку Tab для переключения между панелями
    // Переключаемся между фильтрами, таблицей и панелью параметров
    this.screen.key(['tab'], () => {
      if (this.screen.focused === this.filterList) {
        this.table.focus();
      } else if (this.screen.focused === this.table) {
        this.deviceInfo.focus();
      } else {
        this.filterList.focus();
      }
    });
    
    // Зачем: contrib.table имеет встроенную навигацию через стрелки вверх/вниз
    // Добавляем поддержку клавиш j/k для навигации (как в vim)
    // Используем правильный API blessed для обработки клавиш
    this.table.key('k', () => {
      // Зачем: Перемещаемся вверх по таблице
      this.isNavigating = true;
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        // Зачем: Обновляем панель параметров при навигации
        this.updateDeviceInfo();
      }
      // Зачем: Не обновляем таблицу при навигации, только синхронизируем позицию
      setImmediate(() => {
        this.isNavigating = false;
      });
    });
    
    this.table.key('j', () => {
      // Зачем: Перемещаемся вниз по таблице
      this.isNavigating = true;
      if (this.selectedIndex < this.devices.length - 1) {
        this.selectedIndex++;
        // Зачем: Обновляем панель параметров при навигации
        this.updateDeviceInfo();
      }
      // Зачем: Не обновляем таблицу при навигации, только синхронизируем позицию
      setImmediate(() => {
        this.isNavigating = false;
      });
    });
    
    // Зачем: Копирование выделенной строки таблицы в буфер обмена
    // Поддерживаем стандартные комбинации Ctrl+C/Cmd+C и клавишу 'y' (yank, как в vim)
    this.table.key(['y'], () => {
      this.copyTableRowToClipboard();
    });
    
    this.table.key(['c'], () => {
      this.copyTableRowToClipboard();
    });
    
    // Зачем: Обработка Ctrl+C/Cmd+C для копирования строки таблицы
    // Когда фокус на таблице, копируем строку, иначе выходим из приложения
    this.table.key(['C-c'], () => {
      this.copyTableRowToClipboard();
    });
    
    // Зачем: Альтернативная обработка через keypress для надежности
    this.table.on('keypress', (ch, key) => {
      // Зачем: Обрабатываем Ctrl+C / Cmd+C
      if (key && (key.name === 'c' && key.ctrl) || (key.name === 'c' && key.meta)) {
        this.copyTableRowToClipboard();
        return;
      }
      // Зачем: Обрабатываем клавиши y и c
      if (ch === 'y' || ch === 'c') {
        this.copyTableRowToClipboard();
        return;
      }
    });
    
    // Зачем: Отслеживаем встроенную навигацию таблицы (стрелки вверх/вниз)
    // contrib.table автоматически обрабатывает стрелки, нужно синхронизировать selectedIndex
    // Проверяем наличие метода для отслеживания выделения
    if (this.table.rows && typeof this.table.rows.on === 'function') {
      this.table.rows.on('select', (item, index) => {
        if (index !== undefined && index >= 0 && index < this.devices.length) {
          this.selectedIndex = index;
        }
      });
    }
    
    // Зачем: Отслеживаем изменения выделения через события таблицы
    // При изменении выделения обновляем панель параметров
    this.table.on('select', (item, index) => {
      if (index !== undefined && index >= 0 && index < this.devices.length) {
        this.selectedIndex = index;
        this.updateDeviceInfo();
      }
    });
    
    // Зачем: При выборе устройства обновляем панель параметров
    // Enter больше не нужен, так как параметры показываются автоматически
    
    // Зачем: Отслеживаем навигацию стрелками для сохранения позиции и обновления информации
    // contrib.table автоматически обрабатывает стрелки, нужно синхронизировать selectedIndex
    // Зачем: Используем более надежный подход - отслеживаем все клавиши навигации
    this.table.on('keypress', (ch, key) => {
      if (key && (key.name === 'up' || key.name === 'down' || key.name === 'pageup' || key.name === 'pagedown' || key.name === 'home' || key.name === 'end')) {
        // Зачем: При навигации стрелками обновляем selectedIndex после небольшой задержки
        // Это нужно для сохранения позиции при обновлении таблицы
        setImmediate(() => {
          try {
            if (this.table && this.table.rows && this.table.rows.selected !== undefined) {
              const currentSelected = this.table.rows.selected;
              if (currentSelected !== undefined && currentSelected >= 0 && currentSelected < this.devices.length) {
                // Зачем: Обновляем selectedIndex только если он изменился
                if (this.selectedIndex !== currentSelected) {
                  this.selectedIndex = currentSelected;
                  // Зачем: Обновляем панель параметров при изменении выделения стрелками
                  this.updateDeviceInfo();
                }
              }
            }
          } catch (e) {
            // Игнорируем ошибки
          }
        });
      }
    });
    
    // Зачем: Добавляем периодическую проверку изменений выделения для надежности
    // Это гарантирует обновление информации даже если события не срабатывают
    this.selectionCheckInterval = setInterval(() => {
      try {
        if (this.table && this.table.focused && this.table.rows && this.table.rows.selected !== undefined) {
          const currentSelected = this.table.rows.selected;
          if (currentSelected !== undefined && currentSelected >= 0 && currentSelected < this.devices.length) {
            // Зачем: Обновляем selectedIndex только если он изменился
            if (this.selectedIndex !== currentSelected) {
              this.selectedIndex = currentSelected;
              // Зачем: Обновляем панель параметров при изменении выделения
              this.updateDeviceInfo();
            }
          }
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    }, 100); // Зачем: Проверяем каждые 100мс для быстрой реакции на изменения
    
    // Зачем: Отслеживаем событие select для синхронизации selectedIndex и обновления информации
    if (this.table.rows && typeof this.table.rows.on === 'function') {
      this.table.rows.on('select', (item, index) => {
        if (index !== undefined && index >= 0 && index < this.devices.length) {
          // Зачем: Обновляем selectedIndex только если он изменился
          if (this.selectedIndex !== index) {
            this.selectedIndex = index;
            // Зачем: Обновляем панель параметров при изменении выделения
            this.updateDeviceInfo();
          }
        }
      });
    }
    
    // Зачем: Обработка выбора в списке фильтров
    this.filterList.on('select', (item, index) => {
      this.handleFilterSelect(item, index);
    });
    
    // Зачем: Добавляем поддержку Enter для выбора фильтра
    this.filterList.key(['enter', 'space'], () => {
      const selected = this.filterList.selected;
      if (selected !== undefined) {
        this.handleFilterSelect(this.filterList.items[selected], selected);
      }
    });
    
    // Зачем: Переключение фокуса между панелями уже обработано на уровне screen
    // Дублируем здесь для надежности
    this.filterList.key(['tab'], () => {
      this.table.focus();
    });
    
    this.table.key(['tab'], () => {
      this.filterList.focus();
    });
    
    // Зачем: Устанавливаем фокус на список фильтров по умолчанию (левая панель)
    // Откладываем на следующий тик, чтобы все виджеты были готовы
    setImmediate(() => {
      this.filterList.focus();
      this.updateFocusStyles('filterList');
    });
  }
  
  // Зачем: Обновляем стили выделения в зависимости от активной панели
  // Активная панель - синий, неактивная - серый
  updateFocusStyles(activePanel) {
    if (activePanel === 'filterList') {
      // Зачем: Активная панель фильтров - синее выделение
      this.filterList.style.selected = {
        bg: 'blue',
        fg: 'white',
        bold: true,
      };
      this.filterList.selectedFg = 'white';
      this.filterList.selectedBg = 'blue';
      
      // Зачем: Неактивная панель таблицы - серое выделение
      this.table.selectedBg = 'grey';
      this.table.selectedFg = 'white';
      if (this.table.style) {
        this.table.style.selected = {
          bg: 'grey',
          fg: 'white',
          bold: false,
        };
      }
    } else {
      // Зачем: Активная панель таблицы - синее выделение
      // Важно: обновляем все возможные свойства для contrib.table
      this.table.selectedBg = 'blue';
      this.table.selectedFg = 'white';
      if (this.table.style) {
        this.table.style.selected = {
          bg: 'blue',
          fg: 'white',
          bold: true,
        };
      }
      // Зачем: Также обновляем через rows, если доступно
      if (this.table.rows && this.table.rows.style) {
        this.table.rows.style.selected = {
          bg: 'blue',
          fg: 'white',
          bold: true,
        };
      }
      
      // Зачем: Неактивная панель фильтров - серое выделение
      this.filterList.style.selected = {
        bg: 'grey',
        fg: 'white',
        bold: false,
      };
      this.filterList.selectedFg = 'white';
      this.filterList.selectedBg = 'grey';
    }
    
    // Зачем: Перерисовываем для применения изменений
    this.screen.render();
  }
  
  // Зачем: Очищаем панель параметров для предотвращения артефактов букв
  // Заполняем видимую область пробелами для полной перезаписи старого контента
  clearDeviceInfoPanel() {
    if (this.deviceInfo && typeof this.deviceInfo.setContent === 'function') {
      const padWidth = Math.max(100, this.deviceInfo.width || 100);
      const padHeight = Math.max(50, this.deviceInfo.height || 50);
      const blankLine = ' '.repeat(padWidth);
      const blankBlock = Array(padHeight).fill(blankLine).join('\n');
      this.deviceInfo.setContent(blankBlock);
      this.deviceInfo.setScroll(0);
    }
  }
  
  // Зачем: Обновляем панель параметров устройства с кэшированием
  updateDeviceInfo() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.devices.length) {
      this.clearDeviceInfoPanel();
      this.deviceInfo.setContent('Выберите устройство для просмотра параметров');
      this.screen.render();
      return;
    }
    
    const device = this.devices[this.selectedIndex];
    const data = this.deviceStates.get(device.id);
    const state = data?.state;
    
    // Зачем: Проверяем кэш информации об устройстве
    // Зачем: Включаем value, initialized, online, ready в хеш для корректного кэширования
    // Зачем: Включаем bind для потребителей (может быть в состоянии или в устройстве)
    // Зачем: Включаем состояние каналов для актуаторов (для инвалидации кэша при изменении каналов)
    const deviceBind = (state && state.bind) || device.bind;
    
    // Зачем: Для актуаторов собираем хеш состояния всех каналов
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
      bind: deviceBind, // Зачем: Включаем bind для потребителей
      channels: channelsHash, // Зачем: Включаем хеш каналов для актуаторов
      lastUpdate: data.lastUpdate,
      lastStateChange: data.lastStateChange,
    }) : 'null';
    const deviceInfoHash = `${device.id}:${deviceStateHash}`;
    
    // Зачем: Сначала проверяем кеш по deviceId для быстрого доступа при перемещении между устройствами
    const cachedByDeviceId = this.cache.deviceInfoByDeviceId.get(device.id);
    if (cachedByDeviceId && cachedByDeviceId.hash === deviceInfoHash) {
      // Зачем: Информация об этом устройстве уже была вычислена и не изменилась - используем кеш
      // Зачем: Все равно очищаем панель перед выводом для предотвращения артефактов
      this.clearDeviceInfoPanel();
      this.deviceInfo.setContent(cachedByDeviceId.content);
      this.deviceInfo.setScroll(0);
      this.devicePopupText = cachedByDeviceId.text;
      this.cache.deviceInfo = cachedByDeviceId.content;
      this.cache.deviceInfoHash = deviceInfoHash;
      this.screen.render();
      return;
    }
    
    // Зачем: Проверяем общий кэш информации об устройстве
    if (this.cache.deviceInfo && this.cache.deviceInfoHash === deviceInfoHash) {
      // Зачем: Информация не изменилась, используем кэш
      // Зачем: Сохраняем в кеш по deviceId для быстрого доступа в будущем
      this.cache.deviceInfoByDeviceId.set(device.id, {
        content: this.cache.deviceInfo,
        hash: deviceInfoHash,
        text: this.devicePopupText || ''
      });
      // Зачем: Все равно очищаем панель перед выводом для предотвращения артефактов
      this.clearDeviceInfoPanel();
      this.deviceInfo.setContent(this.cache.deviceInfo);
      this.deviceInfo.setScroll(0);
      this.screen.render();
      return;
    }
    
    // Зачем: Формируем информацию об устройстве
    let info = [];
    info.push(`{bold}Информация об устройстве{/bold}`);
    info.push('');
    info.push(`{bold}Название:{/bold} ${device.name || '—'}`);
    info.push(`{bold}ID:{/bold} ${device.id}`);
    info.push(`{bold}Тип:{/bold} ${device.typeName} (${device.type})`);
    info.push(`{bold}Категория:{/bold} ${device.category || '—'}`);
    // Зачем: Согласно документации, поле site в устройстве содержит UUID помещения
    // Мы резолвим название помещения при загрузке, поэтому device.site уже содержит название
    info.push(`{bold}Помещение:{/bold} ${device.site || '—'}`);
    if (device.siteId && device.siteId !== device.site) {
      info.push(`{bold}UUID помещения:{/bold} ${device.siteId}`);
    }
    info.push('');
    info.push(`{bold}Статус подключения:{/bold}`);
    
    // Зачем: Всегда показываем стандартные поля статуса подключения, даже если state отсутствует
    // Это гарантирует, что список полей не меняется при обновлении состояния
    const stateValue = state?.value;
    const stateInitialized = state?.initialized;
    const stateOnline = state?.online;
    const stateReady = state?.ready;
    const stateIp = state?.ip;
    const stateLastUpdate = state?.lastUpdate || data?.lastUpdate;
    const stateLastStateChange = data?.lastStateChange;
    
    // Зачем: Всегда показываем все поля статуса подключения
    info.push(`  Value: ${stateValue !== undefined && stateValue !== null ? stateValue : '—'}`);
    info.push(`  Initialized: ${stateInitialized !== undefined && stateInitialized !== null ? (stateInitialized ? 'Да' : 'Нет') : '—'}`);
    info.push(`  Online: ${stateOnline !== undefined && stateOnline !== null ? (stateOnline ? 'Да' : 'Нет') : '—'}`);
    info.push(`  Ready: ${stateReady !== undefined && stateReady !== null ? (stateReady ? '🟢 Да' : '🔴 Нет') : '—'}`);
    info.push(`  IP-адрес: ${stateIp || '—'}`);
    
    // Зачем: Всегда показываем временные метки
    if (stateLastUpdate) {
      const dataAge = Math.floor((Date.now() - stateLastUpdate) / 1000);
      const ageStr = dataAge < 60 ? `${dataAge}с` : dataAge < 3600 ? `${Math.floor(dataAge / 60)}м` : `${Math.floor(dataAge / 3600)}ч`;
      info.push(`  Последнее обновление: ${ageStr} назад`);
    } else {
      info.push(`  Последнее обновление: —`);
    }
    
    if (stateLastStateChange) {
      const stateChangeAge = Math.floor((Date.now() - stateLastStateChange) / 1000);
      const changeAgeStr = stateChangeAge < 60 ? `${stateChangeAge}с` : stateChangeAge < 3600 ? `${Math.floor(stateChangeAge / 60)}м` : `${Math.floor(stateChangeAge / 3600)}ч`;
      info.push(`  Последнее изменение: ${changeAgeStr} назад`);
    } else {
      info.push(`  Последнее изменение: —`);
    }
      
    info.push('');
    info.push(`{bold}Параметры:{/bold}`);
    
    // Зачем: Получаем или создаем множество известных параметров для этого устройства
    // Параметры, которые когда-либо имели значения, будут показываться до следующего обновления
    if (!this.cache.knownParameters.has(device.id)) {
      this.cache.knownParameters.set(device.id, new Set());
    }
    const knownParams = this.cache.knownParameters.get(device.id);
    
    // Зачем: Вспомогательная функция для проверки, нужно ли показывать параметр
    // Показываем параметр, если он имеет текущее значение или был известен ранее
    const shouldShowParam = (paramName, paramValue) => {
      const hasValue = paramValue !== undefined && paramValue !== null;
      if (hasValue) {
        // Зачем: Если параметр имеет значение, добавляем его в известные
        knownParams.add(paramName);
        return true;
      }
      // Зачем: Показываем параметр, если он был известен ранее
      return knownParams.has(paramName);
    };
    
    // Зачем: Группируем параметры по категориям согласно документации
    // device-parameters-list-2025-12-10.md
    // Зачем: Показываем только параметры со значениями или которые когда-либо имели значения
    
    // === ПАРАМЕТРЫ СЕНСОРОВ ===
    const temp = state?.temperature;
    const hum = state?.humidity;
    const co2 = state?.co2;
    const illum = state?.illumination;
    const press = state?.pressure;
    const motion = state?.motion;
    const leak = state?.leakage;
    const smoke = state?.smoke;
    
    if (shouldShowParam('temperature', temp)) {
      info.push(`  Температура: ${temp !== undefined && temp !== null ? temp.toFixed(1) + '°C' : '—'}`);
    }
    if (shouldShowParam('humidity', hum)) {
      info.push(`  Влажность: ${hum !== undefined && hum !== null ? hum.toFixed(1) + '%' : '—'}`);
    }
    if (shouldShowParam('co2', co2)) {
      info.push(`  CO2: ${co2 !== undefined && co2 !== null ? co2 + ' ppm' : '—'}`);
    }
    if (shouldShowParam('illumination', illum)) {
      info.push(`  Освещённость: ${illum !== undefined && illum !== null ? illum + ' лк' : '—'}`);
    }
    if (shouldShowParam('pressure', press)) {
      info.push(`  Давление: ${press !== undefined && press !== null ? press : '—'}`);
    }
    if (shouldShowParam('motion', motion)) {
      info.push(`  Движение: ${motion !== undefined && motion !== null ? (motion ? 'Да' : 'Нет') : '—'}`);
    }
    if (shouldShowParam('leakage', leak)) {
      info.push(`  Протечка: ${leak !== undefined && leak !== null ? (leak ? 'Да' : 'Нет') : '—'}`);
    }
    if (shouldShowParam('smoke', smoke)) {
      info.push(`  Дым: ${smoke !== undefined && smoke !== null ? (smoke ? 'Да' : 'Нет') : '—'}`);
    }
      
    // Зачем: Специфичные параметры температуры из драйвера BB/PLC
    for (let i = 1; i <= 8; i++) {
      const airTemp = state?.[`t${i}_air_temperature`];
      const humidity = state?.[`t${i}_humidity`];
      const floorTemp = state?.[`t${i}_floor_temperature`];
      if (shouldShowParam(`t${i}_air_temperature`, airTemp)) {
        info.push(`  T${i} воздух: ${airTemp !== undefined && airTemp !== null ? airTemp.toFixed(1) + '°C' : '—'}`);
      }
      if (shouldShowParam(`t${i}_humidity`, humidity)) {
        info.push(`  T${i} влажность: ${humidity !== undefined && humidity !== null ? humidity.toFixed(1) + '%' : '—'}`);
      }
      if (shouldShowParam(`t${i}_floor_temperature`, floorTemp)) {
        info.push(`  T${i} пол: ${floorTemp !== undefined && floorTemp !== null ? floorTemp.toFixed(1) + '°C' : '—'}`);
      }
    }
    
    // === ПАРАМЕТРЫ АКТУАТОРОВ ===
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
      // Зачем: value для потребителей показываем в статусе подключения
      info.push(`  Value: ${value !== undefined && value !== null ? value : '—'}`);
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
    
    // Зачем: RGB компоненты (для RGB светильников)
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
      
    // Зачем: Параметры кондиционеров (из драйвера BB/PLC)
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
    
    // Зачем: Параметры вентиляции
    const ventPower = state?.vent_power;
    const ventFanSpeed = state?.vent_fan_speed;
    const ventDamper = state?.vent_damper;
    const hasVentParams = ventPower !== undefined || ventFanSpeed !== undefined || ventDamper !== undefined;
    
    if (shouldShowParam('vent_power', ventPower)) {
      info.push(`  Вент. мощность: ${ventPower !== undefined ? ventPower : '—'}`);
    }
    if (shouldShowParam('vent_fan_speed', ventFanSpeed)) {
      info.push(`  Вент. скорость: ${ventFanSpeed !== undefined ? ventFanSpeed : '—'}`);
    }
    if (shouldShowParam('vent_damper', ventDamper)) {
      info.push(`  Вент. заслонка: ${ventDamper !== undefined ? ventDamper : '—'}`);
    }
    
    // Зачем: Параметры тёплого пола
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
    
    // Зачем: Параметры реле вентиляции
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
    
    // === ПАРАМЕТРЫ СЧЁТЧИКОВ ===
    for (let i = 1; i <= 4; i++) {
      const counter = state?.[`water_counter_${i}`];
      if (shouldShowParam(`water_counter_${i}`, counter)) {
        info.push(`  Счётчик воды ${i}: ${counter !== undefined && counter !== null ? counter : '—'}`);
      }
    }
    
    // === ПАРАМЕТРЫ ЭЛЕКТРОПИТАНИЯ ===
    const voltA = state?.voltage_phase_a;
    const voltB = state?.voltage_phase_b;
    const voltC = state?.voltage_phase_c;
    const currA = state?.current_phase_a;
    const currB = state?.current_phase_b;
    const currC = state?.current_phase_c;
    const powA = state?.power_phase_a;
    const powB = state?.power_phase_b;
    const powC = state?.power_phase_c;
    
    if (shouldShowParam('voltage_phase_a', voltA)) {
      info.push(`  Напряжение A: ${voltA !== undefined ? voltA + 'В' : '—'}`);
    }
    if (shouldShowParam('voltage_phase_b', voltB)) {
      info.push(`  Напряжение B: ${voltB !== undefined ? voltB + 'В' : '—'}`);
    }
    if (shouldShowParam('voltage_phase_c', voltC)) {
      info.push(`  Напряжение C: ${voltC !== undefined ? voltC + 'В' : '—'}`);
    }
    if (shouldShowParam('current_phase_a', currA)) {
      info.push(`  Ток A: ${currA !== undefined ? currA + 'А' : '—'}`);
    }
    if (shouldShowParam('current_phase_b', currB)) {
      info.push(`  Ток B: ${currB !== undefined ? currB + 'А' : '—'}`);
    }
    if (shouldShowParam('current_phase_c', currC)) {
      info.push(`  Ток C: ${currC !== undefined ? currC + 'А' : '—'}`);
    }
    if (shouldShowParam('power_phase_a', powA)) {
      info.push(`  Мощность A: ${powA !== undefined ? powA + 'Вт' : '—'}`);
    }
    if (shouldShowParam('power_phase_b', powB)) {
      info.push(`  Мощность B: ${powB !== undefined ? powB + 'Вт' : '—'}`);
    }
    if (shouldShowParam('power_phase_c', powC)) {
      info.push(`  Мощность C: ${powC !== undefined ? powC + 'Вт' : '—'}`);
    }
    
    // === СПЕЦИАЛЬНЫЕ ПАРАМЕТРЫ ===
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
    
    // === ПАРАМЕТРЫ ПАНЕЛЕЙ ===
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
    
    // === ОШИБКИ ===
    const error = state?.error;
    if (shouldShowParam('error', error)) {
      info.push(`  Ошибка: ${error !== undefined && error !== null ? error : '—'}`);
    }
    
    // Зачем: Показываем все остальные поля состояния, которые не были отображены выше
    // Зачем: Исключаем поля, которые уже показаны отдельно согласно device-parameters-list-2025-12-10.md
    if (state) {
      const excludedKeys = [
        // Системные поля
        'initialized', 'ip', 'online', 'ready', 'timestamp', 'lastUpdate', 'lastStateChange',
        // Параметры сенсоров (уже показаны)
        'co2', 'temperature', 'humidity', 'illumination', 'pressure', 'motion', 'leakage', 'smoke',
        // Параметры актуаторов (уже показаны)
        'value', 'brightness', 'r', 'g', 'b', 'fan_speed', 'mode', 'direction', 'setpoint',
        // Параметры кондиционеров (уже показаны)
        'acc1_power', 'acc1_mode', 'acc1_fan_speed', 'acc1_vane_position',
        'acc2_power', 'acc2_mode', 'acc2_fan_speed', 'acc2_vane_position',
        'acc3_power', 'acc3_mode', 'acc3_fan_speed', 'acc3_vane_position',
        'acc4_power', 'acc4_mode', 'acc4_fan_speed', 'acc4_vane_position',
        // Параметры вентиляции (уже показаны)
        'vent_power', 'vent_fan_speed', 'vent_damper',
        // Параметры тёплого пола (уже показаны)
        'room1_set_point', 'room2_set_point', 'room3_set_point', 'room4_set_point',
        'room5_set_point', 'room6_set_point', 'room7_set_point', 'room8_set_point',
        'room1_floor_power', 'room2_floor_power', 'room4_floor_power',
        'room6_floor_power', 'room7_floor_power', 'room8_floor_power',
        // Параметры реле (уже показаны)
        'ventilator_relay_k1', 'ventilator_relay_k6', 'ventilator_relay_k7', 'ventilator_relay_k8',
        // Параметры счётчиков (уже показаны)
        'water_counter_1', 'water_counter_2', 'water_counter_3', 'water_counter_4',
        // Параметры электропитания (уже показаны)
        'voltage_phase_a', 'voltage_phase_b', 'voltage_phase_c',
        'current_phase_a', 'current_phase_b', 'current_phase_c',
        'power_phase_a', 'power_phase_b', 'power_phase_c',
        // Специальные параметры (уже показаны)
        'executed', 'last_execution', 'error',
        // Параметры панелей (уже показаны)
        'button_states', 'display_content',
        // Параметры температуры BB/PLC (уже показаны)
        't1_air_temperature', 't1_humidity', 't1_floor_temperature',
        't2_air_temperature', 't2_humidity', 't2_floor_temperature',
        't3_air_temperature', 't3_humidity',
        't4_air_temperature', 't4_humidity', 't4_floor_temperature',
        't5_air_temperature', 't5_humidity',
        't6_air_temperature', 't6_humidity', 't6_floor_temperature',
        't7_air_temperature', 't7_humidity', 't7_floor_temperature',
        't8_air_temperature', 't8_humidity', 't8_floor_temperature',
        // Метаданные (не логируются как параметры)
        'bind', 'id', 'name', 'code', 'title', 'type', 'parent', 'site', 'project', 'mac'
      ];
      
      const otherFields = Object.keys(state).filter(key => !excludedKeys.includes(key));
      const fieldsToShow = otherFields.filter(key => {
        const value = state[key];
        return shouldShowParam(key, value);
      });
      
      if (fieldsToShow.length > 0) {
        info.push('');
        info.push(`{bold}Дополнительные параметры:{/bold}`);
        fieldsToShow.forEach(key => {
          const value = state[key];
          // Зачем: Форматируем вывод в зависимости от типа значения
          if (value !== undefined && value !== null) {
            if (typeof value === 'object') {
              info.push(`  ${key}: ${JSON.stringify(value, null, 2).split('\n').join('\n    ')}`);
            } else {
              info.push(`  ${key}: ${value}`);
            }
          } else {
            info.push(`  ${key}: —`);
          }
        });
      }
      
      // Зачем: Показываем timestamp из состояния (если есть)
      if (state.timestamp !== undefined && state.timestamp !== null) {
        info.push('');
        info.push(`{bold}Временные метки:{/bold}`);
        const timestampDate = new Date(state.timestamp);
        info.push(`  Timestamp: ${timestampDate.toLocaleString('ru-RU')} (${state.timestamp})`);
      }
    } else {
      // Зачем: Если state отсутствует, все равно показываем секцию временных меток
      info.push('');
      info.push(`{bold}Временные метки:{/bold}`);
      info.push(`  Timestamp: —`);
    }
    
    // Зачем: Показываем связь потребителя с актуатором согласно документации
      // Зачем: Проверяем для всех потребителей (по категории или по типу из CONSUMER_TYPES)
      // Согласно документации, все потребители могут иметь bind: light_220, light_LED, light_RGB, 
      // socket_220, valve_heating, valve_water, warm_floor, AC, FAN, BOILER, PUMP
      const isConsumer = device.category === 'Потребитель' || 
                         (typeof device.type === 'string' && CONSUMER_TYPES.includes(device.type));
      // Зачем: bind может быть в состоянии (из WebSocket) или в устройстве (из БД)
      const bindValue = (state && state.bind) || device.bind;
      
      if (isConsumer && bindValue) {
        info.push('');
        info.push(`{bold}Связь с актуатором:{/bold}`);
        // Зачем: Используем bind из состояния или из устройства для получения связи
        const stateWithBind = state ? { ...state, bind: bindValue } : { bind: bindValue };
        const binding = this.getConsumerActuatorBinding(device.id, stateWithBind);
        if (binding) {
          info.push(`  Bind: ${bindValue}`);
          info.push(`  Актуатор: ${binding.actuatorName || binding.actuatorId}`);
          if (binding.actuatorType) {
            info.push(`  Тип актуатора: ${DEVICE_TYPE_NAMES[binding.actuatorType] || `Тип${binding.actuatorType}`} (${binding.actuatorType})`);
          }
          info.push(`  Канал: ${binding.channelType}/${binding.channelIndex}`);
          if (binding.channelState) {
            const channelValue = binding.channelState.value !== undefined ? binding.channelState.value : '—';
            info.push(`  Состояние канала: ${channelValue}`);
          } else {
            info.push(`  Состояние канала: — (данные не получены)`);
          }
        } else {
          info.push(`  Bind: ${bindValue}`);
          info.push(`  ⚠️  Актуатор не найден в БД`);
        }
      } else if (isConsumer) {
        // Зачем: Показываем, что потребитель не привязан к актуатору
        info.push('');
        info.push(`{bold}Связь с актуатором:{/bold}`);
        info.push(`  ⚠️  Не привязан к актуатору (bind отсутствует)`);
      }
    
    // Зачем: Показываем каналы актуатора и связанные устройства
    const isActuator = device.category === 'Актуатор' && typeof device.type === 'number';
    if (isActuator) {
        const channels = this.getActuatorChannels(device.id, device.type);
        if (channels.length > 0) {
          info.push('');
          info.push(`{bold}Каналы актуатора:{/bold}`);
          
          // Зачем: Группируем каналы по типу для удобного отображения
          const channelsByType = {};
          channels.forEach(channel => {
            if (!channelsByType[channel.channelType]) {
              channelsByType[channel.channelType] = [];
            }
            channelsByType[channel.channelType].push(channel);
          });
          
          // Зачем: Выводим каналы по типам (do, dim, ao)
          Object.keys(channelsByType).sort().forEach(channelType => {
            const typeChannels = channelsByType[channelType];
            const typeName = channelType === 'do' ? 'Реле' : channelType === 'dim' ? 'Диммер' : channelType === 'ao' ? 'Аналоговый' : channelType;
            
            info.push(`  {bold}${typeName} каналы ({cyan-fg}${channelType}{/cyan-fg}):{/bold}`);
            
            typeChannels.forEach(channel => {
              const channelValue = channel.channelState && channel.channelState.value !== undefined 
                ? channel.channelState.value 
                : '—';
              const channelValueStr = channel.channelType === 'dim' 
                ? `${channelValue} (0-255)` 
                : channel.channelType === 'do' 
                  ? (channelValue ? 'ВКЛ' : 'ВЫКЛ')
                  : `${channelValue}`;
              
              info.push(`    ${channel.channelType}/${channel.channelIndex}: ${channelValueStr}`);
              
              if (channel.linkedDevice) {
                info.push(`      → ${channel.linkedDevice.name || channel.linkedDevice.id} (${channel.linkedDevice.typeName || channel.linkedDevice.type})`);
                if (channel.linkedDevice.site) {
                  info.push(`        Помещение: ${channel.linkedDevice.site}`);
                }
              } else if (channel.channelState && channel.channelState.bind) {
                info.push(`      → ⚠️  Устройство не найдено (bind: ${channel.channelState.bind})`);
              } else {
                info.push(`      → (не привязан)`);
              }
            });
          });
        } else {
          // Зачем: Если каналы не найдены, но это актуатор, показываем информацию
          const channelConfig = this.getActuatorChannelCount(device.type);
          if (channelConfig) {
            info.push('');
            info.push(`{bold}Каналы актуатора:{/bold}`);
            info.push(`  Типы каналов: ${channelConfig.types.join(', ')}`);
            info.push(`  Количество: ${channelConfig.count}`);
            info.push(`  ⚠️  Состояние каналов не получено (данные не загружены через WebSocket)`);
          }
        }
      }
    
    // Зачем: Добавляем подсказку в панель параметров о горячих клавишах
    info.push('');
    info.push('{bold}Управление:{/bold}');
    info.push('  c - Копировать в буфер обмена');
    info.push('  ↑/↓ или j/k - Прокрутка');
    
    const deviceInfoContent = info.join('\n');
    
    // Зачем: Сохраняем текст для копирования (без форматирования blessed)
    this.devicePopupText = info.map(line => {
      // Зачем: Убираем форматирование blessed ({bold}, {/bold} и т.д.)
      return line
        .replace(/\{bold\}/g, '')
        .replace(/\{\/bold\}/g, '')
        .replace(/\{[^}]+\}/g, '');
    }).join('\n');
    
    // Зачем: Сохраняем информацию об устройстве в кэш
    this.cache.deviceInfo = deviceInfoContent;
    this.cache.deviceInfoHash = deviceInfoHash;
    
    // Зачем: Сохраняем в кеш по deviceId для быстрого доступа при перемещении между устройствами
    // Это позволяет мгновенно показывать информацию при возврате к уже просмотренному устройству
    this.cache.deviceInfoByDeviceId.set(device.id, {
      content: deviceInfoContent,
      hash: deviceInfoHash,
      text: this.devicePopupText
    });
    
    // Зачем: Полностью очищаем панель перед выводом нового текста для предотвращения артефактов
    this.clearDeviceInfoPanel();
    
    // Зачем: Устанавливаем новый контент после очистки
    this.deviceInfo.setContent(deviceInfoContent);
    this.deviceInfo.setScroll(0);
    
    if (this.screen && !this.screen.destroyed) {
      this.screen.render();
    }
  }
  
  // Зачем: Копируем содержимое выделенной строки таблицы в буфер обмена
  // Позволяет быстро скопировать данные устройства из таблицы
  copyTableRowToClipboard() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.devices.length) {
      return;
    }
    
    const device = this.devices[this.selectedIndex];
    if (!device) return;
    
    // Зачем: Формируем текст строки таблицы для копирования
    // Используем тот же формат, что отображается в таблице
    const deviceName = device.name || '—';
    const typeName = device.typeName || '—';
    const site = device.site || '—';
    
    // Зачем: Формируем строку в формате таблицы (разделитель - табуляция для удобства вставки в Excel/таблицы)
    const tableRow = `${deviceName}\t${typeName}\t${site}`;
    
    // Зачем: Также формируем читаемый формат
    const readableFormat = `Название: ${deviceName}\nТип: ${typeName}\nПомещение: ${site}`;
    
    // Зачем: Используем читаемый формат для копирования
    const textToCopy = readableFormat;
    
    // Зачем: Определяем команду для копирования в буфер обмена в зависимости от ОС
    const { exec } = require('child_process');
    const { spawn } = require('child_process');
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    const isWindows = process.platform === 'win32';
    
    // Зачем: Используем spawn вместо exec для более надежной работы с данными
    if (isMac) {
      // macOS: используем pbcopy через spawn для надежности
      const pbcopy = spawn('pbcopy', []);
      pbcopy.stdin.write(textToCopy);
      pbcopy.stdin.end();
      
      // Зачем: Показываем уведомление о копировании
      const notification = blessed.box({
        top: 'center',
        left: 'center',
        width: 35,
        height: 3,
        content: '✅ Строка скопирована в буфер обмена',
        align: 'center',
        valign: 'middle',
        style: {
          bg: 'green',
          fg: 'white',
          bold: true
        }
      });
      this.screen.append(notification);
      this.screen.render();
      
      // Зачем: Убираем уведомление через 2 секунды
      setTimeout(() => {
        notification.detach();
        this.screen.render();
      }, 2000);
    } else if (isLinux) {
      // Linux: используем xclip или xsel
      const xclip = spawn('sh', ['-c', `echo ${JSON.stringify(textToCopy)} | xclip -selection clipboard 2>/dev/null || echo ${JSON.stringify(textToCopy)} | xsel --clipboard --input 2>/dev/null || true`]);
      xclip.on('close', (code) => {
        if (code === 0) {
          const notification = blessed.box({
            top: 'center',
            left: 'center',
            width: 35,
            height: 3,
            content: '✅ Строка скопирована в буфер обмена',
            align: 'center',
            valign: 'middle',
            style: {
              bg: 'green',
              fg: 'white',
              bold: true
            }
          });
          this.screen.append(notification);
          this.screen.render();
          
          setTimeout(() => {
            notification.detach();
            this.screen.render();
          }, 2000);
        } else {
          console.log('\n=== Строка таблицы (для копирования) ===');
          console.log(textToCopy);
          console.log('========================================\n');
        }
      });
    } else if (isWindows) {
      // Windows: используем clip
      const clip = spawn('clip', []);
      clip.stdin.write(textToCopy);
      clip.stdin.end();
      
      const notification = blessed.box({
        top: 'center',
        left: 'center',
        width: 35,
        height: 3,
        content: '✅ Строка скопирована в буфер обмена',
        align: 'center',
        valign: 'middle',
        style: {
          bg: 'green',
          fg: 'white',
          bold: true
        }
      });
      this.screen.append(notification);
      this.screen.render();
      
      setTimeout(() => {
        notification.detach();
        this.screen.render();
      }, 2000);
    } else {
      // Неизвестная ОС - выводим в консоль
      console.log('\n=== Строка таблицы (для копирования) ===');
      console.log(textToCopy);
      console.log('========================================\n');
    }
  }
  
  // Зачем: Копируем информацию об устройстве в буфер обмена
  copyDeviceInfoToClipboard() {
    // Зачем: Получаем полное содержимое панели для копирования
    // Используем сохраненный текст или получаем из текущего контента панели
    let textToCopy = this.devicePopupText;
    
    if (!textToCopy) {
      // Зачем: Если текст не сохранен, получаем его из текущего контента панели
      if (this.deviceInfo && this.deviceInfo.content) {
        // Зачем: Убираем форматирование blessed из контента панели
        textToCopy = this.deviceInfo.content
          .replace(/\{bold\}/g, '')
          .replace(/\{\/bold\}/g, '')
          .replace(/\{[^}]+\}/g, '');
      }
    }
    
    // Зачем: Если текст все еще отсутствует, формируем базовую информацию
    if (!textToCopy) {
      const device = this.devices[this.selectedIndex];
      if (!device) return;
      const data = this.deviceStates.get(device.id);
      const state = data?.state;
      
      // Зачем: Формируем базовый текст для копирования
      let text = [];
      text.push(`Информация об устройстве`);
      text.push('');
      text.push(`Название: ${device.name || '—'}`);
      text.push(`ID: ${device.id}`);
      text.push(`Тип: ${device.typeName} (${device.type})`);
      text.push(`Категория: ${device.category || '—'}`);
      text.push(`Помещение: ${device.site || '—'}`);
      if (device.siteId && device.siteId !== device.site) {
        text.push(`UUID помещения: ${device.siteId}`);
      }
      text.push('');
      text.push(`Статус подключения:`);
      
      if (state) {
        const isReady = state.ready === true;
        text.push(`  Ready: ${isReady ? 'Да' : 'Нет'}`);
        text.push(`  IP-адрес: ${state.ip || '—'}`);
        
        if (state.lastUpdate) {
          const dataAge = Math.floor((Date.now() - state.lastUpdate) / 1000);
          const ageStr = dataAge < 60 ? `${dataAge}с` : dataAge < 3600 ? `${Math.floor(dataAge / 60)}м` : `${Math.floor(dataAge / 3600)}ч`;
          text.push(`  Последнее обновление: ${ageStr} назад`);
        }
        
        text.push('');
        text.push(`Параметры:`);
        
        if (state.co2 !== undefined && state.co2 !== null) {
          text.push(`  CO2: ${state.co2} ppm`);
        }
        if (state.temperature !== undefined && state.temperature !== null) {
          text.push(`  Температура: ${state.temperature.toFixed(1)}°C`);
        }
        if (state.humidity !== undefined && state.humidity !== null) {
          text.push(`  Влажность: ${state.humidity.toFixed(1)}%`);
        }
        if (state.illumination !== undefined && state.illumination !== null) {
          text.push(`  Освещенность: ${state.illumination}`);
        }
      } else {
        text.push('  Данные не получены');
      }
      
      textToCopy = text.join('\n');
    }
    
    if (!textToCopy) return;
    
    // Зачем: Используем spawn вместо exec для более надежного копирования многострочного текста
    const { spawn } = require('child_process');
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';
    const isWindows = process.platform === 'win32';
    
    let copyProcess;
    if (isMac) {
      // macOS: используем pbcopy
      copyProcess = spawn('pbcopy', []);
    } else if (isLinux) {
      // Linux: используем xclip или xsel
      copyProcess = spawn('sh', ['-c', 'xclip -selection clipboard 2>/dev/null || xsel --clipboard --input 2>/dev/null || cat > /dev/null']);
    } else if (isWindows) {
      // Windows: используем clip
      copyProcess = spawn('clip', []);
    } else {
      // Неизвестная ОС - выводим в консоль
      console.log('\n=== Информация об устройстве (для копирования) ===');
      console.log(textToCopy);
      console.log('==================================================\n');
      return;
    }
    
    // Зачем: Записываем текст в stdin процесса копирования
    copyProcess.stdin.write(textToCopy);
    copyProcess.stdin.end();
    
    // Зачем: Обрабатываем результат копирования
    copyProcess.on('close', (code) => {
      if (code === 0 || isLinux) {
        // Зачем: Показываем уведомление о копировании
        const notification = blessed.box({
          top: 'center',
          left: 'center',
          width: 35,
          height: 3,
          content: '✅ Всё содержимое скопировано в буфер обмена',
          align: 'center',
          valign: 'middle',
          style: {
            bg: 'green',
            fg: 'white',
            bold: true
          }
        });
        this.screen.append(notification);
        this.screen.render();
        
        // Зачем: Убираем уведомление через 2 секунды
        setTimeout(() => {
          notification.detach();
          this.screen.render();
        }, 2000);
      } else {
        // Зачем: Если команда не сработала, выводим в консоль
        console.log('\n=== Информация об устройстве (для копирования) ===');
        console.log(textToCopy);
        console.log('==================================================\n');
      }
    });
    
    copyProcess.on('error', (error) => {
      // Зачем: Если процесс не запустился, выводим в консоль
      console.log('\n=== Информация об устройстве (для копирования) ===');
      console.log(textToCopy);
      console.log('==================================================\n');
    });
  }
  
  // Зачем: Определяет количество каналов актуатора по типу устройства
  // Используется для получения всех каналов актуатора
  getActuatorChannelCount(deviceType) {
    // Зачем: Маппинг типов актуаторов на количество каналов и их типы
    const channelConfigs = {
      // Реле (do каналы)
      0x0a: { count: 8, types: ['do'] },   // DO8
      0x0b: { count: 16, types: ['do'] },   // DO16
      0x11: { count: 12, types: ['do'] },   // DO12
      0x23: { count: 2, types: ['do'] },   // RELAY_2
      0xa0: { count: 6, types: ['do'] },   // RELAY_6
      0xa1: { count: 12, types: ['do'] },   // RELAY_12
      0xa2: { count: 24, types: ['do'] },   // RELAY_24
      0xa7: { count: 2, types: ['do'] },   // RELAY_2_DIN
      0xae: { count: 12, types: ['do'] },   // RELAY_12_RS
      
      // Диммеры (dim каналы)
      0x0e: { count: 4, types: ['dim'] },   // DIM4
      0x0f: { count: 8, types: ['dim'] },   // DIM8
      0xa3: { count: 4, types: ['dim'] },   // DIM_4
      0xa4: { count: 8, types: ['dim'] },   // DIM_8
      0xa5: { count: 8, types: ['dim'] },   // LANAMP (8 каналов dim)
      0xaf: { count: 8, types: ['dim'] },   // DIM_8_RS
      0xad: { count: 12, types: ['dim'] },   // DIM_12_LED_RS
      0xb3: { count: 12, types: ['dim'] },   // DIM_12_AC_RS
      0xb4: { count: 12, types: ['dim'] },   // DIM_12_DC_RS
      0xb6: { count: 1, types: ['dim'] },   // DIM_1_AC_RS
      
      // Аналоговые выходы (ao каналы)
      0xa9: { count: 4, types: ['ao'] },   // AO_4_DIN
      
      // Смешанные устройства (do и dim каналы)
      0x0c: { count: 8, types: ['do'] },   // DI16_DO8 (только do каналы)
      0x0d: { count: 8, types: ['do'] },   // DO8_DI16 (только do каналы)
      0x41: { count: 6, types: ['do', 'dim'] },   // MIX_H (6 do + 6 dim)
      0xaa: { count: 2, types: ['do', 'dim'] },   // MIX_2 (2 do + 2 dim)
      0xab: { count: 1, types: ['do', 'dim'] },   // MIX_1 (1 do + 1 dim)
      0xac: { count: 1, types: ['do', 'dim'] },   // MIX_1_RS (1 do + 1 dim)
      0xb5: { count: 6, types: ['do', 'dim'] },   // MIX_6x12_RS (6 do + 12 dim)
    };
    
    return channelConfigs[deviceType] || null;
  }
  
  // Зачем: Получает все каналы актуатора с их состоянием и связанными устройствами
  // Используется для отображения информации о каналах в попапе актуатора
  getActuatorChannels(actuatorId, deviceType) {
    const channelConfig = this.getActuatorChannelCount(deviceType);
    if (!channelConfig) return [];
    
    const channels = [];
    const channelTypes = channelConfig.types;
    const channelCount = channelConfig.count;
    
    // Зачем: Для смешанных устройств нужно определить количество каналов каждого типа
    let doCount = 0;
    let dimCount = 0;
    let aoCount = 0;
    
    if (channelTypes.includes('do') && channelTypes.includes('dim')) {
      // Смешанные устройства: MIX_H, MIX_2, MIX_1, MIX_1_RS, MIX_6x12_RS
      switch (deviceType) {
        case 0x41: // MIX_H
          doCount = 6;
          dimCount = 6;
          break;
        case 0xaa: // MIX_2
          doCount = 2;
          dimCount = 2;
          break;
        case 0xab: // MIX_1
        case 0xac: // MIX_1_RS
          doCount = 1;
          dimCount = 1;
          break;
        case 0xb5: // MIX_6x12_RS
          doCount = 6;
          dimCount = 12;
          break;
      }
    } else {
      // Однотипные устройства
      if (channelTypes.includes('do')) doCount = channelCount;
      if (channelTypes.includes('dim')) dimCount = channelCount;
      if (channelTypes.includes('ao')) aoCount = channelCount;
    }
    
    // Зачем: Собираем все каналы актуатора
    for (let i = 1; i <= doCount; i++) {
      const channelId = `${actuatorId}/do/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      // Зачем: Ищем связанное устройство через bind канала
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
      }
      
      channels.push({
        channelId: channelId,
        channelType: 'do',
        channelIndex: i,
        channelState: channelState,
        linkedDevice: linkedDevice
      });
    }
    
    for (let i = 1; i <= dimCount; i++) {
      const channelId = `${actuatorId}/dim/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      // Зачем: Ищем связанное устройство через bind канала
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
      }
      
      channels.push({
        channelId: channelId,
        channelType: 'dim',
        channelIndex: i,
        channelState: channelState,
        linkedDevice: linkedDevice
      });
    }
    
    for (let i = 1; i <= aoCount; i++) {
      const channelId = `${actuatorId}/ao/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      // Зачем: Ищем связанное устройство через bind канала
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
      }
      
      channels.push({
        channelId: channelId,
        channelType: 'ao',
        channelIndex: i,
        channelState: channelState,
        linkedDevice: linkedDevice
      });
    }
    
    return channels;
  }
  
  // Зачем: Получаем информацию о связи потребителя с актуатором согласно документации
  // Согласно ENDPOINT_DEVICES_ALGORITHM.md, поле bind имеет формат "MAC-адрес/тип/индекс"
  // Поддерживает все типы каналов: do (реле), dim (диммер), ao (аналоговый выход), rgb (RGB)
  getConsumerActuatorBinding(consumerId, state) {
    if (!state || !state.bind) return null;
    
    try {
      // Зачем: Парсим bind: "MAC-адрес/тип/индекс"
      const parts = state.bind.split('/');
      if (parts.length < 3) return null;
      
      const [deviceMac, channelType, channelIndex] = parts;
      
      if (!deviceMac || !channelType || !channelIndex) {
        return null;
      }
      
      // Зачем: Ищем актуатор по MAC-адресу в загруженных устройствах
      let actuator = this.devicesByMac.get(deviceMac);
      
      // Зачем: Если не нашли в кэше, пытаемся найти в allDevices
      if (!actuator) {
        actuator = this.allDevices.find(d => d.id === deviceMac);
        // Зачем: Если нашли, добавляем в кэш для следующих запросов
        if (actuator) {
          this.devicesByMac.set(deviceMac, actuator);
        }
      }
      
      // Зачем: Получаем состояние канала из deviceStates
      // Канал имеет ID в формате "MAC-адрес/тип/индекс" (например, "68:27:19:e4:49:17/do/1")
      const channelId = state.bind;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      // Зачем: Формируем информацию о связи, даже если актуатор не найден
      // Это позволяет показать bind и предупреждение, если актуатор отсутствует
      const binding = {
        consumerId: consumerId,
        actuatorId: deviceMac,
        actuatorType: actuator?.type || null,
        actuatorName: actuator?.name || deviceMac,
        channelId: channelId,
        channelType: channelType,  // 'do', 'dim', 'ao', 'rgb'
        channelIndex: parseInt(channelIndex, 10),
        channelState: channelState,
        bind: state.bind
      };
      
      // Зачем: Если актуатор не найден, возвращаем null для показа предупреждения
      // Но можно вернуть binding с null actuatorType для отображения bind
      return binding;
    } catch (e) {
      // Зачем: Игнорируем ошибки парсинга
      console.error('Ошибка при парсинге bind:', e);
      return null;
    }
  }
  
  // Зачем: Метод больше не нужен, так как попап заменен на постоянную панель
  // Оставляем для совместимости, но он ничего не делает
  hideDevicePopup() {
    // Зачем: Панель параметров всегда видна, не нужно скрывать
  }
  
  // Зачем: Строим список фильтров с категориями и помещениями
  buildFilterTree() {
    try {
      const items = [];
      this.filterMapping = {};
      
      // Зачем: Добавляем секцию типов устройств
      items.push('📦 Типы устройств');
      
      // Зачем: Определяем, какой фильтр категории выбран
      const selectedCategory = this.activeFilters.category;
      const typeAllIndex = items.length;
      const typeAllChecked = selectedCategory === null ? '☑' : '☐';
      items.push(`  ${typeAllChecked} Все`);
      this.filterMapping[typeAllIndex] = { category: null };
      
      const typeActuatorIndex = items.length;
      const typeActuatorChecked = selectedCategory === 'Актуатор' ? '☑' : '☐';
      items.push(`  ${typeActuatorChecked} Актуатор`);
      this.filterMapping[typeActuatorIndex] = { category: 'Актуатор' };
      
      const typeSensorIndex = items.length;
      const typeSensorChecked = selectedCategory === 'Сенсор' ? '☑' : '☐';
      items.push(`  ${typeSensorChecked} Сенсор`);
      this.filterMapping[typeSensorIndex] = { category: 'Сенсор' };
      
      const typePanelIndex = items.length;
      const typePanelChecked = selectedCategory === 'Панель' ? '☑' : '☐';
      items.push(`  ${typePanelChecked} Панель`);
      this.filterMapping[typePanelIndex] = { category: 'Панель' };
      
      // Зачем: Добавляем секцию потребителей с иконкой
      items.push('');
      items.push('⚡ Потребители');
      
      // Зачем: Определяем, какой фильтр типа потребителя выбран
      const selectedConsumerType = this.activeFilters.consumerType;
      const consumerAllIndex = items.length;
      const consumerAllChecked = selectedConsumerType === null ? '☑' : '☐';
      items.push(`  ${consumerAllChecked} Все`);
      this.filterMapping[consumerAllIndex] = { consumerType: null };
      
      // Зачем: Добавляем типы потребителей с маппингом и чекбоксами
      const consumerTypeNames = {
        'light_220': 'light_220',
        'light_LED': 'light_LED',
        'light_RGB': 'light_RGB',
        'light_led': 'light_led',
        'socket_220': 'socket_220',
        'valve_heating': 'valve_heating',
        'valve_water': 'valve_water',
        'warm_floor': 'warm_floor',
        'AC': 'AC',
        'FAN': 'FAN',
        'BOILER': 'BOILER',
        'PUMP': 'PUMP',
        'thermostat': 'thermostat',
        'hygrostat': 'hygrostat',
        'co2_stat': 'co2_stat'
      };
      
      // Зачем: Добавляем только те типы потребителей, которые есть в системе
      const existingConsumerTypes = new Set(
        this.allDevices
          .filter(d => d.category === 'Потребитель')
          .map(d => d.type)
      );
      
      Object.entries(consumerTypeNames).forEach(([type, name]) => {
        if (existingConsumerTypes.has(type)) {
          const consumerTypeIndex = items.length;
          const consumerTypeChecked = selectedConsumerType === type ? '☑' : '☐';
          items.push(`  ${consumerTypeChecked} ${name}`);
          this.filterMapping[consumerTypeIndex] = { consumerType: type };
        }
      });
      
      // Зачем: Добавляем секцию помещений
      items.push('');
      items.push('🏠 Помещения');
      
      // Зачем: Определяем, какой фильтр помещения выбран
      const selectedSite = this.activeFilters.site;
      const siteAllIndex = items.length;
      const siteAllChecked = selectedSite === null ? '☑' : '☐';
      items.push(`  ${siteAllChecked} Все`);
      this.filterMapping[siteAllIndex] = { site: null };
      
      // Зачем: Добавляем помещения с маппингом и чекбоксами
      this.sites.forEach(site => {
        const siteIndex = items.length;
        const siteChecked = selectedSite === site.name ? '☑' : '☐';
        items.push(`  ${siteChecked} ${site.name}`);
        this.filterMapping[siteIndex] = { site: site.name };
      });
      
      this.filterList.setItems(items);
      // Зачем: Инициализируем таблицу с пустыми данными
      this.updateTable();
      this.updateStats();
      // Зачем: Обновляем панель параметров при изменении фильтров
      if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
        this.updateDeviceInfo();
      } else if (this.devices.length > 0) {
        // Зачем: Если индекс вне границ, выбираем первое устройство
        this.selectedIndex = 0;
        this.updateDeviceInfo();
      } else {
        // Зачем: Если устройств нет, показываем сообщение
        this.deviceInfo.setContent('Нет устройств для отображения');
        this.screen.render();
      }
    } catch (error) {
      console.error('Ошибка при построении дерева фильтров:', error);
      throw error;
    }
  }
  
  // Зачем: Обрабатываем выбор фильтра в списке
  handleFilterSelect(item, index) {
    // Зачем: Проверяем маппинг по индексу (индексы в blessed.list начинаются с 0)
    const filter = this.filterMapping[index];
    if (filter) {
      if (filter.category !== undefined) {
        // Зачем: Применяем фильтр категории (или сбрасываем, если выбран "Все")
        this.activeFilters.category = filter.category;
        // Зачем: При выборе категории сбрасываем фильтр потребителей
        if (filter.category !== null) {
          this.activeFilters.consumerType = null;
        }
        this.applyFilters();
      } else if (filter.consumerType !== undefined) {
        // Зачем: Применяем фильтр типа потребителя (или сбрасываем, если выбран "Все")
        this.activeFilters.consumerType = filter.consumerType;
        // Зачем: При выборе типа потребителя сбрасываем фильтр категорий
        if (filter.consumerType !== null) {
          this.activeFilters.category = null;
        }
        this.applyFilters();
      } else if (filter.site !== undefined) {
        // Зачем: Применяем фильтр помещения (или сбрасываем, если выбран "Все")
        this.activeFilters.site = filter.site;
        this.applyFilters();
      }
    }
    // Зачем: Игнорируем выбор заголовков секций и пустых строк
    // buildFilterTree() уже вызван в applyFilters(), поэтому чекбоксы обновятся автоматически
  }
  
  // Зачем: Вычисляем хеш фильтров для кэширования
  getFiltersHash() {
    return JSON.stringify(this.activeFilters);
  }
  
  // Зачем: Вычисляем хеш состояния устройств для кэширования
  getDevicesStateHash() {
    const stateHashes = [];
    for (const device of this.devices) {
      const data = this.deviceStates.get(device.id);
      if (data && data.state) {
        // Зачем: Используем только ключевые поля для хеша (ready, ip, параметры)
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
  
  // Зачем: Применяем активные фильтры к списку устройств с кэшированием
  applyFilters() {
    // Зачем: Проверяем кэш отфильтрованных устройств
    const filtersHash = this.getFiltersHash();
    if (this.cache.filteredDevices && this.cache.filteredDevicesHash === filtersHash) {
      this.devices = this.cache.filteredDevices;
      // Зачем: Обновляем только таблицу и статистику, фильтры не изменились
      this.updateTable();
      this.updateStats();
      if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
        this.updateDeviceInfo();
      }
      return;
    }
    
    // Зачем: Фильтруем устройства
    this.devices = this.allDevices.filter(device => {
      // Зачем: Фильтр по категории (Актуатор, Сенсор, Панель)
      // Не применяем к потребителям, так как у них отдельный фильтр
      if (this.activeFilters.category !== null) {
        if (device.category !== this.activeFilters.category) {
          return false;
        }
        // Зачем: Если выбрана категория, исключаем потребителей
        if (device.category === 'Потребитель') {
          return false;
        }
      }
      
      // Зачем: Фильтр по типу потребителя
      if (this.activeFilters.consumerType !== null) {
        // Зачем: Показываем только потребителей выбранного типа
        if (device.category !== 'Потребитель' || device.type !== this.activeFilters.consumerType) {
          return false;
        }
      } else if (this.activeFilters.category !== null) {
        // Зачем: Если выбрана категория, но не выбран тип потребителя - исключаем потребителей
        // (они показываются только при явном выборе типа или когда ничего не выбрано)
        if (device.category === 'Потребитель') {
          return false;
        }
      }
      
      // Зачем: Фильтр по помещению
      if (this.activeFilters.site !== null) {
        if (device.site !== this.activeFilters.site) {
          return false;
        }
      }
      
      return true;
    });
    
    // Сбрасываем выбранный индекс, если он выходит за границы
    if (this.selectedIndex >= this.devices.length) {
      this.selectedIndex = Math.max(0, this.devices.length - 1);
    }
    
    // Зачем: Обновляем список фильтров, чтобы показать выбранные чекбоксы
    this.buildFilterTree();
    this.updateTable();
    this.updateStats();
    // Зачем: Обновляем панель параметров при применении фильтров
    if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
      this.updateDeviceInfo();
    } else if (this.devices.length > 0) {
      // Зачем: Если индекс вне границ, выбираем первое устройство
      this.selectedIndex = 0;
      this.updateDeviceInfo();
    } else {
      // Зачем: Если устройств нет, показываем сообщение
      this.deviceInfo.setContent('Нет устройств для отображения');
      this.screen.render();
    }
  }
  
  updateDeviceState(deviceId, newState) {
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();
    
    // Зачем: Объединяем старое и новое состояние, чтобы не потерять поля, которые не пришли в обновлении
    // Это решает проблему мигания устройств, когда приходит частичное обновление состояния
    const oldState = existing?.state || {};
    const mergedState = { ...oldState, ...newState };
    
    // Проверяем изменения состояния
    let stateChanged = false;
    if (existing && existing.state) {
      const keyFields = ['ready', 'ip', 'co2', 'temperature', 'humidity', 'illumination'];
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
    
    // Зачем: Сохраняем объединенное состояние, чтобы не потерять поля при частичных обновлениях
    this.deviceStates.set(deviceId, {
      ...existing,
      state: mergedState,
      lastUpdate: now,
      lastStateChange: lastStateChange,
    });
    
    // Зачем: Проверяем, нужно ли обновлять информацию об устройстве
    // Зачем: Инвалидируем кэш, если обновляется выбранное устройство или его канал
    let shouldUpdateDeviceInfo = false;
    if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
      const selectedDevice = this.devices[this.selectedIndex];
      
      // Зачем: Проверяем, обновляется ли само устройство
      if (selectedDevice && selectedDevice.id === deviceId) {
        this.cache.deviceInfo = null;
        this.cache.deviceInfoHash = null;
        // Зачем: Инвалидируем кеш по deviceId при изменении состояния устройства
        this.cache.deviceInfoByDeviceId.delete(deviceId);
        shouldUpdateDeviceInfo = true;
      }
      
      // Зачем: Проверяем, обновляется ли канал актуатора (для актуаторов)
      if (selectedDevice && selectedDevice.category === 'Актуатор' && typeof selectedDevice.type === 'number') {
        const isChannel = deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/');
        if (isChannel && deviceId.startsWith(selectedDevice.id + '/')) {
          // Зачем: Обновляется канал выбранного актуатора - инвалидируем кэш
          this.cache.deviceInfo = null;
          this.cache.deviceInfoHash = null;
          // Зачем: Инвалидируем кеш по deviceId актуатора при изменении его канала
          this.cache.deviceInfoByDeviceId.delete(selectedDevice.id);
          shouldUpdateDeviceInfo = true;
        }
      }
    }
    
    // Зачем: Инвалидируем кеш по deviceId для устройства, состояние которого изменилось
    // Это гарантирует, что при следующем просмотре этого устройства будет показана актуальная информация
    if (stateChanged) {
      this.cache.deviceInfoByDeviceId.delete(deviceId);
    }
    
    // Зачем: Обновляем таблицу только если устройство видимо (прошло фильтры) или это канал актуатора
    // Зачем: Не обновляем, если идет навигация
    // Зачем: Инвалидируем кэш таблицы только если данные действительно изменились (stateChanged)
    const isChannel = deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/');
    const isVisibleDevice = this.devices.some(d => d.id === deviceId);
    const isVisibleChannel = isChannel && this.devices.some(d => {
      if (d.category === 'Актуатор' && typeof d.type === 'number') {
        return deviceId.startsWith(d.id + '/');
      }
      return false;
    });
    
    // Зачем: Инвалидируем кэш таблицы только если состояние действительно изменилось
    // Это предотвращает ненужные обновления таблицы и прыжки курсора
    if (stateChanged && (isVisibleDevice || isVisibleChannel)) {
      this.cache.tableData = null;
      this.cache.tableDataHash = null;
    }
    
    // Зачем: Инвалидируем кэш статистики только если состояние изменилось
    if (stateChanged) {
      this.cache.stats = null;
      this.cache.statsHash = null;
    }
    
    if (!this.isNavigating && stateChanged && (isVisibleDevice || isVisibleChannel)) {
      this.updateTable();
      this.updateStats();
      // Зачем: Обновляем панель параметров, если выбранное устройство изменилось
      if (shouldUpdateDeviceInfo) {
        // Зачем: Обновляем информацию об устройстве, включая каналы актуатора
        this.updateDeviceInfo();
      }
    } else if (shouldUpdateDeviceInfo) {
      // Зачем: Обновляем только панель параметров, если данные не изменились, но это выбранное устройство
      this.updateDeviceInfo();
    }
  }
  
  setDeviceInfo(deviceId, deviceInfo) {
    const existing = this.deviceStates.get(deviceId) || {};
    this.deviceStates.set(deviceId, {
      ...existing,
      device: deviceInfo,
    });
  }
  
  setConnected(connected) {
    this.isConnected = connected;
    const status = connected ? '🟢 ПОДКЛЮЧЕНО' : '🔴 ОТКЛЮЧЕНО';
    const time = new Date().toLocaleTimeString('ru-RU');
    // Зачем: Используем setContent вместо setDisplay для box виджета
    this.header.setContent(`${status} | ${time}`);
    this.screen.render();
  }
  
  updateTable() {
    try {
      // Зачем: Пропускаем обновление, если идет навигация
      if (this.isNavigating) {
        return;
      }
      
      // Зачем: Ограничиваем частоту обновлений (не чаще раза в 100мс)
      const now = Date.now();
      if (now - this.lastUpdateTime < 100) {
        return;
      }
      this.lastUpdateTime = now;
      
      // Зачем: Проверяем кэш данных таблицы
      const stateHash = this.getDevicesStateHash();
      // Зачем: Заголовки таблицы - фиксированные строки без эмодзи для правильного выравнивания
      const headers = ['Название', 'Тип', 'Помещение'];
      
      if (this.cache.tableData && this.cache.tableDataHash === stateHash) {
        // Зачем: Проверяем, что кэшированные данные имеют правильное количество столбцов
        // Это защита от старых данных с другим количеством столбцов
        const cachedData = this.cache.tableData;
        const isValidCache = cachedData.every(row => row && row.length === headers.length);
        
        if (isValidCache) {
          // Зачем: Данные не изменились и валидны - НЕ вызываем setData, чтобы не сбрасывать курсор
          // Просто возвращаемся без обновления таблицы
          return;
        } else {
          // Зачем: Кэш невалиден (старые данные), инвалидируем его
          this.cache.tableData = null;
          this.cache.tableDataHash = null;
        }
      }
      
      // Зачем: Сохраняем текущее выделение ПЕРЕД формированием данных
      // Это критично для сохранения позиции курсора
      let savedSelection = this.selectedIndex;
      try {
        // Зачем: Пытаемся получить реальную позицию из таблицы
        if (this.table && this.table.rows) {
          if (this.table.rows.selected !== undefined && this.table.rows.selected !== null) {
            const currentSelected = this.table.rows.selected;
            if (currentSelected >= 0 && currentSelected < this.devices.length) {
              savedSelection = currentSelected;
              this.selectedIndex = currentSelected;
            }
          }
        }
      } catch (e) {
        // Игнорируем ошибки, используем сохраненный selectedIndex
      }
      
      const tableData = [];
      
      // Зачем: Оптимизация: предварительно вычисляем подстроки для часто используемых значений
      for (let i = 0; i < this.devices.length; i++) {
        const device = this.devices[i];
        const data = this.deviceStates.get(device.id);
        const state = data?.state;
        
        const site = device.site || '—';
        
        // Зачем: Убеждаемся, что в каждой строке ровно 3 элемента (как в headers)
        // Зачем: Используем функции truncateString и padStringToWidth для правильного форматирования
        // Зачем: Заполняем пробелами до нужной ширины для полной перезаписи старых данных
        // Это гарантирует правильное выравнивание колонок в таблице и предотвращает артефакты
        const deviceName = device.name || '';
        const typeName = device.typeName || '';
        tableData.push([
          padStringToWidth(truncateString(deviceName, 30), 30), // Зачем: Обрезаем и заполняем до визуальной ширины 30 символов
          padStringToWidth(truncateString(typeName, 15), 15),     // Зачем: Обрезаем и заполняем до визуальной ширины 15 символов
          padStringToWidth(truncateString(site, 15), 15),        // Зачем: Обрезаем и заполняем до визуальной ширины 15 символов
        ]);
      }
      
      // Зачем: Обновляем заголовки таблицы
      // Важно: количество элементов в headers должно совпадать с количеством в columnWidth и в каждой строке данных
      // Зачем: headers уже объявлен выше (строка 1896), используем существующую переменную
      // Зачем: Пустая строка тоже заполняется пробелами для предотвращения артефактов
      const emptyRow = [
        padStringToWidth('Нет устройств', 30),
        padStringToWidth('—', 15),
        padStringToWidth('—', 15),
      ];
      
      // Зачем: Проверяем, что все строки имеют правильное количество столбцов
      // Зачем: Оптимизация - используем кэшированные данные, если они валидны
      let validData;
      if (tableData.length > 0) {
        // Зачем: Фильтруем только невалидные строки (обычно их нет)
        validData = tableData.filter(row => row && row.length === headers.length);
        if (validData.length === 0) {
          validData = [emptyRow];
        }
      } else {
        validData = [emptyRow];
      }
      
      // Зачем: Обновляем кэш с валидными данными
      this.cache.tableData = validData;
      this.cache.tableDataHash = stateHash;
      
      // Зачем: Восстанавливаем выделение после обновления данных
      // Важно: восстанавливаем только если индекс в допустимых пределах
      if (savedSelection >= 0 && savedSelection < validData.length) {
        this.selectedIndex = savedSelection;
      } else if (validData.length > 0) {
        // Зачем: Если сохраненный индекс вне границ, устанавливаем на последний доступный
        this.selectedIndex = Math.max(0, validData.length - 1);
      } else {
        this.selectedIndex = 0;
      }
      
      // Зачем: Обновляем данные таблицы
      // Зачем: Проверяем, что все данные валидны перед установкой
      try {
        // Зачем: Дополнительная проверка валидности данных и правильное форматирование
        const finalData = validData.map(row => {
          if (!row || !Array.isArray(row)) {
            // Зачем: Даже пустые строки заполняются пробелами для предотвращения артефактов
            return [
              padStringToWidth('—', 30),
              padStringToWidth('—', 15),
              padStringToWidth('—', 15),
            ];
          }
          // Зачем: Если строка имеет неправильное количество столбцов, исправляем
          if (row.length !== headers.length) {
            const fixedRow = [];
            fixedRow[0] = padStringToWidth(String(row[0] || '—'), 30); // Название
            fixedRow[1] = padStringToWidth(String(row[1] || '—'), 15); // Тип
            fixedRow[2] = padStringToWidth(String(row[2] || '—'), 15); // Помещение
            return fixedRow;
          }
          // Зачем: Убеждаемся, что все строки правильно обрезаны с учетом эмодзи
          // Зачем: Заполняем пробелами до нужной ширины для полной перезаписи старых данных
          // Это гарантирует правильное выравнивание колонок и предотвращает артефакты
          return [
            padStringToWidth(truncateString(String(row[0] || '—'), 30), 30),
            padStringToWidth(truncateString(String(row[1] || '—'), 15), 15),
            padStringToWidth(truncateString(String(row[2] || '—'), 15), 15),
          ];
        });
        
        // Зачем: Устанавливаем данные таблицы с фиксированными заголовками и шириной колонок
        // Зачем: Все строки заполнены пробелами до нужной ширины для полной перезаписи старых данных
        // Это предотвращает сбой разметки при обновлении данных и артефакты букв
        this.table.setData({
          headers: headers,
          data: finalData,
        });
      } catch (e) {
        // Зачем: Если ошибка, показываем пустую таблицу с правильно заполненными пробелами
        console.error('Ошибка при обновлении таблицы:', e.message);
        this.table.setData({
          headers: headers,
          data: [emptyRow],
        });
      }
      
      // Зачем: Восстанавливаем выделение в таблице с задержкой
      // contrib.table может сбросить выделение при setData, нужно восстановить
      // Зачем: Используем setImmediate вместо setTimeout для более быстрого восстановления
      // Зачем: Проверяем, что курсор действительно нужно восстановить (не идет навигация)
      if (!this.isNavigating) {
        setImmediate(() => {
          try {
            if (this.table && this.table.rows && !this.isNavigating) {
              // Зачем: Восстанавливаем выделение только если оно действительно изменилось
              const currentSelected = this.table.rows.selected;
              if (currentSelected !== this.selectedIndex) {
                // Попытка 1: напрямую устанавливаем selected (самый надежный способ)
                if (this.table.rows.selected !== undefined) {
                  this.table.rows.selected = this.selectedIndex;
                }
                // Попытка 2: через метод select
                if (typeof this.table.rows.select === 'function') {
                  this.table.rows.select(this.selectedIndex);
                }
                // Попытка 3: через установку позиции скролла
                if (typeof this.table.rows.scrollTo === 'function') {
                  this.table.rows.scrollTo(this.selectedIndex);
                }
              }
            }
          } catch (e) {
            // Игнорируем, если метод не поддерживается
          }
        });
      }
      
      // Зачем: contrib.table автоматически управляет выделением при навигации стрелками
      // При обновлении данных выделение сохраняется автоматически
      // Если нужно явно установить выделение, можно использовать:
      // this.table.rows.select(this.selectedIndex) - но это может не работать для contrib.table
      
      // Зачем: Рендерим только если экран готов
      if (this.screen && !this.screen.destroyed) {
        this.screen.render();
      }
    } catch (error) {
      // Зачем: Логируем ошибки, но не падаем
      console.error('Ошибка при обновлении таблицы:', error.message);
    }
  }
  
  updateStats() {
    // Зачем: Проверяем кэш статистики
    const stateHash = this.getDevicesStateHash();
    if (this.cache.stats && this.cache.statsHash === stateHash) {
      // Зачем: Статистика не изменилась, используем кэш
      this.stats.setContent(this.cache.stats);
      this.screen.render();
      return;
    }
    
    // Зачем: Считаем статистику только по отфильтрованным устройствам
    const total = this.devices.length;
    const totalAll = this.allDevices.length; // Всего устройств в системе
    let online = 0;
    let offline = 0;
    
    // Зачем: Оптимизация - используем for-of вместо for-i для лучшей производительности
    for (const device of this.devices) {
      const data = this.deviceStates.get(device.id);
      if (!data || !data.state) {
        continue; // Пропускаем устройства без состояния
      }
      
      const state = data.state;
      
      // Зачем: Логика определения статуса по ready
      const isReady = state.ready === true;
      if (isReady) {
        online++;
      } else {
        offline++;
      }
    }
    
    const pending = total - online - offline;
    const filterInfo = [];
    if (this.activeFilters.category) {
      filterInfo.push(`Тип: ${this.activeFilters.category}`);
    }
    if (this.activeFilters.consumerType) {
      filterInfo.push(`Потребитель: ${this.activeFilters.consumerType}`);
    }
    if (this.activeFilters.site) {
      filterInfo.push(`Помещение: ${this.activeFilters.site}`);
    }
    const filterStr = filterInfo.length > 0 ? ` | Фильтры: ${filterInfo.join(', ')}` : '';
    
    // Зачем: Показываем статистику по отфильтрованным устройствам и общее количество в системе
    const displayTotal = total < totalAll ? `${total}/${totalAll}` : total;
    const statsContent = `Показано: ${displayTotal} | 🟢 Ready: ${online} | 🔴 Not ready: ${offline} | ⚪ Ожидание: ${pending}${filterStr}`;
    
    // Зачем: Сохраняем статистику в кэш
    this.cache.stats = statsContent;
    this.cache.statsHash = stateHash;
    
    this.stats.setContent(statsContent);
    this.screen.render();
  }
  
  render() {
    this.screen.render();
  }
  
  stop() {
    // Зачем: Панель параметров не нужно закрывать, она всегда видна
    // Зачем: Очищаем интервал проверки выделения перед уничтожением экрана
    if (this.selectionCheckInterval) {
      clearInterval(this.selectionCheckInterval);
      this.selectionCheckInterval = null;
    }
    this.screen.destroy();
  }
}

// Основная функция
async function monitorDevices() {
  try {
    console.log('Загрузка списка устройств и помещений из БД...\n');
    console.log('Используется алгоритм из docs/ENDPOINT_DEVICES_ALGORITHM.md\n');
    
    // Зачем: Загружаем устройства и помещения за один проход по БД
    // Этап 1 из документации: Загрузка базовой информации из LevelDB
    const { devices, sites } = await getDevicesAndSitesFromDB();
    
    if (devices.length === 0) {
      console.error('❌ Устройства не найдены в базе данных');
      process.exit(1);
    }
    
    // Зачем: Подсчитываем устройства по категориям для информативности
    const byCategory = devices.reduce((acc, d) => {
      acc[d.category] = (acc[d.category] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`✅ Найдено ${devices.length} устройств:`);
    Object.entries(byCategory).forEach(([cat, count]) => {
      console.log(`   - ${cat}: ${count}`);
    });
    console.log(`✅ Найдено ${sites.length} помещений\n`);
    
    // Зачем: Создаем display с устройствами и помещениями для фильтрации
    // Важно: после создания blessed.screen все console.log будут перехвачены
    let display;
    try {
      display = new BlessedStatusDisplay(devices, sites);
    } catch (error) {
      // Зачем: Выводим ошибку до того, как blessed перехватит вывод
      console.error('❌ Ошибка при инициализации UI:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  
    // Зачем: Сохраняем информацию об устройствах для обновления состояния
    devices.forEach(device => {
      display.setDeviceInfo(device.id, device);
      // Зачем: Добавляем устройство в кэш по MAC-адресу для поиска актуаторов
      // MAC-адрес может быть в формате "xx:xx:xx:xx:xx:xx"
      if (device.id.includes(':')) {
        display.devicesByMac.set(device.id, device);
      }
    });
  
    // Зачем: Инициализируем таблицу, статистику и панель параметров перед первым рендером
    display.updateTable();
    display.updateStats();
    display.updateDeviceInfo(); // Зачем: Показываем параметры первого устройства по умолчанию
  
    // Зачем: Рендерим экран после полной инициализации
    // Откладываем на следующий тик, чтобы UI полностью инициализировался
    setImmediate(() => {
      display.render();
      
      // Зачем: Подключаемся к WebSocket после инициализации UI
      const ws = new WebSocket(WS_URI);
      
      // Зачем: Добавляем таймаут подключения, чтобы скрипт не зависал бесконечно
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          display.setConnected(false);
          display.render();
        }
      }, 10000); // 10 секунд
      
      ws.on('open', () => {
        clearTimeout(connectionTimeout);
        display.setConnected(true);
        
        // Зачем: Запрашиваем полное состояние всех устройств (алгоритм из документации)
        // Этап 2.2: Отправляем запрос GET с массивом ID устройств
        const deviceIds = devices.map(d => d.id);
        
        // Зачем: Добавляем каналы актуаторов для получения их состояния
        // Это позволяет показывать состояние каналов и связанные устройства
        const actuatorChannels = [];
        devices.forEach(device => {
          if (device.category === 'Актуатор' && typeof device.type === 'number') {
            const channelConfig = display.getActuatorChannelCount(device.type);
            if (channelConfig) {
              const channelTypes = channelConfig.types;
              const channelCount = channelConfig.count;
              
              // Зачем: Определяем количество каналов каждого типа для смешанных устройств
              let doCount = 0, dimCount = 0, aoCount = 0;
              
              if (channelTypes.includes('do') && channelTypes.includes('dim')) {
                // Смешанные устройства
                switch (device.type) {
                  case 0x41: doCount = 6; dimCount = 6; break; // MIX_H
                  case 0xaa: doCount = 2; dimCount = 2; break; // MIX_2
                  case 0xab: case 0xac: doCount = 1; dimCount = 1; break; // MIX_1, MIX_1_RS
                  case 0xb5: doCount = 6; dimCount = 12; break; // MIX_6x12_RS
                }
              } else {
                if (channelTypes.includes('do')) doCount = channelCount;
                if (channelTypes.includes('dim')) dimCount = channelCount;
                if (channelTypes.includes('ao')) aoCount = channelCount;
              }
              
              // Зачем: Добавляем ID всех каналов актуатора
              for (let i = 1; i <= doCount; i++) {
                actuatorChannels.push(`${device.id}/do/${i}`);
              }
              for (let i = 1; i <= dimCount; i++) {
                actuatorChannels.push(`${device.id}/dim/${i}`);
              }
              for (let i = 1; i <= aoCount; i++) {
                actuatorChannels.push(`${device.id}/ao/${i}`);
              }
            }
          }
        });
        
        // Зачем: Объединяем ID устройств и каналов для запроса
        const allIds = [...deviceIds, ...actuatorChannels];
        
        ws.send(JSON.stringify({ 
          type: 'get', 
          state: allIds 
        }));
        
        // Зачем: Периодически обновляем состояние (каждые 3 секунды)
        // Согласно ENDPOINT_DEVICES_ALGORITHM.md, это нужно для актуальных данных
        setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'get', state: allIds }));
          }
        }, UPDATE_INTERVAL);
      });
      
      // Зачем: Обработка ответов ACTION_SET (Этап 2.3 из документации)
      // Сервер отправляет серию сообщений ACTION_SET (по одному на каждое устройство)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Зачем: Обрабатываем только ACTION_SET сообщения с id и payload
          if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
            const deviceId = msg.id;
            const state = msg.payload;
            
            // Зачем: Проверяем, что устройство есть в списке всех устройств или это канал актуатора
            // Это включает щитовые и конечные устройства, а также каналы актуаторов
            const isDevice = display.allDevices.some(d => d.id === deviceId);
            const isChannel = deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/');
            
            if (isDevice || isChannel) {
              // Зачем: Обновляем состояние устройства или канала
              // Зачем: Передаем только payload без lastUpdate (он добавляется в updateDeviceState)
              // Зачем: updateDeviceState объединяет старое и новое состояние, чтобы не потерять поля
              display.updateDeviceState(deviceId, state);
            }
          }
        } catch (e) {
          // Игнорируем ошибки парсинга
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(connectionTimeout);
        display.setConnected(false);
        // Зачем: Не выводим ошибку в консоль, чтобы не ломать UI, обновляем только статус
        display.render();
      });
      
      ws.on('close', () => {
        clearTimeout(connectionTimeout);
        display.setConnected(false);
        display.render();
      });
      
      process.on('SIGINT', () => {
        display.stop();
        ws.close();
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('❌ Ошибка при инициализации:', error.message);
    if (error.message.includes('TTY')) {
      console.error('💡 Запустите скрипт в интерактивном терминале');
    }
    process.exit(1);
  }
}

// Проверяем наличие библиотек и загружаем их
try {
  blessed = require('blessed');
  contrib = require('blessed-contrib');
  monitorDevices().catch(error => {
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  });
} catch (e) {
  console.error('❌ Необходимо установить зависимости:');
  console.error('   npm install blessed blessed-contrib');
  console.error('\nОшибка:', e.message);
  process.exit(1);
}

