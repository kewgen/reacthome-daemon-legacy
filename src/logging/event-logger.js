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

// 6. Обратный индекс deviceId -> Set<scriptId> для быстрого поиска скриптов
// Зачем: оптимизация поиска скриптов содержащих устройство
const deviceToScriptsIndex = new Map(); // deviceId -> Set<scriptId>

// Константы для TTL очистки кэшей (зачем: предотвращение утечки памяти)
const TRACE_CACHE_TTL_MS = 3600000; // 1 час - traceIdCache
const DEVICE_STATE_MAX_SIZE = 500; // Максимальный размер deviceState кэша (уменьшено для экономии памяти)
const DEVICE_STATE_TTL_MS = 3600000; // 1 час - TTL для deviceState (зачем: удаление неактивных устройств)
const ACTUATOR_CACHE_TTL_MS = 86400000; // 24 часа - actuatorStateCache и channelStateCache

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

// Поиск скриптов содержащих устройство (с использованием обратного индекса)
// Зачем: быстрое определение какие скрипты могут влиять на устройство
const findScriptsContainingDevice = (deviceId) => {
  return Array.from(deviceToScriptsIndex.get(deviceId) || []);
};

// Генерация синтетического события executed для скрипта
// Зачем: создание события executed когда скрипт запустился (выведено из изменений устройств)
const generateSyntheticScriptEvent = (scriptId, timestamp, trace_id) => {
  const script = state.get(scriptId);
  if (!script) return;
  
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
    trace_id: trace_id,
    extra: {
      action_type: determineScriptActionType(scriptId, script), // Зачем: единый action_type для синтетики и боевых логов
      synthetic: true,              // Маркер: это синтетическое событие
      inferred_from: 'device_changes', // Метод вывода
      confidence: 'high',            // Уверенность (high/medium/low)
      target_devices_count: script.action?.length || 0
    }
  };
  
  // Отправляем событие
  sendEvent(syntheticEvent);
  
  log(`📋 [SYNTHETIC] Создано синтетическое событие executed для скрипта ${scriptId.slice(0,8)}..., trace_id=${trace_id.slice(0,8)}`);
};

// Обработка нового запуска скрипта
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
    const directTrace = traceIdCache.get(deviceId);
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
  const isSchedulerLikeForTick = !!(
    scriptStateForTick &&
    typeof scriptStateForTick === 'object' &&
    (scriptStateForTick.clock || scriptStateForTick.schedule || scriptStateForTick.timer || scriptStateForTick.duration)
  );
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
  generateSyntheticScriptEvent(scriptId, timestamp, trace_id);
  
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
  // Если deviceId уже находится в trace (traceIdCache), то синтетически выводим только те скрипты,
  // которые уже были “помечены” этим же trace (например, через SOURCE→SCRIPT→targets прокидывание).
  // Это резко уменьшает шум (случайные скрипты, у которых в action встречается этот consumerId).
  const getCurrentTrace = () => {
    const t = traceIdCache.get(deviceId);
    if (t) return t;
    const r = recentEventsCache.get(deviceId);
    return r && r.trace_id ? r.trace_id : null;
  };

  // Зачем: ветка on/off в toggle должна быть единственной и соответствовать новому значению consumer.value.
  const consumerValue =
    newState && typeof newState === 'object' && Object.prototype.hasOwnProperty.call(newState, 'value')
      ? newState.value
      : undefined;

  // Зачем: если trace уже установлен, синтетику строим только на “разрешённом” подмножестве:
  // Toggle-скрипт(ы) в этом trace + одна ветка on/off, выбранная по consumer.value.
  const currentTrace = getCurrentTrace();
  const allowedScripts = new Set();
  if (currentTrace) {
    // 1) Разрешаем только Toggle-скрипты, которые уже помечены этим trace (явная связь от SOURCE→SCRIPT(onClick)→traceIdCache).
    // Зачем: иначе через deviceToScriptsIndex к consumerId могут “приклеиться” чужие toggle‑скрипты (пример: "Сон в спальне toggle").
    for (const sid of scripts) {
      const st = state.get(sid);
      const at = determineScriptActionType(sid, st);
      if (at !== 'ACTION_TOGGLE') continue;
      const stTrace = traceIdCache.get(sid);
      if (stTrace && stTrace === currentTrace) {
        allowedScripts.add(sid);
      }
    }

    // 2) Разрешаем ровно одну ветку on/off, если можем определить её по consumer.value.
    if (allowedScripts.size > 0 && typeof consumerValue === 'boolean') {
      const wantOn = consumerValue === true;
      const pickBranch = (toggleScriptId) => {
        const toggle = state.get(toggleScriptId);
        if (!toggle || typeof toggle !== 'object' || !Array.isArray(toggle.action) || toggle.action.length === 0) return null;

        // Зачем: формат payload в бою может отличаться (payload.payload vs payload),
        // а toggle может иметь несколько action[] — пробуем по всем.
        for (const actionId of toggle.action) {
          const actionObj = state.get(actionId);
          if (!actionObj || typeof actionObj !== 'object') continue;
          const p = actionObj.payload;
          const pp = p && typeof p === 'object' ? (p.payload && typeof p.payload === 'object' ? p.payload : p) : null;
          if (!pp || typeof pp !== 'object') continue;
          const id = wantOn ? pp.onOn : pp.onOff;
          if (typeof id === 'string' && id) return id;
        }
        return null;
      };
      for (const tid of allowedScripts) {
        let bid = pickBranch(tid);
        // Зачем: фолбэк — если onOn/onOff не нашли, выбираем ветку по префиксу из title toggle ("X Toggle" -> "X on/off").
        if (!bid) {
          const toggle = state.get(tid);
          const title = toggle && typeof toggle === 'object' ? toggle.title : null;
          if (typeof title === 'string' && title.includes(' ')) {
            const prefix = title.split(' ')[0]; // "6.D.L.3"
            for (const sid of scripts) {
              const st = state.get(sid);
              const at = determineScriptActionType(sid, st);
              if (wantOn && at !== 'ACTION_ON') continue;
              if (!wantOn && at !== 'ACTION_OFF') continue;
              const stTitle = st && typeof st === 'object' ? st.title : null;
              if (typeof stTitle === 'string' && stTitle.startsWith(`${prefix} `)) {
                bid = sid;
                break;
              }
            }
          }
        }
        if (bid) allowedScripts.add(bid);
      }
    }
  }

  // Зачем: если trace уже есть, но мы НЕ смогли однозначно выделить “наши” скрипты (allowedScripts пуст),
  // то синтетика не должна нацеплять любые случайные скрипты с consumerId в action — это и есть “шум”.
  if (currentTrace && allowedScripts.size === 0) return;

  for (const scriptId of scripts) {
    const scriptState = state.get(scriptId);
    const actionType = determineScriptActionType(scriptId, scriptState);

    // Зачем: для branch-скриптов выбираем соответствующую ветку по значению consumer.value
    // (true -> ACTION_ON / title "* on", false -> ACTION_OFF / title "* off").
    if (typeof consumerValue === 'boolean') {
      if (actionType === 'ACTION_ON' && consumerValue !== true) continue;
      if (actionType === 'ACTION_OFF' && consumerValue !== false) continue;
      // Дополнительный фолбэк по title, если action_type не определился.
      if (actionType === 'ACTION_UNKNOWN' && typeof scriptState?.title === 'string') {
        const t = scriptState.title.trim().toLowerCase();
        if (t.endsWith(' on') && consumerValue !== true) continue;
        if (t.endsWith(' off') && consumerValue !== false) continue;
      }
    }

    // Зачем: если trace уже есть — берём только разрешённые скрипты (см. allowedScripts),
    // иначе от consumerId могут “прилипнуть” чужие ACTION_ON/OFF (например, "Свет балкон").
    if (currentTrace) {
      if (!allowedScripts.has(scriptId)) continue;
    } else {
      // Зачем: если trace ещё не установлен, разрешаем синтетику только для “планировщика” (clock/schedule/timer),
      // чтобы стартовать цепочку, а дальше уже работать по явному trace.
      const isSchedulerLike = !!(scriptState && typeof scriptState === 'object' && (scriptState.clock || scriptState.schedule || scriptState.timer || scriptState.duration));
      if (!isSchedulerLike) continue;
    }

    const cached = scriptExecutionCache.get(scriptId);
    const timeSinceLastChange = cached 
      ? (timestamp - cached.firstChangeTimestamp) 
      : Infinity;
    
    // Условие: НОВЫЙ ЗАПУСК скрипта
    const isNewExecution = 
      !cached ||                                    // Скрипт не в кэше
      timeSinceLastChange > SCRIPT_EXECUTION_WINDOW_MS_SYNTHETIC;  // Прошло > 10 секунд
    
    if (isNewExecution) {
      // ✅ ЭТО НОВЫЙ ЗАПУСК СКРИПТА!
      handleNewScriptExecution(scriptId, deviceId, timestamp);
    } else {
      // ⏳ Продолжение работы скрипта
      handleContinuingScriptExecution(scriptId, deviceId, cached);
    }
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
const generateTraceId = (id, context, param, eventTimestamp) => {
  // Зачем: для корректной связности цепочек используем timestamp события (из payload),
  // а не локальный Date.now() — это важно и для боевых логов, и для e2e сценариев с “пауза 20+ секунд”.
  const now = (typeof eventTimestamp === 'number' ? eventTimestamp : Date.now());

  // Зачем: не у всех сущностей должна быть трассировка. SITE/PROJECT/DAEMON — служебные объекты (локации/проект/демон),
  // их события не являются частью пользовательских цепочек SOURCE→SCRIPT→ACTUATOR→CONSUMER и дают “шум”
  // (ложные склейки по parent/временному окну). Поэтому trace_id им НЕ назначаем и в кэши корреляции НЕ кладём.
  {
    const obj = state.get(id);
    const t = obj && typeof obj === 'object' && typeof obj.type === 'string' ? obj.type.toLowerCase() : null;
    if (t === 'site' || t === 'project' || t === 'daemon') {
      traceIdCache.delete(id);
      recentEventsCache.delete(id);
      return null;
    }
  }
  
  // Если в контексте уже есть trace_id - используем его и сохраняем в кэш
  if (context && context.trace_id) {
    traceIdCache.set(id, context.trace_id);
    recentEventsCache.set(id, { timestamp: now, trace_id: context.trace_id, type: context.type });
    return context.trace_id;
  }

  // Зачем: если trace_id уже вычислен ранее для этого id (например, скрипт заполнил кэш для target devices),
  // используем его для связности цепочки (SCRIPT → ACTUATOR → CONSUMER).
  if (traceIdCache.has(id)) {
    const cachedTraceId = traceIdCache.get(id);
    const recent = recentEventsCache.get(id);
    const age = recent && typeof recent.timestamp === 'number' ? (now - recent.timestamp) : Infinity;
    const role = getDeviceRole(id);
    // Зачем: если это CONSUMER, и предыдущий trace_id был поставлен самим consumer-событием,
    // то при быстрых колебаниях (true→false за сотни миллисекунд) мы получаем “две ветки” в одном trace.
    // Это ломает правило “одна ветка на trace” и мешает анализу. Поэтому consumer→consumer reuse запрещаем,
    // но если trace_id пришёл от SCRIPT (recent.type==='script'), то reuse разрешаем (явная связь).
    if (role === 'consumer' && recent && recent.type === 'consumer') {
      // Не переиспользуем cachedTraceId; ниже будет создан новый trace_id для этого consumer-события.
    } else {
      // Зачем: для CONSUMER `value` считаем “липкость” очень короткой (только RECENT_EVENT_WINDOW_MS),
      // иначе auto-off/дребезг (через 3-5 секунд) попадает в тот же trace_id и даёт обе ветки on+off в одном trace.
      // Это не про “склейку разных сущностей”, а про переиспользование кэша на одном id.
      const effectiveReuseWindowMs =
        role === 'consumer' && param === 'value' ? RECENT_EVENT_WINDOW_MS : TRACE_ID_REUSE_WINDOW_MS;
    // Зачем: не переносим trace_id “вечно”; если событие оторвалось по времени — это новая цепочка.
    // Также: не используем “unknown” trace_id из init-state (GET), иначе каналы/устройства будут прилипать к случайному trace_id.
    if (
        age <= effectiveReuseWindowMs &&
      recent &&
      (recent.type === 'script' || recent.type === 'schedule' || recent.type === 'timer' || recent.type === 'consumer')
    ) {
      recentEventsCache.set(id, { timestamp: now, trace_id: cachedTraceId, type: context?.type || 'unknown' });
      return cachedTraceId;
    }
    }
  }
  
  // Зачем: проверяем scriptExecutionCache - если устройство уже связано со скриптом, используем его trace_id
  const scriptCacheEntry = scriptExecutionCache.get(id);
  if (scriptCacheEntry) {
    const cachedTraceId = traceIdCache.get(id);
    if (cachedTraceId) {
      return cachedTraceId; // Используем trace_id из кэша скрипта
    }
  }
  
  // Проверяем все скрипты в scriptExecutionCache - может быть устройство в targetDevices
  for (const [scriptId, cached] of scriptExecutionCache.entries()) {
    if (cached.targetDevices && cached.targetDevices.has(id)) {
      const cachedTraceId = cached.trace_id;
      traceIdCache.set(id, cachedTraceId);
      return cachedTraceId; // Используем trace_id скрипта
    }
  }
  
  // Анализируем контекст из БД
  const dbContext = analyzeDeviceContext(id, now, param);
  
  // Если это событие скрипта (executed/last_execution)
  if (dbContext.isScriptEvent && dbContext.targetDevices) {
    const deviceTriggersScript = (deviceId, scriptId) => {
      // Зачем: наследовать trace_id от SOURCE-устройства можно только если оно действительно запускает этот скрипт.
      // Иначе любой шумный датчик/кнопка в окне RECENT_EVENT_WINDOW_MS будет “прилипать” к чужим цепочкам.
      if (!deviceId || !scriptId) return false;
      const obj = state.get(deviceId);
      if (!obj || typeof obj !== 'object') return false;

      const stringKeys = ['onDoppler', 'onTrue', 'onFalse', 'onChange', 'onOpen', 'onClose'];
      for (const k of stringKeys) {
        if (typeof obj[k] === 'string' && obj[k] === scriptId) return true;
      }
      const arrayKeys = ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff'];
      for (const k of arrayKeys) {
        const v = obj[k];
        if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x === scriptId)) return true;
      }

      // Зачем: в бою клик/сработка может приходить по базовому устройству (MAC),
      // а триггеры на скрипты лежат в DI `${deviceId}/di/1` (onClick/onHold/...).
      if (typeof deviceId === 'string' && deviceId.includes(':') && !deviceId.includes('/')) {
        const di = state.get(`${deviceId}/di/1`);
        if (di && typeof di === 'object') {
          for (const k of arrayKeys) {
            const v = di[k];
            if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x === scriptId)) return true;
          }
        }
      }
      return false;
    };

    // Зачем: пытаемся “наследовать” trace_id от недавнего инициатора (schedule/timer/script),
    // чтобы цепочки из нескольких скриптов попадали в один trace.
    let inheritedTraceId = null;
    let inheritedTs = -1;
    if (TEMPORAL_TRACE_CORRELATION_ENABLED) {
      for (const [recentId, recent] of recentEventsCache.entries()) {
        if (!recent || typeof recent.timestamp !== 'number') continue;
        const timeDiff = now - recent.timestamp;
        if (timeDiff < 0 || timeDiff > RECENT_EVENT_WINDOW_MS) continue;
        // Зачем: SOURCE (кнопка/датчик) часто не приходит с _context, поэтому recent.type будет "unknown".
        // Чтобы собрать цепочку SOURCE → SCRIPT → ACTUATOR → CONSUMER, разрешаем наследование от "device"‑событий,
        // но только если устройство действительно триггерит текущий скрипт.
        const recentRole = getDeviceRole(recentId);
        const canInherit =
          (recent.type === 'script' || recent.type === 'schedule' || recent.type === 'timer') ||
          // Зачем: некоторые скрипты (например, clock/schedule) могут попасть в recentEventsCache с type='unknown',
          // но по роли это всё равно SCRIPT — даём шанс склейке цепочек скрипт→скрипт.
          (recentRole === 'script') ||
          (recentRole === 'device' && deviceTriggersScript(recentId, id));
        if (!canInherit) continue;
        if (recent.timestamp > inheritedTs && recent.trace_id) {
          inheritedTs = recent.timestamp;
          inheritedTraceId = recent.trace_id;
        }
      }
    }

    // Генерируем новый trace_id для цепочки, если наследовать нечего
    const newTraceId = inheritedTraceId || uuidv4();
    
    // Зачем: сохраняем скрипт в кэше активных скриптов
    activeScriptsCache.set(id, {
      timestamp: now,
      trace_id: newTraceId,
      actionDevices: dbContext.targetDevices
    });
    
    // Зачем: сохраняем trace_id для всех целевых устройств скрипта + помечаем их как “recent”,
    // чтобы события устройств унаследовали trace_id в окне выполнения.
    traceIdCache.set(id, newTraceId);
    for (const deviceId of dbContext.targetDevices) {
      traceIdCache.set(deviceId, newTraceId);
      recentEventsCache.set(deviceId, { timestamp: now, trace_id: newTraceId, type: 'script' });
    }
    
    recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: 'script' });
    
    log(`📋 Скрипт ${id} запущен, trace_id=${newTraceId.slice(0,8)}, целевых устройств: ${dbContext.targetDevices.size}${inheritedTraceId ? ' (унаследован)' : ''}`);
    
    return newTraceId;
  }
  
  // Если контекст не был передан, но мы определили его из БД - обновляем
  if (dbContext.type !== 'unknown') {
    context.type = dbContext.type;
    context.ref = dbContext.ref;
    context.deviceId = dbContext.deviceId;
  }
  
  // Если trigger определён (script, schedule, timer, device) - ищем trace_id в кэше по ref
  const triggerType = context?.type || 'unknown';
  const triggerRef = context?.ref;
  
  if (triggerType !== 'unknown' && triggerRef) {
    // Ищем trace_id в кэше по ref
    if (traceIdCache.has(triggerRef)) {
    // Нашли trace_id в кэше - используем его и сохраняем для текущего события
    const traceId = traceIdCache.get(triggerRef);
    traceIdCache.set(id, traceId);
      recentEventsCache.set(id, { timestamp: now, trace_id: traceId, type: triggerType });
    return traceId;
  }
  
  // Если trigger есть, но trace_id не найден в кэше - генерируем новый
  const newTraceId = uuidv4();
  traceIdCache.set(id, newTraceId);
    traceIdCache.set(triggerRef, newTraceId); // Сохраняем для trigger.ref
    recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: triggerType });
    return newTraceId;
  }
  
  // Если trigger не определён - анализируем временные паттерны
  // Зачем: связываем события, произошедшие в течение короткого времени
  // Быстрая связка по bind → trace_id bound устройства
  // Зачем: канал/актуатор может идти без прямого trigger, но если он привязан (bind) к CONSUMER,
  // то должен наследовать trace_id потребителя в пределах окна RECENT_EVENT_WINDOW_MS.
  {
    const device = getDeviceFields(id);
    const bind = (device && typeof device.bind === 'string' && device.bind)
      ? device.bind
      : (context && typeof context.bind === 'string' && context.bind ? context.bind : null);
    if (bind) {
      const boundRecent = recentEventsCache.get(bind);
      if (boundRecent && typeof boundRecent.timestamp === 'number') {
        const age = now - boundRecent.timestamp;
        if (age >= 0 && age <= RECENT_EVENT_WINDOW_MS && boundRecent.trace_id) {
          traceIdCache.set(id, boundRecent.trace_id);
          recentEventsCache.set(id, { timestamp: now, trace_id: boundRecent.trace_id, type: context?.type || 'unknown' });
          return boundRecent.trace_id;
        }
      }
    }
  }

  // Зачем: эвристическая склейка по времени (через recentEventsCache + parent/bind) часто даёт шум.
  // bind мы уже обработали выше через “быструю” строгую связку по bind → recentEventsCache.get(bind),
  // поэтому этот блок оставляем выключенным по умолчанию и включаем только для диагностики.
  if (TEMPORAL_TRACE_CORRELATION_ENABLED) {
    for (const [recentId, recentEvent] of recentEventsCache.entries()) {
      const timeDiff = now - recentEvent.timestamp;
      
      // Если событие в пределах временного окна
      if (timeDiff <= RECENT_EVENT_WINDOW_MS) {
        // Проверяем связь через parent/bind/site
        const device = getDeviceFields(id);
        const recentDevice = getDeviceFields(recentId);
        
        if (device && recentDevice) {
          // Связь через parent
          if (device.parent === recentId || recentDevice.parent === id) {
            traceIdCache.set(id, recentEvent.trace_id);
            recentEventsCache.set(id, { timestamp: now, trace_id: recentEvent.trace_id, type: 'unknown' });
            return recentEvent.trace_id;
          }

          // Связь через bind (потребитель ↔ канал/актуатор)
          // Зачем: у потребителя bind="MAC/dim/N", а у канала bind указывает обратно на UUID потребителя.
          if (device.bind && device.bind === recentId) {
            traceIdCache.set(id, recentEvent.trace_id);
            recentEventsCache.set(id, { timestamp: now, trace_id: recentEvent.trace_id, type: 'unknown' });
            return recentEvent.trace_id;
          }
          if (recentDevice.bind && recentDevice.bind === id) {
            traceIdCache.set(id, recentEvent.trace_id);
            recentEventsCache.set(id, { timestamp: now, trace_id: recentEvent.trace_id, type: 'unknown' });
            return recentEvent.trace_id;
          }
        }
      }
    }
  }
  
  // Если не нашли связей - генерируем новый trace_id
  // Зачем: не переиспользуем старый trace_id бесконечно — новая цепочка должна получать новый trace_id
  const newTraceId = uuidv4();
  traceIdCache.set(id, newTraceId);
  recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: 'unknown' });
  
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
    
    const msgTimestamp = payload.timestamp || Date.now();

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
      if (typeof id === 'string' && id.includes(':') && !id.includes('/')) {
        const di = state.get(`${id}/di/1`);
        if (di && typeof di === 'object') {
          for (const k of ['onClick', 'onClick2', 'onHold', 'onOn', 'onOff']) {
            const v = di[k];
            if (Array.isArray(v) && v.some((x) => typeof x === 'string' && x)) return true;
          }
        }
      }

      return false;
    })();

    // Зачем: SOURCE фиксируем только по value (клик/сработка), не по humidity/temperature шуму.
    const isTriggerValueEvent = isTriggerDevice && keyParam === 'value';

    if (isTriggerValueEvent && !context.trace_id) {
      context.trace_id = uuidv4();
    }

    // Зачем: для боевых логов _context часто отсутствует, и SCRIPT приходится выводить из изменений устройств.
    // Чтобы device/actuator/consumer попали в тот же trace_id, что и синтетический SCRIPT,
    // сначала пробуем определить запуск скрипта по изменению устройства, и только потом считаем trace_id.
    if (SYNTHETIC_SCRIPT_EVENTS_ENABLED && payload.executed === undefined && payload.last_execution === undefined) {
      checkAndGenerateScriptEvent(id, msgTimestamp, newState);
    }

    const traceId = generateTraceId(id, context, keyParam, msgTimestamp);
    context.trace_id = traceId;

    // Зачем: SOURCE → SCRIPT → (targets...) — заранее прокидываем trace_id в скрипты, которые запускает устройство.
    // Это снижает зависимость от порядка прихода WS сообщений и окна RECENT_EVENT_WINDOW_MS.
    if (isTriggerValueEvent) {
      const triggerScriptIds = [];
      const src = (newState && typeof newState === 'object') ? newState : payload;

      // Зачем: для value-событий от кнопки/DI нам нужен “клик”,
      // а строковые триггеры (onDoppler/onChange/...) часто дают шум и лишние склейки.
      // Поэтому для value учитываем только onClick/onClick2 (массовые сценарии кнопок).
      for (const k of ['onClick', 'onClick2']) {
        const v = src ? src[k] : null;
        if (Array.isArray(v)) {
          for (const x of v) {
            if (typeof x === 'string' && x) triggerScriptIds.push(x);
          }
        }
      }
      // Зачем: см. выше — базовое устройство может не содержать onClick[], но DI содержит.
      if (typeof id === 'string' && id.includes(':') && !id.includes('/')) {
        const di = state.get(`${id}/di/1`);
        if (di && typeof di === 'object') {
          for (const k of ['onClick', 'onClick2']) {
            const v = di[k];
            if (Array.isArray(v)) {
              for (const x of v) {
                if (typeof x === 'string' && x) triggerScriptIds.push(x);
              }
            }
          }
        }
      }
      for (const scriptId of triggerScriptIds) {
        traceIdCache.set(scriptId, traceId);
        recentEventsCache.set(scriptId, { timestamp: msgTimestamp, trace_id: traceId, type: 'script' });
        const targets = getScriptTargetDevices(scriptId);
        for (const tid of targets) {
          // Зачем: не прокидываем trace_id на вложенные скрипты (ветки on/off и др.) заранее —
          // иначе синтетика может “выполнить” обе ветки и загрязнить trace.
          if (getDeviceRole(tid) === 'script') continue;
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
    
    const scriptActionType = determineScriptActionType(id, newState); // Зачем: фиксируем тип запуска/природу скрипта для трассировки
    const event = {
      timestamp: Date.now(),
      id,
      device: {
        type: null,
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
        action_type: scriptActionType
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
      timestamp: Date.now(),
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
    pendingFileLines.shift();
  }
};

const writeEventToFile = (event) => {
  try {
    const logDir = path.join(VAR, 'log');
    
    // Создаём папку если не существует
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
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
    
    // LIST возвращает [[id, timestamp], ...], а не полные данные
    // Нужно запросить полные данные через GET
    const deviceIds = stateList.map(([id]) => id).filter(Boolean);
    
    if (deviceIds.length > 0) {
      log(`Запрашиваем полные данные для ${deviceIds.length} устройств через GET...`);
      
      // Запрашиваем полные данные через GET
      // GET принимает массив ID в поле state
      // GET вернёт серию ACTION_SET сообщений (по одному на каждое устройство)
      if (ws && ws.readyState === WebSocket.OPEN) {
        pendingGetRequests = deviceIds.length;
        logDebug('Отправлен GET запрос', { count: deviceIds.length, firstIds: deviceIds.slice(0, 5) });
        ws.send(JSON.stringify({ type: GET, state: deviceIds }));
        
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
  
  log('Запрашиваем полное состояние...');
  
  // Отправляем LIST для получения полного состояния
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: LIST }));
    
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
      if (dataString.length > MAX_MESSAGE_SIZE) {
        logError(`WebSocket message too large (${dataString.length} bytes), ignoring`);
        return;
      }
      
      const message = JSON.parse(dataString);
      
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

