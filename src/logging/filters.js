/**
 * Система фильтрации событий для логирования
 * 
 * Фильтры определяют, какие события отправляются в OpenSearch и файлы.
 * Фильтры типизированы в соответствии с таблицей правил и могут быть настроены.
 */

/**
 * @typedef {Object} FilterRule
 * @property {string} id - Уникальный идентификатор правила
 * @property {string} name - Название правила
 * @property {string} description - Описание правила
 * @property {boolean} enabled - Включено ли правило
 * @property {Function} check - Функция проверки (возвращает true, если событие должно быть отправлено)
 */

// Системные поля, которые не логируются
const SYSTEM_FIELDS = new Set([
  'initialized',      // Инициализация устройства
  'online',           // Статус онлайн
  'ready',            // Готовность
  'timestamp',        // Временная метка
  'executed',         // Выполнение скрипта (обрабатывается отдельно)
  'last_execution'    // Последнее выполнение (обрабатывается отдельно)
]);

// Параметры актуаторов
const ACTUATOR_PARAMS = [
  'value',        // Включение/выключение
  'brightness',   // Яркость
  'r',            // Красный канал RGB
  'g',            // Зелёный канал RGB
  'b',            // Синий канал RGB
  'fan_speed',    // Скорость вентилятора
  'mode',         // Режим работы
  'direction',    // Направление
  'setpoint',     // Уставка
  'level',         // Уровень (для штор/жалюзи)
  'state',         // Статус (для штор: open/close/stop)
  'position'      // Позиция (для штор: 0-100)
];

// Параметры сенсоров
const SENSOR_PARAMS = [
  'temperature',  // Температура
  'humidity',     // Влажность
  'co2'           // CO2
];

// Параметры источников (DI-count)
// Зачем: в бою клик/удержание S4 часто приходит как инкремент счётчиков в DI,
// и это должно логироваться как SOURCE для полноты трассировки.
const DI_COUNT_PARAMS = [
  'onClick1Count',
  'onClick2Count',
  'onHoldCount',
];

// Все параметры для логирования
const ALL_PARAMS = [...ACTUATOR_PARAMS, ...SENSOR_PARAMS, ...DI_COUNT_PARAMS];

// Специальные параметры (всегда логируются)
const SPECIAL_PARAMS = [
  'executed',         // Выполнение скрипта
  'last_execution'    // Последнее выполнение скрипта
];

/**
 * Округление числа до десятых (одного знака после запятой)
 * Применяется только к числам, для остальных типов возвращает исходное значение
 * 
 * @param {any} value - Значение для округления
 * @returns {any} Округлённое значение или исходное, если не число
 */
const roundToTenths = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)) {
    return Math.round(value * 10) / 10;
  }
  return value;
};

/**
 * Сравнение значений с округлением чисел до десятых
 * 
 * @param {any} oldValue - Старое значение
 * @param {any} newValue - Новое значение
 * @returns {boolean} true, если значения равны после округления
 */
const areValuesEqual = (oldValue, newValue) => {
  // Если оба значения не числа - строгое сравнение
  if (typeof oldValue !== 'number' || typeof newValue !== 'number') {
    return oldValue === newValue;
  }
  
  // Если одно из значений NaN или Infinity - строгое сравнение
  if (Number.isNaN(oldValue) || Number.isNaN(newValue) || 
      !Number.isFinite(oldValue) || !Number.isFinite(newValue)) {
    return oldValue === newValue;
  }
  
  // Округляем до десятых и сравниваем
  const roundedOld = roundToTenths(oldValue);
  const roundedNew = roundToTenths(newValue);
  
  return roundedOld === roundedNew;
};

/**
 * Правило 1: События запуска скрипта (executed, last_execution)
 * ✅ Да (всегда)
 */
const RULE_SCRIPT_EXECUTION = {
  id: 'script_execution',
  name: 'События запуска скрипта',
  description: 'Логировать события запуска скрипта (executed, last_execution) - всегда',
  enabled: true, // Включено - для трассировки скриптов
  check: (param) => {
    // Зачем: проверяем только специальные параметры, остальные пропускаем для других правил
    if (!SPECIAL_PARAMS.includes(param)) {
      return true; // Не специальный параметр - пропускаем для других правил
    }
    return true; // Специальный параметр (executed, last_execution) - всегда логируем
  }
};

/**
 * Правило 2: Изменения актуаторов (value, brightness, и т.д.)
 * ✅ Да (если значение изменилось)
 */
const RULE_ACTUATOR_CHANGES = {
  id: 'actuator_changes',
  name: 'Изменения актуаторов',
  description: 'Логировать изменения актуаторов (value, brightness, и т.д.) - если значение изменилось',
  enabled: true, // Включено
  check: (param, oldValue, newValue, id, isActuatorDeviceFn) => {
    // Проверяем только параметры актуаторов
    // Если параметр не актуатор - пропускаем (возвращаем true), чтобы другие правила могли его проверить
    if (!ACTUATOR_PARAMS.includes(param)) {
      return true; // Пропускаем для других параметров (сенсоры, системные поля и т.д.)
    }
    
    // Проверка валидности значений
    const oldIsValid = oldValue !== undefined && oldValue !== null && !(typeof oldValue === 'number' && Number.isNaN(oldValue));
    const newIsValid = newValue !== undefined && newValue !== null && !(typeof newValue === 'number' && Number.isNaN(newValue));
    
    // Пропускаем невалидные значения
    if (!newIsValid) {
      return false;
    }
    
    // Пропускаем события, где old и new равны (с округлением до десятых для чисел)
    if (areValuesEqual(oldValue, newValue)) {
      return false;
    }
    
    // Для value проверяем тип устройства
    if (param === 'value') {
      const isChannel = id.includes('/do/') || id.includes('/dim/');
      if (isChannel) {
        if (id.includes('/di/')) {
          return false; // Пропускаем DI каналы
        }
        return true; // DO и DIM каналы - актуаторы
      } else {
        // Зачем: проверяем, является ли устройство актуатором или потребителем
        // Потребители (light_220, socket_220 и т.д.) также должны логироваться
        const isActuator = isActuatorDeviceFn(id);
        if (isActuator) {
          return true;
        }
        
        // Если не актуатор, проверяем, является ли устройство потребителем
        // Зачем: потребители также должны логироваться при включении/выключении
        // Используем state для получения типа устройства
        const state = require('../controllers/state');
        const device = state.get(id);
        if (device && device.type) {
          const deviceType = device.type;
          // Проверяем список типов потребителей (из event-logger.js)
          // Примечание: thermostat, hygrostat, co2_stat - программные компоненты, не потребители
          const CONSUMER_TYPES = [
            'light_220', 'light_LED', 'light_RGB', 'light_led',
            'socket_220', 'valve_heating', 'valve_water',
            'warm_floor', 'AC', 'FAN', 'fan', 'BOILER', 'PUMP',
            'curtains', 'curtain', 'blind', 'blinds', 'roller',
            'multiroom', 'NOVA'
          ];
          if (typeof deviceType === 'string' && CONSUMER_TYPES.includes(deviceType)) {
            return true; // Потребитель - логируем
          }
        }
        
        // Зачем: устройства‑триггеры (кнопки/датчики), запускающие скрипты через onDoppler/onTrue/...,
        // должны попадать в trace как SOURCE, иначе цепочка не собирается в ≥5 событий.
        if (device && typeof device === 'object') {
          const hasTrigger =
            (typeof device.onDoppler === 'string' && device.onDoppler) ||
            (typeof device.onTrue === 'string' && device.onTrue) ||
            (typeof device.onFalse === 'string' && device.onFalse) ||
            (typeof device.onChange === 'string' && device.onChange) ||
            (typeof device.onOpen === 'string' && device.onOpen) ||
            (typeof device.onClose === 'string' && device.onClose) ||
            // Зачем: в бою кнопки/DI могут хранить скрипты-триггеры массивами (onClick/onHold/...),
            // это тоже SOURCE и должно логироваться по value.
            (Array.isArray(device.onClick) && device.onClick.some((x) => typeof x === 'string' && x)) ||
            (Array.isArray(device.onClick2) && device.onClick2.some((x) => typeof x === 'string' && x)) ||
            (Array.isArray(device.onHold) && device.onHold.some((x) => typeof x === 'string' && x)) ||
            (Array.isArray(device.onOn) && device.onOn.some((x) => typeof x === 'string' && x)) ||
            (Array.isArray(device.onOff) && device.onOff.some((x) => typeof x === 'string' && x));
          if (hasTrigger) {
            return true;
          }

          // Зачем: в бою “клик” может приходить по базовому устройству (MAC),
          // а конфигурация триггеров лежит в DI каналах `${id}/di/1..4`.
          // Если DI содержит onClick/onHold — считаем базовое устройство SOURCE и логируем value.
          if (typeof id === 'string' && id.includes(':') && !id.includes('/')) {
            // Зачем: у S4 4 кнопки, и триггеры могут быть не только в di/1.
            for (let i = 1; i <= 4; i += 1) {
              const di = state.get(`${id}/di/${i}`);
              if (!di || typeof di !== 'object') continue;
              for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
                const v = di[k];
                if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x)) {
                  return true;
                }
              }
            }
          }
        }
        
        return false; // Не актуатор и не потребитель - не логируем
      }
    }
    
    return true; // Остальные параметры актуаторов
  }
};

/**
 * Правило 3: Изменения сенсоров (temperature, humidity, co2)
 * ✅ Да (если валидное число и изменилось)
 */
const RULE_SENSOR_CHANGES = {
  id: 'sensor_changes',
  name: 'Изменения сенсоров',
  description: 'Логировать изменения сенсоров (temperature, humidity, co2) - если валидное число и изменилось',
  enabled: true, // Включено
  check: (param, oldValue, newValue) => {
    if (!SENSOR_PARAMS.includes(param)) {
      return true; // Не проверяем для других параметров
    }
    
    // Проверка валидности значений
    const oldIsValid = oldValue !== undefined && oldValue !== null && !(typeof oldValue === 'number' && Number.isNaN(oldValue));
    const newIsValid = newValue !== undefined && newValue !== null && !(typeof newValue === 'number' && Number.isNaN(newValue));
    
    // Пропускаем невалидные значения
    if (!newIsValid) {
      return false;
    }
    
    // Должно быть валидным числом
    if (typeof newValue !== 'number') {
      return false;
    }
    
    // Пропускаем неизменённые значения (с округлением до десятых для чисел)
    if (oldIsValid && areValuesEqual(oldValue, newValue)) {
      return false;
    }
    
    return true; // Валидное число и изменилось
  }
};

/**
 * Правило 4: Системные поля (online, ready, и т.д.)
 * ❌ Нет
 */
const RULE_SYSTEM_FIELDS = {
  id: 'system_fields',
  name: 'Системные поля',
  description: 'Пропускать системные поля (online, ready, и т.д.)',
  enabled: false, // Выключено
  check: (param) => {
    return !SYSTEM_FIELDS.has(param);
  }
};

/**
 * Правило 5: Невалидные значения (null, NaN)
 * ❌ Нет
 */
const RULE_INVALID_VALUES = {
  id: 'invalid_values',
  name: 'Невалидные значения',
  description: 'Пропускать невалидные значения (null, NaN)',
  enabled: false, // Выключено
  check: (param, oldValue, newValue) => {
    // Для специальных параметров (executed, last_execution) не проверяем
    if (SPECIAL_PARAMS.includes(param)) {
      return true;
    }
    
    // Пропускаем undefined, null, NaN
    if (newValue === undefined || newValue === null) {
      return false;
    }
    if (typeof newValue === 'number' && Number.isNaN(newValue)) {
      return false;
    }
    
    return true;
  }
};

/**
 * Правило 6: Неизменённые значения
 * ❌ Нет
 */
const RULE_UNCHANGED_VALUES = {
  id: 'unchanged_values',
  name: 'Неизменённые значения',
  description: 'Пропускать неизменённые значения',
  enabled: false, // Выключено
  check: (param, oldValue, newValue) => {
    // Для специальных параметров (executed, last_execution) не проверяем
    if (SPECIAL_PARAMS.includes(param)) {
      return true;
    }
    
    // Проверяем валидность oldValue
    const oldIsValid = oldValue !== undefined && 
                       oldValue !== null && 
                       !(typeof oldValue === 'number' && Number.isNaN(oldValue));
    
    // Если oldValue валидно и равно newValue - пропускаем (с округлением до десятых для чисел)
    if (oldIsValid && areValuesEqual(oldValue, newValue)) {
      return false;
    }
    
    // Если oldValue невалидно (null/undefined/NaN) - логируем (первое появление)
    return true;
  }
};

/**
 * Правило 7: DI каналы (/di/)
 * ❌ Нет
 */
const RULE_DI_CHANNELS = {
  id: 'di_channels',
  name: 'DI каналы',
  description: 'Пропускать DI каналы (/di/)',
  enabled: false, // Выключено
  check: (param, oldValue, newValue, id) => {
    // Проверяем только для параметра value
    if (param !== 'value') {
      return true; // Не проверяем для других параметров
    }
    
    // Пропускаем DI каналы
    if (id.includes('/di/')) {
      return false;
    }
    
    return true;
  }
};

/**
 * Список всех правил фильтрации
 */
const FILTER_RULES = [
  RULE_SCRIPT_EXECUTION,    // Правило 1: События запуска скрипта
  RULE_ACTUATOR_CHANGES,    // Правило 2: Изменения актуаторов
  RULE_SENSOR_CHANGES,      // Правило 3: Изменения сенсоров
  RULE_SYSTEM_FIELDS,       // Правило 4: Системные поля
  RULE_INVALID_VALUES,      // Правило 5: Невалидные значения
  RULE_UNCHANGED_VALUES,    // Правило 6: Неизменённые значения
  RULE_DI_CHANNELS          // Правило 7: DI каналы
];

/**
 * Проверка события через все правила фильтрации
 * 
 * @param {string} param - Параметр события
 * @param {any} oldValue - Старое значение
 * @param {any} newValue - Новое значение
 * @param {string} id - ID устройства
 * @param {Function} isActuatorDeviceFn - Функция проверки, является ли устройство актуатором
 * @returns {boolean} true, если событие должно быть отправлено
 */
const shouldLogEvent = (param, oldValue, newValue, id, isActuatorDeviceFn) => {
  // Зачем: СПЕЦИАЛЬНЫЕ ПАРАМЕТРЫ (executed, last_execution) всегда логируем
  // Для трассировки скриптов нам нужны все события executed, даже если значение не изменилось
  if (SPECIAL_PARAMS.includes(param)) {
    return true; // ✅ Всегда логируем executed и last_execution
  }
  
  // Глобальная проверка: если old и new равны - отфильтровываем событие
  // Это применяется ко всем параметрам (актуаторы и сенсоры)
  // НО: если oldValue === null или undefined - это первое появление, логируем
  const oldIsNullish = oldValue === null || oldValue === undefined;
  const newIsNullish = newValue === null || newValue === undefined;
  
  // Если oldValue null/undefined - это первое появление значения, логируем
  if (oldIsNullish && !newIsNullish) {
    // Первое появление значения - пропускаем проверку равенства
  } else if (!oldIsNullish && !newIsNullish && areValuesEqual(oldValue, newValue)) {
    // Если оба значения не null/undefined и равны (с округлением до десятых для чисел) - отфильтровываем
    return false; // Событие отфильтровано
  }
  
  // Проверка через все правила
  for (const rule of FILTER_RULES) {
    if (!rule.enabled) {
      continue; // Пропускаем отключённые правила
    }
    
    let result = true;
    
    // Вызываем функцию проверки правила
    try {
      result = rule.check(param, oldValue, newValue, id, isActuatorDeviceFn);
    } catch (err) {
      console.error(`[filters] Ошибка в правиле ${rule.id}:`, err.message);
      result = false; // При ошибке не логируем
    }
    
    if (!result) {
      return false; // Правило отклонило событие
    }
  }
  
  return true; // Все правила пройдены
};

/**
 * Получить список всех правил
 * 
 * @returns {Array<{id: string, name: string, description: string, enabled: boolean}>} Список правил
 */
const getRules = () => {
  return FILTER_RULES.map(rule => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled
  }));
};

/**
 * Включить/выключить правило
 * 
 * @param {string} ruleId - ID правила
 * @param {boolean} enabled - Включить или выключить
 */
const setRuleEnabled = (ruleId, enabled) => {
  const rule = FILTER_RULES.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = enabled;
    console.log(`[filters] Правило "${rule.name}" ${enabled ? 'включено' : 'выключено'}`);
  } else {
    console.warn(`[filters] Правило с ID "${ruleId}" не найдено`);
  }
};

/**
 * Получить конфигурацию всех правил
 * 
 * @returns {Object} Конфигурация всех правил
 */
const getRulesConfig = () => {
  return FILTER_RULES.reduce((config, rule) => {
    config[rule.id] = {
      enabled: rule.enabled,
      name: rule.name,
      description: rule.description
    };
    return config;
  }, {});
};

/**
 * Получить правило по ID
 * 
 * @param {string} ruleId - ID правила
 * @returns {FilterRule|null} Правило или null
 */
const getRule = (ruleId) => {
  return FILTER_RULES.find(r => r.id === ruleId) || null;
};

module.exports = {
  // Константы
  SYSTEM_FIELDS,
  ACTUATOR_PARAMS,
  SENSOR_PARAMS,
  ALL_PARAMS,
  SPECIAL_PARAMS,
  
  // Правила
  RULE_SCRIPT_EXECUTION,
  RULE_ACTUATOR_CHANGES,
  RULE_SENSOR_CHANGES,
  RULE_SYSTEM_FIELDS,
  RULE_INVALID_VALUES,
  RULE_UNCHANGED_VALUES,
  RULE_DI_CHANNELS,
  FILTER_RULES,
  
  // Функции
  shouldLogEvent,
  getRules,
  setRuleEnabled,
  getRulesConfig,
  getRule
};

