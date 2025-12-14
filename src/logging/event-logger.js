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
const fs = require('fs');
const util = require('util'); // Зачем: безопасно сериализуем объекты в файл-лог без console spam
const os = require('os'); // Зачем: поддержка ~ в путях (например OPENSEARCH_CA_CERT)
// Зачем: корректируем пути импортов после перемещения файла в src/logging
const state = require('../controllers/state');
const { VAR, TMP } = require('../assets/constants'); // Зачем: единые пути var/tmp для логов и кэшей

// Зачем: определяем TTY максимально рано, т.к. используется в env-preload и политике логирования
const IS_TTY = !!process.stdout.isTTY;

// Зачем: минимальный BOOT-лог (без зависимости от writeInteractiveLog, который объявлен ниже)
const bootLog = (line) => {
  try {
    if (!IS_TTY) return;
    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const file = path.join(logDir, `event-logger-interactive-${today}.log`);
    const ts = new Date().toISOString();
    fs.appendFileSync(file, `[${ts}] [BOOT] [pid:${process.pid}] ${line}\n`, 'utf8');
  } catch (e) {}
};

// Зачем: важные "разовые" факты при старте должны быть видны оператору в консоли даже в интерактивном режиме.
// Важно: печатаем ДО запуска 📊 панели и только 2–3 строки, чтобы не ломать интерактив.
const printStartupFactsToConsole = () => {
  if (!IS_TTY) return;
  try {
    const osEnabled = opensearch && opensearch.isEnabled ? opensearch.isEnabled() : false;
    const osUrl = process.env.OPENSEARCH_URL || '';
    const maxSockets = process.env.OPENSEARCH_MAX_SOCKETS || '';
    const timeoutMs = process.env.OPENSEARCH_REQUEST_TIMEOUT_MS || '';

    // stdout: намеренно — оператор должен увидеть это сразу.
    console.log(`[BOOT] pid=${process.pid} cwd=${process.cwd()}`);
    console.log(`[BOOT] ws=${DAEMON_WS_URL}`);
    console.log(`[BOOT] os=${osEnabled ? 'ON' : 'OFF'} url=${osUrl || '(empty)'} maxSockets=${maxSockets || '(default)'} timeoutMs=${timeoutMs || '(default)'}`);
  } catch (e) {
    // ignore
  }
};

// ==========================
// Env loading (needed for interactive запуск)
// ==========================
// Зачем: в интерактивном запуске env из PM2 не подхватывается; OpenSearch модуль читает env на require().
// Поэтому грузим .env / scripts/ecosystem.config.js ДО require('./opensearch').
// Зачем: источник "корня проекта" для env-preload.
// Важно: process.cwd() стабильно указывает на корень, т.к. PM2 запускает с cwd=rootDir,
// а ручной запуск обычно делается из корня репозитория.
const PROJECT_DIR = process.cwd();

const loadDotEnv = () => {
  try {
    const envFile = path.join(PROJECT_DIR, '.env');
    if (!fs.existsSync(envFile)) return;
    const content = fs.readFileSync(envFile, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = String(line).trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      const valueRaw = trimmed.slice(idx + 1).trim();
      if (!key) return;
      if (process.env[key] !== undefined && process.env[key] !== '') return; // не перетираем уже заданное
      const value = valueRaw.replace(/^["']|["']$/g, '');
      process.env[key] = value;
    });
  } catch (e) {
    // Зачем: ошибки чтения env не должны ломать сервис
  }
};

const loadEcosystemEnvFallback = () => {
  try {
    const ecoFile = path.join(PROJECT_DIR, 'scripts', 'ecosystem.config.js');
    bootLog(`ecosystem path: ${ecoFile} exists=${fs.existsSync(ecoFile)}`);
    if (!fs.existsSync(ecoFile)) return;
    // Загружаем конфиг PM2 и вытягиваем env для приложения logger
    // Важно: только если переменная ещё не задана.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const eco = require(ecoFile);
    const apps = Array.isArray(eco?.apps) ? eco.apps : [];
    const loggerApp =
      apps.find((a) => a?.name === 'logger') ||
      apps.find((a) => String(a?.script || '').includes('event-logger.js')) ||
      null;
    bootLog(`ecosystem apps=${apps.length} loggerFound=${!!loggerApp}`);
    const env = loggerApp?.env || {};
    bootLog(`ecosystem envKeys=${Object.keys(env).slice(0, 12).join(',')}`);
    for (const [k, v] of Object.entries(env)) {
      // Зачем: в интерактивном режиме нам критично включать OpenSearch.
      // Если в локальном окружении переменная задана как 'false' (или пуста), но в ecosystem она корректная —
      // берём значение из ecosystem.
      const shouldForceFromEcosystem =
        IS_TTY &&
        (k === 'DAEMON_WS_URL' || String(k).startsWith('OPENSEARCH_')) &&
        (process.env[k] === undefined || process.env[k] === '' || process.env[k] === 'false');

      if (!shouldForceFromEcosystem) {
        if (process.env[k] !== undefined && process.env[k] !== '') continue;
      }
      if (v === undefined || v === null) continue;
      process.env[k] = String(v);
    }
    bootLog(`env applied: OPENSEARCH_ENABLED=${process.env.OPENSEARCH_ENABLED || ''} OPENSEARCH_URL=${process.env.OPENSEARCH_URL ? 'set' : ''}`);
  } catch (e) {
    // ignore
    bootLog(`ecosystem load error: ${e && e.message ? e.message : String(e)}`);
  }
};

loadDotEnv();
loadEcosystemEnvFallback();

// Зачем: опционально расширяем ~ в OPENSEARCH_CA_CERT (используется в opensearch.js)
if (process.env.OPENSEARCH_CA_CERT && process.env.OPENSEARCH_CA_CERT.startsWith('~')) {
  process.env.OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT.replace('~', os.homedir());
}

const opensearch = require('./opensearch');
// Зачем: opensearch.js может быть загружен до env-preload (через другие модули). Явно переинициализируем после загрузки env.
if (opensearch && typeof opensearch.initFromEnv === 'function') {
  try {
    opensearch.initFromEnv();
  } catch (e) {
    // ignore
  }
}

// ВАЖНО: ./event-log внутри делает require('./opensearch'), поэтому импортируем его только ПОСЛЕ env-preload.
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

// Зачем: диагностика причины OS⚪ в интерактивном режиме (пишем в файл, не в консоль)
if (IS_TTY) {
  try {
    // Важно: writeInteractiveLog объявляется ниже, поэтому здесь пишем напрямую в файл.
    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const file = path.join(logDir, `event-logger-interactive-${today}.log`);
    const ts = new Date().toISOString();
    fs.appendFileSync(
      file,
      `[${ts}] [BOOT] env: OPENSEARCH_ENABLED=${process.env.OPENSEARCH_ENABLED || ''} OPENSEARCH_URL=${process.env.OPENSEARCH_URL ? 'set' : ''} DAEMON_WS_URL=${process.env.DAEMON_WS_URL || ''}\n`,
      'utf8'
    );
  } catch (e) {}
}

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
const BUFFER_MAX_SIZE = 1000; // Зачем: выдерживаем недоступность OpenSearch без потери событий

// Константы для WebSocket сообщений (из src/init/constants.js и src/constants.js)
const { LIST, GET } = require('../init/constants');
const { ACTION_SET } = require('../constants');

// Состояние
let ws = null;
let wsMessageSeq = 0; // Зачем: порядковый номер входящих WS-сообщений для диагностики дублей
let wsSentSeq = 0; // Зачем: считаем исходящие WS-сообщения (LIST/GET) для панели
let deviceState = new Map(); // Хранение предыдущего состояния устройств
let reconnectAttempts = 0;
let isConnected = false;
let eventBuffer = []; // Буфер для событий при недоступности OpenSearch
let stateRequested = false;
let isInitialStateReceived = false;
let bufferFlushInterval = null; // Интервал для отправки событий из буфера

// ==========================
// Interactive stats (always on)
// ==========================
let statsLineActive = false;
let lastStatsLineLen = 0;

const stats = {
  processed: 0,         // сколько событий (sendEvent) обработано
  buffered: 0,          // сколько событий добавлено в буфер
  flushed: 0,           // сколько событий отправлено из буфера
  dropped: 0,           // сколько событий удалено при переполнении буфера
  errors: 0,            // счётчик ошибок логгера (не opensearch)
  os_ok: 0,             // сколько событий успешно отправлено в OpenSearch
  os_fail: 0,           // сколько событий не удалось отправить в OpenSearch
  lastOsOkTs: 0,        // когда был последний успех
  lastOsFailTs: 0,      // когда был последний фейл
  lastTickTs: Date.now(),
  lastProcessed: 0,
  eps: 0                // events per second (по processed)
};

const updateEps = () => {
  const now = Date.now();
  const dt = Math.max(250, now - stats.lastTickTs);
  const dProcessed = stats.processed - stats.lastProcessed;
  stats.eps = Math.round((dProcessed * 1000) / dt);
  stats.lastTickTs = now;
  stats.lastProcessed = stats.processed;
};

const ansi = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// ==========================
// Logging policy (interactive-safe)
// ==========================
// Правило: в интерактивном режиме (TTY) нельзя писать "обычные" логи в консоль — это ломает панель.
// Решение: при IS_TTY пишем логи в файл, а в консоль оставляем только 📊 строку панели.
const formatLogArgs = (args) => {
  try {
    if (!args || args.length === 0) return '';
    return args
      .map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 160 })))
      .join(' ');
  } catch (e) {
    return '';
  }
};

let currentInteractiveLogFile = null;
const writeInteractiveLog = (level, message, args) => {
  try {
    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    const file = path.join(logDir, `event-logger-interactive-${today}.log`);
    if (currentInteractiveLogFile !== file) currentInteractiveLogFile = file;
    const ts = new Date().toISOString();
    const extra = formatLogArgs(args);
    fs.appendFileSync(
      currentInteractiveLogFile,
      `[${ts}] [pid:${process.pid}] [${level}] ${message}${extra ? ' ' + extra : ''}\n`,
      'utf8'
    );
  } catch (e) {
    // Зачем: логирование не должно ломать основной поток
  }
};

const clearStatsLine = () => {
  if (!IS_TTY) return;
  if (!statsLineActive) return;
  process.stdout.write('\r\x1b[2K');
  statsLineActive = false;
  lastStatsLineLen = 0;
};

const renderStatsLine = () => {
  // Зачем: в non-TTY (PM2) нельзя рисовать \r-панель, делаем периодический лог
  if (!IS_TTY) return;

  updateEps();
  const now = Date.now();

  const wsStatus = isConnected ? '✅' : '❌';
  const osEnabled = opensearch.isEnabled && opensearch.isEnabled();
  const osRecentFail = stats.lastOsFailTs && (now - stats.lastOsFailTs) < 60_000;
  const osStatus = !osEnabled ? '⚪' : (osRecentFail ? '❌' : '✅');

  const bufSize = eventBuffer.length;
  const bufPct = BUFFER_MAX_SIZE > 0 ? Math.round((bufSize * 100) / BUFFER_MAX_SIZE) : 0;

  const neg = (n) => (IS_TTY && n > 0) ? ansi.red(String(n)) : String(n);
  const epsStr = `${stats.eps}/s`;

  // Формат: 📊 WS✅ r/s OS✅ ok/fail 9/s buf:x/y(%) e:n d:n
  const line =
    `📊 WS${wsStatus} ${wsMessageSeq}/${wsSentSeq} ` +
    `OS${osStatus} ${stats.os_ok}/${neg(stats.os_fail)} ` +
    `${ansi.dim(epsStr)} ` +
    `buf:${bufSize}/${BUFFER_MAX_SIZE}(${bufPct}%) ` +
    `e:${neg(stats.errors)} d:${neg(stats.dropped)}`;

  // Очистка/перерисовка в одну строку
  const padded = lastStatsLineLen > line.length ? line + ' '.repeat(lastStatsLineLen - line.length) : line;
  process.stdout.write('\r' + padded);
  statsLineActive = true;
  lastStatsLineLen = Math.max(lastStatsLineLen, line.length);
};

const logStatsLineNonTty = () => {
  updateEps();
  const now = Date.now();
  const wsStatus = isConnected ? '✅' : '❌';
  const osEnabled = opensearch.isEnabled && opensearch.isEnabled();
  const osRecentFail = stats.lastOsFailTs && (now - stats.lastOsFailTs) < 60_000;
  const osStatus = !osEnabled ? '⚪' : (osRecentFail ? '❌' : '✅');
  const bufSize = eventBuffer.length;
  const bufPct = BUFFER_MAX_SIZE > 0 ? Math.round((bufSize * 100) / BUFFER_MAX_SIZE) : 0;
  log(`📊 WS${wsStatus} ${wsMessageSeq}/${wsSentSeq} OS${osStatus} ${stats.os_ok}/${stats.os_fail} ${stats.eps}/s buf:${bufSize}/${BUFFER_MAX_SIZE}(${bufPct}%) e:${stats.errors} d:${stats.dropped}`);
};

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

// 6. Обратный индекс deviceId -> Set<scriptId> для быстрого поиска скриптов
// Зачем: оптимизация поиска скриптов содержащих устройство
const deviceToScriptsIndex = new Map(); // deviceId -> Set<scriptId>

// Константы для TTL очистки кэшей (зачем: предотвращение утечки памяти)
const TRACE_CACHE_TTL_MS = 3600000; // 1 час - traceIdCache
const DEVICE_STATE_MAX_SIZE = 500; // Максимальный размер deviceState кэша (уменьшено для экономии памяти)
const DEVICE_STATE_TTL_MS = 3600000; // 1 час - TTL для deviceState (зачем: удаление неактивных устройств)
const ACTUATOR_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней - actuatorStateCache и channelStateCache
// Зачем: потребителей всего несколько десятков устройств, поэтому размер кэша мал; увеличиваем TTL для длинных сессий работы устройств.

// Зачем: флаг отладки для условного логирования (включается через DEBUG=true)
const DEBUG_MODE = process.env.DEBUG === 'true';

// Логирование
const log = (message, ...args) => {
  if (IS_TTY) {
    writeInteractiveLog('INFO', message, args);
    return;
  }
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [pid:${process.pid}] [event-logger] ${message}`, ...args);
};

const logError = (message, ...args) => {
  stats.errors++; // Зачем: счётчик ошибок для панели
  if (IS_TTY) {
    writeInteractiveLog('ERROR', message, args);
    return;
  }
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [pid:${process.pid}] [event-logger] ERROR: ${message}`, ...args);
};

// ==========================
// Cache persistence (restart-safe)
// ==========================

const ACTUATOR_CACHE_FILE = path.join(TMP, 'actuator-cache.json'); // Зачем: совместимость с существующим файлом кэша
let cacheSaveInterval = null;
let isShuttingDown = false;

const ensureTmpDir = () => {
  try {
    if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
  } catch (e) {
    // Зачем: проблемы с FS не должны ломать основной поток
  }
};

const saveActuatorCache = () => {
  try {
    ensureTmpDir();

    const now = Date.now();
    // Зачем: сохраняем в исторически используемом формате (actuators/channels массив объектов),
    // чтобы восстановление работало и после обновлений.
    const payload = {
      timestamp: now,
      actuators: Array.from(actuatorStateCache.entries()).map(([id, v]) => ({ id, ...(v || {}) })),
      channels: Array.from(channelStateCache.entries()).map(([id, v]) => ({ id, ...(v || {}) })),
    };

    // Зачем: атомарная запись, чтобы не потерять кэш при внезапной остановке процесса
    const tmpFile = `${ACTUATOR_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmpFile, ACTUATOR_CACHE_FILE);
  } catch (e) {
    // Зачем: сохранение кэша не должно ронять сервис
  }
};

const loadActuatorCache = () => {
  try {
    ensureTmpDir();
    if (!fs.existsSync(ACTUATOR_CACHE_FILE)) return;

    const raw = fs.readFileSync(ACTUATOR_CACHE_FILE, 'utf8');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const now = Date.now();

    // Поддерживаем оба формата:
    // 1) { actuators:[{id,...}], channels:[{id,...}] } (исторический)
    // 2) { actuator:[[id,obj],...], channel:[[id,obj],...] } (внутренний/служебный)
    const actuatorObjects = Array.isArray(parsed.actuators) ? parsed.actuators : [];
    const channelObjects = Array.isArray(parsed.channels) ? parsed.channels : [];
    const actuatorEntries = Array.isArray(parsed.actuator) ? parsed.actuator : [];
    const channelEntries = Array.isArray(parsed.channel) ? parsed.channel : [];

    // Валидация/фильтрация по TTL
    let restoredActuators = 0;
    let restoredChannels = 0;

    actuatorStateCache.clear();
    // формат 1
    for (const obj of actuatorObjects) {
      const id = obj && obj.id;
      if (!id || !obj || typeof obj !== 'object') continue;
      const ts = obj.onTimestamp;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if ((now - ts) > ACTUATOR_CACHE_TTL_MS) continue;
      const { id: _id, ...rest } = obj;
      actuatorStateCache.set(id, rest);
      restoredActuators++;
    }
    // формат 2
    for (const [id, v] of actuatorEntries) {
      if (!id || !v || typeof v !== 'object') continue;
      const ts = v.onTimestamp;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if ((now - ts) > ACTUATOR_CACHE_TTL_MS) continue;
      actuatorStateCache.set(id, v);
      restoredActuators++;
    }

    channelStateCache.clear();
    // формат 1
    for (const obj of channelObjects) {
      const id = obj && obj.id;
      if (!id || !obj || typeof obj !== 'object') continue;
      const ts = obj.onTimestamp;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if ((now - ts) > ACTUATOR_CACHE_TTL_MS) continue;
      const { id: _id, ...rest } = obj;
      channelStateCache.set(id, rest);
      restoredChannels++;
    }
    // формат 2
    for (const [id, v] of channelEntries) {
      if (!id || !v || typeof v !== 'object') continue;
      const ts = v.onTimestamp;
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      if ((now - ts) > ACTUATOR_CACHE_TTL_MS) continue;
      channelStateCache.set(id, v);
      restoredChannels++;
    }

    log(`♻️ Восстановлен кэш длительности: actuators=${restoredActuators}, channels=${restoredChannels} (${path.basename(ACTUATOR_CACHE_FILE)})`);
  } catch (e) {
    logError('Ошибка восстановления кэша длительности:', e.message);
  }
};

// Зачем: условное логирование только в режиме отладки
const logDebug = (message, ...args) => {
  if (DEBUG_MODE) {
    // Зачем: в интерактивном режиме debug тоже нельзя писать в консоль
    if (IS_TTY) {
      writeInteractiveLog('DEBUG', message, args);
      return;
    }
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
    site: obj.site !== undefined ? obj.site : null,
    project: obj.project !== undefined ? obj.project : null,
    // Зачем: связывание channel <-> endDevice по bind для корректного trace_id
    bind: obj.bind !== undefined ? obj.bind : null
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
  // Зачем: типы могут приходить в разном регистре (например LIGHT_LED vs light_LED),
  // нормализуем для устойчивого определения consumer.
  if (typeof deviceType === 'string') {
    const normalized = deviceType.toLowerCase();
    return CONSUMER_TYPES.some((t) => String(t).toLowerCase() === normalized);
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
  const script = state.get(scriptId);
  if (!script || !Array.isArray(script.action)) return new Set();
  
  const targetDevices = new Set();

  // Зачем: единая точка добавления целевого ID + учёт bind-канала (для light_220 и др.)
  // Это критично для скриптов, которые меняют "обёртку" устройства, но фактически меняется канал MAC/dim/x.
  const addTarget = (id) => {
    if (!id || typeof id !== 'string') return;
    targetDevices.add(id);

    // Если это устройство-обёртка с bind на канал, добавляем и канал как цель
    const obj = state.get(id);
    if (obj && typeof obj === 'object' && typeof obj.bind === 'string') {
      const bindId = obj.bind;
      if (isChannelId(bindId)) {
        targetDevices.add(bindId);
      }
    }
  };
  
  // Зачем: проходим по всем действиям скрипта и извлекаем ID целевых устройств
  for (const actionId of script.action) {
    const actionObj = state.get(actionId);
    if (!actionObj || typeof actionObj !== 'object') continue;
    
    // Action object может содержать разные поля в зависимости от типа действия
    // Общие поля: id (целевое устройство), ref (связанное устройство), payload
    
    // Зачем: получаем ID целевого устройства из действия
    if (actionObj.id && typeof actionObj.id === 'string') {
      addTarget(actionObj.id);
    }
    
    // Зачем: для некоторых действий целевое устройство в поле ref
    if (actionObj.ref && typeof actionObj.ref === 'string') {
      addTarget(actionObj.ref);
    }
    
    // Зачем: для ACTION_ON/OFF/TOGGLE целевое устройство в payload.id
    if (actionObj.payload && typeof actionObj.payload === 'object') {
      if (actionObj.payload.id && typeof actionObj.payload.id === 'string') {
        addTarget(actionObj.payload.id);
      }

      // Зачем: поддержка ACTION_TOGGLE (payload.onOn/onOff/test) — иначе не строится граф script -> script
      if (actionObj.payload.onOn && typeof actionObj.payload.onOn === 'string') {
        addTarget(actionObj.payload.onOn);
      }
      if (actionObj.payload.onOff && typeof actionObj.payload.onOff === 'string') {
        addTarget(actionObj.payload.onOff);
      }
      if (Array.isArray(actionObj.payload.test)) {
        for (const testId of actionObj.payload.test) {
          if (typeof testId === 'string') addTarget(testId);
        }
      }
    }
    
    // Зачем: для действий с site - добавляем все устройства в site
    if (Array.isArray(actionObj.site)) {
      for (const siteId of actionObj.site) {
        const siteObj = state.get(siteId);
        // Получаем устройства из site (обычно в полях device, do, dim)
        if (siteObj && typeof siteObj === 'object') {
          const siteDevices = [
            ...(siteObj.device || []),
            ...(siteObj.do || []),
            ...(siteObj.dim || [])
          ];
          siteDevices.forEach((devId) => addTarget(devId));
        }
      }
    }
  }
  
  return targetDevices;
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
const handleNewScriptExecution = (scriptId, deviceId, timestamp, visited = null) => {
  // 1. Определяем trace_id для цепочки
  // Зачем: если запуск скрипта выведен из уже связанного события (deviceId уже имеет trace_id),
  // то наследуем trace_id, чтобы цепочка не рвалась (например: Start -> Скрипт B -> устройство).
  const inheritedTraceId = traceIdCache.get(deviceId);
  const trace_id = (typeof inheritedTraceId === 'string' && inheritedTraceId.length > 0)
    ? inheritedTraceId
    : uuidv4();
  
  // 2. Получаем целевые устройства скрипта
  const targetDevices = getScriptTargetDevices(scriptId);
  
  // 3. Сохраняем в кэш
  scriptExecutionCache.set(scriptId, {
    firstChangeTimestamp: timestamp,
    trace_id: trace_id,
    devicesChanged: new Set([deviceId]),
    syntheticEventSent: false,
    targetDevices: targetDevices
  });
  
  // 4. Сохраняем trace_id для самого скрипта и всех целевых устройств
  // Зачем: скрипт должен быть участником цепочки, чтобы по нему можно было строить "скрипт -> скрипт"
  traceIdCache.set(scriptId, trace_id);
  for (const devId of targetDevices) {
    traceIdCache.set(devId, trace_id);
  }
  
  // 5. Генерируем синтетическое событие executed
  generateSyntheticScriptEvent(scriptId, timestamp, trace_id);
  
  // 6. Отмечаем что синтетическое событие отправлено
  const cached = scriptExecutionCache.get(scriptId);
  if (cached) {
    cached.syntheticEventSent = true;
  }
  
  if (typeof inheritedTraceId === 'string' && inheritedTraceId.length > 0) {
    log(`🔗 [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} унаследовал trace_id=${trace_id.slice(0,8)} от источника ${String(deviceId).slice(0,8)} (целевых устройств: ${targetDevices.size})`);
  } else {
    log(`📋 [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} запущен (выведено), trace_id=${trace_id.slice(0,8)}, целевых устройств: ${targetDevices.size}`);
  }

  // 7. Прокидываем "изменение" на уровень выше: скрипт как узел графа
  // Зачем: если scriptId является целевым для другого скрипта (ACTION_SCRIPT_RUN), то хотим вывести и родителя.
  const nextVisited = visited instanceof Set ? visited : new Set();
  nextVisited.add(scriptId);
  checkAndGenerateScriptEvent(scriptId, timestamp, nextVisited);
};

// Обработка продолжения работы скрипта
// Зачем: отслеживание изменений устройств в рамках уже запущенного скрипта
const handleContinuingScriptExecution = (scriptId, deviceId, cached) => {
  // Добавляем устройство в список изменённых
  cached.devicesChanged.add(deviceId);
  
  log(`⏳ [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} продолжает работу, устройство ${deviceId.slice(0,8)} изменено (${cached.devicesChanged.size}/${cached.targetDevices.size})`);
  
  // Проверяем, все ли целевые устройства изменились
  if (cached.devicesChanged.size === cached.targetDevices.size) {
    log(`✅ [SYNTHETIC] Скрипт ${scriptId.slice(0,8)} завершил работу, все устройства изменены`);
  }
};

// Проверка и генерация синтетических событий для скриптов
// Зачем: определение запущенных скриптов по изменениям устройств и генерация синтетических событий
const checkAndGenerateScriptEvent = (deviceId, timestamp, visited = null) => {
  const scripts = findScriptsContainingDevice(deviceId);
  if (scripts.length === 0) return;

  const visitedSet = visited instanceof Set ? visited : new Set();
  // Зачем: если источник уже имеет trace_id, но скрипт в кэше с другим trace_id,
  // это новый независимый запуск (иначе "инициатор" не попадёт в цепочку).
  const inheritedTraceId = traceIdCache.get(deviceId);
  
  for (const scriptId of scripts) {
    // Зачем: защита от циклов в графе скриптов (A -> B -> A)
    if (visitedSet.has(scriptId)) continue;
    visitedSet.add(scriptId);

    const cached = scriptExecutionCache.get(scriptId);
    const timeSinceLastChange = cached 
      ? (timestamp - cached.firstChangeTimestamp) 
      : Infinity;
    
    // Условие: НОВЫЙ ЗАПУСК скрипта
    const isNewExecution = 
      !cached ||                                    // Скрипт не в кэше
      timeSinceLastChange > SCRIPT_EXECUTION_WINDOW_MS_SYNTHETIC || // Прошло > 10 секунд
      // Зачем: при подъёме по графу (script->script) источник уже может иметь trace_id цепочки,
      // а cached.trace_id может быть от другой цепочки — тогда нужно "переоткрыть" запуск.
      (typeof inheritedTraceId === 'string' &&
        inheritedTraceId.length > 0 &&
        cached &&
        typeof cached.trace_id === 'string' &&
        cached.trace_id.length > 0 &&
        cached.trace_id !== inheritedTraceId);
    
    if (isNewExecution) {
      // ✅ ЭТО НОВЫЙ ЗАПУСК СКРИПТА!
      handleNewScriptExecution(scriptId, deviceId, timestamp, visitedSet);
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
  
  // Если это событие executed/last_execution для скрипта
  if (role === 'script' && (param === 'executed' || param === 'last_execution')) {
    // Зачем: создаём запись об активном скрипте для последующего связывания
    const targetDevices = getScriptTargetDevices(id);
    
    // Для получения action нужен полный объект из state
    const device = state.get(id);
    
    return {
      type: 'script',
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
  
  // Для обычных устройств возвращаем unknown
  return {
    type: 'unknown',
    ref: null,
    deviceId: null
  };
};

// Генерация trace ID для трассировки событий на основе БД и временных паттернов
// Зачем: построение трассировки без _context от демона через анализ контекста из БД
const generateTraceId = (id, context, param) => {
  const now = Date.now();

  // Зачем: каналы (MAC/do|dim/x) и "обёртки" устройств (UUID с bind=канал) должны иметь один trace_id.
  // Иначе цепочка рвётся: script -> UUID-device имеет trace_id, а channel-change получает новый trace_id.
  const bindFields = getDeviceFields(id);
  const bindId = bindFields && typeof bindFields.bind === 'string' ? bindFields.bind : null;
  if (bindId && traceIdCache.has(bindId)) {
    const linkedTraceId = traceIdCache.get(bindId);
    traceIdCache.set(id, linkedTraceId);
    recentEventsCache.set(id, { timestamp: now, trace_id: linkedTraceId, type: context?.type || 'unknown' });
    return linkedTraceId;
  }
  // Если это канал, который ссылается bind-ом на endDevice (UUID), то тоже подхватываем trace_id endDevice.
  if (isChannelId(id) && bindId && traceIdCache.has(bindId)) {
    const linkedTraceId = traceIdCache.get(bindId);
    traceIdCache.set(id, linkedTraceId);
    recentEventsCache.set(id, { timestamp: now, trace_id: linkedTraceId, type: context?.type || 'unknown' });
    return linkedTraceId;
  }
  
  // Если в контексте уже есть trace_id - используем его и сохраняем в кэш
  if (context && context.trace_id) {
    traceIdCache.set(id, context.trace_id);
    recentEventsCache.set(id, { timestamp: now, trace_id: context.trace_id, type: context.type });
    // Зачем: прокидываем trace_id на bind-канал/обёртку, если связь есть
    if (bindId) traceIdCache.set(bindId, context.trace_id);
    return context.trace_id;
  }
  
  // Зачем: проверяем scriptExecutionCache - если устройство уже связано со скриптом, используем его trace_id
  const scriptCacheEntry = scriptExecutionCache.get(id);
  if (scriptCacheEntry) {
    const cachedTraceId = traceIdCache.get(id);
    if (cachedTraceId) {
      if (bindId) traceIdCache.set(bindId, cachedTraceId);
      return cachedTraceId; // Используем trace_id из кэша скрипта
    }
  }
  
  // Проверяем все скрипты в scriptExecutionCache - может быть устройство в targetDevices
  for (const [scriptId, cached] of scriptExecutionCache.entries()) {
    if (cached.targetDevices && cached.targetDevices.has(id)) {
      const cachedTraceId = cached.trace_id;
      traceIdCache.set(id, cachedTraceId);
      if (bindId) traceIdCache.set(bindId, cachedTraceId);
      return cachedTraceId; // Используем trace_id скрипта
    }
  }
  
  // Анализируем контекст из БД
  const dbContext = analyzeDeviceContext(id, now, param);
  
  // Если это событие скрипта (executed/last_execution)
  if (dbContext.isScriptEvent && dbContext.targetDevices) {
    // Зачем: если скрипт запущен другим скриптом, наследуем trace_id родителя,
    // чтобы цепочка выглядела как Start -> Скрипт B -> ... и не рвалась на отдельные trace_id.
    let inherited = null;
    for (const [parentScriptId, parent] of activeScriptsCache.entries()) {
      const withinWindow = parent?.timestamp && (now - parent.timestamp) <= SCRIPT_EXECUTION_WINDOW_MS_SYNTHETIC;
      const isChild = parent?.actionDevices && parent.actionDevices.has(id);
      if (withinWindow && isChild) {
        if (!inherited || parent.timestamp > inherited.timestamp) {
          inherited = { parentScriptId, timestamp: parent.timestamp, trace_id: parent.trace_id };
        }
      }
    }

    // Генерируем новый trace_id только если нет родительской цепочки
    const traceIdToUse = inherited?.trace_id || uuidv4();
    
    // Зачем: сохраняем скрипт в кэше активных скриптов
    activeScriptsCache.set(id, {
      timestamp: now,
      trace_id: traceIdToUse,
      actionDevices: dbContext.targetDevices
    });
    
    // Зачем: сохраняем trace_id для всех целевых устройств скрипта
    traceIdCache.set(id, traceIdToUse);
    for (const deviceId of dbContext.targetDevices) {
      traceIdCache.set(deviceId, traceIdToUse);
    }
    if (bindId) traceIdCache.set(bindId, traceIdToUse);
    
    recentEventsCache.set(id, { timestamp: now, trace_id: traceIdToUse, type: 'script' });
    
    if (inherited?.parentScriptId) {
      log(`🔗 Скрипт ${id} унаследовал trace_id=${traceIdToUse.slice(0,8)} от родителя ${inherited.parentScriptId.slice(0,8)} (целевых устройств: ${dbContext.targetDevices.size})`);
    } else {
      log(`📋 Скрипт ${id} запущен, trace_id=${traceIdToUse.slice(0,8)}, целевых устройств: ${dbContext.targetDevices.size}`);
    }
    
    return traceIdToUse;
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
    if (bindId) traceIdCache.set(bindId, traceId);
    return traceId;
  }
  
  // Если trigger есть, но trace_id не найден в кэше - генерируем новый
  const newTraceId = uuidv4();
  traceIdCache.set(id, newTraceId);
    traceIdCache.set(triggerRef, newTraceId); // Сохраняем для trigger.ref
    recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: triggerType });
    if (bindId) traceIdCache.set(bindId, newTraceId);
    return newTraceId;
  }
  
  // Если trigger не определён - анализируем временные паттерны
  // Зачем: связываем события, произошедшие в течение короткого времени
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
          if (bindId) traceIdCache.set(bindId, recentEvent.trace_id);
          return recentEvent.trace_id;
        }

        // Связь через bind (обёртка <-> канал)
        if (
          (device.bind && device.bind === recentId) ||
          (recentDevice.bind && recentDevice.bind === id) ||
          (device.bind && recentDevice.bind && device.bind === recentDevice.bind)
        ) {
          traceIdCache.set(id, recentEvent.trace_id);
          recentEventsCache.set(id, { timestamp: now, trace_id: recentEvent.trace_id, type: 'unknown' });
          if (bindId) traceIdCache.set(bindId, recentEvent.trace_id);
          return recentEvent.trace_id;
        }
        
        // Связь через site (оба устройства в одном site)
        const deviceSite = Array.isArray(device.site) ? device.site : (device.site ? [device.site] : []);
        const recentDeviceSite = Array.isArray(recentDevice.site) ? recentDevice.site : (recentDevice.site ? [recentDevice.site] : []);
        if (deviceSite.length > 0 && recentDeviceSite.length > 0) {
          const hasSameSite = deviceSite.some(s => recentDeviceSite.includes(s));
          if (hasSameSite && timeDiff <= 500) { // Для site более строгое окно - 500ms
            traceIdCache.set(id, recentEvent.trace_id);
            recentEventsCache.set(id, { timestamp: now, trace_id: recentEvent.trace_id, type: 'unknown' });
            if (bindId) traceIdCache.set(bindId, recentEvent.trace_id);
            return recentEvent.trace_id;
          }
        }
      }
    }
  }
  
  // Если не нашли связей - генерируем новый trace_id
  // Проверяем, есть ли уже trace_id в кэше для этого ID
  if (traceIdCache.has(id)) {
    const existingTraceId = traceIdCache.get(id);
    recentEventsCache.set(id, { timestamp: now, trace_id: existingTraceId, type: 'unknown' });
    if (bindId) traceIdCache.set(bindId, existingTraceId);
    return existingTraceId;
  }
  
  // Генерируем новый trace_id и сохраняем в кэш
  const newTraceId = uuidv4();
  traceIdCache.set(id, newTraceId);
  recentEventsCache.set(id, { timestamp: now, trace_id: newTraceId, type: 'unknown' });
  if (bindId) traceIdCache.set(bindId, newTraceId);
  
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
const handleActionSet = (message, wsMeta = null) => {
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
                          // Зачем: эти поля нужны для трассировки и построения device -> scripts индекса
                          // (иначе скрипты/действия теряются и цепочки рвутся)
                          'action', 'payload', 'ref', 'id', 'schedule', 'timer', 'duration', 'group',
                          // Зачем: нужно для распаковки site в getScriptTargetDevices (site.device/do/dim)
                          'device', 'do', 'dim'];
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
    
    // 3. Генерируем trace_id для трассировки
    // Зачем: определяем ключевой параметр для анализа (executed, last_execution или другой)
    const keyParam = payload.executed !== undefined ? 'executed' : 
                     payload.last_execution !== undefined ? 'last_execution' : 
                     Object.keys(payload).find(k => k !== 'timestamp') || null;
    
    const traceId = generateTraceId(id, context, keyParam);
    context.trace_id = traceId;
    
    // Создаём чистый payload без timestamp для правильного сравнения
    const cleanPayload = { ...payload };
    delete cleanPayload.timestamp;
    
    // Зачем: проверяем и генерируем синтетические события для скриптов
    // Делаем это ДО processEvent, чтобы синтетическое событие создалось первым
    const timestamp = payload.timestamp || Date.now();
    checkAndGenerateScriptEvent(id, timestamp);
    
    // Обрабатываем событие (используем логику из event-log.js)
    // Зачем: передаем информацию о состоянии актуатора для обогащения событий
    processEvent(id, oldState, newState, context, cleanPayload, actuatorStateInfo, wsMeta);
    
  } catch (error) {
    logError('Ошибка обработки ACTION_SET:', error.message, error.stack);
  }
};

// Обработка события (логика из event-log.js)
// Зачем: обработка событий с обогащением информацией о включении/выключении устройств
const processEvent = (id, oldState, newState, context, changedPayload = null, actuatorStateInfo = null, wsMeta = null) => {
  if (!id || !newState || typeof newState !== 'object') return;

  // Зачем: используем timestamp из payload (если есть), чтобы дедупликация работала стабильно.
  // Иначе Date.now() даёт разные значения на повторных сообщениях (1-2мс), и получаем "дубли" в OpenSearch и consumer-логах.
  const eventTimestamp = (typeof newState.timestamp === 'number' && Number.isFinite(newState.timestamp))
    ? newState.timestamp
    : Date.now();
  
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
    
    const event = {
      timestamp: eventTimestamp,
      logger_pid: process.pid, // Зачем: диагностика дублей при нескольких запущенных процессах логгера
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
      extra: {}
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
    sendEvent(enrichedEvent, wsMeta);
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
      timestamp: eventTimestamp,
      logger_pid: process.pid, // Зачем: диагностика дублей при нескольких запущенных процессах логгера
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
    sendEvent(enrichedEvent, wsMeta);
  }
};

// Отправка события в OpenSearch или буфер
const sendEvent = (event, wsMeta = null) => {
  stats.processed++;
  // Зачем: записываем событие в локальный файл для резервного хранения
  writeEventToFile(event);
  // Зачем: отдельный лог потребителей + детектор дубликатов для анализа отсутствия duration и повторов
  writeConsumerEventToFile(event, wsMeta);
  
  // Проверяем доступность OpenSearch
  if (opensearch.isEnabled && opensearch.isEnabled()) {
    // Отправляем напрямую
    opensearch.sendBatch([event], { enqueueOnFail: false })
      .then(() => {
        stats.os_ok += 1;
        stats.lastOsOkTs = Date.now();
      })
      .catch(err => {
        stats.os_fail += 1;
        stats.lastOsFailTs = Date.now();
        logError('Ошибка отправки события в OpenSearch:', err.message);
        // При ошибке добавляем в буфер
        addToBuffer(event);
      });
  } else {
    // Добавляем в буфер
    addToBuffer(event);
  }
};

// Запись события в локальный файл
// Зачем: резервное хранение событий в локальных файлах

let currentLogFile = null;
let currentConsumersLogFile = null; // Зачем: отдельный файл логов только для потребителей
let currentConsumersDupLogFile = null; // Зачем: отдельный файл для дубликатов потребителей

// Зачем: детектор дубликатов (в пределах окна) для диагностики повторных событий.
// Окно делаем небольшим, т.к. нас интересуют повторы из WS/драйверов в течение секунд.
const DUPLICATE_WINDOW_MS = parseInt(process.env.DUPLICATE_WINDOW_MS || '2000', 10); // 2 секунды
const DUPLICATE_MAX_KEYS = parseInt(process.env.DUPLICATE_MAX_KEYS || '50000', 10);
const recentConsumerEventKeyCache = new Map(); // key -> { ts, ws_seq }

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
    }
    
    // Записываем событие в файл (append)
    const eventLine = JSON.stringify(event) + '\n';
    fs.appendFileSync(currentLogFile, eventLine, 'utf8');
    
  } catch (err) {
    logError('Ошибка записи события в файл:', err.message);
  }
};

// Запись события потребителя в отдельный файл + фиксация дубликатов
// Зачем: быстро анализировать только consumer-события и отлавливать повторы (частая причина "плавающего duration")
const writeConsumerEventToFile = (event, wsMeta = null) => {
  try {
    if (!event || typeof event !== 'object') return;

    const isConsumerEvent =
      (event.device && event.device.consumer === true) ||
      (event.endDevice && event.endDevice.consumer === true);
    if (!isConsumerEvent) return;

    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const consumersLogFile = path.join(logDir, `events-${today}-consumers.jsonl`);
    const consumersDupLogFile = path.join(logDir, `events-${today}-consumers-duplicates.jsonl`);

    if (currentConsumersLogFile !== consumersLogFile) {
      currentConsumersLogFile = consumersLogFile;
      // Зачем: файл должен существовать, чтобы можно было tail-ить его сразу, не дожидаясь первого append
      try { fs.closeSync(fs.openSync(currentConsumersLogFile, 'a')); } catch (e) {}
    }
    if (currentConsumersDupLogFile !== consumersDupLogFile) {
      currentConsumersDupLogFile = consumersDupLogFile;
      // Зачем: файл дублей должен существовать всегда — это упрощает диагностику "дубли на WS или у нас"
      try { fs.closeSync(fs.openSync(currentConsumersDupLogFile, 'a')); } catch (e) {}
    }

    const now = Date.now();
    // Зачем: ключ без event.timestamp, т.к. повторные сообщения часто отличаются на 1-2мс по timestamp,
    // но по смыслу это одно и то же событие (и именно такие повторы ломают duration/кэш).
    const key = `${event.id}|${event.param}|${String(event.old)}|${String(event.new)}`;
    const last = recentConsumerEventKeyCache.get(key);

    // Если это дубль в пределах окна — пишем в отдельный файл и НЕ дублируем в consumers.jsonl
    if (last && (now - last.ts) <= DUPLICATE_WINDOW_MS) {
      fs.appendFileSync(
        currentConsumersDupLogFile,
        JSON.stringify({
          ts: now,
          iso: new Date(now).toISOString(),
          key,
          // Зачем: подтверждаем/опровергаем, что дубли приходят разными WS-сообщениями
          ws_seq_prev: last.ws_seq ?? null,
          ws_seq_now: wsMeta && wsMeta.seq ? wsMeta.seq : null,
          id: event.id,
          timestamp: event.timestamp,
          param: event.param,
          old: event.old,
          new: event.new,
          device: event.device ? { human: event.device.human, type: event.device.type } : null,
          endDevice: event.endDevice ? { human: event.endDevice.human, type: event.endDevice.type } : null
        }) + '\n',
        'utf8'
      );
      return;
    }

    recentConsumerEventKeyCache.set(key, {
      ts: now,
      ws_seq: wsMeta && wsMeta.seq ? wsMeta.seq : null
    });

    // Периодическая чистка (простая) и ограничение размера
    if (recentConsumerEventKeyCache.size > DUPLICATE_MAX_KEYS) {
      const threshold = now - DUPLICATE_WINDOW_MS;
      for (const [k, info] of recentConsumerEventKeyCache.entries()) {
        if (info && typeof info.ts === 'number' && info.ts < threshold) recentConsumerEventKeyCache.delete(k);
      }
      if (recentConsumerEventKeyCache.size > DUPLICATE_MAX_KEYS) {
        // Если всё равно много — чистим самые старые
        const entries = Array.from(recentConsumerEventKeyCache.entries());
        entries.sort((a, b) => (a[1]?.ts ?? 0) - (b[1]?.ts ?? 0));
        const toDrop = recentConsumerEventKeyCache.size - DUPLICATE_MAX_KEYS;
        for (let i = 0; i < toDrop; i++) {
          recentConsumerEventKeyCache.delete(entries[i][0]);
        }
      }
    }

    fs.appendFileSync(currentConsumersLogFile, JSON.stringify(event) + '\n', 'utf8');
  } catch (err) {
    // Зачем: логирование потребителей не должно ломать основной поток
  }
};

// Добавление события в буфер
const addToBuffer = (event) => {
  eventBuffer.push(event);
  stats.buffered++;
  
  // Если буфер переполнен, удаляем старые события
  if (eventBuffer.length > BUFFER_MAX_SIZE) {
    eventBuffer.shift();
    stats.dropped++;
    // Зачем: не спамим ERROR-логами при переполнении. Метрика отображается в 📊 панели (d: dropped),
    // а подробные записи о каждом удалённом событии тут только мешают анализу.
  }
};

// Попытка отправить события из буфера
const flushBuffer = async () => {
  if (eventBuffer.length === 0) return;
  
  if (opensearch.isEnabled && opensearch.isEnabled()) {
    const eventsToSend = [...eventBuffer];
    eventBuffer = [];
    
    try {
      await opensearch.sendBatch(eventsToSend, { enqueueOnFail: false });
      stats.os_ok += eventsToSend.length;
      stats.flushed += eventsToSend.length;
      stats.lastOsOkTs = Date.now();
      log(`Отправлено ${eventsToSend.length} событий из буфера`);
    } catch (err) {
      stats.os_fail += eventsToSend.length;
      stats.lastOsFailTs = Date.now();
      logError('Ошибка отправки событий из буфера:', err.message);
      // Возвращаем события в буфер
      eventBuffer = [...eventsToSend, ...eventBuffer];
    }
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
        wsSentSeq++; // Зачем: счётчик исходящих WS сообщений для панели
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
    wsSentSeq++; // Зачем: счётчик исходящих WS сообщений для панели
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
        logError(`Достигнуто максимальное количество попыток переподключения (${MAX_RECONNECT_ATTEMPTS}). Продолжаем пытаться дальше.`);
        reconnectAttempts = 0;
        setTimeout(connect, RECONNECT_DELAY);
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
      const wsMeta = { seq: ++wsMessageSeq }; // Зачем: диагностика дублей (разные ws_seq = дубли на WS)
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
                                    // Зачем: эти поля нужны для трассировки и построения device -> scripts индекса
                                    'action', 'payload', 'ref', 'id', 'schedule', 'timer', 'duration', 'group',
                                    // Зачем: нужно для распаковки site в getScriptTargetDevices (site.device/do/dim)
                                    'device', 'do', 'dim'];
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
            handleActionSet(message, wsMeta);
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
      logError(`Достигнуто максимальное количество попыток переподключения (${MAX_RECONNECT_ATTEMPTS}). Продолжаем пытаться дальше.`);
      reconnectAttempts = 0;
      setTimeout(connect, RECONNECT_DELAY);
    }
  });
};

// Graceful shutdown
const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('Получен сигнал завершения, завершаем работу...');

  // Зачем: при рестарте/остановке сохраняем кэши, чтобы не терять duration между on/off
  saveActuatorCache();
  if (cacheSaveInterval) clearInterval(cacheSaveInterval);
  
  // Останавливаем интервал
  if (bufferFlushInterval) {
    clearInterval(bufferFlushInterval);
  }
  
  // Отправляем события из буфера
  flushBuffer().then(() => {
    if (ws) {
      ws.close();
    }
    // Зачем: в интерактивном режиме не пишем "обычные" логи, но финальный статус панели показать можно.
    if (IS_TTY) {
      clearStatsLine();
      renderStatsLine();
      process.stdout.write('\n');
    } else {
      log(`📊 Финал: p=${stats.processed} os=${stats.os_ok}/${stats.os_fail} buf=${eventBuffer.length}/${BUFFER_MAX_SIZE} e=${stats.errors} d=${stats.dropped}`);
    }
    process.exit(0);
  }).catch(err => {
    logError('Ошибка при завершении:', err.message);
    if (IS_TTY) {
      clearStatsLine();
      renderStatsLine();
      process.stdout.write('\n');
    }
    process.exit(1);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('beforeExit', () => {
  // Зачем: best-effort сохранение кэша перед завершением процесса
  saveActuatorCache();
});
process.on('uncaughtException', (err) => {
  // Зачем: сохраняем кэш даже при падении, чтобы не потерять onTimestamp
  logError('uncaughtException:', err && err.message ? err.message : String(err));
  saveActuatorCache();
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  // Зачем: сохраняем кэш при необработанном промисе
  logError('unhandledRejection:', err && err.message ? err.message : String(err));
  saveActuatorCache();
});

// Запуск

// В TTY показываем стартовые факты в консоли (однократно), затем работает только 📊 панель.
// В non-TTY (PM2) остаёмся на обычных логах.
if (IS_TTY) {
  printStartupFactsToConsole();
} else {
  log(`Подключение к демону: ${DAEMON_WS_URL}`);
  log(`OpenSearch включен: ${process.env.OPENSEARCH_ENABLED === 'true'}`);
}

// Зачем: восстанавливаем кэш длительности до подключения к WS, чтобы duration считался после рестарта
loadActuatorCache();
// Зачем: периодически сохраняем кэш на диск (best-effort)
cacheSaveInterval = setInterval(saveActuatorCache, 60_000);

// Зачем: интерактивная панель всегда включена.
// В TTY — обновляем одну строку; в non-TTY (PM2) — пишем компактную строку периодически.
setInterval(() => {
  if (IS_TTY) renderStatsLine();
}, 500);
setInterval(() => {
  if (!IS_TTY) logStatsLineNonTty();
}, 30_000);

// Периодически пытаемся отправить события из буфера
bufferFlushInterval = setInterval(flushBuffer, 5000); // Каждые 5 секунд

// Зачем: state будет инициализирован после получения данных через WebSocket (LIST/GET)
// LevelDB не поддерживает многопроцессорный доступ, поэтому читаем через WebSocket
connect();

