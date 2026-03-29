#!/usr/bin/env node

/**
 * Интерактивная панель управления устройствами (в стиле pm2)
 * 
 * ОПИСАНИЕ:
 * =========
 * Интерактивная панель для мониторинга и управления устройствами ReactHome.
 * Показывает список устройств с их состояниями, поддерживает фильтрацию по типам
 * и группировку по site и type.
 * 
 * ФУНКЦИОНАЛ:
 * ============
 * - Список устройств с состояниями (онлайн/оффлайн, IP, параметры)
 * - Фильтры по типам устройств (вки/чекбоксы)
 * - Группировка устройств по site и type
 * - Интерактивное управление через клавиатуру
 * - Обновление данных в реальном времени
 * 
 * УПРАВЛЕНИЕ:
 * ===========
 * - Стрелки вверх/вниз - навигация по устройствам
 * - Стрелки влево/вправо - переключение между группами
 * - Пробел - включить/выключить фильтр типа устройства
 * - f - переключить режим фильтрации
 * - g - переключить режим группировки (site/type)
 * - q или Ctrl+C - выход
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * ==============
 * Базовое использование:
 *   node scripts/device-dashboard.js
 * 
 * С указанием WebSocket URI:
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/device-dashboard.js
 * 
 * С указанием пути к базе данных:
 *   DB_PATH=/path/to/db node scripts/device-dashboard.js
 * 
 * ПАРАМЕТРЫ ОКРУЖЕНИЯ:
 * ===================
 * REACTHOME_WS_URI  - URI WebSocket сервера (по умолчанию: ws://192.168.88.4:3000)
 * DB_PATH           - Путь к базе данных LevelDB (по умолчанию: ./var/db)
 * 
 * ЗАЧЕМ:
 * ======
 * Предоставляет оператору удобный интерактивный интерфейс для мониторинга
 * и управления устройствами системы умного дома с возможностью фильтрации
 * и группировки для быстрого поиска нужных устройств.
 */

const WebSocket = require('ws');
const { Level } = require('level');
const path = require('path');
const readline = require('readline');
const fs = require('fs');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const UPDATE_INTERVAL = 3000; // Обновление каждые 3 секунды

// Типы щитовых устройств
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

// Получаем список устройств из БД
// Зачем: Загружаем все устройства из БД, не только щитовые, для полного мониторинга
async function getDevicesFromDB() {
  if (!fs.existsSync(DB_PATH)) {
    return [];
  }
  
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  
  try {
    for await (const [key, value] of db.iterator()) {
      if (value && typeof value === 'object' && typeof value.type === 'number') {
        // Загружаем все устройства, не только щитовые
        if (!key.includes('/')) {
          const deviceType = value.type;
          const site = value.site || 'default';
          
          devices.push({
            id: key,
            name: getDeviceName(value),
            type: deviceType,
            typeName: DEVICE_TYPE_NAMES[deviceType] || `Тип${deviceType}`,
            category: getDeviceCategory(deviceType),
            site: site,
            raw: value,
          });
        }
      }
    }
  } catch (error) {
    // Игнорируем ошибки чтения БД
  } finally {
    await db.close();
  }
  
  return devices;
}

// Класс для управления интерактивной панелью
class DeviceDashboard {
  constructor() {
    this.deviceStates = new Map(); // id -> { device, state, lastUpdate, lastStateChange }
    this.devices = []; // Список устройств из БД
    this.selectedIndex = 0; // Индекс выбранного устройства
    this.scrollOffset = 0; // Смещение прокрутки
    this.filterMode = false; // Режим фильтрации
    this.groupBy = 'type'; // Группировка: 'type' или 'site'
    this.enabledTypes = new Set(); // Включенные типы устройств для фильтрации
    this.selectedFilterIndex = 0; // Индекс выбранного фильтра
    this.isConnected = false;
    this.updateTimer = null;
    this.rl = null;
    
    // Состояние меню
    this.menuOpen = false; // Открыто ли меню
    this.menuType = null; // Тип меню: 'filter' или 'group'
    this.menuSelectedIndex = 0; // Выбранный элемент в меню
    
    // Кэш для оптимизации рендеринга
    this.lastRender = {
      lines: [],
      height: 0,
      timestamp: 0,
      menuOpen: false,
    };
  }
  
  initializeFilters() {
    // Зачем: Инициализируем фильтры со всеми типами включенными по умолчанию
    // Вызывается после загрузки устройств
    const allTypes = new Set();
    this.devices.forEach(device => {
      if (device.typeName) {
        allTypes.add(device.typeName);
      }
    });
    allTypes.forEach(type => this.enabledTypes.add(type));
  }
  
  updateDeviceState(deviceId, newState) {
    // Зачем: Отслеживаем изменения состояния устройства
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();
    
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
    
    this.deviceStates.set(deviceId, {
      ...existing,
      state: { ...newState, lastUpdate: now },
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
  
  // Получаем отфильтрованные и сгруппированные устройства
  getFilteredAndGroupedDevices() {
    // Зачем: Фильтруем устройства по включенным типам и группируем их
    // Если фильтры выключены, показываем все устройства
    let filtered = Array.from(this.deviceStates.entries())
      .filter(([id, data]) => {
        if (!data.device) return false;
        // Если фильтры включены, применяем фильтрацию
        if (this.filterMode && this.enabledTypes.size > 0 && !this.enabledTypes.has(data.device.typeName)) {
          return false;
        }
        return true;
      })
      .map(([id, data]) => ({
        id,
        ...data,
      }));
    
    // Группируем по выбранному критерию
    const grouped = {};
    filtered.forEach(item => {
      const key = this.groupBy === 'site' 
        ? (item.device?.site || 'default')
        : (item.device?.category || 'Неизвестно');
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    });
    
    return grouped;
  }
  
  // Получаем плоский список для навигации
  getFlatDeviceList() {
    const grouped = this.getFilteredAndGroupedDevices();
    const flat = [];
    
    Object.entries(grouped).forEach(([groupName, devices]) => {
      flat.push({ type: 'group', name: groupName });
      devices.forEach(device => {
        flat.push({ type: 'device', ...device });
      });
    });
    
    return flat;
  }
  
  render() {
    if (!process.stdout.isTTY) return;
    
    // Зачем: Используем оптимизированный рендеринг без полной очистки экрана для плавной работы
    const timeStr = new Date().toLocaleTimeString('ru-RU');
    const statusIcon = this.isConnected ? '🟢' : '🔴';
    
    // Собираем все строки для вывода
    const lines = [];
    
    // Заголовок
    lines.push(`╔═══════════════════════════════════════════════════════════════════════════╗`);
    lines.push(`║ ПАНЕЛЬ УПРАВЛЕНИЯ УСТРОЙСТВАМИ  ${statusIcon}  ${timeStr.padEnd(20)} ║`);
    lines.push(`╚═══════════════════════════════════════════════════════════════════════════╝`);
    lines.push('');
    
    // Статистика
    const total = this.deviceStates.size;
    const online = Array.from(this.deviceStates.values()).filter(d => d.state?.online).length;
    const offline = total - online;
    const grouped = this.getFilteredAndGroupedDevices();
    const filteredCount = this.getFlatDeviceList().filter(item => item.type === 'device').length;
    
    const groupByText = this.groupBy === 'site' ? 'по site' : 'по type';
    const filterText = this.filterMode ? ` [Фильтры: ${this.enabledTypes.size} типов]` : '';
    lines.push(`📊 Всего: ${total}  🟢 Онлайн: ${online}  🔴 Оффлайн: ${offline}  Показано: ${filteredCount}  Группировка: ${groupByText}${filterText}`);
    lines.push('');
    
    // Панель управления (меню)
    this.renderMenuBar(lines);
    lines.push('');
    
    // Список устройств
    const deviceLines = this.getDeviceListLines();
    lines.push(...deviceLines);
    lines.push('');
    
    // Подсказки
    lines.push('═══════════════════════════════════════════════════════════════════════════');
    if (this.menuOpen) {
      lines.push('Управление: ↑↓ выбор | Enter: применить | Esc: отмена');
    } else {
      lines.push('Управление: ↑↓ навигация | f: фильтры | g: группировка | Пробел: переключить фильтр | q: выход');
    }
    
    // Зачем: Обновляем только измененные строки для плавной работы без мерцания
    this.updateScreen(lines);
  }
  
  updateScreen(newLines) {
    // Зачем: Обновляем экран инкрементально, перерисовывая только измененные строки
    const oldLines = this.lastRender.lines;
    const oldHeight = this.lastRender.height;
    
    // Если это первый рендер или меню открыто/закрыто - полная перерисовка
    if (oldLines.length === 0 || this.menuOpen !== (this.lastRender.menuOpen || false)) {
      process.stdout.write('\x1b[2J\x1b[H');
      newLines.forEach(line => {
        // Зачем: Используем правильный вывод для строк с ANSI кодами
        if (line.includes('\x1b[')) {
          process.stdout.write(line + '\n');
        } else {
          console.log(line);
        }
      });
      this.lastRender = {
        lines: newLines,
        height: newLines.length,
        menuOpen: this.menuOpen,
        timestamp: Date.now(),
      };
      return;
    }
    
    // Находим первую измененную строку
    let firstDiff = 0;
    while (firstDiff < Math.min(oldLines.length, newLines.length) && 
           oldLines[firstDiff] === newLines[firstDiff]) {
      firstDiff++;
    }
    
    // Если есть изменения, обновляем с нужной позиции
    if (firstDiff < newLines.length || newLines.length !== oldLines.length) {
      // Сохраняем позицию курсора
      process.stdout.write('\x1b[s');
      
      // Перемещаемся к первой измененной строке
      if (firstDiff > 0) {
        process.stdout.write(`\x1b[${firstDiff}B`);
      }
      
      // Очищаем оставшиеся строки
      const linesToClear = Math.max(0, oldHeight - firstDiff);
      for (let i = 0; i < linesToClear; i++) {
        process.stdout.write('\x1b[2K');
        if (i < linesToClear - 1) {
          process.stdout.write('\n');
        }
      }
      
      // Возвращаемся к первой измененной строке
      if (linesToClear > 0) {
        process.stdout.write(`\x1b[${linesToClear}A`);
      }
      
      // Выводим новые строки
      for (let i = firstDiff; i < newLines.length; i++) {
        process.stdout.write('\x1b[2K'); // Очистить строку
        // Зачем: Используем правильный вывод для строк с ANSI кодами
        if (newLines[i].includes('\x1b[')) {
          process.stdout.write(newLines[i] + '\n');
        } else {
          console.log(newLines[i]);
        }
      }
      
      // Восстанавливаем позицию курсора
      process.stdout.write('\x1b[u');
    }
    
    this.lastRender = {
      lines: newLines,
      height: newLines.length,
      menuOpen: this.menuOpen,
      timestamp: Date.now(),
    };
  }
  
  renderMenuBar(lines) {
    // Зачем: Рендерим панель управления с выпадающими меню
    const filterStatus = this.filterMode ? `☑ Фильтры (${this.enabledTypes.size})` : '☐ Фильтры';
    const groupStatus = this.groupBy === 'site' ? 'Группировка: по site' : 'Группировка: по type';
    
    if (this.menuOpen && this.menuType === 'filter') {
      // Показываем выпадающее меню фильтров
      lines.push('┌─ Фильтры по типам устройств ───────────────────────────────────────────┐');
      const allTypes = Array.from(new Set(
        Array.from(this.deviceStates.values())
          .map(d => d.device?.typeName)
          .filter(Boolean)
      )).sort();
      
      allTypes.forEach((typeName, index) => {
        const isEnabled = this.enabledTypes.has(typeName);
        const checkbox = isEnabled ? '☑' : '☐';
        const marker = index === this.menuSelectedIndex ? '▶' : ' ';
        lines.push(`│ ${marker} ${checkbox} ${typeName.padEnd(60)} │`);
      });
      
      lines.push('└────────────────────────────────────────────────────────────────────────┘');
    } else if (this.menuOpen && this.menuType === 'group') {
      // Показываем выпадающее меню группировки
      lines.push('┌─ Группировка устройств ─────────────────────────────────────────────────┐');
      const options = [
        { value: 'type', label: 'По типу (Актуаторы, Сенсоры, Панели)' },
        { value: 'site', label: 'По сайту (site)' },
      ];
      
      options.forEach((option, index) => {
        const marker = index === this.menuSelectedIndex ? '▶' : ' ';
        const selected = this.groupBy === option.value ? '●' : '○';
        lines.push(`│ ${marker} ${selected} ${option.label.padEnd(60)} │`);
      });
      
      lines.push('└────────────────────────────────────────────────────────────────────────┘');
    } else {
      // Обычная панель управления
      lines.push(`Панель: [f] ${filterStatus} | [g] ${groupStatus}`);
    }
  }
  
  getDeviceListLines() {
    // Зачем: Получаем строки списка устройств для рендеринга
    const lines = [];
    const flatList = this.getFlatDeviceList();
    const visibleHeight = (process.stdout.rows || 24) - 12; // Вычитаем заголовок, статистику, меню и подсказки
    
    // Определяем видимый диапазон
    let startIdx = Math.max(0, this.selectedIndex - Math.floor(visibleHeight / 2));
    let endIdx = Math.min(flatList.length, startIdx + visibleHeight);
    
    if (endIdx - startIdx < visibleHeight) {
      startIdx = Math.max(0, endIdx - visibleHeight);
    }
    
    for (let i = startIdx; i < endIdx; i++) {
      const item = flatList[i];
      const isSelected = i === this.selectedIndex;
      const marker = isSelected ? '▶' : ' ';
      
      if (item.type === 'group') {
        lines.push(`\n📦 ${item.name.toUpperCase()} (${this.getFilteredAndGroupedDevices()[item.name]?.length || 0} устройств)`);
      } else {
        const device = item.device;
        const state = item.state;
        const name = device?.name || item.id;
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
        
        const stateChangeAge = item.lastStateChange ? Math.floor((Date.now() - item.lastStateChange) / 1000) : null;
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
        
        const line = `  ${marker} ${onlineIcon} ${name.padEnd(30)} ${typeName.padEnd(15)} ${ip.padEnd(15)}${extraInfo}${stateChangeStr}`;
        
        if (isSelected) {
          // Выделяем выбранную строку инвертированными цветами
          lines.push(`\x1b[7m${line}\x1b[0m`);
        } else {
          lines.push(line);
        }
      }
    }
    
    return lines;
  }
  
  
  handleKey(key) {
    // Зачем: Обрабатываем нажатия клавиш для управления панелью с поддержкой выпадающих меню
    try {
      if (this.menuOpen) {
        // Обработка в режиме меню
        this.handleMenuKey(key);
        return;
      }
      
      // Обработка в обычном режиме
      const flatList = this.getFlatDeviceList();
      
      if (key === '\u0003' || key === 'q' || key === 'Q') { // Ctrl+C или q
        this.stop();
        process.exit(0);
      } else if (key === '\u001b[A') { // Стрелка вверх
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.render();
      } else if (key === '\u001b[B') { // Стрелка вниз
        this.selectedIndex = Math.min(flatList.length - 1, this.selectedIndex + 1);
        this.render();
      } else if (key === ' ') { // Пробел - переключить фильтр выбранного устройства
        const selected = flatList[this.selectedIndex];
        if (selected && selected.device) {
          const typeName = selected.device.typeName;
          if (this.enabledTypes.has(typeName)) {
            this.enabledTypes.delete(typeName);
          } else {
            this.enabledTypes.add(typeName);
          }
          this.render();
        }
      } else if (key === 'f' || key === 'F') {
        // Открываем меню фильтров
        this.openMenu('filter');
      } else if (key === 'g' || key === 'G') {
        // Открываем меню группировки
        this.openMenu('group');
      }
    } catch (error) {
      console.error('\nОшибка обработки клавиши:', error.message);
    }
  }
  
  openMenu(type) {
    // Зачем: Открываем выпадающее меню указанного типа
    this.menuOpen = true;
    this.menuType = type;
    this.menuSelectedIndex = 0;
    this.render();
  }
  
  closeMenu() {
    // Зачем: Закрываем выпадающее меню
    this.menuOpen = false;
    this.menuType = null;
    this.menuSelectedIndex = 0;
    this.render();
  }
  
  handleMenuKey(key) {
    // Зачем: Обрабатываем клавиши в режиме открытого меню
    try {
      if (key === '\u001b' || key === '\u001b[') { // Esc
        this.closeMenu();
        return;
      }
      
      if (this.menuType === 'filter') {
        const allTypes = Array.from(new Set(
          Array.from(this.deviceStates.values())
            .map(d => d.device?.typeName)
            .filter(Boolean)
        )).sort();
        
        if (key === '\u001b[A') { // Стрелка вверх
          this.menuSelectedIndex = Math.max(0, this.menuSelectedIndex - 1);
          this.render();
        } else if (key === '\u001b[B') { // Стрелка вниз
          this.menuSelectedIndex = Math.min(allTypes.length - 1, this.menuSelectedIndex + 1);
          this.render();
        } else if (key === ' ') { // Пробел - переключить фильтр
          if (this.menuSelectedIndex < allTypes.length) {
            const typeName = allTypes[this.menuSelectedIndex];
            if (this.enabledTypes.has(typeName)) {
              this.enabledTypes.delete(typeName);
            } else {
              this.enabledTypes.add(typeName);
            }
            this.render();
          }
        } else if (key === '\r' || key === '\n') { // Enter - закрыть меню
          this.closeMenu();
        }
      } else if (this.menuType === 'group') {
        const options = [
          { value: 'type', label: 'По типу (Актуаторы, Сенсоры, Панели)' },
          { value: 'site', label: 'По сайту (site)' },
        ];
        
        if (key === '\u001b[A') { // Стрелка вверх
          this.menuSelectedIndex = Math.max(0, this.menuSelectedIndex - 1);
          this.render();
        } else if (key === '\u001b[B') { // Стрелка вниз
          this.menuSelectedIndex = Math.min(options.length - 1, this.menuSelectedIndex + 1);
          this.render();
        } else if (key === '\r' || key === '\n') { // Enter - применить
          if (this.menuSelectedIndex < options.length) {
            this.groupBy = options[this.menuSelectedIndex].value;
            this.selectedIndex = 0;
            this.closeMenu();
          }
        }
      }
    } catch (error) {
      console.error('\nОшибка обработки клавиши меню:', error.message);
    }
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
    if (this.rl) {
      this.rl.close();
    }
    // Восстанавливаем нормальный режим терминала
    process.stdout.write('\x1b[?25h'); // Показать курсор
  }
  
  setupKeyboard() {
    // Зачем: Настраиваем обработку клавиатуры для интерактивного управления
    if (!process.stdin.isTTY) {
      console.log('⚠️  Терминал не поддерживает интерактивный режим');
      return;
    }
    
    // Скрываем курсор
    process.stdout.write('\x1b[?25l');
    
    // Переводим stdin в raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    // Зачем: Обрабатываем клавиши с правильной обработкой escape-последовательностей
    let buffer = '';
    process.stdin.on('data', (key) => {
      // Обрабатываем escape-последовательности для стрелок
      if (key === '\u001b') {
        buffer = key;
        return;
      }
      
      if (buffer === '\u001b') {
        if (key === '[') {
          buffer += key;
          return;
        } else {
          // Просто Esc
          this.handleKey('\u001b');
          buffer = '';
          return;
        }
      }
      
      if (buffer === '\u001b[') {
        buffer += key;
        if (['A', 'B', 'C', 'D'].includes(key)) {
          // Стрелки
          this.handleKey(buffer);
          buffer = '';
        } else if (key >= '0' && key <= '9') {
          // Числовая последовательность, продолжаем читать
          return;
        } else {
          // Неизвестная последовательность
          buffer = '';
        }
        return;
      }
      
      // Обычная клавиша
      buffer = '';
      this.handleKey(key);
    });
  }
  
  setConnected(connected) {
    this.isConnected = connected;
  }
}

// Основная функция
async function startDashboard() {
  console.log('Загрузка списка устройств из БД...\n');
  
  const devices = await getDevicesFromDB();
  
  if (devices.length === 0) {
    console.error('❌ Устройства не найдены в базе данных');
    process.exit(1);
  }
  
  console.log(`✅ Найдено ${devices.length} устройств\n`);
  console.log('Подключение к WebSocket...\n');
  
  const dashboard = new DeviceDashboard();
  dashboard.devices = devices;
  
  // Зачем: Инициализируем фильтры после загрузки устройств
  dashboard.initializeFilters();
  
  // Сохраняем информацию об устройствах
  devices.forEach(device => {
    dashboard.setDeviceInfo(device.id, device);
  });
  
  // Настраиваем клавиатуру
  dashboard.setupKeyboard();
  
  // Подключаемся к WebSocket
  const ws = new WebSocket(WS_URI);
  
  ws.on('open', () => {
    dashboard.setConnected(true);
    dashboard.render();
    
    // Запрашиваем состояние всех устройств
    const deviceIds = devices.map(d => d.id);
    ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
    
    // Запускаем периодическое обновление
    dashboard.startAutoUpdate();
    
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
      
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const deviceId = msg.id;
        const state = msg.payload;
        
        if (dashboard.deviceStates.has(deviceId)) {
          dashboard.updateDeviceState(deviceId, {
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
    dashboard.setConnected(false);
    dashboard.render();
  });
  
  ws.on('close', () => {
    dashboard.setConnected(false);
    dashboard.render();
  });
  
  // Обработка Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\nОстановка панели...');
    dashboard.stop();
    ws.close();
    process.exit(0);
  });
  
  // Первый рендер
  dashboard.render();
}

startDashboard().catch(error => {
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});












