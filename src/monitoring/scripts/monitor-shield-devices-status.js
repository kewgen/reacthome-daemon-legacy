#!/usr/bin/env node

/**
 * Скрипт для интерактивного мониторинга состояния щитовых устройств
 * 
 * ОПИСАНИЕ:
 * =========
 * Скрипт предоставляет интерактивный интерфейс для мониторинга состояния всех
 * щитовых устройств в системе ReactHome в реальном времени. Он автоматически
 * загружает список устройств из базы данных LevelDB, подключается к WebSocket
 * серверу и периодически запрашивает актуальное состояние каждого устройства.
 * 
 * Экран обновляется каждые 3 секунды, показывая:
 * - Статус подключения к WebSocket (🟢/🔴)
 * - Онлайн/оффлайн статус каждого устройства
 * - IP-адреса устройств
 * - Дополнительные параметры (CO2, температура, влажность) для сенсоров
 * - Время с момента последнего изменения состояния устройства (изм: Xs/Xм/Xч)
 * - Время последнего обновления данных (в скобках)
 * - Общую статистику по всем устройствам
 * 
 * Устройства группируются по категориям:
 * - Актуаторы (реле, диммеры, LANAMP, AO)
 * - Панели управления (Smart 4G)
 * - Сенсоры (DI_4, CO2 сенсоры, Doppler)
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * ==============
 * Базовое использование (использует настройки по умолчанию):
 *   node scripts/monitor-shield-devices-status.js
 * 
 * С указанием WebSocket URI:
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/monitor-shield-devices-status.js
 * 
 * С указанием пути к базе данных:
 *   DB_PATH=/path/to/db node scripts/monitor-shield-devices-status.js
 * 
 * Комбинированное использование:
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 DB_PATH=/home/pi/reacthome-daemon/var/db node scripts/monitor-shield-devices-status.js
 * 
 * ПАРАМЕТРЫ ОКРУЖЕНИЯ:
 * ====================
 * REACTHOME_WS_URI  - URI WebSocket сервера (по умолчанию: ws://192.168.88.4:3000)
 * DB_PATH           - Путь к базе данных LevelDB (по умолчанию: ./var/db)
 * 
 * ПРИМЕРЫ ВЫВОДА:
 * ===============
 * Скрипт выводит таблицу с информацией о каждом устройстве:
 * 
 *   🟢 AO 4                           AO_4_DIN        172.16.0.3      изм: 8s (2s)
 *   🟢 R1                             RELAY_12        172.16.0.5      изм: 5s (2s)
 *   🔴 S4 Ванна                       SMART_4G        —               изм: 2s (0s)
 *   🟢 1.СО2 Младшая                  CO2_SENSOR      172.16.0.5      CO2: 810 изм: 0s (2s)
 * 
 * Где:
 *   🟢/🔴/⚪ - статус устройства (онлайн/оффлайн/ожидание данных)
 *   Название устройства
 *   Тип устройства
 *   IP-адрес (или "—" если не указан)
 *   Дополнительные параметры (CO2, температура, влажность)
 *   "изм: Xs/Xм/Xч" - время с момента последнего изменения состояния (секунды/минуты/часы)
 *   "(Xs)" - время с момента последнего обновления данных в секундах
 * 
 * ВЫХОД:
 * ======
 * Для выхода из скрипта нажмите Ctrl+C. Скрипт корректно закроет все соединения
 * и освободит ресурсы.
 * 
 * ТЕХНИЧЕСКИЕ ДЕТАЛИ:
 * ===================
 * - Скрипт использует WebSocket API для получения состояния устройств
 * - Запросы отправляются каждые 3 секунды через команду GET
 * - Состояние устройств кэшируется в памяти для быстрого отображения
 * - Отслеживаются изменения состояния по ключевым полям: online, ip, co2, temperature, humidity, illumination
 * - Время последнего изменения состояния обновляется только при реальных изменениях параметров
 * - Экран очищается и перерисовывается при каждом обновлении
 * - Поддерживается автоматическое переподключение при разрыве соединения
 * 
 * ЗАЧЕМ:
 * ======
 * Позволяет оператору системы быстро оценить состояние всех щитовых устройств
 * в реальном времени, быстро выявить проблемы с подключением устройств,
 * отследить изменения параметров сенсоров (CO2, температура, влажность)
 * и получить общую картину работоспособности системы умного дома.
 */

const WebSocket = require('ws');
const { Level } = require('level');
const path = require('path');
const readline = require('readline');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const UPDATE_INTERVAL = 3000; // Обновление каждые 3 секунды

// Типы щитовых устройств
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f];
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4',
  0x02: 'SENSOR6',
  0x03: 'THI',
  0x04: 'DOPPLER',
  0x0a: 'DO8',
  0x0b: 'DO16',
  0x0e: 'DIM4',
  0x0f: 'DIM8',
  0x20: 'DI_4',
  0x23: 'RELAY_2',
  0x25: 'SMART_4G',
  0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4',
  0x2e: 'DOPPLER_5_DI_4',
  0x2f: 'DI_4_RSM',
  0xa0: 'RELAY_6',
  0xa1: 'RELAY_12',
  0xa3: 'DIM_4',
  0xa4: 'DIM_8',
  0xa5: 'LANAMP',
  0xa7: 'RELAY_2_DIN',
  0xa9: 'AO_4_DIN',
  0xac: 'MIX_1_RS',
  0xad: 'DIM_12_LED_RS',
  0xae: 'RELAY_12_RS',
  0xaf: 'DIM_8_RS',
  0xb3: 'DIM_12_AC_RS',
  0xb4: 'DIM_12_DC_RS',
  0xb5: 'MIX_6x12_RS',
  0xb6: 'DIM_1_AC_RS',
};

function isShieldDevice(type) {
  return SHIELD_TYPES.includes(type);
}

function getDeviceName(device) {
  return device.title || device.code || device.name || 'без названия';
}

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  return 'Другое';
}

// Получаем список щитовых устройств из БД
async function getShieldDevicesFromDB() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
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
  } finally {
    await db.close();
  }
  
  return devices.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

// Класс для управления выводом в консоль
class StatusDisplay {
  constructor() {
    this.deviceStates = new Map(); // id -> { device, state }
    this.lastUpdate = null;
    this.isConnected = false;
    this.updateTimer = null;
  }
  
  updateDeviceState(deviceId, newState) {
    // Зачем: Отслеживаем изменения состояния устройства, а не просто обновления данных
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();
    
    // Проверяем, изменилось ли состояние устройства
    let stateChanged = false;
    if (existing && existing.state) {
      const oldState = existing.state;
      
      // Сравниваем ключевые поля состояния
      const keyFields = ['online', 'ip', 'co2', 'temperature', 'humidity', 'illumination'];
      for (const field of keyFields) {
        if (oldState[field] !== newState[field]) {
          stateChanged = true;
          break;
        }
      }
      
      // Также проверяем изменения в числовых полях с учетом точности
      if (!stateChanged) {
        if (oldState.temperature !== undefined && newState.temperature !== undefined) {
          if (Math.abs((oldState.temperature || 0) - (newState.temperature || 0)) > 0.1) {
            stateChanged = true;
          }
        }
        if (oldState.humidity !== undefined && newState.humidity !== undefined) {
          if (Math.abs((oldState.humidity || 0) - (newState.humidity || 0)) > 0.1) {
            stateChanged = true;
          }
        }
      }
    } else {
      // Первое получение состояния - считаем это изменением
      stateChanged = true;
    }
    
    // Обновляем время последнего изменения состояния
    const lastStateChange = stateChanged ? now : (existing?.lastStateChange || now);
    
    this.deviceStates.set(deviceId, {
      ...existing,
      state: newState,
      lastUpdate: now,
      lastStateChange: lastStateChange,
    });
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
  }
  
  render() {
    // Очищаем экран (используем ANSI escape codes для совместимости)
    // Зачем: Очищаем экран перед каждым обновлением для интерактивного режима
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[2J\x1b[H'); // Очистить экран и переместить курсор в начало
    } else {
      // Если не терминал, просто выводим разделитель
      console.log('\n' + '═'.repeat(80) + '\n');
    }
    
    // Заголовок
    const statusIcon = this.isConnected ? '🟢' : '🔴';
    const timeStr = new Date().toLocaleTimeString('ru-RU');
    console.log(`╔═══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ МОНИТОРИНГ СОСТОЯНИЯ ЩИТОВЫХ УСТРОЙСТВ  ${statusIcon}  ${timeStr.padEnd(20)} ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════╝\n`);
    
    if (!this.isConnected) {
      console.log('⚠️  Ожидание подключения к WebSocket...\n');
      return;
    }
    
    // Группируем по категориям
    const byCategory = {};
    for (const [id, data] of this.deviceStates.entries()) {
      const category = data.device?.category || 'Неизвестно';
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push({ id, ...data });
    }
    
    // Выводим по категориям
    for (const [category, devices] of Object.entries(byCategory)) {
      console.log(`\n📦 ${category.toUpperCase()} (${devices.length} устройств)\n`);
      
      devices.forEach(({ id, device, state, lastStateChange }) => {
        const name = device?.name || id;
        const typeName = device?.typeName || '?';
        
        // Определяем статус онлайн/оффлайн
        // Зачем: Улучшенная логика определения статуса - если устройство отправляет данные,
        //        то оно работает, даже если поле online=false (может быть из-за таймаута discovery)
        let onlineIcon = '⚪'; // Серый - состояние еще не получено
        if (state) {
          // Проверяем поле online
          let isOnline = state.online === true;
          
          // Если online=false, но устройство отправляет актуальные данные - считаем его онлайн
          if (!isOnline) {
            const dataAge = state.lastUpdate ? Math.floor((Date.now() - state.lastUpdate) / 1000) : null;
            
            // Устройство считается работающим, если:
            // 1. Есть IP-адрес И данные обновлялись недавно (меньше 2 минут)
            // 2. ИЛИ есть актуальные данные от сенсоров (температура, влажность, CO2) и данные свежие
            const hasRecentData = dataAge !== null && dataAge < 120; // 2 минуты
            const hasSensorData = (state.temperature !== undefined && state.temperature !== null) ||
                                 (state.humidity !== undefined && state.humidity !== null) ||
                                 (state.co2 !== undefined && state.co2 !== null);
            const hasIp = state.ip && state.ip !== '—';
            
            if (hasRecentData && (hasIp || hasSensorData)) {
              isOnline = true;
            }
          }
          
          onlineIcon = isOnline ? '🟢' : '🔴';
        }
        
        const ip = state?.ip || '—';
        
        // Дополнительная информация в зависимости от типа устройства
        // Зачем: Показываем важные параметры устройств (CO2, температура, влажность)
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
        
        // Время с момента последнего обновления данных
        const dataAge = state?.lastUpdate ? Math.floor((Date.now() - state.lastUpdate) / 1000) : null;
        
        // Время с момента последнего изменения состояния
        // Зачем: Показываем, когда устройство реально изменило свое состояние
        const stateChangeAge = lastStateChange ? Math.floor((Date.now() - lastStateChange) / 1000) : null;
        
        // Форматируем время последнего изменения состояния
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
        
        // Время последнего обновления данных (для отладки)
        const dataAgeStr = dataAge !== null && dataAge < 10 ? ` (${dataAge}s)` : dataAge !== null ? ` (${dataAge}s)` : ' (ожидание...)';
        
        console.log(`  ${onlineIcon} ${name.padEnd(30)} ${typeName.padEnd(15)} ${ip.padEnd(15)}${extraInfo}${stateChangeStr}${dataAgeStr}`);
      });
    }
    
    // Статистика
    // Зачем: Показываем общую статистику по всем устройствам с улучшенной логикой определения статуса
    const total = this.deviceStates.size;
    let online = 0;
    let offline = 0;
    
    for (const [id, data] of this.deviceStates.entries()) {
      const state = data.state;
      if (!state) {
        continue; // Пропускаем устройства без состояния
      }
      
      // Используем ту же логику, что и для отображения статуса
      let isOnline = state.online === true;
      
      if (!isOnline) {
        const dataAge = state.lastUpdate ? Math.floor((Date.now() - state.lastUpdate) / 1000) : null;
        const hasRecentData = dataAge !== null && dataAge < 120; // 2 минуты
        const hasSensorData = (state.temperature !== undefined && state.temperature !== null) ||
                             (state.humidity !== undefined && state.humidity !== null) ||
                             (state.co2 !== undefined && state.co2 !== null);
        const hasIp = state.ip && state.ip !== '—';
        
        if (hasRecentData && (hasIp || hasSensorData)) {
          isOnline = true;
        }
      }
      
      if (isOnline) {
        online++;
      } else {
        offline++;
      }
    }
    
    const pending = total - online - offline;
    
    console.log(`\n═══════════════════════════════════════════════════════════════════════════\n`);
    console.log(`📊 Всего: ${total}  🟢 Онлайн: ${online}  🔴 Оффлайн: ${offline}  ⚪ Ожидание: ${pending}`);
    console.log(`\nНажмите Ctrl+C для выхода\n`);
  }
  
  startAutoUpdate() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    this.updateTimer = setInterval(() => {
      this.render();
    }, UPDATE_INTERVAL);
  }
  
  stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
  }
}

// Основная функция
async function monitorDevices() {
  console.log('Загрузка списка щитовых устройств из БД...\n');
  
  // Получаем список устройств из БД
  const devices = await getShieldDevicesFromDB();
  
  if (devices.length === 0) {
    console.error('❌ Щитовые устройства не найдены в базе данных');
    process.exit(1);
  }
  
  console.log(`✅ Найдено ${devices.length} щитовых устройств\n`);
  console.log('Подключение к WebSocket...\n');
  
  const display = new StatusDisplay();
  
  // Сохраняем информацию об устройствах
  devices.forEach(device => {
    display.setDeviceInfo(device.id, device);
  });
  
  // Подключаемся к WebSocket
  const ws = new WebSocket(WS_URI);
  
  ws.on('open', () => {
    display.setConnected(true);
    display.render();
    
    // Запрашиваем состояние всех устройств
    const deviceIds = devices.map(d => d.id);
    ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
    
    // Запускаем периодическое обновление
    display.startAutoUpdate();
    
    // Периодически запрашиваем обновления
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
      }
    }, UPDATE_INTERVAL);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Обрабатываем ответы GET (ACTION_SET)
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const deviceId = msg.id;
        const state = msg.payload;
        
        // Обновляем только если это одно из наших устройств
        if (display.deviceStates.has(deviceId)) {
          display.updateDeviceState(deviceId, {
            ...state,
            lastUpdate: Date.now(),
          });
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });
  
  ws.on('error', (error) => {
    display.setConnected(false);
    display.render();
    console.error(`\n❌ Ошибка WebSocket: ${error.message}`);
  });
  
  ws.on('close', () => {
    display.setConnected(false);
    display.render();
    console.error('\n⚠️  Соединение закрыто');
  });
  
  // Обработка Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\nОстановка мониторинга...');
    display.stop();
    ws.close();
    process.exit(0);
  });
  
  // Первый рендер
  display.render();
}

monitorDevices().catch(error => {
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});
