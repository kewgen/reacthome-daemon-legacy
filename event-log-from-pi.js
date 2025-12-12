const fs = require('fs');
const path = require('path');
const state = require('../controllers/state');
const { VAR } = require('../assets/constants');
const opensearch = require('./opensearch');
const filters = require('./filters');

// Константы (оптимизированы для Raspberry Pi)
const BATCH_SIZE = 50;
const BATCH_TIMER_MS = 500; // Увеличено с 100ms для снижения нагрузки
const FLUSH_INTERVAL_MS = 10000; // Увеличено с 5s для снижения частоты записи
const FAILED_BATCH_SIZE = 50; // Уменьшено с 100 для экономии памяти
const MAX_LOG_FILE_SIZE_MB = 10; // Максимальный размер файла лога (MB)
const MAX_LOG_FILES_DAYS = 7; // Хранить логи только за последние 7 дней
const MAX_LOG_DIR_SIZE_MB = 50; // Максимальный размер всей папки логов (MB)

// Состояние
let batch = [];
let failedBatch = [];
let flushTimer = null;
let flushInterval = null;
let isShuttingDown = false;
let currentLogFile = null;
let siteNameCache = new Map(); // Кеш для getSiteName
const CACHE_TTL = 60000; // TTL кеша 1 минута

// Проверка доступного места на диске (упрощённая версия для Pi)
const checkDiskSpace = async () => {
  try {
    // Используем простую проверку через stat текущего файла
    // Если файл существует и его размер разумный, считаем что место есть
    if (currentLogFile && fs.existsSync(currentLogFile)) {
      const stats = await fs.promises.stat(currentLogFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      // Если файл меньше 10MB, считаем что место есть
      if (fileSizeMB < MAX_LOG_FILE_SIZE_MB) {
        return 100; // Предполагаем что место есть
      }
    }
    // Если файла нет или он маленький, место точно есть
    return 100;
  } catch (err) {
    // При ошибке считаем что место есть (не блокируем запись)
    return 100;
  }
};

// Очистка старых логов
const cleanupOldLogs = async (aggressive = false) => {
  try {
    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) return;
    
    const files = await fs.promises.readdir(logDir);
    const now = new Date();
    const maxAge = MAX_LOG_FILES_DAYS * 24 * 60 * 60 * 1000;
    
    // Собрать информацию о файлах
    const fileInfos = [];
    for (const file of files) {
      if (!file.startsWith('events-') || !file.endsWith('.jsonl')) continue;
      
      const filePath = path.join(logDir, file);
      const stats = await fs.promises.stat(filePath);
      
      // Извлечь дату из имени файла
      // Формат: events-2025-11-25.jsonl или events-2025-11-25-2025-11-25T09-18-11.112Z.jsonl
      const dateMatch = file.match(/events-(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      
      const fileDate = new Date(dateMatch[1] + 'T00:00:00Z');
      const age = now.getTime() - fileDate.getTime();
      
      fileInfos.push({
        file,
        filePath,
        size: stats.size,
        age
      });
    }
    
    // Сортировать по возрасту (старые первыми)
    fileInfos.sort((a, b) => a.age - b.age);
    
    // Удалить файлы старше maxAge
    for (const info of fileInfos) {
      if (info.age > maxAge) {
        await fs.promises.unlink(info.filePath);
        console.log(`[event-log] Удалён старый лог: ${info.file} (возраст: ${Math.floor(info.age / (24 * 60 * 60 * 1000))} дней)`);
      }
    }
    
    // Если агрессивная очистка - удалить самые старые файлы до достижения лимита
    if (aggressive) {
      const dirSizeMB = await checkLogDirSize();
      if (dirSizeMB > MAX_LOG_DIR_SIZE_MB) {
        // Удалить самые старые файлы, пока размер папки не станет меньше лимита
        for (const info of fileInfos) {
          if (fs.existsSync(info.filePath)) {
            await fs.promises.unlink(info.filePath);
            console.log(`[event-log] Удалён файл для освобождения места: ${info.file} (${(info.size / (1024 * 1024)).toFixed(2)}MB)`);
            
            const newDirSizeMB = await checkLogDirSize();
            if (newDirSizeMB <= MAX_LOG_DIR_SIZE_MB) {
              break;
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[event-log] Ошибка очистки старых логов:', err.message);
  }
};

// Проверка размера папки логов
const checkLogDirSize = async () => {
  try {
    const logDir = path.join(VAR, 'log');
    if (!fs.existsSync(logDir)) return 0;
    
    const files = await fs.promises.readdir(logDir);
    let totalSize = 0;
    
    for (const file of files) {
      if (!file.startsWith('events-') || !file.endsWith('.jsonl')) continue;
      const filePath = path.join(logDir, file);
      const stats = await fs.promises.stat(filePath);
      totalSize += stats.size;
    }
    
    return totalSize / (1024 * 1024); // MB
  } catch (err) {
    return 0;
  }
};

// Инициализация файла лога
const initLogFile = async () => {
  const logDir = path.join(VAR, 'log');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Очистка старых логов при инициализации
  await cleanupOldLogs();
  
  // Проверка размера папки
  const dirSizeMB = await checkLogDirSize();
  if (dirSizeMB > MAX_LOG_DIR_SIZE_MB) {
    console.warn(`[event-log] Размер папки логов превышает ${MAX_LOG_DIR_SIZE_MB}MB (${dirSizeMB.toFixed(2)}MB), выполняется агрессивная очистка`);
    await cleanupOldLogs(true);
  }
  
  const today = new Date().toISOString().split('T')[0];
  currentLogFile = path.join(logDir, `events-${today}.jsonl`);
  
  // Проверка размера текущего файла
  try {
    const stats = await fs.promises.stat(currentLogFile).catch(() => null);
    if (stats) {
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > MAX_LOG_FILE_SIZE_MB) {
        // Ротация: переименовать текущий файл с timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const rotatedFile = path.join(logDir, `events-${today}-${timestamp}.jsonl`);
        await fs.promises.rename(currentLogFile, rotatedFile);
        console.log(`[event-log] Файл лога ротирован: ${fileSizeMB.toFixed(2)}MB`);
      }
    }
  } catch (err) {
    // Файл не существует, это нормально
  }
};

// Получение типа устройства (с поддержкой каналов)
const getDeviceType = (id) => {
  const dev = state.get(id);
  if (dev && dev.type !== undefined) return dev.type;
  
  // Извлечь MAC-адрес из ID канала (формат: MAC/do/1 или MAC/dim/2)
  const parts = id.split('/');
  if (parts.length >= 2 && parts[0].includes(':')) {
    const parentId = parts[0]; // MAC-адрес
    const parent = state.get(parentId);
    return parent?.type;
  }
  return null;
};

// Fallback определение типа устройства
const getDeviceTypeWithFallback = (id) => {
  // Сначала попробовать получить тип напрямую (для корневых устройств)
  const dev = state.get(id);
  if (dev && dev.type !== undefined) return dev.type;
  
  // Извлечь MAC-адрес из ID канала (формат: MAC/do/1 или MAC/dim/2)
  const parts = id.split('/');
  if (parts.length >= 2 && parts[0].includes(':')) {
    const parentId = parts[0]; // MAC-адрес
    const parent = state.get(parentId);
    
    // Если родитель имеет тип - вернуть его
    if (parent && parent.type !== undefined) {
      return parent.type;
    }
    
    // Если это канал DO или DIM - считать актуатором по умолчанию
    if (id.includes('/do/') || id.includes('/dim/')) {
      return 'ACTUATOR_CHANNEL'; // Специальный маркер для каналов-актуаторов
    }
  }
  
  // Fallback для корневых устройств: если есть поля актуаторов
  if (dev && typeof dev === 'object') {
    const hasActuatorFields = 'value' in dev || 'brightness' in dev || 'fan_speed' in dev;
    const hasSensorFields = 'temperature' in dev || 'humidity' in dev || 'co2' in dev;
    
    // Если есть поля актуаторов и нет полей сенсоров - вероятно актуатор
    if (hasActuatorFields && !hasSensorFields) {
      return 'ACTUATOR_FALLBACK'; // Маркер для fallback-определения
    }
  }
  
  return null;
};

// Определение типа актуатора
const isActuatorDevice = (id) => {
  const deviceType = getDeviceTypeWithFallback(id);
  if (!deviceType) return false;
  
  // Специальные маркеры для fallback
  if (deviceType === 'ACTUATOR_CHANNEL' || deviceType === 'ACTUATOR_FALLBACK') {
    return true;
  }
  
  // Проверить, является ли это каналом
  const isChannel = id.includes('/do/') || id.includes('/di/') || id.includes('/dim/');
  
  // Для каналов: DO и DIM - актуаторы, DI - сенсоры (не логируем)
  if (isChannel) {
    return id.includes('/do/') || id.includes('/dim/');
  }
  
  // Для корневых устройств - проверка по типу
  const actuatorTypes = [
    0x0a, // DEVICE_TYPE_DO8
    0x0b, // DEVICE_TYPE_DO16
    0x0c, // DEVICE_TYPE_DI16_DO8
    0x0d, // DEVICE_TYPE_DO8_DI16
    0x11, // DEVICE_TYPE_DO12
    0x23, // DEVICE_TYPE_RELAY_2
    0x25, // DEVICE_TYPE_SMART_4G
    0x26, // DEVICE_TYPE_SMART_4GD
    0x27, // DEVICE_TYPE_SMART_4A
    0x2a, // DEVICE_TYPE_SMART_4AM
    0xa0, // DEVICE_TYPE_RELAY_6
    0xa1, // DEVICE_TYPE_RELAY_12
    0xa2, // DEVICE_TYPE_RELAY_24
    0xa3, // DEVICE_TYPE_DIM_4
    0xa4, // DEVICE_TYPE_DIM_8
    0xa5, // DEVICE_TYPE_LANAMP
    0xa7, // DEVICE_TYPE_RELAY_2_DIN
    0xa9, // DEVICE_TYPE_AO_4_DIN
    0xaa, // DEVICE_TYPE_MIX_2
    0xab, // DEVICE_TYPE_MIX_1
    0xac, // DEVICE_TYPE_MIX_1_RS
    0xad, // DEVICE_TYPE_DIM_12_LED_RS
    0xae, // DEVICE_TYPE_RELAY_12_RS
    0xaf, // DEVICE_TYPE_DIM_8_RS
    0xb3, // DEVICE_TYPE_DIM_12_AC_RS
    0xb4, // DEVICE_TYPE_DIM_12_DC_RS
    0xb5, // DEVICE_TYPE_MIX_6x12_RS
    0xb6, // DEVICE_TYPE_DIM_1_AC_RS
    0x0e, // DEVICE_TYPE_DIM4
    0x0f, // DEVICE_TYPE_DIM8
    0x41  // DEVICE_TYPE_MIX_H
  ];
  
  return actuatorTypes.includes(deviceType);
};

// Получение названия локации (Site) (с кешированием для оптимизации)
const getSiteName = (id, maxDepth = 10, visited = new Set(), debug = false) => {
  // Проверка кеша
  const cacheKey = `${id}_${maxDepth}`;
  const cached = siteNameCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    if (debug) console.log(`[getSiteName] Кеш для ${id}:`, cached.value);
    return cached.value;
  }
  
  if (visited.has(id) || maxDepth <= 0) {
    if (debug) console.log(`[getSiteName] Превышен maxDepth или циклическая ссылка для ${id}`);
    const result = null;
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  visited.add(id);
  
  const current = state.get(id);
  if (!current || typeof current !== 'object') {
    if (debug) console.log(`[getSiteName] Объект ${id} не найден или не является объектом`);
    const result = null;
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  
  if (debug) {
    console.log(`[getSiteName] Проверка ${id}:`, {
      type: current.type,
      hasSite: !!current.site,
      siteType: Array.isArray(current.site) ? 'array' : typeof current.site,
      siteLength: Array.isArray(current.site) ? current.site.length : 'N/A',
      hasProject: !!current.project,
      projectType: typeof current.project,
      hasTitle: !!current.title,
      hasCode: !!current.code,
      title: current.title,
      code: current.code
    });
  }
  
  // Проверить, является ли текущий элемент локацией (Site)
  // Константа SITE = "site" (нижний регистр), а не "SITE"
  if (current.type === 'site' || current.type === 'SITE') {
    const result = current.title || current.code || null;
    if (debug) console.log(`[getSiteName] Найден SITE для ${id}:`, result);
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  
  // Проверить, является ли текущий элемент проектом (Project)
  // Константа PROJECT = "project" (нижний регистр), а не "PROJECT"
  if (current.type === 'project' || current.type === 'PROJECT') {
    const result = current.title || current.code || null;
    if (debug) console.log(`[getSiteName] Найден PROJECT для ${id}:`, result);
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  
  // Проверить site (массив или строка) - приоритет Site над Project
  if (current.site) {
    let siteId = null;
    
    // Если site - массив, берём первый элемент
    if (Array.isArray(current.site) && current.site.length > 0) {
      siteId = current.site[0];
    }
    // Если site - строка (ID), используем её напрямую
    else if (typeof current.site === 'string') {
      siteId = current.site;
    }
    
    if (siteId && typeof siteId === 'string') {
      if (debug) console.log(`[getSiteName] Рекурсивный поиск для site=${siteId}`);
      const site = getSiteName(siteId, maxDepth - 1, visited, debug);
      if (site) {
        if (debug) console.log(`[getSiteName] Найден site через site для ${id}:`, site);
        siteNameCache.set(cacheKey, { value: site, timestamp: Date.now() });
        return site;
      }
    }
  }
  
  // Проверить project (fallback, если нет site) - возвращаем Project (pochta, mindal)
  if (current.project && typeof current.project === 'string') {
    if (debug) console.log(`[getSiteName] Рекурсивный поиск для project=${current.project}`);
    const project = getSiteName(current.project, maxDepth - 1, visited, debug);
    if (project) {
      if (debug) console.log(`[getSiteName] Найден site через project для ${id}:`, project);
      siteNameCache.set(cacheKey, { value: project, timestamp: Date.now() });
      return project;
    }
  }
  
  // Проверить parent (fallback для каналов и других вложенных объектов)
  if (current.parent && typeof current.parent === 'string') {
    if (debug) console.log(`[getSiteName] Рекурсивный поиск для parent=${current.parent}`);
    const parentSite = getSiteName(current.parent, maxDepth - 1, visited, debug);
    if (parentSite) {
      if (debug) console.log(`[getSiteName] Найден site через parent для ${id}:`, parentSite);
      siteNameCache.set(cacheKey, { value: parentSite, timestamp: Date.now() });
      return parentSite;
    }
  }
  
  if (debug) console.log(`[getSiteName] Не найдено site для ${id}`);
  const result = null;
  siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
  return result;
};

// Получение названия проекта (Project) (с кешированием для оптимизации)
// Получение ID устройства-источника из контекста
const getTriggerDeviceId = (context) => {
  if (!context) return null;
  
  // Если есть явное поле deviceId - используем его
  if (context.deviceId) {
    return context.deviceId;
  }
  
  // Если trigger.type === 'device', то trigger.id = trigger.ref
  if (context.type === 'device' && context.ref) {
    return context.ref;
  }
  
  return null;
};

// Округление числа до десятых (одного знака после запятой)
// Применяется только к числам, для остальных типов возвращает исходное значение
const roundToTenths = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)) {
    return Math.round(value * 10) / 10;
  }
  return value;
};

// Список числовых параметров (для value.old и value.new)
const NUMERIC_PARAMS = [
  'temperature',  // Температура
  'humidity',     // Влажность
  'co2',          // CO2
  'r',            // Красный канал RGB
  'g',            // Зелёный канал RGB
  'b',            // Синий канал RGB
  'brightness',   // Яркость
  'fan_speed',    // Скорость вентилятора
  'setpoint'      // Уставка
];

// Проверка, является ли параметр числовым
const isNumericParam = (param) => {
  return NUMERIC_PARAMS.includes(param);
};

// Получение человекочитаемого названия из объекта (title/code/name через "/")
const getHumanName = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  
  const parts = [];
  if (obj.title) parts.push(obj.title);
  if (obj.code) parts.push(obj.code);
  if (obj.name) parts.push(obj.name);
  
  const result = parts.length > 0 ? parts.join('/') : null;
  
  return result;
};

// Получение человекочитаемого названия триггера
// Если triggerId передан и отличается от context.ref, используем его для получения названия устройства-источника
const getTriggerHuman = (context, triggerId = null) => {
  if (!context || !context.ref) return null;
  
  const triggerType = context.type;
  
  // Для websocket и unknown - возвращаем null
  if (triggerType === 'websocket' || triggerType === 'unknown') {
    return null;
  }
  
  // Если triggerId передан и отличается от ref - использовать его для получения названия устройства-источника
  // Это позволяет показывать название устройства, которое вызвало скрипт, вместо названия скрипта
  if (triggerId && triggerId !== context.ref) {
    const deviceState = state.get(triggerId);
    if (deviceState && typeof deviceState === 'object') {
      return getHumanName(deviceState);
    }
  }
  
  // Иначе использовать ref (текущая логика) - для скриптов без устройства-источника, расписаний, таймеров
  const triggerState = state.get(context.ref);
  if (!triggerState || typeof triggerState !== 'object') {
    return null;
  }
  
  return getHumanName(triggerState);
};

const getProjectName = (id, maxDepth = 10, visited = new Set()) => {
  // Проверка кеша
  const cacheKey = `project_${id}_${maxDepth}`;
  const cached = siteNameCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.value;
  }
  
  if (visited.has(id) || maxDepth <= 0) {
    // Если достигли лимита глубины или циклическая ссылка, возвращаем дефолтный проект 'pochta'
    const result = 'pochta';
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  visited.add(id);
  
  const current = state.get(id);
  if (!current || typeof current !== 'object') {
    // Если объект не найден, возвращаем дефолтный проект 'pochta'
    const result = 'pochta';
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  
  // Проверить, является ли текущий элемент проектом (Project)
  if (current.type === 'PROJECT') {
    const result = current.title || current.code || 'pochta';
    siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
    return result;
  }
  
  // Проверить project (если есть прямая ссылка на проект)
  if (current.project && typeof current.project === 'string') {
    const project = getProjectName(current.project, maxDepth - 1, visited);
    if (project) {
      siteNameCache.set(cacheKey, { value: project, timestamp: Date.now() });
      return project;
    }
  }
  
  // Проверить site (если есть site, искать project в нём)
  if (current.site && Array.isArray(current.site) && current.site.length > 0) {
    const siteId = current.site[0];
    if (typeof siteId === 'string') {
      const project = getProjectName(siteId, maxDepth - 1, visited);
      if (project) {
        siteNameCache.set(cacheKey, { value: project, timestamp: Date.now() });
        return project;
      }
    }
  }
  
  // Если проект не найден в иерархии, возвращаем дефолтный проект 'pochta'
  // Это сервер pochta, поэтому по умолчанию используем 'pochta'
  const result = 'pochta';
  siteNameCache.set(cacheKey, { value: result, timestamp: Date.now() });
  return result;
};

// Очистка кеша (периодически)
const clearCache = () => {
  const now = Date.now();
  for (const [key, value] of siteNameCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      siteNameCache.delete(key);
    }
  }
};

// Запись батча в файл
const writeBatch = async () => {
  const eventsToWrite = batch.length > 0 ? [...batch] : [...failedBatch];
  if (eventsToWrite.length === 0) return;
  
  batch.length = 0;
  const tempFailed = failedBatch.length > 0;
  failedBatch.length = 0;
  
  // Проверка доступного места на диске перед записью
  const freeSpaceMB = await checkDiskSpace();
  if (freeSpaceMB < 10) { // Меньше 10MB свободного места
    console.warn(`[event-log] Мало места на диске: ${freeSpaceMB.toFixed(2)}MB, пропуск записи`);
    // Не добавляем в failedBatch, чтобы не расходовать память
    return;
  }
  
  // Проверка размера текущего файла перед записью
  const logDir = path.join(VAR, 'log');
  try {
    if (currentLogFile && fs.existsSync(currentLogFile)) {
      const stats = await fs.promises.stat(currentLogFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > MAX_LOG_FILE_SIZE_MB) {
        // Ротация: переименовать текущий файл с timestamp
        const today = new Date().toISOString().split('T')[0];
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const rotatedFile = path.join(logDir, `events-${today}-${timestamp}.jsonl`);
        await fs.promises.rename(currentLogFile, rotatedFile);
        console.log(`[event-log] Файл лога ротирован: ${fileSizeMB.toFixed(2)}MB`);
        
        // Создать новый файл для текущего дня
        currentLogFile = path.join(logDir, `events-${today}.jsonl`);
      }
    }
  } catch (err) {
    console.error('[event-log] Ошибка проверки размера файла:', err.message);
  }
  
  // Оптимизированная сериализация (один JSON.stringify для всего батча)
  let lines = '';
  for (const event of eventsToWrite) {
    try {
      lines += JSON.stringify(event) + '\n';
    } catch (err) {
      // Пропустить событие с ошибкой сериализации
      console.error('[event-log] Ошибка сериализации события:', err.message);
    }
  }
  
  try {
    await fs.promises.appendFile(currentLogFile, lines);
    
    // Если были failed события - логировать успешное восстановление
    if (tempFailed) {
      console.log(`[event-log] Recovered ${eventsToWrite.length} failed events`);
    }
    
    // Отправка в OpenSearch (асинхронно, не блокирует запись в файл)
    if (opensearch.isEnabled()) {
      opensearch.sendBatch(eventsToWrite).catch(err => {
        console.error('[event-log] Ошибка отправки в OpenSearch:', err.message);
      });
    }
    
    // Периодическая очистка кеша
    if (Math.random() < 0.1) { // 10% вероятность при каждой записи
      clearCache();
    }
  } catch (err) {
    console.error('[event-log] Ошибка записи в файл:', err.message);
    
    // Добавить события в резервное хранилище (только если есть место)
    if (failedBatch.length < FAILED_BATCH_SIZE) {
      failedBatch.push(...eventsToWrite);
    } else {
      // Если резервное хранилище переполнено, просто отбрасываем события
      console.error(`[event-log] Dropped ${eventsToWrite.length} events due to failed batch overflow`);
    }
    
    // Повторная попытка через 10 секунд (увеличено для снижения нагрузки)
    setTimeout(() => {
      if (!isShuttingDown && failedBatch.length > 0) {
        writeBatch();
      }
    }, 10000);
  }
};

// Flush батча
const flush = async () => {
  await writeBatch();
};

// Добавление события в батч
const add = (id, oldState, newState, context, changedPayload = null) => {
  if (!id || !newState || typeof newState !== 'object') return;
  
  // Если передан changedPayload, логируем только параметры из payload
  // Это нужно, потому что state.set делает merge через Object.assign,
  // и для параметров, не переданных в payload, old и new будут одинаковыми
  const paramsToCheck = changedPayload ? Object.keys(changedPayload) : null;
  
  // Специальная обработка для события запуска скрипта
  // Логируем событие запуска скрипта (executed, last_execution)
  if (newState.executed !== undefined || newState.last_execution !== undefined) {
    const param = newState.executed !== undefined ? 'executed' : 'last_execution';
    // Правильная обработка oldValue - если undefined, используем null
    let oldValue = null;
    if (param === 'executed') {
      oldValue = oldState?.executed !== undefined ? oldState.executed : null;
    } else {
      oldValue = oldState?.last_execution !== undefined ? oldState.last_execution : null;
    }
    const newValue = newState.executed !== undefined ? newState.executed : (newState.last_execution || null);
    
    // Для executed и last_execution не применяем округление (это не числовые параметры для value)
    // executed - булево, last_execution - timestamp
    const roundedOldValue = oldValue !== null && oldValue !== undefined ? oldValue : null;
    const roundedNewValue = newValue !== null && newValue !== undefined ? newValue : null;
    
    // Для скриптов получаем site из родительской локации
    let siteName = getSiteName(id);
    if (!siteName && newState.parent) {
      siteName = getSiteName(newState.parent);
    }
    
    const triggerDeviceId = getTriggerDeviceId(context);
    const event = {
      timestamp: Date.now(),
      id,
      device: {
        type: null,
        human: getHumanName(newState),
        code: newState.code || null,
        name: newState.name || null
      },
      param,
      old: roundedOldValue,
      new: roundedNewValue,
      trigger: {
        type: 'script', // Всегда 'script' для события запуска скрипта
        ref: context.ref || null,
        id: triggerDeviceId, // ID устройства-источника
        human: getTriggerHuman(context, triggerDeviceId), // Используем triggerDeviceId для получения названия устройства
        session: context.session || null,
        remote_ip: context.remote_ip || null
      },
      site: siteName || null,
      project: getProjectName(id),
      extra: {}
    };
    
    batch.push(event);
    
    if (batch.length >= BATCH_SIZE) {
      flush();
    }
    return; // Логируем только событие запуска скрипта
  }
  
  // Использование типизированной системы фильтров
  // Параметры актуаторов и сенсоров
  const allParams = filters.ALL_PARAMS;
  
  for (const param of allParams) {
    // Если передан changedPayload, проверяем только параметры из payload
    if (paramsToCheck && !paramsToCheck.includes(param)) {
      continue; // Параметр не был изменён в payload
    }
    
    const oldValue = oldState?.[param];
    const newValue = newState[param];
    
    // Проверка через типизированную систему фильтров
    if (!filters.shouldLogEvent(param, oldValue, newValue, id, isActuatorDevice)) {
      continue; // Фильтр отклонил событие
    }
    
    const deviceType = getDeviceTypeWithFallback(id);
    const deviceTypeStr = deviceType && typeof deviceType === 'number' 
      ? `DEVICE_TYPE_${deviceType.toString(16).toUpperCase()}` 
      : null;
    
    // Определяем валидность значений для формирования события
    const oldIsValid = oldValue !== undefined && oldValue !== null && !(typeof oldValue === 'number' && Number.isNaN(oldValue));
    const newIsValid = newValue !== undefined && newValue !== null && !(typeof newValue === 'number' && Number.isNaN(newValue));
    
    // Округляем значения до десятых перед сохранением в событие
    const roundedOldValue = oldIsValid ? roundToTenths(oldValue) : null;
    const roundedNewValue = newIsValid ? roundToTenths(newValue) : null;
    
    // Определяем, является ли параметр числовым
    const isNumeric = isNumericParam(param);
    
    const triggerDeviceId = getTriggerDeviceId(context);
    const event = {
      timestamp: Date.now(),
      id,
      device: {
        type: deviceTypeStr,
        human: getHumanName(newState),
        code: newState.code || null,
        name: newState.name || null
      },
      param,
      // Для обратной совместимости оставляем old и new
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
        id: triggerDeviceId, // ID устройства-источника
        human: getTriggerHuman(context, triggerDeviceId), // Используем triggerDeviceId для получения названия устройства
        session: context.session || null,
        remote_ip: context.remote_ip || null
      },
      site: (() => {
        // Включаем debug для случаев, когда site=null
        const current = state.get(id);
        const siteType = current?.site ? (Array.isArray(current.site) ? 'array' : typeof current.site) : 'none';
        const enableDebug = !current?.site && !current?.project && !current?.parent;
        const siteName = getSiteName(id, 10, new Set(), enableDebug);
        
        // Временное логирование для диагностики (можно убрать после проверки)
        if (!siteName) {
          const siteId = current?.site ? (Array.isArray(current.site) ? current.site[0] : current.site) : null;
          console.log(`[event-log] site=null для id=${id}, type=${current?.type}, site=${siteType}, siteId=${siteId || 'N/A'}, hasProject=${!!current?.project}, hasParent=${!!current?.parent}`);
          
          // Если есть siteId, проверяем, существует ли объект сайта
          if (siteId) {
            const siteObj = state.get(siteId);
            if (siteObj) {
              console.log(`[event-log] Объект сайта ${siteId} найден: type=${siteObj.type}, hasTitle=${!!siteObj.title}, hasCode=${!!siteObj.code}, title=${siteObj.title || 'N/A'}, code=${siteObj.code || 'N/A'}`);
            } else {
              console.log(`[event-log] Объект сайта ${siteId} НЕ найден в state`);
            }
          }
        }
        return siteName;
      })(),
      project: getProjectName(id),
      extra: {}
    };
    
    batch.push(event);
    
    // Немедленный flush при переполнении
    if (batch.length >= BATCH_SIZE) {
      flush();
    }
  }
};

// Graceful shutdown
const setupGracefulShutdown = () => {
  const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
  signals.forEach(sig => {
    process.on(sig, async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      
      // Отменить таймеры
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
      
      // Немедленный flush всех событий
      await flush();
      
      console.log('[event-log] Graceful shutdown completed');
      
      // Выйти из процесса (для SIGTERM/SIGINT)
      if (sig === 'SIGTERM' || sig === 'SIGINT') {
        process.exit(0);
      }
    });
  });
};

// Инициализация модуля
const init = async () => {
  await initLogFile();
  setupGracefulShutdown();
  
  // Таймер для периодического flush (500ms - оптимизировано для Pi)
  flushTimer = setInterval(() => {
    if (batch.length > 0) {
      flush();
    }
  }, BATCH_TIMER_MS);
  
  // Периодический flush каждые 10 секунд (оптимизировано для Pi)
  flushInterval = setInterval(() => {
    if (batch.length > 0 || failedBatch.length > 0) {
      writeBatch();
    }
  }, FLUSH_INTERVAL_MS);
  
  // Периодическая очистка старых логов (каждые 10 минут)
  setInterval(async () => {
    await cleanupOldLogs();
    const dirSizeMB = await checkLogDirSize();
    if (dirSizeMB > MAX_LOG_DIR_SIZE_MB) {
      console.warn(`[event-log] Размер папки логов превышает ${MAX_LOG_DIR_SIZE_MB}MB (${dirSizeMB.toFixed(2)}MB), выполняется агрессивная очистка`);
      await cleanupOldLogs(true); // Агрессивная очистка
    }
  }, 10 * 60 * 1000); // 10 минут
};

// Автоматическая инициализация при загрузке модуля
init().catch(err => {
  console.error('[event-log] Ошибка инициализации:', err);
});

// Логирование события перезапуска демона
const logDaemonRestart = (reason, details = {}) => {
  try {
    // Получить ID демона (обычно это MAC адрес)
    const daemonId = process.env.MAC || 'unknown';
    const daemonState = state.get(daemonId) || {};
    
    // Определить дополнительные детали
    const restartDetails = {
      reason,
      uptime: process.uptime(),
      pid: process.pid,
      pm2_instance_id: process.env.INSTANCE_ID || null,
      pm2_restart_time: process.env.PM2_RESTART_TIME || null,
      pm2_restart_count: process.env.PM2_RESTART || null,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      ...details
    };
    
    // Создать событие перезапуска
    const event = {
      timestamp: Date.now(),
      id: daemonId,
      device: {
        type: 'DAEMON',
        human: 'Демон',
        name: null
      },
      param: 'restart',
      old: null,
      new: reason,
      trigger: {
        type: 'system',
        ref: null,
        id: null,
        human: 'Система',
        session: null,
        remote_ip: null
      },
      site: null,
      project: 'pochta',
      extra: restartDetails
    };
    
    // Добавить событие в батч (синхронно, чтобы гарантировать запись)
    batch.push(event);
    
    // Немедленный flush для события перезапуска
    flush().catch(err => {
      console.error('[event-log] Ошибка логирования перезапуска:', err.message);
    });
    
    console.log(`[event-log] Зафиксирован перезапуск демона: ${reason}`, restartDetails);
  } catch (err) {
    console.error('[event-log] Ошибка логирования перезапуска:', err.message);
  }
};

module.exports = {
  add,
  flush,
  logDaemonRestart,
  // Вспомогательные функции для event-logger.js
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
};

