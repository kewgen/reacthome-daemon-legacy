#!/usr/bin/env node

/**
 * Event Logger Service
 * 
 * Отдельный сервис для логирования событий актуаторов через WebSocket.
 * Подключается к демону через ws://localhost:3000 и логирует события в OpenSearch.
 * 
 * Использует те же функции из event-log.js для обеспечения идентичности формата.
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
// Зачем: корректируем пути импортов после перемещения файла в src/logging
const state = require('../controllers/state');
const {
  getDeviceTypeWithFallback,
  isActuatorDevice,
  getSiteName,
  getProjectName,
  getHumanName,
  getTriggerHuman,
  getTriggerDeviceId,
  roundToTenths,
  isNumericParam,
  NUMERIC_PARAMS
} = require('./event-log');
const filters = require('./filters');
const opensearch = require('./opensearch');
const { ensureLoggerPid } = require('./event-meta'); // Зачем: единая точка заполнения logger_pid + юнит‑тесты
const { getScriptTargetDeviceIds } = require('./script-targets'); // Зачем: корректный резолв onTrue/onFalse и вложенных скриптов
const { resolveSignalSourceFromWs } = require('./signal-source'); // Зачем: единый резолвер источников сигнала (WS -> signal_source)

// Зачем: определение типов устройств-потребителей для добавления признака consumer в события
// Алгоритм взят из src/monitor.js
// Примечание: thermostat, hygrostat, co2_stat - программные компоненты, не потребители
const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'fan', 'BOILER', 'PUMP',
  'curtains', 'curtain', 'blind', 'blinds', 'roller',
  'multiroom',
];




// Конфигурация
const DAEMON_WS_URL = process.env.DAEMON_WS_URL || 'ws://localhost:3000';
const RECONNECT_DELAY = 5000; // 5 секунд
const MAX_RECONNECT_ATTEMPTS = 10;
const STATE_REQUEST_TIMEOUT = 30000; // 30 секунд
const CONNECTION_TIMEOUT = 10000; // 10 секунд - таймаут подключения к WebSocket
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB - максимальный размер сообщения (защита от DoS)
// Зачем: буфер защищает от кратких деградаций OpenSearch/сети; размер делаем настраиваемым, чтобы не терять события при пиковой нагрузке
const BUFFER_MAX_SIZE = parseInt(process.env.EVENT_LOGGER_BUFFER_MAX_SIZE || '5000', 10); // Максимальный размер буфера событий
// Зачем: батчинг снижает нагрузку на сеть/балансировщик и уменьшает вероятность ERR_STREAM_PREMATURE_CLOSE
const OPENSEARCH_FLUSH_INTERVAL_MS = parseInt(process.env.OPENSEARCH_FLUSH_INTERVAL_MS || '250', 10);
const OPENSEARCH_BATCH_SIZE = parseInt(process.env.OPENSEARCH_BATCH_SIZE || '200', 10);

// Константы для WebSocket сообщений (из src/init/constants.js и src/constants.js)
const { LIST, GET } = require('../init/constants');
const { ACTION_SET } = require('../constants');

// Состояние
let ws = null;
let deviceState = new Map(); // Хранение предыдущего состояния устройств
let reconnectAttempts = 0;
let isConnected = false;
let eventBuffer = []; // Буфер для событий при недоступности OpenSearch
let stateRequested = false;
let isInitialStateReceived = false;
let bufferFlushInterval = null; // Интервал для отправки событий из буфера
let isFlushingBuffer = false; // Зачем: исключаем параллельные flush, чтобы не устраивать “шторм” запросов
let lastFlushLogTs = 0; // Зачем: защита от лог-спама

// 1. Кэш состояния актуаторов (лампы, вентиляторы, кондеи, тёплые полы)
// Зачем: хранит время включения для вычисления длительности работы и обогащения trace_id
const actuatorStateCache = new Map(); // id -> { onTimestamp, param, value }

// 1.1. Кэш состояния каналов do/dim (по endDevice.id)
// Зачем: хранит время включения для вычисления длительности работы конечного устройства
const channelStateCache = new Map(); // endDevice.id -> { onTimestamp, channelId, value }

// 2. Трассировка событий - генерация trace ID для цепочек связности
// Зачем: связывание событий в цепочки для анализа причинно-следственных связей
const traceIdCache = new Map(); // id -> trace_id

// 3. Кэш последних событий для анализа временных паттернов
// Зачем: связывание событий по времени для построения трассировки без _context
const recentEventsCache = new Map(); // id -> { timestamp, trace_id, type }
const RECENT_EVENT_WINDOW_MS = 2000; // Окно 2 секунды для связывания событий
// Зачем: защита от “залипания” trace_id на одном id (особенно на CONSUMER) после широких сценариев (site-light-off и т.п.).
// Это не “склейка по времени” разных сущностей, а TTL переиспользования trace_id для ТОГО ЖЕ id.
const TRACE_ID_REUSE_WINDOW_MS = Number(process.env.TRACE_ID_REUSE_WINDOW_MS || RECENT_EVENT_WINDOW_MS);

// 4. Кэш активных скриптов для связывания событий устройств
// Зачем: отслеживание запущенных скриптов и связывание их событий с событиями устройств
const activeScriptsCache = new Map(); // scriptId -> { timestamp, trace_id, actionDevices: Set }
const SCRIPT_EXECUTION_WINDOW_MS = 5000; // Окно 5 секунд для событий скрипта

// 5. Кэш выполнения скриптов для генерации синтетических событий executed
// Зачем: отслеживание запущенных скриптов и генерация синтетических событий когда устройства изменяются
const scriptExecutionCache = new Map(); // scriptId -> {
//   firstChangeTimestamp: number,    // Время первого изменения устройства
//   trace_id: string,                 // trace_id для всей цепочки
//   devicesChanged: Set<deviceId>,    // Устройства которые уже изменились
//   syntheticEventSent: boolean,       // Было ли отправлено синтетическое событие
//   targetDevices: Set<deviceId>       // Все целевые устройства скрипта
// }
const SCRIPT_EXECUTION_WINDOW_MS_SYNTHETIC = 10000; // 10 секунд (учитывая delay в скриптах)
const SCRIPT_CACHE_CLEANUP_THRESHOLD_MS = 20000; // 20 секунд для очистки

// 5.1. Кэш “tick” планировщика (timestamp демона -> trace_id)
// Зачем: у планировщика (clock/schedule) и дочерних скриптов executed часто один и тот же payload.timestamp (один tick демона),
// но выводятся они из разных device-change (разные вызовы checkAndGenerateScriptEvent), поэтому без временной эвристики цепь распадается.
// Мы не используем “окно 2 секунды”, а связываем только по ТОЧНОМУ timestamp демона и только для SCRIPT executed.
const schedulerTickTraceCache = new Map(); // timestamp:number -> { timestamp, trace_id }

// Зачем: trace_id должен быть строго строкой. В кэшах/логах встречались объекты вида {trace_id,timestamp},
// которые ломали OpenSearch mapping (keyword) и приводили к падениям (trace_id.slice is not a function).
const normalizeTraceId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.trace_id === 'string' && value.trace_id) return value.trace_id;
    if (typeof value.traceId === 'string' && value.traceId) return value.traceId;
  }
  return null;
};

// Зачем: ветки toggle обычно представлены отдельными скриптами с title "... on"/"... off".
// Их можно заранее пометить trace_id (это НЕ генерирует событий), но синтетика должна выбирать ветку строго по consumer.value,
// иначе появятся "лишние" SCRIPT executed.
const isBranchScriptByTitle = (scriptId) => {
  const s = state.get(scriptId);
  const title = typeof s?.title === 'string' ? s.title.trim().toLowerCase() : '';
  return title.endsWith(' on') || title.endsWith(' off');
};

// 6. Обратный индекс deviceId -> Set<scriptId> для быстрого поиска скриптов
// Зачем: оптимизация поиска скриптов содержащих устройство
const deviceToScriptsIndex = new Map(); // deviceId -> Set<scriptId>

// Константы для TTL очистки кэшей (зачем: предотвращение утечки памяти)
const TRACE_CACHE_TTL_MS = 3600000; // 1 час - traceIdCache
const DEVICE_STATE_MAX_SIZE = 500; // Максимальный размер deviceState кэша (уменьшено для экономии памяти)
const DEVICE_STATE_TTL_MS = 3600000; // 1 час - TTL для deviceState (зачем: удаление неактивных устройств)
const ACTUATOR_CACHE_TTL_MS = 86400000; // 24 часа - actuatorStateCache и channelStateCache

// Зачем: для S4/DI нужно склеить down/move/up в один "жест", чтобы удержание/диммирование не распадалось на десятки trace_id.
const signalSourceCache = new Map(); // key: base device id (например, "90:..") -> gesture state
const gestureTraceCache = new Map(); // key: gesture_id -> trace_id

// Зачем: флаг отладки для условного логирования (включается через DEBUG=true)
const DEBUG_MODE = process.env.DEBUG === 'true';

// Зачем: в некоторых тестовых сценариях SCRIPT executed события приходят явно (из YAML),
// и синтетическая генерация “executed” по изменениям устройств мешает детерминизму.
const SYNTHETIC_SCRIPT_EVENTS_ENABLED = process.env.SYNTHETIC_SCRIPT_EVENTS !== 'false';

// Зачем: временная (эвристическая) корреляция по окну времени часто даёт “шум” и ложные склейки trace_id.
// Оставляем возможность включить её для диагностики, но по умолчанию выключаем.
// Включение: TRACE_TEMPORAL_CORRELATION_ENABLED=1
const TEMPORAL_TRACE_CORRELATION_ENABLED = process.env.TRACE_TEMPORAL_CORRELATION_ENABLED === '1';

// Логирование
const log = (message, ...args) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [event-logger] ${message}`, ...args);
};

const logError = (message, ...args) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [event-logger] ERROR: ${message}`, ...args);
};

// Зачем: условное логирование только в режиме отладки
const logDebug = (message, ...args) => {
  if (DEBUG_MODE) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [event-logger] [DEBUG] ${message}`, ...args);
  }
};

// Вспомогательная функция для извлечения полей устройства из state
// Зачем: упрощение доступа к полям устройства без дублирования кэша
const getDeviceFields = (id) => {
  if (!id) return null;
  
  const obj = state.get(id);
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  
  // Извлекаем только необходимые базовые поля
  return {
    name: obj.name !== undefined ? obj.name : null,
    code: obj.code !== undefined ? obj.code : null,
    title: obj.title !== undefined ? obj.title : null,
    type: obj.type !== undefined ? obj.type : null,
    parent: obj.parent !== undefined ? obj.parent : null,
    bind: obj.bind !== undefined ? obj.bind : null, // Зачем: связываем потребителя и канал/актуатор для корректного trace_id
    site: obj.site !== undefined ? obj.site : null,
    project: obj.project !== undefined ? obj.project : null
  };
};

// Зачем: определение, является ли ID каналом (формат MAC/type/index)
const isChannelId = (id) => {
  if (!id || typeof id !== 'string') return false;
  const parts = id.split('/');
  return parts.length >= 2 && parts[0].includes(':');
};

// Зачем: парсинг ID канала на компоненты
const parseChannelId = (id) => {
  const parts = id.split('/');
  return {
    mac: parts[0],
    type: parts[1] || null,  // 'do', 'dim', 'di', 'ai'
    index: parts[2] || null
  };
};

// Зачем: обогащение события информацией о канале, конечном устройстве и щитовом устройстве
const enrichChannelEvent = (id, event) => {
  if (!isChannelId(id)) {
    return event; // Не канал - возвращаем как есть
  }
  
  const channel = state.get(id);
  if (!channel) return event;
  
  const parsed = parseChannelId(id);
  const parentDevice = state.get(parsed.mac);
  
  // Обогащаем device.human: щитовое устройство + канал
  if (parentDevice) {
    const parentHuman = getHumanName(parentDevice);
    event.device.human = parentHuman 
      ? `${parentHuman} / ${parsed.type}/${parsed.index}`
      : `${parsed.mac} / ${parsed.type}/${parsed.index}`;
  }
  
  // Добавляем объект channel
  // Зачем: используем актуальное значение из события, если оно есть, иначе из state
  const channelValue = event.new !== undefined ? event.new : (channel.value !== undefined ? channel.value : null);
  event.channel = {
    id: id,
    type: parsed.type,
    index: parsed.index ? parseInt(parsed.index, 10) : null,
    value: channelValue,
    velocity: channel.velocity !== undefined ? channel.velocity : null
  };
  
  // Добавляем объект parentDevice
  if (parentDevice) {
    let parentTypeStr = null;
    if (typeof parentDevice.type === 'number') {
      parentTypeStr = `DEVICE_TYPE_${parentDevice.type.toString(16).toUpperCase()}`;
    } else if (typeof parentDevice.type === 'string') {
      parentTypeStr = parentDevice.type.toUpperCase();
    }
    
    event.parentDevice = {
      id: parsed.mac,
      type: parentTypeStr,
      human: getHumanName(parentDevice),
      title: parentDevice.title || null,
      code: parentDevice.code || null,
      name: parentDevice.name || null,
      ip: parentDevice.ip || null
    };
  }
  
  // Добавляем объект endDevice (через bind)
  const endDeviceId = channel.bind;
  if (endDeviceId && typeof endDeviceId === 'string') {
    const endDevice = state.get(endDeviceId);
    if (endDevice) {
      // Зачем: определение, является ли конечное устройство потребителем
      const endDeviceType = endDevice.type || getDeviceTypeWithFallback(endDeviceId);
      const endDeviceIsConsumer = isConsumerDevice(endDeviceType);
      
      event.endDevice = {
        id: endDeviceId,
        type: endDeviceType || null,
        human: getHumanName(endDevice),
        title: endDevice.title || null,
        code: endDevice.code || null,
        name: endDevice.name || null,
        site: endDevice.site || null,
        consumer: endDeviceIsConsumer // Зачем: признак потребителя для мониторинга
      };
      
      // Обогащаем site из конечного устройства
      if (!event.site) {
        const siteName = getSiteName(endDeviceId);
        if (siteName) {
          event.site = siteName;
        }
      }
    }
  }
  
  return event;
};

// Определение класса актуатора (лампа, вентилятор, кондей, тёплый пол)
const getActuatorClass = (id, newState) => {
  if (!newState || typeof newState !== 'object') return null;
  
  // Лампа: есть value или brightness
  if ('value' in newState || 'brightness' in newState || 'r' in newState || 'g' in newState || 'b' in newState) {
    return 'light';
  }
  
  // Вентилятор: есть fan_speed
  if ('fan_speed' in newState) {
    return 'fan';
  }
  
  // Кондей: есть mode (heat, cool, stop, dry, wet, ventilation)
  if ('mode' in newState) {
    return 'ac';
  }
  
  // Тёплый пол: есть setpoint или type === 'warm_floor'
  if ('setpoint' in newState || newState.type === 'warm_floor') {
    return 'warm_floor';
  }
  
  return null;
};

// Зачем: определение, является ли устройство потребителем (алгоритм из src/monitor.js)
const isConsumerDevice = (deviceType) => {
  if (!deviceType) return false;
  // Если тип - строка и содержится в CONSUMER_TYPES
  if (typeof deviceType === 'string' && CONSUMER_TYPES.includes(deviceType)) {
    return true;
  }
  return false;
};

// Проверка, включён ли актуатор
const isActuatorOn = (actuatorClass, deviceState) => {
  if (!actuatorClass || !deviceState) return false;
  
  switch (actuatorClass) {
    case 'light':
      // Лампа включена, если value > 0 или brightness > 0 или есть цвет
      return (deviceState.value > 0) || 
             (deviceState.brightness > 0) || 
             (deviceState.r > 0 || deviceState.g > 0 || deviceState.b > 0);
    case 'fan':
      // Вентилятор включен, если fan_speed > 0
      return (deviceState.fan_speed > 0);
    case 'ac':
      // Кондей включен, если mode !== 'stop' и mode !== null
      return (deviceState.mode && deviceState.mode !== 'stop' && deviceState.mode !== null);
    case 'warm_floor':
      // Тёплый пол включен, если setpoint > 0 или value > 0
      return (deviceState.setpoint > 0) || (deviceState.value > 0);
    default:
      return false;
  }
};

// Обновление кэша состояния актуаторов
// Зачем: отслеживание включения/выключения и возврат информации для обогащения событий
const updateActuatorStateCache = (id, oldState, newState) => {
  const actuatorClass = getActuatorClass(id, newState);
  if (!actuatorClass) return null;
  
  const wasOn = isActuatorOn(actuatorClass, oldState);
  const isOn = isActuatorOn(actuatorClass, newState);
  
  const cached = actuatorStateCache.get(id);
  const now = Date.now();
  
  if (!wasOn && isOn) {
    // Включение: сохраняем время включения и возвращаем информацию для события
    const cacheEntry = {
      onTimestamp: now,
      param: actuatorClass === 'light' ? (newState.brightness !== undefined ? 'brightness' : 'value') :
             actuatorClass === 'fan' ? 'fan_speed' :
             actuatorClass === 'ac' ? 'mode' : 'setpoint',
      value: actuatorClass === 'light' ? (newState.brightness || newState.value || 1) :
             actuatorClass === 'fan' ? newState.fan_speed :
             actuatorClass === 'ac' ? newState.mode : newState.setpoint
    };
    actuatorStateCache.set(id, cacheEntry);
    // Зачем: возвращаем информацию о включении для добавления в событие
    return {
      type: 'on',
      onTimestamp: cacheEntry.onTimestamp,
      param: cacheEntry.param,
      value: cacheEntry.value
    };
  } else if (wasOn && !isOn && cached) {
    // Выключение: вычисляем длительность и очищаем кэш
    const duration = now - cached.onTimestamp;
    actuatorStateCache.delete(id); // Очищаем кэш при выключении
    // Зачем: возвращаем информацию о выключении для добавления в событие
    return {
      type: 'off',
      onTimestamp: cached.onTimestamp,
      duration: duration,
      param: cached.param,
      value: cached.value
    };
  } else if (wasOn && isOn && cached) {
    // Устройство остаётся включённым - обновляем значение и возвращаем информацию о текущей сессии
    const duration = now - cached.onTimestamp;
    actuatorStateCache.set(id, {
      ...cached,
      value: actuatorClass === 'light' ? (newState.brightness || newState.value || 1) :
             actuatorClass === 'fan' ? newState.fan_speed :
             actuatorClass === 'ac' ? newState.mode : newState.setpoint
    });
    // Зачем: возвращаем информацию о текущей сессии работы для добавления в событие
    return {
      type: 'update',
      onTimestamp: cached.onTimestamp,
      duration: duration,
      param: cached.param,
      value: cached.value
    };
  }
  
  return null;
};

// Зачем: отслеживание включения/выключения устройств через каналы do и dim
const updateChannelStateCache = (channelId, oldValue, newValue, endDeviceId) => {
  // Проверяем, что это канал do или dim
  if (!isChannelId(channelId)) return null;
  
  const parsed = parseChannelId(channelId);
  if (parsed.type !== 'do' && parsed.type !== 'dim') return null;
  
  // Проверяем, что есть endDevice
  if (!endDeviceId || typeof endDeviceId !== 'string') return null;
  
  const cached = channelStateCache.get(endDeviceId);
  const now = Date.now();
  
  // Включение: old = 0 и newValue > 0
  if (oldValue === 0 && newValue > 0) {
    const cacheEntry = {
      onTimestamp: now,
      channelId: channelId,
      value: newValue
    };
    channelStateCache.set(endDeviceId, cacheEntry);
    // Зачем: возвращаем информацию о включении для добавления в событие
    return {
      type: 'on',
      onTimestamp: cacheEntry.onTimestamp,
      channelId: cacheEntry.channelId,
      value: cacheEntry.value
    };
  }
  
  // Выключение: newValue = 0 и было включено
  if (newValue === 0 && cached) {
    const duration = now - cached.onTimestamp;
    channelStateCache.delete(endDeviceId); // Очищаем кеш при выключении
    // Зачем: возвращаем информацию о выключении для добавления в событие
    return {
      type: 'off',
      onTimestamp: cached.onTimestamp,
      duration: duration,
      channelId: cached.channelId,
      value: cached.value
    };
  }
  
  // Устройство остаётся включённым - обновляем значение
  if (newValue > 0 && cached) {
    const duration = now - cached.onTimestamp;
    channelStateCache.set(endDeviceId, {
      ...cached,
      value: newValue
    });
    // Зачем: возвращаем информацию о текущей сессии работы для добавления в событие
    return {
      type: 'update',
      onTimestamp: cached.onTimestamp,
      duration: duration,
      channelId: cached.channelId,
      value: cached.value
    };
  }
  
  return null;
};

// Определение типа устройства по данным из БД
// Зачем: для определения триггеров событий без _context от демона
const getDeviceRole = (id) => {
  const device = state.get(id);
  if (!device || typeof device !== 'object') return 'device';
  
  // Зачем: в бою (и в init snapshot) скрипт может иметь пустой action[],
  // но по смыслу это всё равно SCRIPT (особенно clock/schedule-скрипты вроде "Ежеминутник").
  if (typeof device.type === 'string' && device.type.toLowerCase() === 'script') {
    return 'script';
  }
  
  // Скрипт: есть массив action
  if (Array.isArray(device.action) && device.action.length > 0) {
    return 'script';
  }
  
  // Расписание: есть schedule
  if (device.schedule) {
    return 'schedule';
  }
  
  // Таймер: есть timer или duration
  if (device.timer || device.duration) {
    return 'timer';
  }
  
  // Группа: есть group или массив устройств
  if (device.group || (Array.isArray(device.site) && device.site.length > 5)) {
    return 'group';
  }
  
  // Обычное устройство
  return 'device';
};

// Получение списка целевых устройств из action массива скрипта
// Зачем: определение какие устройства будут изменены скриптом для построения трассировки
const getScriptTargetDevices = (scriptId) => {
  return getScriptTargetDeviceIds(state, scriptId);
};

// Определение action_type для события запуска скрипта (executed/last_execution).
// Зачем: систематизируем причины/тип запуска скрипта для тестовых сетов и анализа боевых логов.
const determineScriptActionType = (scriptId, scriptState) => {
  if (!scriptState || typeof scriptState !== 'object') {
    return 'ACTION_UNKNOWN';
  }
  
  // Зачем: для некоторых “веток” toggle (on/off) action[] может ссылаться на общий ACTION_TOGGLE,
  // но по смыслу и для тестов нам важно видеть ACTION_ON/ACTION_OFF.
  if (typeof scriptState.title === 'string' && scriptState.title) {
    const t = scriptState.title.trim().toLowerCase();
    if (t.endsWith(' on')) return 'ACTION_ON';
    if (t.endsWith(' off')) return 'ACTION_OFF';
    if (t.includes(' toggle')) return 'ACTION_TOGGLE';
  }

  // Запуск по расписанию.
  if (scriptState.schedule) {
    return 'ACTION_SCHEDULE_START';
  }
  
  // Запуск по clock (в текущей терминологии тестов).
  if (scriptState.clock) {
    return 'ACTION_CLOCK_TEST';
  }
  
  // Запуск через action (берём первый action как “главный” тип).
  if (Array.isArray(scriptState.action) && scriptState.action.length > 0) {
    const firstActionId = scriptState.action[0];
    const actionObj = firstActionId ? state.get(firstActionId) : null;
    const actionType = actionObj && typeof actionObj === 'object' ? actionObj.type : null;
    if (typeof actionType === 'string' && actionType.trim()) {
      return actionType.trim(); // Например: ACTION_ON, ACTION_TOGGLE и т.п.
    }
  }
  
  // Фолбэк: ручной запуск (точно определить без _context нельзя).
  return 'ACTION_RUN';
};

// Зачем: в боевом WS у планировщиков (clock/schedule) часто НЕТ явного флага clock=true,
// но первый action-объект имеет type=ACTION_CLOCK_TEST / ACTION_SCHEDULE_START.
// Для синтетики (и tick-связности) это критично: иначе планировщик не считается scheduler-like,
// и цепочки "Ежеминутник → script → device" не собираются.
const isSchedulerLikeScript = (scriptId, scriptState) => {
  if (!scriptState || typeof scriptState !== 'object') return false;
  if (scriptState.clock || scriptState.schedule || scriptState.timer || scriptState.duration) return true;
  const at = determineScriptActionType(scriptId, scriptState);
  return at === 'ACTION_CLOCK_TEST' || at === 'ACTION_SCHEDULE_START';
};

// Поиск скриптов содержащих устройство (с использованием обратного индекса)
// Зачем: быстрое определение какие скрипты могут влиять на устройство
const findScriptsContainingDevice = (deviceId) => {
  return Array.from(deviceToScriptsIndex.get(deviceId) || []);
};

// Генерация синтетического события executed для скрипта
// Зачем: создание события executed когда скрипт запустился (выведено из изменений устройств)
const generateSyntheticScriptEvent = (scriptId, timestamp, trace_id, meta = {}) => {
  const script = state.get(scriptId);
  if (!script) return;

  const normalizedTraceId = normalizeTraceId(trace_id);
  if (!normalizedTraceId) {
    logError('Синтетика SCRIPT executed пропущена: trace_id не строка', String(trace_id));
    return;
  }
  
  // Получаем метаданные скрипта
  const scriptFields = getDeviceFields(scriptId);
  const scriptHuman = getHumanName(script);
  const siteName = getSiteName(scriptId);
  const projectName = getProjectName(scriptId);
  
  // Создаём синтетическое событие executed
  const syntheticEvent = {
    timestamp: timestamp,
    id: scriptId,
    device: {
      type: 'SCRIPT',
      human: scriptHuman,
      name: scriptFields?.name ?? null,
      code: scriptFields?.code ?? null,
      title: scriptFields?.title ?? null
    },
    param: 'executed',
    old: null,  // Не знаем предыдущее значение
    new: true,  // Скрипт выполняется
    trigger: {
      type: 'script',
      ref: scriptId,
      id: scriptId,
      human: scriptHuman,
      session: null,
      remote_ip: null
    },
    site: siteName,
    project: projectName,
    trace_id: normalizedTraceId,
    extra: {
      action_type: determineScriptActionType(scriptId, script), // Зачем: единый action_type для синтетики и боевых логов
      // Зачем: главный фильтр для аналитики (OpenSearch/Kibana): extra.synthetic:true
      synthetic: true,
      // Зачем: стабильная “сигнатура” синтетики для отчётов/фильтров/эволюции формата.
      synthetic_version: 1,
      synthetic_kind: 'script.executed',
      // Зачем: источник вывода синтетики (мы НЕ обогащаем WS, это отметка именно логгера).
      synthetic_source: meta.synthetic_source || meta.inferred_from || 'device_changes',
      // Зачем: сохраняем историческую совместимость со старым полем.
      inferred_from: meta.inferred_from || 'device_changes',
      // Зачем: уверенность вывода (high/medium/low)
      confidence: meta.confidence || 'high',
      // Зачем: мы можем сдвигать timestamp синтетики “назад” для причинной сортировки.
      synthetic_ts_shift_ms: typeof meta.synthetic_ts_shift_ms === 'number' ? meta.synthetic_ts_shift_ms : 0,
      target_devices_count: script.action?.length || 0
    }
  };
  
  // Отправляем событие
  sendEvent(syntheticEvent);
  
  log(`📋 [SYNTHETIC] Создано синтетическое событие executed для скрипта ${scriptId.slice(0,8)}..., trace_id=${normalizedTraceId.slice(0,8)}`);
};

// Обработка нового запуска скрипта
// Регистрация выполнения скрипта (реального или синтетического)
// Зачем: наполнение кэшей связности для прокидывания trace_id на ACTUATOR/CONSUMER устройства.
const registerScriptExecution = (scriptId, timestamp, traceId, deviceId = null, isSynthetic = false, syntheticEventTimestamp = null) => {
  const normalizedTraceId = normalizeTraceId(traceId);
  if (!scriptId || !normalizedTraceId) return;

  const scriptState = state.get(scriptId);
  const isScheduler = isSchedulerLikeScript(scriptId, scriptState);

  // 1. Бронируем trace_id для этого тика демона (если это планировщик)
  if (isScheduler && typeof timestamp === 'number' && !schedulerTickTraceCache.has(timestamp)) {
    schedulerTickTraceCache.set(timestamp, { timestamp, trace_id: normalizedTraceId });
  }

  // 2. Получаем целевые устройства скрипта
  const targetDevicesForTrace = getScriptTargetDevices(scriptId);
  // Зачем: для синтетики отфильтровываем вложенные скрипты, чтобы определить “завершение” по устройствам.
  const targetDevicesForCompletion = new Set(
    Array.from(targetDevicesForTrace).filter((tid) => getDeviceRole(tid) !== 'script')
  );

  // 3. Сохраняем в кэш выполнения (для синтетики и связности)
  scriptExecutionCache.set(scriptId, {
    firstChangeTimestamp: timestamp,
    trace_id: normalizedTraceId,
    devicesChanged: deviceId ? new Set([deviceId]) : new Set(),
    syntheticEventSent: isSynthetic,
    targetDevices: targetDevicesForCompletion
  });

  // 4. Прокидываем trace_id на все цели (включая вложенные скрипты)
  for (const devId of targetDevicesForTrace) {
    traceIdCache.set(devId, normalizedTraceId);
    const prev = recentEventsCache.get(devId);
    if (!prev || (typeof prev.timestamp === 'number' && prev.timestamp <= timestamp)) {
      recentEventsCache.set(devId, { timestamp, trace_id: normalizedTraceId, type: 'script' });
    }
  }

  // 5. Генерируем синтетическое событие, если нужно
  if (isSynthetic) {
    // Зачем: синтетика выводится ПОСЛЕ факта изменения устройства, поэтому “реальный” порядок в ленте
    // (SCRIPT → ACTUATOR/CONSUMER) может нарушаться, если штамповать timestamp ровно как у change-события
    // или позже. Для корректной причинной сортировки ставим synthetic.timestamp немного раньше первого change.
    // Важно: в кэшах оставляем исходный timestamp изменения устройства (timestamp),
    // а сдвиг применяем только к полю timestamp у синтетического события.
    const syntheticTs =
      typeof syntheticEventTimestamp === 'number'
        ? syntheticEventTimestamp
        : (typeof timestamp === 'number' ? Math.max(0, timestamp - 1) : Date.now());
    const shiftMs =
      (typeof timestamp === 'number' && typeof syntheticTs === 'number')
        ? Math.max(0, timestamp - syntheticTs)
        : 0;
    generateSyntheticScriptEvent(scriptId, syntheticTs, normalizedTraceId, {
      inferred_from: 'device_changes',
      synthetic_source: 'device_changes',
      confidence: 'high',
      synthetic_ts_shift_ms: shiftMs
    });
    const cached = scriptExecutionCache.get(scriptId);
    if (cached) {
      cached.syntheticEventSent = true;
    }
    log(`📋 [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} запущен (выведено), trace_id=${normalizedTraceId.slice(0,8)}, целевых устройств: ${targetDevicesForCompletion.size}`);
  } else {
    log(`📋 [REAL] Скрипт ${scriptId.slice(0,8)} зарегистрирован, trace_id=${normalizedTraceId.slice(0,8)}, целевых устройств: ${targetDevicesForCompletion.size}`);
  }

  // Зачем: если скрипт сразу “закрылся” (например, одно устройство в action), не держим его в кэше.
  {
    const cached = scriptExecutionCache.get(scriptId);
    if (cached && cached.targetDevices && cached.devicesChanged && cached.devicesChanged.size >= cached.targetDevices.size && cached.targetDevices.size > 0) {
      scriptExecutionCache.delete(scriptId);
    }
  }
};

// Зачем: создание trace_id и синтетического события когда скрипт только что запустился
const handleNewScriptExecution = (scriptId, deviceId, timestamp) => {
  // 1. Генерируем trace_id для цепочки
  // Зачем: если устройство уже в активной цепочке (например CONSUMER только что сработал),
  // то скрипт должен попасть в тот же trace_id, иначе канал/потребитель разъедутся по разным trace.
  const now = (typeof timestamp === 'number' ? timestamp : Date.now());
  let trace_id = null;

  // Зачем: убираем “поиск по временному окну” (скан recentEventsCache),
  // но сохраняем ЯВНУЮ связку: если текущий запуск скрипта выведен из изменения конкретного deviceId,
  // и этот deviceId уже помечен trace_id как цель скрипта/цепочки (traceIdCache+recentEventsCache),
  // то скрипт обязан унаследовать этот trace_id (пример: SOURCE → CONSUMER → synthetic SCRIPT executed).
  if (!TEMPORAL_TRACE_CORRELATION_ENABLED && deviceId) {
    const directTrace = normalizeTraceId(traceIdCache.get(deviceId));
    const direct = recentEventsCache.get(deviceId);
    if (directTrace && direct && typeof direct.timestamp === 'number') {
      const age = now - direct.timestamp;
      if (
        age >= 0 &&
        age <= SCRIPT_EXECUTION_WINDOW_MS_SYNTHETIC &&
        direct.trace_id === directTrace &&
        (direct.type === 'script' || direct.type === 'consumer' || direct.type === 'schedule' || direct.type === 'timer')
      ) {
        trace_id = directTrace;
      }
    }
  }

  // Зачем: “tick” демона применяем ТОЛЬКО для scheduler-like скриптов (clock/schedule/timer/duration).
  // Иначе есть риск склеить независимые цепочки, которые просто совпали по payload.timestamp.
  const scriptStateForTick = state.get(scriptId);
  const isSchedulerLikeForTick = isSchedulerLikeScript(scriptId, scriptStateForTick);
  if (isSchedulerLikeForTick && typeof timestamp === 'number') {
    const tick = schedulerTickTraceCache.get(timestamp);
    if (tick && tick.trace_id) {
      trace_id = tick.trace_id;
    }
  }

  if (TEMPORAL_TRACE_CORRELATION_ENABLED) {
    const recent = deviceId ? recentEventsCache.get(deviceId) : null;
    if (recent && typeof recent.timestamp === 'number') {
      const age = now - recent.timestamp;
      if (age >= 0 && age <= RECENT_EVENT_WINDOW_MS && recent.trace_id) {
        // Разрешаем наследование от consumer/script/schedule/timer (но не от "unknown" init-state).
        if (recent.type === 'consumer' || recent.type === 'script' || recent.type === 'schedule' || recent.type === 'timer') {
          trace_id = recent.trace_id;
        }
      }
    }
  }
  if (!trace_id) {
    // Зачем: без временных эвристик склеиваем синтетические script→script цепочки по ЯВНОЙ связи (граф скриптов).
    // Если родительский скрипт уже пометил этот scriptId как цель (targets включают вложенные скрипты),
    // то trace_id уже будет в traceIdCache + recentEventsCache с тем же timestamp — переиспользуем.
    const cachedTraceId = traceIdCache.get(scriptId);
    const recent = recentEventsCache.get(scriptId);
    if (
      cachedTraceId &&
      recent &&
      typeof recent.timestamp === 'number' &&
      typeof timestamp === 'number' &&
      recent.timestamp === timestamp &&
      recent.type === 'script'
    ) {
      trace_id = cachedTraceId;
    } else {
      trace_id = uuidv4();
    }
  }

  // Зачем: запоминаем trace_id для данного tick timestamp только для scheduler-like скриптов.
  if (isSchedulerLikeForTick && typeof timestamp === 'number' && trace_id && !schedulerTickTraceCache.has(timestamp)) {
    schedulerTickTraceCache.set(timestamp, { timestamp, trace_id });
  }
  
  // 2. Получаем целевые устройства скрипта
  const targetDevicesForTrace = getScriptTargetDevices(scriptId);
  // Зачем: `getScriptTargetDevices` включает вложенные скрипты как “цели” для прокидывания trace_id,
  // но скрипты как сущности не генерируют device-change события, поэтому по ним нельзя определять “завершение”
  // синтетического выполнения. Если оставить их в targetDevices, то кэш будет “вечно” висеть и склеивать
  // поздние события (например, авто-выключение) в тот же trace_id.
  const targetDevicesForCompletion = new Set(
    Array.from(targetDevicesForTrace).filter((tid) => getDeviceRole(tid) !== 'script')
  );
  
  // 3. Сохраняем в кэш
  scriptExecutionCache.set(scriptId, {
    firstChangeTimestamp: timestamp,
    trace_id: trace_id,
    devicesChanged: new Set([deviceId]),
    syntheticEventSent: false,
    targetDevices: targetDevicesForCompletion
  });
  
  // 4. Сохраняем trace_id для всех целей (включая вложенные скрипты — для связности script→script)
  for (const devId of targetDevicesForTrace) {
    traceIdCache.set(devId, trace_id);
    // Зачем: целевое устройство/скрипт может прийти следующим событием и должен сразу подхватить trace_id,
    // даже если у него ещё нет собственной записи в recentEventsCache.
    const prev = recentEventsCache.get(devId);
    if (!prev || (typeof prev.timestamp === 'number' && prev.timestamp <= timestamp)) {
      recentEventsCache.set(devId, { timestamp, trace_id, type: 'script' });
    }
  }
  
  // 5. Генерируем синтетическое событие executed
  generateSyntheticScriptEvent(scriptId, timestamp, trace_id, {
    inferred_from: 'device_changes',
    synthetic_source: 'device_changes',
    confidence: 'high',
    synthetic_ts_shift_ms: 0
  });
  
  // 6. Отмечаем что синтетическое событие отправлено
  const cached = scriptExecutionCache.get(scriptId);
  if (cached) {
    cached.syntheticEventSent = true;
  }
  
  log(`📋 [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} запущен (выведено), trace_id=${trace_id.slice(0,8)}, целевых устройств: ${targetDevicesForCompletion.size}`);

  // Зачем: если скрипт уже “закрылся” одним изменением (targetDevices=1 и deviceId совпал),
  // не держим его в кэше — иначе trace_id будет “липнуть” к устройству слишком долго.
  {
    const c = scriptExecutionCache.get(scriptId);
    if (c && c.targetDevices && c.devicesChanged && c.devicesChanged.size === c.targetDevices.size) {
      scriptExecutionCache.delete(scriptId);
    }
  }
};

// Обработка продолжения работы скрипта
// Зачем: отслеживание изменений устройств в рамках уже запущенного скрипта
const handleContinuingScriptExecution = (scriptId, deviceId, cached) => {
  // Добавляем устройство в список изменённых
  cached.devicesChanged.add(deviceId);
  
  // Зачем: это очень частое событие, не засоряем логи в обычном режиме
  logDebug(`⏳ [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} продолжает работу, устройство ${deviceId.slice(0,8)} изменено (${cached.devicesChanged.size}/${cached.targetDevices.size})`);
  
  // Проверяем, все ли целевые устройства изменились
  if (cached.devicesChanged.size === cached.targetDevices.size) {
    log(`✅ [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} завершил работу, все устройства изменены`);
    // Зачем: выполнение завершено — удаляем из кэша, чтобы следующие события не наследовали старый trace_id.
    scriptExecutionCache.delete(scriptId);
  }
};

// Проверка и генерация синтетических событий для скриптов
// Зачем: определение запущенных скриптов по изменениям устройств и генерация синтетических событий
const checkAndGenerateScriptEvent = (deviceId, timestamp, newState = null) => {
  const scripts = findScriptsContainingDevice(deviceId);
  if (scripts.length === 0) return;

  // Зачем: синтетика должна строиться на ЯВНЫХ связях, а не “по времени”.
  const getCurrentTrace = () => {
    const t = traceIdCache.get(deviceId);
    if (t) return t;
    const r = recentEventsCache.get(deviceId);
    return r && r.trace_id ? r.trace_id : null;
  };

  const consumerValue =
    newState && typeof newState === 'object' && Object.prototype.hasOwnProperty.call(newState, 'value')
      ? newState.value
      : undefined;

  // Зачем: иногда цепочка стартует с планировщика (scheduler-like) и только затем появляется явный trace_id.
  // Делаем 2 прохода:
  // - pass=0: если trace ещё нет — разрешаем только scheduler-like, чтобы открыть trace_id.
  // - pass=1: если после pass=0 trace появился — разрешаем "обычные" скрипты, явно помеченные этим trace.
  let currentTrace = getCurrentTrace();
  for (let pass = 0; pass < 2; pass++) {
    const allowedScripts = new Set();
    // Зачем: ветки toggle (on/off) нужно синтезировать строго: только одну, соответствующую consumer.value.
    // Нельзя полагаться только на title ("... on/off"), т.к. в бою title может быть пустым,
    // а trace_id может быть прокинут во все вложенные скрипты через targets.
    const toggleBranchesAll = new Set(); // оба onOn + onOff
    const toggleBranchesWanted = new Set(); // только выбранная ветка
    if (currentTrace) {
      // 1) Разрешаем только скрипты, которые уже помечены этим trace (явная связь).
      for (const sid of scripts) {
        const stTrace = traceIdCache.get(sid);
        if (stTrace && stTrace === currentTrace) {
          allowedScripts.add(sid);
        }
      }
      // 2) Находим ветки toggle (onOn/onOff) у скриптов в этой цепочке.
      // Важно: собираем ВСЕ ветки даже когда consumerValue не boolean (например, событие по ACTUATOR),
      // чтобы не синтезировать on/off ветки без знания результата.
      if (allowedScripts.size > 0) {
        const wantOn = (typeof consumerValue === 'boolean') ? (consumerValue === true) : null;
        for (const tid of Array.from(allowedScripts)) {
          const toggle = state.get(tid);
          const at = determineScriptActionType(tid, toggle);
          if (at !== 'ACTION_TOGGLE') continue;
          if (!toggle || typeof toggle !== 'object' || !Array.isArray(toggle.action)) continue;
          for (const actionId of toggle.action) {
            const actionObj = state.get(actionId);
            if (!actionObj || typeof actionObj !== 'object') continue;
            const p = actionObj.payload;
            const pp = p && typeof p === 'object' ? (p.payload && typeof p.payload === 'object' ? p.payload : p) : null;
            if (!pp || typeof pp !== 'object') continue;
            const onBid = (typeof pp.onOn === 'string' && pp.onOn) ? pp.onOn : null;
            const offBid = (typeof pp.onOff === 'string' && pp.onOff) ? pp.onOff : null;
            if (onBid) toggleBranchesAll.add(onBid);
            if (offBid) toggleBranchesAll.add(offBid);

            // 2.1) Разрешаем только выбранную ветку, если знаем итоговое состояние consumer.value.
            if (wantOn !== null) {
              const bid = wantOn ? onBid : offBid;
              if (bid) {
                toggleBranchesWanted.add(bid);
                allowedScripts.add(bid);
              }
            }
          }
        }
      }
    }

    // Если trace уже есть, но мы НЕ смогли однозначно выделить “наши” скрипты, синтетику не запускаем (шум).
    if (currentTrace && allowedScripts.size === 0) return;

    // Зачем: в цепочках “кнопка → toggle → ветка → устройство” важен причинный порядок.
    // Для детерминизма и корректной сортировки по timestamp обрабатываем в порядке:
    // ACTION_TOGGLE → ACTION_ON/OFF → прочее.
    const scriptPriority = (sid, st) => {
      const at = determineScriptActionType(sid, st);
      if (at === 'ACTION_TOGGLE') return 0;
      if (at === 'ACTION_ON' || at === 'ACTION_OFF') return 1;
      return 2;
    };

    /** @type {{scriptId: string, scriptState: any, actionType: string}[]} */
    const eligible = [];
    
    for (const scriptId of scripts) {
      const scriptState = state.get(scriptId);
      const actionType = determineScriptActionType(scriptId, scriptState);
      const title = typeof scriptState?.title === 'string' ? scriptState.title.trim().toLowerCase() : '';
      const isToggleBranch = toggleBranchesAll.has(scriptId);
      const isBranchLike = isToggleBranch || title.endsWith(' on') || title.endsWith(' off');

      // Зачем: ветки toggle (on/off) синтезируем строго только по consumer.value.
      if (isToggleBranch) {
        if (typeof consumerValue !== 'boolean') continue;
        if (!toggleBranchesWanted.has(scriptId)) continue;
      }

      // Зачем: ветку on/off можно выбирать только когда мы знаем итоговое состояние consumer.value.
      // Если consumerValue не boolean (например, событие пришло от ACTUATOR с value=255),
      // то синтезировать ACTION_ON/ACTION_OFF нельзя — иначе появятся обе ветки в одном trace (шум).
      if (isBranchLike && (actionType === 'ACTION_ON' || actionType === 'ACTION_OFF') && typeof consumerValue !== 'boolean') {
        continue;
      }
      // Доп. страховка: если action_type не определился, но по title видно on/off — тоже требуем boolean.
      if (actionType === 'ACTION_UNKNOWN' && typeof scriptState?.title === 'string' && typeof consumerValue !== 'boolean') {
        if (isBranchLike) continue;
      }

      // Зачем: строгий выбор ветки делаем только для branch-like скриптов (title "... on/off").
      // Для прочих скриптов (например "toggle every 1m ...") actionType может быть ACTION_ON,
      // но скрипт реально содержит и ON и OFF — фильтровать по consumerValue нельзя, иначе OFF-трейсы теряют SCRIPT.
      if (isBranchLike && typeof consumerValue === 'boolean') {
        if (actionType === 'ACTION_ON' && consumerValue !== true) continue;
        if (actionType === 'ACTION_OFF' && consumerValue !== false) continue;
      }

      if (currentTrace) {
        if (!allowedScripts.has(scriptId)) continue;
      } else {
        // Если trace ещё не установлен, разрешаем синтетику только для “планировщиков”.
        const isSchedulerLike = isSchedulerLikeScript(scriptId, scriptState);
        if (!isSchedulerLike) continue;
      }

      eligible.push({ scriptId, scriptState, actionType });
    }

    eligible.sort((a, b) => {
      const pa = scriptPriority(a.scriptId, a.scriptState);
      const pb = scriptPriority(b.scriptId, b.scriptState);
      if (pa !== pb) return pa - pb;
      return String(a.scriptId).localeCompare(String(b.scriptId));
    });

    // 1) Сначала помечаем “продолжение” (оно не генерирует новых executed), чтобы не мешать смещениям.
    const newOnes = [];
    for (const item of eligible) {
      const { scriptId } = item;
      const cached = scriptExecutionCache.get(scriptId);
      const isNewExecution = !cached || (timestamp - cached.firstChangeTimestamp) > SCRIPT_EXECUTION_WINDOW_MS_SYNTHETIC;
      if (isNewExecution) {
        newOnes.push(item);
        continue;
      }
      // Продолжение работы
      cached.devicesChanged.add(deviceId);
      if (cached.targetDevices && cached.devicesChanged.size >= cached.targetDevices.size && cached.targetDevices.size > 0) {
        log(`✅ [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} завершил работу, все устройства изменены`);
        scriptExecutionCache.delete(scriptId);
      }
    }

    // 2) Затем генерируем новые executed с небольшими смещениями “назад”:
    // Toggle будет чуть раньше ветки, ветка — чуть раньше устройства.
    for (let i = 0; i < newOnes.length; i++) {
      const { scriptId } = newOnes[i];
      const orderOffset = newOnes.length - i; // 1..N
      const syntheticEventTs = typeof timestamp === 'number' ? Math.max(0, timestamp - orderOffset) : null;

      const trace_id = generateTraceId(scriptId, { type: 'script' }, 'executed', timestamp);
      registerScriptExecution(scriptId, timestamp, trace_id, deviceId, true, syntheticEventTs);
    }

    // Если trace не был известен в начале — после pass=0 он мог появиться (planировщик открыл trace).
    if (currentTrace) return;
    currentTrace = getCurrentTrace();
    if (!currentTrace) return;
  }
};


// Построение обратного индекса device -> scripts при инициализации
// Зачем: оптимизация поиска скриптов содержащих устройство
const buildDeviceToScriptsIndex = () => {
  log('🔨 Строим обратный индекс device -> scripts...');
  
  deviceToScriptsIndex.clear();
  let scriptsCount = 0;
  
  // Проходим по всем объектам в state
  // Зачем: state.state() возвращает объект со всеми устройствами
  const stateObj = state.state();
  const totalObjects = Object.keys(stateObj).length;
  let objectsWithAction = 0;
  
  for (const [scriptId, obj] of Object.entries(stateObj)) {
    if (!obj || typeof obj !== 'object') continue;
    if (!Array.isArray(obj.action)) continue;
    
    objectsWithAction++;
    const targetDevices = getScriptTargetDevices(scriptId);
    if (targetDevices.size === 0) {
      log(`⚠️ Скрипт ${scriptId.slice(0,8)}... имеет action, но целевых устройств не найдено`);
      continue;
    }
    
    scriptsCount++;
    
    // Добавляем в обратный индекс
    for (const deviceId of targetDevices) {
      if (!deviceToScriptsIndex.has(deviceId)) {
        deviceToScriptsIndex.set(deviceId, new Set());
      }
      deviceToScriptsIndex.get(deviceId).add(scriptId);
    }
  }
  
  log(`✅ Обратный индекс построен: ${deviceToScriptsIndex.size} устройств в ${scriptsCount} скриптах (всего объектов: ${totalObjects}, с action: ${objectsWithAction})`);
};

// Анализ связей из БД для определения триггера
// Зачем: восстановление контекста события без _context от демона
const analyzeDeviceContext = (id, timestamp, param) => {
  const device = state.get(id);
  if (!device || typeof device !== 'object') {
    return { type: 'unknown', ref: null, deviceId: null };
  }
  
  const now = timestamp || Date.now();
  const role = getDeviceRole(id);
  
  // Если это событие executed/last_execution для скрипта/расписания/таймера
  // Зачем: в бою и в тестовых сетах запуск скрипта может происходить по schedule/clock/timer,
  // но нам нужно единообразно собирать цепочку (SCRIPT → ACTUATOR → CONSUMER).
  if ((role === 'script' || role === 'schedule' || role === 'timer') && (param === 'executed' || param === 'last_execution')) {
    // Зачем: создаём запись об активном скрипте для последующего связывания
    const targetDevices = getScriptTargetDevices(id);
    
    // Для получения action нужен полный объект из state
    const device = state.get(id);
    
    return {
      type: role === 'schedule' ? 'schedule' : role === 'timer' ? 'timer' : 'script',
      ref: id,
      deviceId: id,
      actions: device?.action || [],
      targetDevices: targetDevices,
      isScriptEvent: true // Маркер события скрипта
    };
  }
  
  // Если это расписание - trigger = schedule
  if (role === 'schedule') {
    return {
      type: 'schedule',
      ref: id,
      deviceId: id
    };
  }
  
  // Если это таймер - trigger = timer
  if (role === 'timer') {
    return {
      type: 'timer',
      ref: id,
      deviceId: id
    };
  }
  
  // Зачем: временная корреляция может давать “шум” — по умолчанию выключаем.
  if (TEMPORAL_TRACE_CORRELATION_ENABLED) {
    // Проверяем активные скрипты (события в течение 5 секунд)
    // Зачем: связываем события устройств с активными скриптами
    for (const [scriptId, scriptInfo] of activeScriptsCache.entries()) {
      const timeDiff = now - scriptInfo.timestamp;

      // Если скрипт активен (в пределах временного окна)
      if (timeDiff <= SCRIPT_EXECUTION_WINDOW_MS) {
        // Проверяем, является ли текущее устройство целевым для скрипта
        if (scriptInfo.actionDevices && scriptInfo.actionDevices.has(id)) {
          return {
            type: 'script',
            ref: scriptId,
            deviceId: scriptId,
            inferredFrom: 'active_script_cache' // Маркер: найдено через кэш активных скриптов
          };
        }
      }
    }

    // Анализируем недавние события для определения возможного триггера
    // Зачем: если устройство изменилось в течение 2 секунд после другого события, возможно это цепочка
    for (const [recentId, recentEvent] of recentEventsCache.entries()) {
      const timeDiff = now - recentEvent.timestamp;

      // Если событие в пределах временного окна
      if (timeDiff <= RECENT_EVENT_WINDOW_MS) {
        const recentRole = getDeviceRole(recentId);

        // Если недавнее событие было от скрипта
        if (recentRole === 'script') {
          // Для получения action нужен полный объект из state
          const recentDevice = state.get(recentId);
          // Проверяем, есть ли текущее устройство в списке действий скрипта
          if (recentDevice && Array.isArray(recentDevice.action)) {
            const targetDevices = getScriptTargetDevices(recentId);
            if (targetDevices.has(id)) {
              // Нашли связь: текущее устройство в целевых устройствах скрипта
              return {
                type: 'script',
                ref: recentId,
                deviceId: recentId,
                inferredFrom: 'temporal_analysis' // Маркер, что это выведено из анализа
              };
            }
          }
        }
      }
    }
  }
  
  // Для обычных устройств возвращаем unknown
  return {
    type: 'unknown',
    ref: null,
    deviceId: null
  };
};

// Генерация trace ID для трассировки событий на основе БД и временных паттернов
// Зачем: построение трассировки без _context от демона через анализ контекста из БД
const generateTraceId = (id, context, param, eventTimestamp, payload = null) => {
  const now = (typeof eventTimestamp === 'number' ? eventTimestamp : Date.now());
  const obj = state.get(id);
  const role = getDeviceRole(id);
  const scriptState = role === 'script' ? (obj || state.get(id)) : null;

  // 1) ИГНОРИРУЕМ служебные объекты
  if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
    const t = obj.type.toLowerCase();
    if (t === 'site' || t === 'project' || t === 'daemon') {
      traceIdCache.delete(id);
      recentEventsCache.delete(id);
      return null;
    }
  }

  // 2) ЕСЛИ СКРИПТ ИЛИ УСТРОЙСТВО — проверяем наличие trace_id для этого тика (timestamp)
  // Зачем: "tick" демона — сильнейший маркер связности. Скрипты и их устройства, запущенные в одну мс, — одна цепочка.
  const isSchedulerLike = role === 'script' ? isSchedulerLikeScript(id, scriptState) : false;
  if (typeof eventTimestamp === 'number') {
    const tick = schedulerTickTraceCache.get(eventTimestamp);
    const tickTraceId =
      (typeof tick === 'string' && tick) ||
      (tick && typeof tick === 'object' && typeof tick.trace_id === 'string' && tick.trace_id) ||
      null;
    if (tickTraceId) {
      if (role === 'script') {
        log(`🔗 [TICK] Скрипт ${id.slice(0,8)} ('${scriptState?.title}') наследует trace_id тика: ${tickTraceId}`);
        if (payload && payload.executed === true) {
          registerScriptExecution(id, now, tickTraceId, null, false);
        }
      } else {
        // Зачем: если устройство изменилось ровно в тик планировщика, оно должно попасть в тот же trace_id,
        // даже если событие скрипта пришло позже или вообще не попало в лог (например, из-за фильтрации).
        log(`🔗 [TICK] Устройство ${id.slice(0,8)} наследует trace_id тика: ${tickTraceId}`);
      }
      return tickTraceId;
    }
  }

  // 2.1) Правило: все источники являются началом цепочки трассировки.
  // Для планировщиков (scheduler-like) это означает: КАЖДОЕ executed/last_execution должно начинать новую цепочку
  // по своему tick timestamp (а не переиспользовать trace_id из traceIdCache/recentEventsCache в пределах 2с).
  if (
    role === 'script' &&
    isSchedulerLike &&
    (param === 'executed' || param === 'last_execution') &&
    typeof eventTimestamp === 'number'
  ) {
    const existing = schedulerTickTraceCache.get(eventTimestamp);
    if (existing && typeof existing === 'string') return existing;
    if (existing && typeof existing === 'object' && existing.trace_id) return existing.trace_id;

    const newTraceId = uuidv4();
    schedulerTickTraceCache.set(eventTimestamp, { timestamp: eventTimestamp, trace_id: newTraceId });
    traceIdCache.set(id, newTraceId);
    recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: 'script' });
    if (payload && payload.executed === true) {
      registerScriptExecution(id, now, newTraceId, null, false);
    }
    return newTraceId;
  }
  
  // 3) ЕСЛИ В КОНТЕКСТЕ УЖЕ ЕСТЬ trace_id (от SOURCE) - используем его
  if (context && context.trace_id) {
    const ctxTraceId = normalizeTraceId(context.trace_id);
    if (!ctxTraceId) return null;
    traceIdCache.set(id, ctxTraceId);
    recentEventsCache.set(id, { timestamp: now, trace_id: ctxTraceId, type: context.type });
    return ctxTraceId;
  }
  
  // 4) ЕСЛИ trace_id ЕСТЬ В КЭШЕ (от SCRIPT targets или недавних событий)
  if (traceIdCache.has(id)) {
    const cachedTraceIdRaw = traceIdCache.get(id);
    const cachedTraceId = normalizeTraceId(cachedTraceIdRaw);
    if (!cachedTraceId) {
      traceIdCache.delete(id);
      recentEventsCache.delete(id);
    } else {
      const recent = recentEventsCache.get(id);
      const age = recent && typeof recent.timestamp === 'number' ? (now - recent.timestamp) : Infinity;
      
      // Зачем: consumer→consumer reuse запрещаем для value, чтобы не склеивать ON и OFF циклы.
      if (role === 'consumer' && recent && recent.type === 'consumer' && param === 'value') {
        // Но: правило "SOURCE всегда старт цепочки" означает, что новый SOURCE мог уже зарезервировать
        // этот CONSUMER в traceIdCache (через прокидывание в targets), и тогда новый consumer.value
        // обязан унаследовать ЭТОТ trace_id, даже если предыдущий consumer.value был недавно.
        if (
          cachedTraceId &&
          typeof cachedTraceId === 'string' &&
          cachedTraceId !== recent.trace_id &&
          age <= RECENT_EVENT_WINDOW_MS
        ) {
          recentEventsCache.set(id, { timestamp: now, trace_id: cachedTraceId, type: 'consumer' });
          return cachedTraceId;
        }
        // Иначе идём к генерации нового ID (разделяем циклы)
      } else {
        const effectiveReuseWindowMs = (role === 'consumer' && param === 'value') ? RECENT_EVENT_WINDOW_MS : TRACE_ID_REUSE_WINDOW_MS;
        if (age <= effectiveReuseWindowMs && recent && (recent.type === 'script' || recent.type === 'consumer')) {
          // Прокидываем таргатам, если это скрипт
          if ((param === 'executed' || param === 'last_execution') && role === 'script') {
            registerScriptExecution(id, now, cachedTraceId, null, false);
          }
          recentEventsCache.set(id, { timestamp: now, trace_id: cachedTraceId, type: context?.type || 'unknown' });
          return cachedTraceId;
        }
      }
    }
  }
  
  // 5) ВРЕМЕННАЯ КОРРЕЛЯЦИЯ (наследование от недавних SOURCE или других SCRIPT)
  if (TEMPORAL_TRACE_CORRELATION_ENABLED) {
    let inheritedTraceId = null;
    let inheritedTs = -1;
    
    const deviceTriggersScript = (deviceId, scriptId) => {
      if (!deviceId || !scriptId) return false;
      const src = state.get(deviceId);
      if (!src || typeof src !== 'object') return false;
      const arrayKeys = ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff'];
      for (const k of arrayKeys) {
        if (Array.isArray(src[k]) && src[k].some(x => x === scriptId)) return true;
      }
      return false;
    };

    for (const [recentId, recent] of recentEventsCache.entries()) {
      if (!recent || typeof recent.timestamp !== 'number') continue;
      const timeDiff = now - recent.timestamp;
      if (timeDiff < 0 || timeDiff > RECENT_EVENT_WINDOW_MS) continue;
      
      const recentRole = getDeviceRole(recentId);
      const canInherit = (recent.type === 'script') || (recentRole === 'script') || (recentRole === 'device' && deviceTriggersScript(recentId, id));
      
      if (canInherit && recent.timestamp > inheritedTs && recent.trace_id) {
        inheritedTs = recent.timestamp;
        inheritedTraceId = recent.trace_id;
      }
    }
    
    if (inheritedTraceId) {
      traceIdCache.set(id, inheritedTraceId);
      recentEventsCache.set(id, { timestamp: now, trace_id: inheritedTraceId, type: 'script' });
      if (role === 'script' && payload && payload.executed === true) {
        registerScriptExecution(id, now, inheritedTraceId, null, false);
      }
      return inheritedTraceId;
    }
  }

  // 6) НОВЫЙ ТРАССИРОВОЧНЫЙ ID
  const newTraceId = uuidv4();
  
  if (isSchedulerLike && typeof eventTimestamp === 'number') {
    schedulerTickTraceCache.set(eventTimestamp, newTraceId);
    log(`🆕 [TICK] Зарегистрирован новый trace_id для тика ${eventTimestamp}: ${newTraceId} (скрипт: ${id.slice(0,8)})`);
  }
  
  traceIdCache.set(id, newTraceId);
  recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: role === 'script' ? 'script' : 'unknown' });

  // Если это запуск скрипта, регистрируем его (таргеты и т.п.)
  if (role === 'script' && payload && payload.executed === true) {
    registerScriptExecution(id, now, newTraceId, null, false);
  }
  
  return newTraceId;
};

// Очистка старых записей из всех кэшей
// Зачем: предотвращение утечки памяти во всех кэшах системы
setInterval(() => {
  const now = Date.now();
  const expiredThreshold = now - (RECENT_EVENT_WINDOW_MS * 2); // Удаляем события старше 4 секунд
  const scriptExpiredThreshold = now - (SCRIPT_EXECUTION_WINDOW_MS * 2); // Удаляем скрипты старше 10 секунд
  const traceCacheThreshold = now - TRACE_CACHE_TTL_MS; // Удаляем trace_id старше 1 часа
  const actuatorCacheThreshold = now - ACTUATOR_CACHE_TTL_MS; // Удаляем актуаторы старше 24 часов
  
  let cleanedCount = {
    recentEvents: 0,
    scripts: 0,
    traces: 0,
    actuators: 0,
    channels: 0,
    deviceStates: 0
  };
  
  // Очистка recentEventsCache
  for (const [id, event] of recentEventsCache.entries()) {
    if (event.timestamp < expiredThreshold) {
      recentEventsCache.delete(id);
      cleanedCount.recentEvents++;
    }
  }
  
  // Очистка activeScriptsCache
  for (const [scriptId, scriptInfo] of activeScriptsCache.entries()) {
    if (scriptInfo.timestamp < scriptExpiredThreshold) {
      activeScriptsCache.delete(scriptId);
      cleanedCount.scripts++;
    }
  }
  
  // Очистка scriptExecutionCache (зачем: удаление завершённых скриптов для синтетических событий)
  const scriptExecutionExpiredThreshold = now - SCRIPT_CACHE_CLEANUP_THRESHOLD_MS;
  for (const [scriptId, cached] of scriptExecutionCache.entries()) {
    if (cached.firstChangeTimestamp < scriptExecutionExpiredThreshold) {
      scriptExecutionCache.delete(scriptId);
      cleanedCount.scripts++;
    }
  }

  // Очистка schedulerTickTraceCache
  // Зачем: предотвращение утечки памяти (tick-ключи живут недолго; достаточно пары секунд).
  const tickExpiredThreshold = now - (RECENT_EVENT_WINDOW_MS * 2);
  for (const [ts, v] of schedulerTickTraceCache.entries()) {
    if (!v || typeof v.timestamp !== 'number' || v.timestamp < tickExpiredThreshold) {
      schedulerTickTraceCache.delete(ts);
    }
  }
  
  // Очистка traceIdCache (зачем: удаление старых trace_id для предотвращения утечки памяти)
  for (const [id, traceId] of traceIdCache.entries()) {
    const recentEvent = recentEventsCache.get(id);
    // Если события нет в recent или оно старое - удаляем trace_id
    if (!recentEvent || recentEvent.timestamp < traceCacheThreshold) {
      traceIdCache.delete(id);
      cleanedCount.traces++;
    }
  }
  
  // Очистка actuatorStateCache (зачем: удаление зависших записей актуаторов)
  for (const [id, cached] of actuatorStateCache.entries()) {
    const age = now - cached.onTimestamp;
    if (age > ACTUATOR_CACHE_TTL_MS) {
      actuatorStateCache.delete(id);
      cleanedCount.actuators++;
    }
  }
  
  // Очистка channelStateCache (зачем: удаление зависших записей каналов)
  for (const [id, cached] of channelStateCache.entries()) {
    const age = now - cached.onTimestamp;
    if (age > ACTUATOR_CACHE_TTL_MS) {
      channelStateCache.delete(id);
      cleanedCount.channels++;
    }
  }
  
  // Очистка deviceState по TTL (зачем: удаление неактивных устройств для предотвращения утечки памяти)
  const deviceStateThreshold = now - DEVICE_STATE_TTL_MS;
  for (const [id, cachedState] of deviceState.entries()) {
    // Проверяем timestamp последнего обновления (если есть)
    const lastUpdate = cachedState._lastUpdate || 0;
    if (lastUpdate > 0 && lastUpdate < deviceStateThreshold) {
      deviceState.delete(id);
      cleanedCount.deviceStates++;
    }
  }
  
  // Очистка deviceState при превышении размера (зачем: ограничение роста кэша состояний устройств)
  if (deviceState.size > DEVICE_STATE_MAX_SIZE) {
    // Более агрессивная очистка: удаляем до достижения 80% от лимита
    const targetSize = Math.floor(DEVICE_STATE_MAX_SIZE * 0.8);
    const toDelete = deviceState.size - targetSize;
    
    if (toDelete > 0) {
      const entries = Array.from(deviceState.entries());
      // Сортируем по времени последнего обновления
      entries.sort((a, b) => {
        const timeA = a[1]._lastUpdate || 0;
        const timeB = b[1]._lastUpdate || 0;
        return timeA - timeB; // Старые первыми
      });
      
      // Удаляем самые старые записи до достижения целевого размера
      for (let i = 0; i < toDelete && i < entries.length; i++) {
        deviceState.delete(entries[i][0]);
        cleanedCount.deviceStates++;
      }
    }
  }
  
  // Очистка trace для жестов (S4): удаляем зависшие gesture_id (зачем: не держать trace_id в памяти после отпускания)
  {
    const nowTs = Date.now();
    const gestureTtlMs = 15000;
    const threshold = nowTs - gestureTtlMs;
    for (const [gid, info] of gestureTraceCache.entries()) {
      const lastTs = info && typeof info.last_ts === 'number' ? info.last_ts : 0;
      if (lastTs < threshold) gestureTraceCache.delete(gid);
    }
    for (const [baseId, st] of signalSourceCache.entries()) {
      const lastActive = st && st.active && typeof st.active.last_ts === 'number' ? st.active.last_ts : 0;
      if (lastActive && lastActive < threshold) {
        // Зачем: если жест завис, сбрасываем, чтобы следующий клик стартовал корректно.
        st.active = null;
        signalSourceCache.set(baseId, st);
      }
    }
  }

  // Логирование результатов очистки и размеров кэшей
  const totalCleaned = Object.values(cleanedCount).reduce((sum, count) => sum + count, 0);
  if (totalCleaned > 0 || deviceState.size > DEVICE_STATE_MAX_SIZE * 0.8) {
    // Логируем если что-то очистили или deviceState близок к лимиту
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    log(`🧹 Очистка кэшей: recentEvents=${cleanedCount.recentEvents}, scripts=${cleanedCount.scripts}, traces=${cleanedCount.traces}, actuators=${cleanedCount.actuators}, channels=${cleanedCount.channels}, deviceStates=${cleanedCount.deviceStates} | Размеры: deviceState=${deviceState.size}/${DEVICE_STATE_MAX_SIZE}, traceId=${traceIdCache.size}, actuator=${actuatorStateCache.size}, channel=${channelStateCache.size} | Память: ${memMB}MB`);
  }
}, 5000); // Очистка каждые 5 секунд (увеличена частота для более агрессивной очистки)

// Обработка ACTION_SET сообщений
const handleActionSet = (message) => {
  try {
    const { id, payload, _context } = message;
    
    if (!id || !payload || typeof payload !== 'object') {
      return;
    }
    
    // Получаем старое состояние
    const oldState = deviceState.get(id) || {};
    
    // Обновляем состояние, но храним только необходимые поля для экономии памяти
    // Зачем: храним только поля, используемые для сравнения, а не весь объект состояния
    const essentialFields = {};
    // Копируем только нужные поля из oldState
    const fieldsToKeep = ['executed', 'last_execution', 'value', 'brightness', 'r', 'g', 'b',
                          'fan_speed', 'mode', 'direction', 'setpoint', 'temperature', 'humidity',
                          'co2', 'code', 'title', 'name', 'parent', 'site', 'project', 'type',
                          'bind', // Зачем: связь consumer↔channel для trace_id (и enrichChannelEvent)
                          // Зачем: поля для резолва целей скриптов (script-targets.js) и построения цепочек
                          'action', 'schedule', 'clock', 'timer', 'duration',
                          // Зачем: триггеры устройств (SOURCE) — иначе "S4 ... / Click" не попадёт в логи и trace.
                          'onDoppler', 'onTrue', 'onFalse', 'onChange', 'onOpen', 'onClose',
                          // Зачем: реальные DI/кнопки часто хранят триггеры как массивы скриптов (onClick/onHold/...),
                          // а live ACTION_SET по value приходит без этих полей — их надо сохранить из init snapshot.
                          'onClick', 'onClick2', 'onHold', 'onOn', 'onOff',
                          // Зачем: action-объекты хранят ссылки в target/ref/id/site и вложенный payload.*
                          'target', 'ref', 'id', 'payload', 'device', 'do', 'dim'];
    for (const field of fieldsToKeep) {
      if (oldState[field] !== undefined) {
        essentialFields[field] = oldState[field];
      }
    }
    // Добавляем новые поля из payload
    for (const field of fieldsToKeep) {
      if (payload[field] !== undefined) {
        essentialFields[field] = payload[field];
      }
    }
    // Сохраняем timestamp последнего обновления для TTL очистки
    essentialFields._lastUpdate = Date.now();
    
    deviceState.set(id, essentialFields);
    
    // Используем полный объект только для текущей обработки
    const newState = { ...oldState, ...payload };
    
    // ❌ НЕ ПИШЕМ в state! Event-logger только читает, не модифицирует БД
    // state.set(id, newState);
    
    // Зачем: логирование только в режиме отладки
    logDebug(`handleActionSet для ${id}`, {
      payloadHasCode: !!payload.code,
      payloadHasTitle: !!payload.title,
      payloadHasName: !!payload.name
    });
    
    // 1. Кэш устройств не нужен - данные уже в state, обновление происходит автоматически через WebSocket
    
    // 2. Обновляем кэш состояния актуаторов и получаем информацию о включении/выключении/обновлении
    // Зачем: получаем информацию о времени включения и длительности работы для обогащения событий
    const actuatorStateInfo = updateActuatorStateCache(id, oldState, newState);
    
    // Получаем контекст из _context или создаём пустой
    const context = _context || {
      type: 'unknown',
      ref: null,
      deviceId: null,
      session: null,
      remote_ip: null
    };

    // Зачем: bind может отсутствовать в state (особенно для каналов), но приходит в payload.
    // Используем его для связности trace_id между CONSUMER и ACTUATOR channel.
    if (payload && typeof payload.bind === 'string' && payload.bind) {
      context.bind = payload.bind;
    }
    
    // 3. Генерируем trace_id для трассировки
    // Зачем: определяем ключевой параметр для анализа (executed, last_execution или другой)
    const keyParam = payload.executed !== undefined ? 'executed' : 
                     payload.last_execution !== undefined ? 'last_execution' : 
                     Object.keys(payload).find(k => k !== 'timestamp') || null;
    // Зачем: многие события приходят по DI каналу (/di/*), но логика триггеров и жестов привязана к baseId.
    const baseId = (typeof id === 'string') ? id.split('/')[0] : String(id);
    
    const msgTimestamp = payload.timestamp || Date.now();

    // Зачем: единый нормализованный источник сигнала (WS -> signal_source) для аналитики и трассировки.
    // Важно: state может быть ещё не инициализирован (до initStateFromWebSocket), поэтому делаем fallback на deviceState.
    const stateForSource = {
      get: (sid) => {
        const v = state.get(sid);
        if (v !== undefined) return v;
        return deviceState.get(sid);
      }
    };
    const signalSource = resolveSignalSourceFromWs(message, { state: stateForSource, cache: signalSourceCache });
    context.signal_source = signalSource;

    // Зачем: триггер‑устройства (кнопки/датчики), запускающие скрипты через onDoppler/onTrue/...,
    // должны открывать новый trace_id (SOURCE), иначе их легко “прилипить” к шумным соседним цепочкам.
    // Также это позволяет заранее прокинуть trace_id в связанные скрипты/targets.
    const isTriggerDevice = (() => {
      // Зачем: в бою live ACTION_SET обычно несёт только {value,timestamp}, а связи onDoppler/onClick/... лежат в init snapshot.
      // Поэтому проверяем не только payload, но и агрегированный newState (oldState + payload).
      const src = (newState && typeof newState === 'object') ? newState : payload;
      if (!src || typeof src !== 'object') return false;

      const hasStringTrigger =
        (typeof src.onDoppler === 'string' && src.onDoppler) ||
        (typeof src.onTrue === 'string' && src.onTrue) ||
        (typeof src.onFalse === 'string' && src.onFalse) ||
        (typeof src.onChange === 'string' && src.onChange) ||
        (typeof src.onOpen === 'string' && src.onOpen) ||
        (typeof src.onClose === 'string' && src.onClose);

      const hasArrayTrigger = (() => {
        // Зачем: реальные DI/кнопки часто хранят скрипты как массивы: onClick: ["<scriptId>", ...]
        for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
          const v = src[k];
          if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x)) return true;
        }
        return false;
      })();

      if (hasStringTrigger || hasArrayTrigger) return true;

      // Зачем: в бою событие клика может приходить по базовому устройству (MAC),
      // а сами триггеры на скрипты лежат в DI канале (например, `${id}/di/1`).
      // Чтобы не зависеть от наличия DI событий в логе, резолвим триггеры через init snapshot.
      if (typeof baseId === 'string' && baseId.includes(':')) {
        // 1) Если событие пришло по DI, в state может быть полный DI snapshot с onClick/onHold.
        if (typeof id === 'string' && id.includes('/di/')) {
          const diSelf = state.get(id);
          if (diSelf && typeof diSelf === 'object') {
            for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
              const v = diSelf[k];
              if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x)) return true;
            }
          }
        }

        // 2) Универсальный фолбэк: DI snapshot по baseId
        const di = state.get(`${baseId}/di/1`);
        if (di && typeof di === 'object') {
          for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
            const v = di[k];
            if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x)) return true;
          }
        }
      }

      return false;
    })();

    // Зачем: правило — все источники являются началом цепочки трассировки.
    // Поэтому SOURCE фиксируем только по "сигналам запуска" (клик/триггер), но НЕ по шуму (humidity/temperature).
    // В боевом WS клик по S4 может приходить как value ИЛИ как инкремент счётчика DI (onClick*Count/onHoldCount).
    const isTriggerCountEvent = isTriggerDevice && (keyParam === 'onClick1Count' || keyParam === 'onClick2Count' || keyParam === 'onHoldCount');
    const isTriggerValueEvent = isTriggerDevice && keyParam === 'value';
    // Зачем: для датчиков‑источников (doppler/motion) запуск приходит не через value, а через поля измерений.
    const isTriggerSensorEvent = isTriggerDevice && (keyParam === 'doppler' || keyParam === 'motion');
    const isTriggerStartEvent = isTriggerValueEvent || isTriggerCountEvent || isTriggerSensorEvent;

    // Зачем: для S4 удержание/диммирование идёт серией ACTION_SET(value) и не должно дробиться на разные trace_id.
    // Склеиваем по gesture_id (down/move/up) в пределах одного устройства.
    const isS4Value = Boolean(
      signalSource &&
      signalSource.kind === 'manual' &&
      signalSource.channel === 's4' &&
      keyParam === 'value'
    );
    const isS4Count = Boolean(
      signalSource &&
      signalSource.kind === 'manual' &&
      signalSource.channel === 's4' &&
      (keyParam === 'onClick1Count' || keyParam === 'onClick2Count' || keyParam === 'onHoldCount')
    );

    // Зачем: для S4 удержание/диммирование идёт серией ACTION_SET(value) и не должно дробиться на разные trace_id,
    // даже если триггеры скриптов временно не резолвятся (порядок init/run, неполный snapshot).
    if ((isS4Value || isS4Count) && signalSource?.action?.gesture_id) {
      const gid = signalSource.action.gesture_id;
      const existing = gestureTraceCache.get(gid);
      if (existing && existing.trace_id) {
        context.trace_id = normalizeTraceId(existing.trace_id);
        existing.last_ts = msgTimestamp;
        gestureTraceCache.set(gid, existing);
      } else if (signalSource.action.phase === 'down' && !context.trace_id) {
        // Зачем: в бою иногда эффект (SCRIPT/CONSUMER) приходит РАНЬШЕ источника (S4),
        // и синтетика успевает открыть trace_id без SOURCE. Тогда SOURCE “опаздывает” и стартует новый trace,
        // что выглядит как “украденный трейс у соседа”.
        // Исправление: если связанные скрипты (onClick/onHold/...) УЖЕ имеют свежий trace_id,
        // подцепляем SOURCE к нему (строго по явным связям, с маленьким окном по времени).
        const recoverWindowMs = 1500;
        const candidateScriptIds = [];
        const s4t = (signalSource && signalSource.linked && signalSource.linked.trigger_scripts)
          ? signalSource.linked.trigger_scripts
          : null;
        if (s4t) {
          for (const x of (Array.isArray(s4t.onClick) ? s4t.onClick : [])) candidateScriptIds.push(x);
          for (const x of (Array.isArray(s4t.onClick2) ? s4t.onClick2 : [])) candidateScriptIds.push(x);
          for (const x of (Array.isArray(s4t.onHold) ? s4t.onHold : [])) candidateScriptIds.push(x);
        } else {
          const di = state.get(`${baseId}/di/1`);
          if (di && typeof di === 'object') {
            for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
              const v = di[k];
              if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x) candidateScriptIds.push(x);
            }
          }
        }
        const uniq = Array.from(new Set(candidateScriptIds.filter(Boolean)));
        let recovered = null;
        for (const sid of uniq) {
          const cached = normalizeTraceId(traceIdCache.get(sid));
          const recent = recentEventsCache.get(sid);
          if (!cached || !recent || typeof recent.timestamp !== 'number') continue;
          const age = msgTimestamp - recent.timestamp;
          if (age < 0 || age > recoverWindowMs) continue;
          if (recent.trace_id !== cached) continue;
          if (!recovered || recent.timestamp > recovered.ts) {
            recovered = { trace_id: cached, ts: recent.timestamp, sid };
          }
        }

        const newTrace = normalizeTraceId(recovered?.trace_id) || uuidv4();
        context.trace_id = newTrace;
        gestureTraceCache.set(gid, { trace_id: newTrace, last_ts: msgTimestamp });
      }
      // Зачем: на release закрываем жест, чтобы следующий клик стартовал новый trace_id.
      if (signalSource.action.phase === 'up') {
        gestureTraceCache.delete(gid);
      }
    } else if (isTriggerStartEvent && !context.trace_id) {
      context.trace_id = uuidv4();
    }

    // Зачем: для боевых логов _context часто отсутствует, и SCRIPT приходится выводить из изменений устройств.
    // Чтобы device/actuator/consumer попали в тот же trace_id, что и синтетический SCRIPT,
    // сначала пробуем определить запуск скрипта по изменению устройства, и только потом считаем trace_id.
    if (SYNTHETIC_SCRIPT_EVENTS_ENABLED && payload.executed === undefined && payload.last_execution === undefined) {
      checkAndGenerateScriptEvent(id, msgTimestamp, newState);
    }

    // Зачем: сохраняем исходный timestamp WS-сообщения в контексте,
    // чтобы “реальные” события (в т.ч. SCRIPT executed) писались с правильным временем,
    // а не с Date.now(), иначе ломается порядок в цепочках.
    context.event_timestamp = msgTimestamp;

    const traceIdRaw = generateTraceId(id, context, keyParam, msgTimestamp);
    const traceId = normalizeTraceId(traceIdRaw);
    context.trace_id = traceId;

    // Зачем: SOURCE → SCRIPT → (targets...) — заранее прокидываем trace_id в скрипты, которые запускает устройство.
    // Это снижает зависимость от порядка прихода WS сообщений и окна RECENT_EVENT_WINDOW_MS.
    if (isTriggerStartEvent) {
      const triggerScriptIds = [];
      const src = (newState && typeof newState === 'object') ? newState : payload;

      // Зачем: S4 имеет разные типы нажатий (одинарный/двойной/удержание),
      // и у них разные триггеры на скрипты (onClick/onClick2/onHold).
      const s4Triggers = (signalSource && signalSource.kind === 'manual' && signalSource.channel === 's4' && signalSource.linked && signalSource.linked.trigger_scripts)
        ? signalSource.linked.trigger_scripts
        : null;

      if (s4Triggers) {
        // Зачем: точный тип нажатия (double/hold) мы можем понять только по завершению жеста,
        // но скрипт может начать цепочку раньше/параллельно. Поэтому для трассировки прокидываем trace_id
        // на ВСЕ потенциальные скрипты (onClick/onClick2/onHold), а не только на выбранный click_kind.
        // Это не создаёт "лишних событий" само по себе — лишь позволяет реальным/синтетическим SCRIPT executed
        // унаследовать корректный trace_id, если они действительно сработали.
        for (const x of (Array.isArray(s4Triggers.onClick) ? s4Triggers.onClick : [])) triggerScriptIds.push(x);
        for (const x of (Array.isArray(s4Triggers.onClick2) ? s4Triggers.onClick2 : [])) triggerScriptIds.push(x);
        for (const x of (Array.isArray(s4Triggers.onHold) ? s4Triggers.onHold : [])) triggerScriptIds.push(x);
      } else {
        // Зачем: fallback для прочих DI/кнопок, где триггеры хранятся в объекте устройства/DI.
        for (const k of ['onClick', 'onClick2']) {
          const v = src ? src[k] : null;
          if (Array.isArray(v)) {
            for (const x of v) {
              if (typeof x === 'string' && x) triggerScriptIds.push(x);
            }
          }
        }
        // Зачем: события могут приходить по DI, а триггеры лежат в DI snapshot.
        if (typeof baseId === 'string' && baseId.includes(':')) {
          // 1) DI по текущему id (если это /di/*)
          if (typeof id === 'string' && id.includes('/di/')) {
            const diSelf = state.get(id);
            if (diSelf && typeof diSelf === 'object') {
              for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
                const v = diSelf[k];
                if (Array.isArray(v)) {
                  for (const x of v) {
                    if (typeof x === 'string' && x) triggerScriptIds.push(x);
                  }
                }
              }
            }
          }
          // 2) DI/1 по baseId
          const di = state.get(`${baseId}/di/1`);
          if (di && typeof di === 'object') {
            for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
              const v = di[k];
              if (Array.isArray(v)) {
                for (const x of v) {
                  if (typeof x === 'string' && x) triggerScriptIds.push(x);
                }
              }
            }
          }
        }
      }

      const uniqueTriggerScriptIds = Array.from(new Set(triggerScriptIds.filter(Boolean)));
      for (const scriptId of uniqueTriggerScriptIds) {
        traceIdCache.set(scriptId, traceId);
        recentEventsCache.set(scriptId, { timestamp: msgTimestamp, trace_id: traceId, type: 'script' });
        const targets = getScriptTargetDevices(scriptId);
        for (const tid of targets) {
          // Зачем: script-graph reservation.
          // Раньше мы пропускали вложенные скрипты, из-за чего их executed мог стартовать новый trace_id
          // и “утащить” конечные устройства (пример: S4 hold → nested script → Эл.конвектор/Лоджия).
          //
          // Безопасность: это только резервирование trace_id (кэш), а не генерация событий.
          // Выбор ветки on/off для синтетики делается строго по consumer.value (см. checkAndGenerateScriptEvent),
          // поэтому отметка обеих веток trace_id не приводит к "лишним" SCRIPT executed.
          //
          // Доп. защита: ветки on/off распознаём по title и помечаем, но НЕ используем как основание для генерации.
          if (getDeviceRole(tid) === 'script' && isBranchScriptByTitle(tid)) {
            traceIdCache.set(tid, traceId);
            recentEventsCache.set(tid, { timestamp: msgTimestamp, trace_id: traceId, type: 'script' });
            continue;
          }
          traceIdCache.set(tid, traceId);
          recentEventsCache.set(tid, { timestamp: msgTimestamp, trace_id: traceId, type: 'script' });
        }
      }
    }

    // Зачем: если это CONSUMER и у него есть bind на канал/актуатор, прокидываем trace_id в канал.
    // Это важно, когда WS сообщение по каналу приходит без payload.bind (в бою такое встречается),
    // иначе канал окажется в другом trace_id, хотя физически связан с потребителем.
    {
      const deviceType = getDeviceTypeWithFallback(id);
      const isConsumer = isConsumerDevice(deviceType);
      if (isConsumer) {
        const fields = getDeviceFields(id);
        const bindId = (payload && typeof payload.bind === 'string' && payload.bind)
          ? payload.bind
          : (fields && typeof fields.bind === 'string' && fields.bind ? fields.bind : null);
        if (bindId) {
          traceIdCache.set(bindId, traceId);
          recentEventsCache.set(bindId, { timestamp: msgTimestamp, trace_id: traceId, type: 'consumer' });
        }
        recentEventsCache.set(id, { timestamp: msgTimestamp, trace_id: traceId, type: 'consumer' });
      }
    }
    
    // Создаём чистый payload без timestamp для правильного сравнения
    const cleanPayload = { ...payload };
    delete cleanPayload.timestamp;
    
    // Зачем: синтетика уже обработана выше для device-событий; для SCRIPT executed не генерируем синтетику повторно.
    
    // Зачем: если это запуск скрипта (реальный от демона), регистрируем его выполнение.
    // Это прокинет trace_id всем таргетам и свяжет их с этим скриптом в одну цепочку.
    if (getDeviceRole(id) === 'script' && payload && payload.executed === true) {
      registerScriptExecution(id, msgTimestamp, traceId, null, false);
    }
    
    // Обрабатываем событие (используем логику из event-log.js)
    // Зачем: передаем информацию о состоянии актуатора для обогащения событий
    processEvent(id, oldState, newState, context, cleanPayload, actuatorStateInfo);
    
  } catch (error) {
    logError('Ошибка обработки ACTION_SET:', error.message, error.stack);
  }
};

// Обработка события (логика из event-log.js)
// Зачем: обработка событий с обогащением информацией о включении/выключении устройств
const processEvent = (id, oldState, newState, context, changedPayload = null, actuatorStateInfo = null) => {
  if (!id || !newState || typeof newState !== 'object') return;
  
  // Если передан changedPayload, логируем только параметры из payload
  const paramsToCheck = changedPayload ? Object.keys(changedPayload) : null;
  
  // Специальная обработка для события запуска скрипта
  // Логируем событие запуска скрипта (executed, last_execution)
  if (newState.executed !== undefined || newState.last_execution !== undefined) {
    const param = newState.executed !== undefined ? 'executed' : 'last_execution';
    
    // Правильная обработка oldValue
    let oldValue = null;
    if (param === 'executed') {
      oldValue = oldState?.executed !== undefined ? oldState.executed : null;
    } else {
      oldValue = oldState?.last_execution !== undefined ? oldState.last_execution : null;
    }
    const newValue = newState.executed !== undefined ? newState.executed : (newState.last_execution || null);
    
    // Для executed и last_execution не применяем округление
    const roundedOldValue = oldValue !== null && oldValue !== undefined ? oldValue : null;
    const roundedNewValue = newValue !== null && newValue !== undefined ? newValue : null;
    
    // Для скриптов получаем site из родительской локации
    let siteName = getSiteName(id);
    if (!siteName && newState.parent) {
      siteName = getSiteName(newState.parent);
    }
    
    const triggerDeviceId = getTriggerDeviceId(context);
    
    // Получаем данные устройства из state
    // Зачем: сохраняем оригинальные значения полей в OpenSearch без резолва по цепочке
    const deviceFields = getDeviceFields(id);
    const deviceName = deviceFields?.name ?? null;
    const deviceCode = deviceFields?.code ?? null;
    const deviceTitle = deviceFields?.title ?? null;
    
    // Зачем: human вычисляем из оригинальных полей (title/code/name через "/")
    const deviceHuman = getHumanName({ title: deviceTitle, code: deviceCode, name: deviceName }) || getHumanName(newState);
    
    // Зачем: определение типа устройства для проверки, является ли оно потребителем
    const deviceType = getDeviceTypeWithFallback(id);
    const isConsumer = isConsumerDevice(deviceType);
    
    // Зачем: боевой WS для executed/last_execution часто содержит только {executed:true,timestamp},
    // поэтому action_type нельзя вычислять из newState (получим ACTION_UNKNOWN).
    // Берём полный объект скрипта из state (init snapshot) и фолбэчим на newState.
    const scriptStateFull = state.get(id);
    const scriptActionType = determineScriptActionType(id, (scriptStateFull && typeof scriptStateFull === 'object') ? scriptStateFull : newState);
    const eventTimestamp =
      (context && typeof context.event_timestamp === 'number')
        ? context.event_timestamp
        : Date.now();
    
    const event = {
      // Зачем: у реальных WS-событий timestamp должен совпадать с payload.timestamp,
      // иначе сортировка “SCRIPT → ACTUATOR → CONSUMER” становится не причинной.
      timestamp: eventTimestamp,
      id,
      device: {
        // Зачем: это НЕ синтетика, а реальный факт executed/last_execution от демона.
        // Ставим type='SCRIPT', чтобы в OpenSearch фильтр по device.type:SCRIPT находил и реальные события тоже.
        type: 'SCRIPT',
        human: deviceHuman,
        name: deviceName,
        code: deviceCode,
        title: deviceTitle,
        consumer: isConsumer // Зачем: признак потребителя для мониторинга
      },
      param,
      old: roundedOldValue,
      new: roundedNewValue,
      trigger: {
        type: 'script', // Всегда 'script' для события запуска скрипта
        ref: context.ref || null,
        id: triggerDeviceId, // ID устройства-источника
        human: getTriggerHuman(context, triggerDeviceId),
        session: context.session || null,
        remote_ip: context.remote_ip || null
      },
      site: siteName || null,
      project: getProjectName(id),
      trace_id: context.trace_id || null, // Трассировка событий
      extra: {
        action_type: scriptActionType,
        // Зачем: явная пометка “это не синтетика”, чтобы в OpenSearch не было двусмысленности.
        synthetic: false
      }
    };
    
    // Зачем: обогащаем событие информацией о канале, конечном устройстве и щитовом устройстве
    const enrichedEvent = enrichChannelEvent(id, event);
    
    // Зачем: отслеживаем включение/выключение/обновление каналов do и dim
    if (enrichedEvent.channel && enrichedEvent.endDevice) {
      const channelStateInfo = updateChannelStateCache(
        id,                    // channelId
        roundedOldValue,        // oldValue
        roundedNewValue,        // newValue
        enrichedEvent.endDevice.id  // endDeviceId
      );
      
      // Добавляем информацию о состоянии канала в extra
      if (channelStateInfo) {
        if (channelStateInfo.type === 'on') {
          // Включение: добавляем время включения
          enrichedEvent.extra.end_device_on = {
            on_timestamp: channelStateInfo.onTimestamp,
            channel_id: channelStateInfo.channelId,
            value: channelStateInfo.value
          };
        } else if (channelStateInfo.type === 'off') {
          // Выключение: добавляем информацию о длительности работы
          enrichedEvent.extra.end_device_off = {
            on_timestamp: channelStateInfo.onTimestamp,
            duration_ms: channelStateInfo.duration,
            duration_seconds: Math.round(channelStateInfo.duration / 1000),
            channel_id: channelStateInfo.channelId,
            value: channelStateInfo.value
          };
          // Зачем: добавляем timestamp_on в формате ISO для индексации в OpenSearch как дата
          if (channelStateInfo.onTimestamp) {
            enrichedEvent.timestamp_on = new Date(channelStateInfo.onTimestamp).toISOString();
          }
        } else if (channelStateInfo.type === 'update') {
          // Обновление параметров во время работы: добавляем время включения и текущую длительность
          enrichedEvent.extra.end_device_update = {
            on_timestamp: channelStateInfo.onTimestamp,
            duration_ms: channelStateInfo.duration,
            duration_seconds: Math.round(channelStateInfo.duration / 1000),
            channel_id: channelStateInfo.channelId,
            value: channelStateInfo.value
          };
          // Зачем: добавляем timestamp_on в формате ISO для индексации в OpenSearch как дата
          if (channelStateInfo.onTimestamp) {
            enrichedEvent.timestamp_on = new Date(channelStateInfo.onTimestamp).toISOString();
          }
        }
      }
    }
    
    // Отправляем событие
    sendEvent(enrichedEvent);
    return; // Логируем только событие запуска скрипта
  }
  
  // Использование типизированной системы фильтров
  const allParams = filters.ALL_PARAMS;
  
  for (const param of allParams) {
    // Если передан changedPayload, проверяем только параметры из payload
    if (paramsToCheck && !paramsToCheck.includes(param)) {
      continue; // Параметр не был изменён в payload
    }
    
    const oldValue = oldState?.[param];
    const newValue = newState[param];
    
    // Зачем: определяем тип устройства до использования в фильтрах
    const deviceType = getDeviceTypeWithFallback(id);
    
    // Зачем: для фильтрации потребителей передаем тип устройства из newState
    // Проблема: filters.js проверяет state.get(id), но устройство может быть еще не загружено
    // Решение: проверяем тип из newState напрямую
    const deviceTypeForFilter = newState.type || deviceType;
    const isConsumerForFilter = isConsumerDevice(deviceTypeForFilter);
    
    // Создаем расширенную функцию проверки актуатора, которая также учитывает потребителей
    const isActuatorOrConsumer = (id) => {
      // Проверяем, является ли актуатором
      if (isActuatorDevice(id)) return true;
      // Проверяем, является ли потребителем
      return isConsumerForFilter;
    };
    
    // Проверка через типизированную систему фильтров
    const shouldLog = filters.shouldLogEvent(param, oldValue, newValue, id, isActuatorOrConsumer);
    if (!shouldLog) {
      // Зачем: временное логирование для отладки фильтров
      if (id === '8828b19b-55b6-4f88-ac6b-20c41b02f1ad') {
        log(`🚫 Событие отфильтровано: ${id.slice(0,8)} ${param}  ${oldValue}→${newValue} type=${deviceTypeForFilter} consumer=${isConsumerForFilter}`);
      }
      continue; // Фильтр отклонил событие
    }
    // Зачем: обрабатываем как числовые типы устройств, так и строковые (site, project, daemon)
    let deviceTypeStr = null;
    if (typeof deviceType === 'number') {
      deviceTypeStr = `DEVICE_TYPE_${deviceType.toString(16).toUpperCase()}`;
    } else if (typeof deviceType === 'string') {
      // Для строковых типов (site, project, daemon, actuator_channel) возвращаем как есть в верхнем регистре
      deviceTypeStr = deviceType.toUpperCase();
    }
    
    // Определяем валидность значений
    const oldIsValid = oldValue !== undefined && oldValue !== null && !(typeof oldValue === 'number' && Number.isNaN(oldValue));
    const newIsValid = newValue !== undefined && newValue !== null && !(typeof newValue === 'number' && Number.isNaN(newValue));
    
    // Округляем значения до десятых
    const roundedOldValue = oldIsValid ? roundToTenths(oldValue) : null;
    const roundedNewValue = newIsValid ? roundToTenths(newValue) : null;
    
    // Определяем, является ли параметр числовым
    const isNumeric = isNumericParam(param);
    
    const triggerDeviceId = getTriggerDeviceId(context);
    
    // Получаем данные устройства из state
    // Зачем: сохраняем оригинальные значения полей в OpenSearch без резолва по цепочке
    const deviceFields = getDeviceFields(id);
    const deviceName = deviceFields?.name ?? null;
    const deviceCode = deviceFields?.code ?? null;
    const deviceTitle = deviceFields?.title ?? null;
    
    // Зачем: human вычисляем из оригинальных полей (title/code/name через "/")
    const deviceHuman = getHumanName({ title: deviceTitle, code: deviceCode, name: deviceName }) || getHumanName(newState);
    
    // Обогащаем событие информацией о включении/выключении/обновлении актуатора
    // Зачем: добавление on_timestamp и duration для мониторинга времени работы устройств
    const extra = {};
    if (context && context.signal_source && typeof context.signal_source === 'object') {
      // Зачем: делаем источник сигнала явным и тестируемым (WS -> signal_source).
      // Не пишем unknown, чтобы не раздувать события шумом.
      if (context.signal_source.kind && context.signal_source.kind !== 'unknown') {
        extra.signal_source = context.signal_source;
      }
    }
    if (actuatorStateInfo && (param === 'value' || param === 'brightness' || param === 'fan_speed' || param === 'mode' || param === 'setpoint')) {
      if (actuatorStateInfo.type === 'on') {
        // Включение: добавляем время включения
        // Зачем: убрали value - конфликт типов в OpenSearch (long vs boolean)
        extra.actuator_on = {
          on_timestamp: actuatorStateInfo.onTimestamp,
          param: actuatorStateInfo.param
        };
      } else if (actuatorStateInfo.type === 'off') {
        // Выключение: добавляем информацию о длительности работы
        // Зачем: убрали value - конфликт типов в OpenSearch
        extra.actuator_off = {
          on_timestamp: actuatorStateInfo.onTimestamp,
          duration_ms: actuatorStateInfo.duration,
          duration_seconds: Math.round(actuatorStateInfo.duration / 1000),
          param: actuatorStateInfo.param
        };
      } else if (actuatorStateInfo.type === 'update') {
        // Обновление параметров во время работы: добавляем время включения и текущую длительность
        // Зачем: убрали value - конфликт типов в OpenSearch
        extra.actuator_update = {
          on_timestamp: actuatorStateInfo.onTimestamp,
          duration_ms: actuatorStateInfo.duration,
          duration_seconds: Math.round(actuatorStateInfo.duration / 1000),
          param: actuatorStateInfo.param
        };
      }
    }
    
    // Зачем: определение, является ли устройство потребителем (алгоритм из src/monitor.js)
    const isConsumer = isConsumerDevice(deviceType);
    
    // Зачем: добавляем on_timestamp и duration на верхнем уровне события для удобства мониторинга
    const eventBase = {
      // Зачем: используем timestamp из WS (payload.timestamp), если он есть.
      // Иначе “реальные” события будут в другой шкале времени, чем SCRIPT executed,
      // и порядок в trace_id станет бессмысленным.
      timestamp: (context && typeof context.event_timestamp === 'number') ? context.event_timestamp : Date.now(),
      id,
      device: {
        type: deviceTypeStr,
        human: deviceHuman,
        name: deviceName,
        code: deviceCode,
        title: deviceTitle,
        consumer: isConsumer // Зачем: признак потребителя для мониторинга
      },
      param,
      old: roundedOldValue,
      new: roundedNewValue,
      // Для числовых параметров добавляем value.old и value.new
      ...(isNumeric ? {
        value: {
          old: roundedOldValue,
          new: roundedNewValue
        }
      } : {}),
      trigger: {
        type: context.type || 'unknown',
        ref: context.ref || null,
        id: triggerDeviceId,
        human: getTriggerHuman(context, triggerDeviceId),
        session: context.session || null,
        remote_ip: context.remote_ip || null
      },
      site: getSiteName(id),
      project: getProjectName(id),
      trace_id: context.trace_id || null, // Трассировка событий
      extra
    };
    
    // Добавляем on_timestamp и duration на верхнем уровне, если есть информация о состоянии актуатора
    // Зачем: упрощение мониторинга времени работы устройств без необходимости обращаться к extra
    if (actuatorStateInfo && (param === 'value' || param === 'brightness' || param === 'fan_speed' || param === 'mode' || param === 'setpoint')) {
      // Зачем: добавляем on_timestamp для всех типов событий (включение, выключение, обновление)
      if (actuatorStateInfo.onTimestamp) {
        eventBase.on_timestamp = actuatorStateInfo.onTimestamp;
      }
      // Зачем: duration добавляем только при выключении и обновлении (когда устройство уже работало)
      if (actuatorStateInfo.duration !== undefined) {
        eventBase.duration_ms = actuatorStateInfo.duration;
        eventBase.duration_seconds = Math.round(actuatorStateInfo.duration / 1000);
        // Зачем: добавляем timestamp_on в формате ISO для индексации в OpenSearch как дата (только при выключении/обновлении)
        if (actuatorStateInfo.onTimestamp) {
          eventBase.timestamp_on = new Date(actuatorStateInfo.onTimestamp).toISOString();
        }
      }
    }
    
    const event = eventBase;
    
    // Зачем: обогащаем событие информацией о канале, конечном устройстве и щитовом устройстве
    const enrichedEvent = enrichChannelEvent(id, event);
    
    // Зачем: отслеживаем включение/выключение/обновление каналов do и dim
    if (enrichedEvent.channel && enrichedEvent.endDevice) {
      const channelStateInfo = updateChannelStateCache(
        id,                    // channelId
        roundedOldValue,        // oldValue
        roundedNewValue,        // newValue
        enrichedEvent.endDevice.id  // endDeviceId
      );
      
      // Добавляем информацию о состоянии канала в extra
      if (channelStateInfo) {
        if (channelStateInfo.type === 'on') {
          // Включение: добавляем время включения
          enrichedEvent.extra.end_device_on = {
            on_timestamp: channelStateInfo.onTimestamp,
            channel_id: channelStateInfo.channelId,
            value: channelStateInfo.value
          };
        } else if (channelStateInfo.type === 'off') {
          // Выключение: добавляем информацию о длительности работы
          enrichedEvent.extra.end_device_off = {
            on_timestamp: channelStateInfo.onTimestamp,
            duration_ms: channelStateInfo.duration,
            duration_seconds: Math.round(channelStateInfo.duration / 1000),
            channel_id: channelStateInfo.channelId,
            value: channelStateInfo.value
          };
          // Зачем: добавляем timestamp_on в формате ISO для индексации в OpenSearch как дата
          if (channelStateInfo.onTimestamp) {
            enrichedEvent.timestamp_on = new Date(channelStateInfo.onTimestamp).toISOString();
          }
        } else if (channelStateInfo.type === 'update') {
          // Обновление параметров во время работы: добавляем время включения и текущую длительность
          enrichedEvent.extra.end_device_update = {
            on_timestamp: channelStateInfo.onTimestamp,
            duration_ms: channelStateInfo.duration,
            duration_seconds: Math.round(channelStateInfo.duration / 1000),
            channel_id: channelStateInfo.channelId,
            value: channelStateInfo.value
          };
          // Зачем: добавляем timestamp_on в формате ISO для индексации в OpenSearch как дата
          if (channelStateInfo.onTimestamp) {
            enrichedEvent.timestamp_on = new Date(channelStateInfo.onTimestamp).toISOString();
          }
        }
      }
    }
    
    // Отправляем событие
    sendEvent(enrichedEvent);
  }
};

// Отправка события в OpenSearch или буфер
const sendEvent = (event) => {
  const eventWithMeta = ensureLoggerPid(event, process.pid); // Зачем: гарантируем logger_pid на каждом событии

  // Зачем: записываем событие в локальный файл для резервного хранения
  writeEventToFile(eventWithMeta);
  
  // Зачем: не отправляем “по одному событию” — это приводит к шторма запросов и росту задержек при сетевых сбоях.
  // Вместо этого складываем в буфер и отправляем батчами.
  addToBuffer(eventWithMeta);
  flushBuffer().catch(() => {}); // best-effort, ошибки логируются внутри
};

// Запись события в локальный файл
// Зачем: резервное хранение событий в локальных файлах
const fs = require('fs');
const { VAR } = require('../assets/constants');

// Зачем: все файловые логи логгера (events/ws) держим в logs/logger, а не в var/log (var — для данных/БД)
const LOGGER_LOG_DIR = path.join(process.cwd(), 'logs', 'logger');
const LOGGER_EVENTS_DIR = path.join(LOGGER_LOG_DIR, 'events');
const LOGGER_WS_DIR = path.join(LOGGER_LOG_DIR, 'ws');

// Зачем: единая функция создания директории под логи
const ensureDir = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    logError('Ошибка создания директории логов:', dirPath, e && e.message ? e.message : String(e));
  }
};

// WS dump (RAW) → отдельный jsonl в logs/logger/ws
// Зачем: гарантируем, что ВСЕ входящие/исходящие WS сообщения пишутся 1:1 (без обогащения/изменений).
const WS_DUMP_MAX_MB = Number(process.env.WS_DUMP_MAX_MB || 64);
const WS_DUMP_MAX_BYTES = Number.isFinite(WS_DUMP_MAX_MB) ? Math.max(16, WS_DUMP_MAX_MB) * 1024 * 1024 : (64 * 1024 * 1024);

/**
 * @typedef {Object} WsDumpState
 * @property {string|null} currentFile
 * @property {import('fs').WriteStream|null} stream
 * @property {{line: string, bytes: number}[]} pending
 * @property {boolean} drainScheduled
 * @property {number} baseSizeBytes
 */

/** @type {Map<string, WsDumpState>} */
const wsDumpByBucket = new Map();

// Зачем: логически разделяем WS-логи по подвидам, чтобы быстро искать причины/цепочки.
const getWsBucket = (record) => {
  const dir = record && record.direction === 'out' ? 'out' : 'in';

  if (record && (record.too_large || record.parse_error)) return 'errors';
  // Зачем: для исходящих GET мы можем писать только метаданные (без raw), но bucket должен остаться handshake-out.
  if (!record || typeof record.raw !== 'string') {
    if (dir === 'out' && record && (record.msg_type === 'get' || record.msg_type === 'list')) return 'handshake-out';
    return dir === 'out' ? 'other-out' : 'other-in';
  }

  const raw = record.raw;

  // OUT: LIST/GET — это handshake
  if (dir === 'out') {
    if (raw.includes('"type":"list"') || raw.includes('"type":"LIST"') || raw.includes('"type":"get"') || raw.includes('"type":"GET"')) return 'handshake-out';
    return 'other-out';
  }

  // IN: list + init ACTION_SET — handshake; ACTION_SET с _context — realtime
  if (raw.includes('"type":"list"') || raw.includes('"type":"LIST"')) return 'handshake-in';
  if (raw.includes('"type":"action_set"') || raw.includes('"type":"ACTION_SET"')) {
    if (raw.includes('"_context"')) return 'realtime';
    return 'handshake-in';
  }

  return 'other-in';
};

// LIST storm guard
// Зачем: если основной демон/broadcast или внешний клиент шлёт LIST часто, мы не должны отвечать GET по кругу.
let lastListRequestAt = 0;
let listRequested = false;
let ignoredUnsolicitedListCount = 0;
const LIST_ACCEPT_WINDOW_MS = Number(process.env.LIST_ACCEPT_WINDOW_MS || 5000);

const getWsDumpState = (bucket) => {
  const key = bucket || 'other-in';
  let st = wsDumpByBucket.get(key);
  if (!st) {
    st = {
      currentFile: null,
      stream: null,
      pending: [],
      drainScheduled: false,
      baseSizeBytes: 0
    };
    wsDumpByBucket.set(key, st);
  }
  return st;
};

const rotateWsStreamIfNeeded = (bucket, st, nextBytes) => {
  if (!st || !st.stream || !st.currentFile) return;
  const streamWritten = typeof st.stream.bytesWritten === 'number' ? st.stream.bytesWritten : 0;
  const writtenTotal = st.baseSizeBytes + streamWritten;
  if ((writtenTotal + nextBytes) < WS_DUMP_MAX_BYTES) return;

  try { st.stream.end(); } catch {}

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const today = new Date().toISOString().split('T')[0];
  const bucketDir = path.join(LOGGER_WS_DIR, bucket);
  ensureDir(bucketDir);
  st.currentFile = path.join(bucketDir, `ws-${today}-${stamp}.jsonl`);
  st.stream = fs.createWriteStream(st.currentFile, { flags: 'a' });
  st.stream.on('error', (err) => logError('Ошибка write stream для ws-дампа:', err.message));
  st.baseSizeBytes = 0;
};

const flushPendingWsLines = (bucket) => {
  const st = getWsDumpState(bucket);
  if (!st.stream) return;
  while (st.pending.length > 0) {
    const item = st.pending[0];
    const line = item && item.line ? item.line : null;
    const bytes = item && Number.isFinite(item.bytes) ? item.bytes : (line ? Buffer.byteLength(line, 'utf8') : 0);
    if (!line) {
      st.pending.shift();
      continue;
    }

    rotateWsStreamIfNeeded(bucket, st, bytes);

    const ok = st.stream.write(line);
    // Зачем: stream.write() всегда принимает данные (даже если возвращает false) — повторная запись даст дубликаты.
    // Поэтому строку убираем из очереди сразу, а при backpressure просто ждём drain.
    st.pending.shift();
    if (!ok) {
      if (!st.drainScheduled) {
        st.drainScheduled = true;
        st.stream.once('drain', () => {
          st.drainScheduled = false;
          flushPendingWsLines(bucket);
        });
      }
      return;
    }
  }
};

const writeWsDump = (record) => {
  try {
    ensureDir(LOGGER_WS_DIR);

    const bucket = getWsBucket(record);
    const st = getWsDumpState(bucket);
    const bucketDir = path.join(LOGGER_WS_DIR, bucket);
    ensureDir(bucketDir);

    const today = new Date().toISOString().split('T')[0];
    const baseFile = path.join(bucketDir, `ws-${today}.jsonl`);

    if (!st.stream || !st.currentFile) {
      st.currentFile = baseFile;
      st.stream = fs.createWriteStream(st.currentFile, { flags: 'a' });
      st.stream.on('error', (err) => logError('Ошибка write stream для ws-дампа:', err.message));
      try { st.baseSizeBytes = fs.statSync(st.currentFile).size || 0; } catch { st.baseSizeBytes = 0; }
    }

    const line = JSON.stringify(record) + '\n';
    const bytes = Buffer.byteLength(line, 'utf8');
    st.pending.push({ line, bytes });
    flushPendingWsLines(bucket);
  } catch (e) {
    logError('Ошибка записи ws-дампа:', e && e.message ? e.message : String(e));
  }
};

// Зачем: единая точка отправки WS сообщений с обязательной записью в ws-дамп
const wsSendJson = (obj) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const raw = JSON.stringify(obj);
  // Зачем: GET может быть огромным (тысячи id) и при шуме LIST превратится в гигабайты логов.
  // Поэтому для исходящего GET по умолчанию пишем только метаданные и хэш содержимого (raw не сохраняем).
  // Это не “обогащение WS”, сообщение на проводе остаётся прежним — меняется только формат логирования.
  const outType = obj && typeof obj === 'object' ? obj.type : null;
  const dumpGetRaw = process.env.WS_DUMP_OUT_GET_RAW === '1' || process.env.WS_DUMP_OUT_GET_RAW === 'true';
  if (!dumpGetRaw && (outType === GET || outType === 'get')) {
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1').update(raw).digest('hex');
    writeWsDump({
      ts: Date.now(),
      direction: 'out',
      msg_type: 'get',
      state_count: Array.isArray(obj.state) ? obj.state.length : null,
      size_bytes: raw.length,
      raw_sha1: sha1
    });
  } else if (!dumpGetRaw && (outType === LIST || outType === 'list')) {
    writeWsDump({ ts: Date.now(), direction: 'out', msg_type: 'list', size_bytes: raw.length, raw });
  } else {
    writeWsDump({ ts: Date.now(), direction: 'out', size_bytes: raw.length, raw });
  }
  ws.send(raw);
  return true;
};

let currentLogFile = null;
let logStream = null;
let pendingFileLines = [];
let fileDrainScheduled = false;

// Зачем: единая функция сброса очереди в write stream с учётом backpressure
const flushPendingFileLines = () => {
  if (!logStream) return;
  while (pendingFileLines.length > 0) {
    const line = pendingFileLines[0];
    const ok = logStream.write(line);
    // Зачем: stream.write() ставит данные в буфер всегда; если ok=false — это только сигнал backpressure.
    // Если не убрать строку из очереди, она будет записана повторно после drain → дубликаты в events-*.jsonl.
    pendingFileLines.shift();
    if (!ok) {
      if (!fileDrainScheduled) {
        fileDrainScheduled = true;
        logStream.once('drain', () => {
          fileDrainScheduled = false;
          flushPendingFileLines();
        });
      }
      return;
    }
  }
};

const writeEventToFile = (event) => {
  try {
    // Зачем: локальные события для OpenSearch (jsonl) храним рядом с pm2-логами логгера
    const logDir = LOGGER_EVENTS_DIR;
    
    // Создаём папку если не существует
    ensureDir(logDir);
    
    // Определяем имя файла по дате
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(logDir, `events-${today}.jsonl`);
    
    // Обновляем текущий файл если изменилась дата
    if (currentLogFile !== logFile) {
      currentLogFile = logFile;
      // Зачем: при смене дня переоткрываем stream, чтобы не держать старый дескриптор
      if (logStream) {
        logStream.end();
      }
      logStream = fs.createWriteStream(currentLogFile, { flags: 'a' });
      logStream.on('error', (err) => {
        logError('Ошибка write stream для файла событий:', err.message);
      });
    }
    
    const eventLine = JSON.stringify(event) + '\n';
    // Зачем: не используем appendFileSync — синхронная запись блокирует event loop и усиливает задержки
    if (!logStream) {
      logStream = fs.createWriteStream(currentLogFile, { flags: 'a' });
      logStream.on('error', (err) => {
        logError('Ошибка write stream для файла событий:', err.message);
      });
    }
    if (pendingFileLines.length > 0) {
      // Зачем: если уже есть очередь — добавляем и сбрасываем через единый механизм
      pendingFileLines.push(eventLine);
      flushPendingFileLines();
      return;
    }

    const ok = logStream.write(eventLine);
    if (!ok) {
      pendingFileLines.push(eventLine);
      flushPendingFileLines();
    }
    
  } catch (err) {
    logError('Ошибка записи события в файл:', err.message);
  }
};

// Добавление события в буфер
const addToBuffer = (event) => {
  eventBuffer.push(event);
  
  // Если буфер переполнен, удаляем старые события
  if (eventBuffer.length > BUFFER_MAX_SIZE) {
    const removed = eventBuffer.shift();
    logError(`Буфер переполнен, удалено старое событие: ${removed?.id || 'unknown'}/${removed?.param || 'unknown'}`);
  }
};

// Попытка отправить события из буфера
const flushBuffer = async () => {
  if (isFlushingBuffer) return;
  if (eventBuffer.length === 0) return;
  if (!(opensearch.isEnabled && opensearch.isEnabled())) return;

  isFlushingBuffer = true;
  try {
    let sent = 0;
    // Зачем: отправляем чанками, чтобы не делать слишком большой _bulk и не провоцировать обрывы ответа
    while (eventBuffer.length > 0) {
      const batch = eventBuffer.splice(0, OPENSEARCH_BATCH_SIZE);
      await opensearch.sendBatch(batch);
      sent += batch.length;
      // Зачем: отдаём управление event loop, чтобы WebSocket не “задыхался”
      await new Promise((r) => setImmediate(r));
    }

    const now = Date.now();
    if (sent > 0 && (now - lastFlushLogTs) > 5000) {
      lastFlushLogTs = now;
      log(`Отправлено ${sent} событий в OpenSearch (батчами)`);
    }
  } catch (err) {
    logError('Ошибка отправки событий из буфера:', err.message);
    // Зачем: при непредвиденной ошибке возвращаем события в начало буфера (сохраняем порядок)
    // (часть событий могла быть уже удалена из буфера)
    // В штатном режиме сетевые ошибки обрабатываются внутри opensearch.sendBatch.
  } finally {
    isFlushingBuffer = false;
  }
};

// Обработка LIST сообщения (получение списка ID устройств)
const handleList = (message) => {
  try {
    const { state: stateList } = message;
    
    if (!Array.isArray(stateList)) {
      logError('LIST не содержит массив state');
      return;
    }
    
    log(`Получено ${stateList.length} ID устройств из LIST`);

    // Зачем: принимаем LIST только если мы сами его запросили недавно (init handshake).
    // Иначе это либо broadcast-эффект, либо внешний клиент в цикле — отвечать GET нельзя (усилим шум и сожрём диск).
    const now = Date.now();
    const accept = listRequested && stateRequested && (now - lastListRequestAt) <= LIST_ACCEPT_WINDOW_MS;
    if (!accept) {
      ignoredUnsolicitedListCount++;
      // Зачем: защита от спама — логируем редко, но с накопительным счётчиком.
      if ((ignoredUnsolicitedListCount % 10) === 1) {
        logError(
          `⚠️ LIST получен вне окна/без запроса — ИГНОРИРУЕМ, чтобы не слать GET по кругу. ` +
          `ignored=${ignoredUnsolicitedListCount}, stateRequested=${stateRequested}, listRequested=${listRequested}, age_ms=${now - lastListRequestAt}`
        );
      }
      return;
    }
    
    // LIST возвращает [[id, timestamp], ...], а не полные данные
    // Нужно запросить полные данные через GET
    const deviceIds = stateList.map(([id]) => id).filter(Boolean);
    
    if (deviceIds.length > 0) {
      // Зачем: если GET уже в процессе (например, LIST пришёл повторно) — второй раз не шлём.
      if (pendingGetRequests > 0) {
        logDebug('GET уже выполняется, повторный LIST игнорируем', { pendingGetRequests });
        return;
      }
      log(`Запрашиваем полные данные для ${deviceIds.length} устройств через GET...`);
      
      // Запрашиваем полные данные через GET
      // GET принимает массив ID в поле state
      // GET вернёт серию ACTION_SET сообщений (по одному на каждое устройство)
      if (ws && ws.readyState === WebSocket.OPEN) {
        pendingGetRequests = deviceIds.length;
        logDebug('Отправлен GET запрос', { count: deviceIds.length, firstIds: deviceIds.slice(0, 5) });
        wsSendJson({ type: GET, state: deviceIds });
        
        // Таймаут для получения всех ответов
        setTimeout(() => {
          if (pendingGetRequests > 0) {
            logError(`Предупреждение: получено не все ответы на GET (ожидалось ${deviceIds.length}, получено ${deviceIds.length - pendingGetRequests})`);
            stateRequested = false;
            isInitialStateReceived = true;
            pendingGetRequests = 0;
          }
        }, STATE_REQUEST_TIMEOUT);
      }
    } else {
      log('Нет устройств для запроса');
      stateRequested = false;
      isInitialStateReceived = true;
    }
  } catch (error) {
    logError('Ошибка обработки LIST:', error.message);
  }
};

// Флаг для отслеживания получения начального состояния
let pendingGetRequests = 0; // Счётчик ожидаемых ACTION_SET ответов на GET

// Запрос полного состояния при подключении
const requestFullState = () => {
  if (stateRequested) return;
  stateRequested = true;
  // Зачем: фиксируем, что LIST мы запросили сами, чтобы отличать от внешнего шума.
  listRequested = true;
  lastListRequestAt = Date.now();
  
  log('Запрашиваем полное состояние...');
  
  // Отправляем LIST для получения полного состояния
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSendJson({ type: LIST });
    
    // LIST вернёт полное состояние в формате { type: 'list', state: [[id, state], ...] }
    // После получения LIST мы обновим deviceState и state
  }
};

// Инициализация state из данных WebSocket
// Зачем: getSiteName требует полную иерархию объектов (parent, site, project)
// LevelDB не поддерживает многопроцессорный доступ, поэтому получаем данные через WebSocket
const initStateFromWebSocket = (stateData) => {
  log('Инициализация state из данных WebSocket...');
  
  try {
    // Зачем: stateData содержит все устройства, полученные через LIST/GET
    // Формируем объект init в формате { id: payload }
    const init = {};
    let siteCount = 0;
    let projectCount = 0;
    
    for (const [id, payload] of stateData.entries()) {
      init[id] = payload;
      
      // Подсчёт site/project для отладки
      if (payload && typeof payload === 'object') {
        if (payload.type === 'site' || payload.type === 'SITE') {
          siteCount++;
          logDebug('Найден site', { id, title: payload.title, code: payload.code });
        }
        if (payload.type === 'project' || payload.type === 'PROJECT') {
          projectCount++;
          logDebug('Найден project', { id, title: payload.title, code: payload.code });
        }
      }
    }
    
    // Зачем: инициализируем глобальный state всеми данными
    state.init(init);
    
    log(`State инициализирован: ${stateData.size} записей (sites: ${siteCount}, projects: ${projectCount})`);
    
    // Зачем: строим обратный индекс device -> scripts после инициализации state
    buildDeviceToScriptsIndex();
  } catch (error) {
    logError('Ошибка инициализации state:', error.message, error.stack);
    throw error;
  }
};

// Таймаут подключения
let connectionTimeoutId = null;

// Подключение к WebSocket
const connect = () => {
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    return; // Уже подключено
  }
  
  log(`Подключение к ${DAEMON_WS_URL}...`);
  
  ws = new WebSocket(DAEMON_WS_URL);
  
  // Зачем: Таймаут подключения к WebSocket (10 секунд)
  connectionTimeoutId = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      logError(`Таймаут подключения к WebSocket после ${CONNECTION_TIMEOUT / 1000} секунд. Состояние: ${ws.readyState}`);
      ws.terminate();
      isConnected = false;
      
      // Переподключение
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        log(`Попытка переподключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} через ${RECONNECT_DELAY}мс...`);
        setTimeout(connect, RECONNECT_DELAY);
      } else {
        logError(`Достигнуто максимальное количество попыток переподключения (${MAX_RECONNECT_ATTEMPTS})`);
        process.exit(1);
      }
    }
  }, CONNECTION_TIMEOUT);
  
  ws.on('open', () => {
    log(`WebSocket подключен: ${DAEMON_WS_URL}`);
    clearTimeout(connectionTimeoutId);
    isConnected = true;
    reconnectAttempts = 0;
    stateRequested = false;
    isInitialStateReceived = false;
    pendingGetRequests = 0;
    
    // Запрашиваем полное состояние
    requestFullState();
  });
  
  ws.on('message', (data) => {
    try {
      // Зачем: Безопасный парсинг JSON с ограничением размера для предотвращения DoS атак
      const dataString = data.toString();
      const receivedAt = Date.now();
      if (dataString.length > MAX_MESSAGE_SIZE) {
        // Зачем: всё равно фиксируем факт прихода сообщения (без raw), чтобы понимать объём и типы потока.
        writeWsDump({ ts: receivedAt, direction: 'in', size_bytes: dataString.length, too_large: true });
        logError(`WebSocket message too large (${dataString.length} bytes), ignoring`);
        return;
      }
      
      // Зачем: пишем входящее сообщение 1:1 (raw), без “обогащения” содержимого WS
      writeWsDump({ ts: receivedAt, direction: 'in', size_bytes: dataString.length, raw: dataString });

      let message = null;
      try {
        message = JSON.parse(dataString);
      } catch (e) {
        // Зачем: фиксируем ошибку парсинга отдельно, чтобы не потерять проблемные сообщения
        writeWsDump({
          ts: receivedAt,
          direction: 'in',
          size_bytes: dataString.length,
          parse_error: true,
          raw_prefix: dataString.substring(0, 200)
        });
        throw e;
      }
      
      // Зачем: логирование только в режиме отладки
      logDebug('Получено сообщение', { type: message.type, id: message.id || 'N/A', hasContext: !!message._context });
      
      // Зачем: логирование только в режиме отладки при начальной загрузке
      if (DEBUG_MODE && !isInitialStateReceived && pendingGetRequests > 0) {
        if (message.type === 'action_set' || message.type === ACTION_SET) {
          logDebug('ACTION_SET детали', {
            id: message.id,
            hasPayload: !!message.payload,
            hasContext: !!message._context
          });
        }
      }
      
      // Обрабатываем разные типы сообщений
      switch (message.type) {
        case LIST:
          handleList(message);
          // НЕ устанавливаем isInitialStateReceived здесь, т.к. нужно дождаться ACTION_SET из GET
          break;
        case ACTION_SET:
          // Если это начальное состояние (без _context), обновляем deviceState
          // Иначе обрабатываем как событие изменения
          if (!isInitialStateReceived && !message._context && pendingGetRequests > 0) {
            logDebug('Получен ACTION_SET для начального состояния', { id: message.id, pendingGetRequests });
            // Это начальное состояние из GET (ответ на запрос полного состояния)
            // Зачем: при GET payload содержит полное состояние устройства, используем его как есть
            const { id, payload } = message;
            if (id && payload && typeof payload === 'object') {
              // Зачем: при начальной загрузке payload - это полное состояние, но храним только нужные поля
              const essentialFields = {};
              const fieldsToKeep = ['executed', 'last_execution', 'value', 'brightness', 'r', 'g', 'b',
                                    'fan_speed', 'mode', 'direction', 'setpoint', 'temperature', 'humidity',
                                    'co2', 'code', 'title', 'name', 'parent', 'site', 'project', 'type',
                                    'bind', // Зачем: связь consumer↔channel для trace_id (и enrichChannelEvent)
                                    // Зачем: поля для резолва целей скриптов (script-targets.js) и построения цепочек
                                    'action', 'schedule', 'clock', 'timer', 'duration',
                                    // Зачем: триггеры устройств (SOURCE) — иначе "S4 ... / Click" не попадёт в логи и trace.
                                    'onDoppler', 'onTrue', 'onFalse', 'onChange', 'onOpen', 'onClose',
                                    // Зачем: реальные кнопки/DI часто хранят триггеры как массивы скриптов (onClick/onHold/...).
                                    // Эти поля приходят только в init snapshot (GET) и нужны, чтобы SOURCE склеивался со SCRIPT.
                                    'onClick', 'onClick2', 'onHold', 'onOn', 'onOff',
                                    // Зачем: action-объекты хранят ссылки в target/ref/id/site и вложенный payload.*
                                    'target', 'ref', 'id', 'payload', 'device', 'do', 'dim'];
              for (const field of fieldsToKeep) {
                if (payload[field] !== undefined) {
                  essentialFields[field] = payload[field];
                }
              }
              essentialFields._lastUpdate = Date.now();
              deviceState.set(id, essentialFields);
              // ❌ НЕ ПИШЕМ в state! Event-logger только читает
              // state.set(id, payload);
              
              // Зачем: логирование только в режиме отладки
              logDebug('Начальное состояние', { id, hasCode: !!payload.code, hasTitle: !!payload.title });
              
              // Кэш устройств не нужен - данные будут доступны через state после initStateFromWebSocket
              
              pendingGetRequests--;
            logDebug('pendingGetRequests', { current: pendingGetRequests });
              
              // Если все ответы получены, считаем начальное состояние загруженным
              if (pendingGetRequests <= 0) {
                log(`Восстановлено ${deviceState.size} состояний устройств`);
                // Данные загружены в state через initStateFromWebSocket
                
                // Зачем: инициализируем глобальный state из полученных через WebSocket данных
                // Это необходимо для работы getSiteName, который требует иерархию объектов
                initStateFromWebSocket(deviceState);
                
                stateRequested = false;
                isInitialStateReceived = true;
                pendingGetRequests = 0;
              }
            }
          } else {
            // Это событие изменения - обрабатываем
            handleActionSet(message);
          }
          break;
        default:
          // Игнорируем другие типы сообщений
          break;
      }
    } catch (error) {
      logError('Ошибка парсинга сообщения:', error.message, data.toString().substring(0, 100));
    }
  });
  
  ws.on('error', (error) => {
    logError('WebSocket ошибка:', error.message || error.toString() || JSON.stringify(error), error);
    clearTimeout(connectionTimeoutId);
    isConnected = false;
  });
  
  ws.on("close", (code, reason) => {
    log(`WebSocket соединение закрыто, код: ${code}, причина: ${reason ? reason.toString() : 'нет'}`);
    clearTimeout(connectionTimeoutId);
    isConnected = false;
    stateRequested = false;
    isInitialStateReceived = false;
    pendingGetRequests = 0;
    
    // Пытаемся переподключиться
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      log(`Попытка переподключения ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} через ${RECONNECT_DELAY}мс...`);
      setTimeout(connect, RECONNECT_DELAY);
    } else {
      logError(`Достигнуто максимальное количество попыток переподключения (${MAX_RECONNECT_ATTEMPTS})`);
      process.exit(1);
    }
  });
};

// Graceful shutdown
const shutdown = () => {
  log('Получен сигнал завершения, завершаем работу...');
  
  // Останавливаем интервал
  if (bufferFlushInterval) {
    clearInterval(bufferFlushInterval);
  }
  
  // Отправляем события из буфера
  flushBuffer().then(() => {
    // Зачем: корректно закрываем write stream, чтобы не потерять хвост файла
    if (logStream) {
      logStream.end();
    }
    // Зачем: закрываем все WS-дампы (по подвидам), чтобы не потерять хвост файлов
    for (const st of wsDumpByBucket.values()) {
      if (st && st.stream) {
        try { st.stream.end(); } catch {}
      }
    }
    if (ws) {
      ws.close();
    }
    process.exit(0);
  }).catch(err => {
    logError('Ошибка при завершении:', err.message);
    process.exit(1);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Запуск

log(`Подключение к демону: ${DAEMON_WS_URL}`);
log(`OpenSearch включен: ${process.env.OPENSEARCH_ENABLED === 'true'}`);

// Периодически пытаемся отправить события из буфера
bufferFlushInterval = setInterval(() => {
  flushBuffer().catch(() => {});
}, OPENSEARCH_FLUSH_INTERVAL_MS);

// Зачем: state будет инициализирован после получения данных через WebSocket (LIST/GET)
// LevelDB не поддерживает многопроцессорный доступ, поэтому читаем через WebSocket
connect();

