#!/usr/bin/env node

/**
 * Мониторинг щитовых устройств с терминальным UI на terminal-kit
 * 
 * Этот файл использует библиотеку terminal-kit для создания
 * интерактивного терминального интерфейса без проблем с артефактами рендеринга.
 * 
 * Алгоритм получения устройств основан на документации:
 * @see docs/ENDPOINT_DEVICES_ALGORITHM.md
 * 
 * Для использования установите зависимости:
 *   npm install terminal-kit
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * ==============
 *   node scripts/monitor.js
 * 
 * ИНТЕРФЕЙС:
 * ==========
 * Экран разделен на три панели с рамками (как в Midnight Commander):
 * - Слева: Дерево фильтров (типы устройств и помещения)
 * - В центре: Список устройств (таблица с увеличенным пространством между полями)
 * - Справа: Параметры выбранного устройства
 * 
 * УПРАВЛЕНИЕ:
 * ===========
 * - Tab: Переключение между панелями (фильтры / таблица / параметры)
 * - Стрелки вверх/вниз или j/k: Навигация по списку
 * - Enter: Выбор фильтра / Показать информацию об устройстве
 * - c: Копировать содержимое раздела "Устройство" в буфер обмена
 * - y+c: Копировать строку таблицы в буфер обмена
 * - q или Ctrl+C: Выход
 */

const termkit = require('terminal-kit');
const term = termkit.terminal;
const WebSocket = require('ws');
const { Level } = require('level');
const path = require('path');
const { spawn } = require('child_process');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
// Зачем: Увеличен интервал обновления для оптимизации узкого SSH канала (с 3 до 10 секунд)
const UPDATE_INTERVAL = process.env.UPDATE_INTERVAL ? parseInt(process.env.UPDATE_INTERVAL, 10) : 10000;
// Зачем: Дебаунсинг для рендеринга - обновляем интерфейс максимум раз в 500мс, даже при частых изменениях
const RENDER_DEBOUNCE_MS = 500;

// Типы устройств (щитовые)
// Зачем: Включаем все типы устройств, которые могут быть в БД
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0];
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

// Зачем: Конечные устройства (Smart TOP, Smart BOTTOM и другие)
const ENDPOINT_DEVICE_TYPES = [
  0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b
];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x0a: 'DO8', 0x0b: 'DO16', 0x0e: 'DIM4', 0x0f: 'DIM8',
  0x20: 'DI_4', 0x23: 'RELAY_2', 0x25: 'SMART_4G', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa3: 'DIM_4', 0xa4: 'DIM_8',
  0xa5: 'LANAMP', 0xa7: 'RELAY_2_DIN', 0xa9: 'AO_4_DIN',
  0xac: 'MIX_1_RS', 0xad: 'DIM_12_LED_RS', 0xae: 'RELAY_12_RS', 0xaf: 'DIM_8_RS',
  0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb5: 'MIX_6x12_RS', 0xb6: 'DIM_1_AC_RS',
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
  0xab: 'MIX_1', 0xf0: 'TEMPERATURE_EXT',
};

const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP',
  'thermostat', 'hygrostat', 'co2_stat'
];

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'Конечное';
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
      'BOILER': '🔥',
      'PUMP': '💧',
      'thermostat': '🌡️',
      'hygrostat': '💨',
      'co2_stat': '🌬️',
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
      if ([0x04, 0x2d, 0x2e].includes(deviceType)) return '👁️';
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

// Зачем: Получаем имя устройства из значения БД
function getDeviceName(value) {
  return value.name || value.title || value.code || 'Без названия';
}

// Зачем: Загружаем устройства и помещения из БД
// Используем алгоритм из ENDPOINT_DEVICES_ALGORITHM.md
async function getDevicesAndSitesFromDB() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const sites = [];
  const siteMap = new Map();
  
  try {
    // Зачем: Сначала загружаем ВСЕ помещения, чтобы siteMap был заполнен
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Зачем: Загружаем помещения (type === 'site' или 'SITE')
      if (type === 'site' || type === 'SITE') {
        const siteName = value.title || value.code || value.name || key;
        sites.push({
          id: key,
          name: siteName,
        });
        siteMap.set(key, siteName);
      }
    }
    
    // Зачем: Теперь загружаем устройства, когда siteMap уже заполнен
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Зачем: Загружаем устройства с числовым типом (щитовые и конечные)
      // Исключаем каналы (ключи содержат '/') и тип 0x00
      if (typeof type === 'number' && !key.includes('/') && type !== 0x00) {
        let siteId = value.site;
        let siteName = null;
        
        // Зачем: Резолвим название помещения по UUID
        if (siteId) {
          if (Array.isArray(siteId)) {
            siteId = siteId[0];
          }
          if (typeof siteId === 'string') {
            siteName = siteMap.get(siteId) || null;
          }
        }
        
        const category = getDeviceCategory(type);
        const deviceIcon = getDeviceIcon(type, category);
        const deviceName = getDeviceName(value);
        const nameWithIcon = deviceIcon ? `${deviceIcon} ${deviceName}` : deviceName;
        
        devices.push({
          id: key,
          name: nameWithIcon,
          code: value.code || null,
          type: type,
          typeName: DEVICE_TYPE_NAMES[type] || `Тип0x${type.toString(16)}`,
          category: category,
          siteId: siteId || null,
          site: siteName || null,
        });
      }
      
      // Зачем: Загружаем потребители (строковые типы)
      if (typeof type === 'string' && CONSUMER_TYPES.includes(type) && !key.includes('/')) {
        let siteId = value.site;
        let siteName = null;
        
        if (siteId) {
          if (Array.isArray(siteId)) {
            siteId = siteId[0];
          }
          if (typeof siteId === 'string') {
            siteName = siteMap.get(siteId) || null;
          }
        }
        
        const consumerIcon = getDeviceIcon({ type, category: 'Потребитель' });
        const deviceName = getDeviceName(value);
        const nameWithIcon = consumerIcon ? `${consumerIcon} ${deviceName}` : deviceName;
        
        devices.push({
          id: key,
          name: nameWithIcon,
          code: value.code || null,
          type: type,
          typeName: type.toUpperCase(),
          category: 'Потребитель',
          siteId: siteId || null,
          site: siteName || null,
          bind: value.bind || null,
        });
      }
    }
    
    // Зачем: Резолвим помещения для устройств по коду/названию
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
    
    return { 
      devices: devices.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
      }), 
      sites: sites.sort((a, b) => a.name.localeCompare(b.name)) 
    };
  } finally {
    await db.close();
  }
}

// Зачем: Копируем текст в буфер обмена
function copyToClipboard(text) {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const isWindows = process.platform === 'win32';
  
  let copyProcess;
  if (isMac) {
    copyProcess = spawn('pbcopy', []);
  } else if (isLinux) {
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

// Зачем: Box drawing characters для рамок как в Midnight Commander
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

// Зачем: Рисуем рамку вокруг области
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

// Зачем: Класс для управления UI с terminal-kit
class TerminalKitStatusDisplay {
  constructor(devices, sites) {
    if (!term.isTTY) {
      throw new Error('Требуется интерактивный терминал (TTY)');
    }
    
    this.deviceStates = new Map();
    this.isConnected = false;
    this.selectedIndex = 0;
    this.sites = sites;
    this.allDevices = devices;
    this.devicesByMac = new Map();
    devices.forEach(device => {
      this.devicesByMac.set(device.id, device);
    });
    this.devices = devices;
    
    this.activeFilters = {
      category: null,
      consumerType: null,
      site: null,
    };
    
    this.isNavigating = false;
    this.lastUpdateTime = 0;
    
    // Зачем: Дебаунсинг для рендеринга - откладываем перерисовку при частых обновлениях
    this.renderTimer = null;
    
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
    this.selectionCheckInterval = null;
    this.filterIndex = 0; // Индекс выбранного фильтра
    this.filterRows = [];
    this.filterSelectable = [];
    this.pendingCopyRow = false;
    
    // Зачем: Размеры экрана
    this.width = term.width;
    this.height = term.height;
    
    // Зачем: Размеры панелей (левая: 4 колонки, центр: 6 колонок, правая: остальное)
    // Зачем: Учитываем рамки (по 2 символа на каждую панель: левая и правая границы)
    this.leftWidth = Math.floor(this.width * 0.25); // 25%
    this.centerWidth = Math.floor(this.width * 0.375); // 37.5%
    this.rightWidth = this.width - this.leftWidth - this.centerWidth - 4; // Остальное минус границы (2 рамки)
    
    // Зачем: Позиции панелей с учетом рамок
    this.leftX = 1;
    this.centerX = this.leftWidth + 3; // leftWidth + 1 (пробел) + 2 (рамка)
    this.rightX = this.centerX + this.centerWidth + 3; // centerX + centerWidth + 1 (пробел) + 2 (рамка)
    
    // Зачем: Текущая активная панель (0: фильтры, 1: таблица, 2: параметры)
    this.activePanel = 1; // По умолчанию таблица
    
    // Зачем: Прокрутка для таблицы
    this.tableScroll = 0;
    this.tableVisibleRows = this.height - 4; // Высота минус заголовок и статистика
    
    this.init();
  }
  
  init() {
    // Зачем: Очищаем экран и настраиваем обработчики
    term.clear();
    // Зачем: Включаем альтернативный буфер для более плавного рендеринга
    term.fullscreen(true);
    // Зачем: Скрываем курсор для чистого интерфейса (в terminal-kit используется метод hideCursor)
    if (term.hideCursor) {
      term.hideCursor();
    }
    
    // Зачем: Включаем захват ввода для правильной обработки стрелок и специальных клавиш
    // Без этого стрелки будут выводиться как escape-последовательности (крякозяблы)
    term.grabInput({ mouse: false });
    
    // Зачем: Обработчики клавиатуры
    term.on('key', (name, matches, data) => {
      this.handleKey(name, matches, data);
    });
    
    // Зачем: Обработчик изменения размера терминала
    term.on('resize', () => {
      this.width = term.width;
      this.height = term.height;
      this.leftWidth = Math.floor(this.width * 0.25);
      this.centerWidth = Math.floor(this.width * 0.375);
      this.rightWidth = this.width - this.leftWidth - this.centerWidth - 4;
      this.leftX = 1;
      this.centerX = this.leftWidth + 3;
      this.rightX = this.centerX + this.centerWidth + 3;
      this.tableVisibleRows = this.height - 4;
      this.renderFull(); // Зачем: При изменении размера нужен полный рендер с очисткой
    });
    
    // Зачем: Обработчик выхода
    process.on('SIGINT', () => {
      this.stop();
    });
    
    this.renderFull(); // Зачем: Первый рендер должен быть полным
  }
  
  handleKey(name, matches, data) {
    if (name === 'CTRL_C' || name === 'q' || name === 'Q') {
      this.stop();
      return;
    }
    
    if (name === 'TAB') {
      // Зачем: Переключение между панелями
      this.activePanel = (this.activePanel + 1) % 3;
      // Зачем: При переключении на панель фильтров синхронизируем filterIndex с актуальными данными
      if (this.activePanel === 0) {
        this.buildFilterRows();
        // Зачем: Проверяем, что filterIndex в допустимых границах
        if (this.filterIndex < 0 || this.filterIndex >= this.filterSelectable.length) {
          this.filterIndex = Math.max(0, this.filterSelectable.length - 1);
        }
      }
      this.render();
      return;
    }
    
    if (this.activePanel === 0) {
      // Зачем: Навигация в фильтрах
      // Зачем: Обновляем список фильтров перед использованием, чтобы filterSelectable был актуальным
      this.buildFilterRows();
      const maxFilterIndex = Math.max(0, this.filterSelectable.length - 1);
      if (name === 'UP' || name === 'k') {
        if (this.filterIndex > 0) {
          this.filterIndex--;
          this.render();
        }
      } else if (name === 'DOWN' || name === 'j') {
        if (this.filterIndex < maxFilterIndex) {
          this.filterIndex++;
          this.render();
        }
      } else if (name === 'ENTER' || name === 'SPACE') {
        // Зачем: Применяем выбранный фильтр
        // Зачем: buildFilterRows() уже вызван выше, так что filterSelectable актуален
        const row = this.getSelectedFilterRow();
        this.applyFilterRow(row);
      }
    } else if (this.activePanel === 1) {
      // Зачем: Навигация в таблице
      if (name === 'UP' || name === 'k') {
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.updateTableScroll();
          this.render();
        }
      } else if (name === 'DOWN' || name === 'j') {
        if (this.selectedIndex < this.devices.length - 1) {
          this.selectedIndex++;
          this.updateTableScroll();
          this.render();
        }
      } else if (name === 'PAGE_UP') {
        this.selectedIndex = Math.max(0, this.selectedIndex - this.tableVisibleRows);
        this.updateTableScroll();
        this.render();
      } else if (name === 'PAGE_DOWN') {
        this.selectedIndex = Math.min(this.devices.length - 1, this.selectedIndex + this.tableVisibleRows);
        this.updateTableScroll();
        this.render();
      } else if (name === 'HOME') {
        this.selectedIndex = 0;
        this.updateTableScroll();
        this.render();
      } else if (name === 'END') {
        this.selectedIndex = this.devices.length - 1;
        this.updateTableScroll();
        this.render();
      } else if (name === 'c' && data.isCharacter) {
        // Зачем: Копирование информации об устройстве
        this.copyDeviceInfoToClipboard();
      } else if (name === 'y' && data.isCharacter) {
        // Зачем: Подготовка к копированию строки таблицы (y+c)
        this.pendingCopyRow = true;
      } else if (name === 'c' && this.pendingCopyRow) {
        // Зачем: Копирование строки таблицы
        this.copyTableRowToClipboard();
        this.pendingCopyRow = false;
      }
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
      { label: 'Конечное', value: 'Конечное' },
      { label: 'Потребитель', value: 'Потребитель' },
    ];

    addRow({ label: 'Категории:', kind: 'title' });
    categories.forEach(cat => {
      const isChecked = this.activeFilters.category === cat.value;
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
      const allSelected = this.activeFilters.consumerType === null;
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
        const isChecked = this.activeFilters.consumerType === type;
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
    const siteAllChecked = this.activeFilters.site === null;
    addRow({
      label: `${siteAllChecked ? '☑' : '☐'} Все`,
      kind: 'site',
      value: null,
      selectable: true,
    });
    this.sites.forEach(site => {
      const isChecked = this.activeFilters.site === site.name;
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
    // Зачем: Проверяем, что filterSelectable не пуст и filterIndex в допустимых границах
    if (!this.filterSelectable.length) return null;
    if (this.filterIndex < 0 || this.filterIndex >= this.filterSelectable.length) return null;
    const rowIndex = this.filterSelectable[this.filterIndex];
    if (rowIndex === undefined || rowIndex < 0 || rowIndex >= this.filterRows.length) return null;
    return this.filterRows[rowIndex];
  }

  applyFilterRow(row) {
    if (!row) return;
    if (row.kind === 'category') {
      this.activeFilters.category = row.value;
      if (row.value !== null) {
        this.activeFilters.consumerType = null;
      }
    } else if (row.kind === 'consumer') {
      this.activeFilters.consumerType = row.value;
      if (row.value !== null) {
        this.activeFilters.category = null;
      }
    } else if (row.kind === 'site') {
      this.activeFilters.site = row.value;
    }
    this.applyFilters();
  }
  
  applyFilters() {
    // Зачем: Применяем активные фильтры к списку устройств
    const filtersHash = this.getFiltersHash();
    if (this.cache.filteredDevices && this.cache.filteredDevicesHash === filtersHash) {
      this.devices = this.cache.filteredDevices;
      this.render();
      return;
    }
    
    this.devices = this.allDevices.filter(device => {
      if (this.activeFilters.category !== null) {
        if (device.category !== this.activeFilters.category) {
          return false;
        }
        if (device.category === 'Потребитель') {
          return false;
        }
      }
      
      if (this.activeFilters.consumerType !== null) {
        if (device.category !== 'Потребитель' || device.type !== this.activeFilters.consumerType) {
          return false;
        }
      }
      
      if (this.activeFilters.site !== null) {
        if (device.site !== this.activeFilters.site) {
          return false;
        }
      }
      
      return true;
    });
    
    this.cache.filteredDevices = this.devices;
    this.cache.filteredDevicesHash = filtersHash;
    
    // Зачем: Сбрасываем selectedIndex если он вне границ
    if (this.selectedIndex >= this.devices.length) {
      this.selectedIndex = Math.max(0, this.devices.length - 1);
    }
    
    this.render();
  }
  
  getFiltersHash() {
    return JSON.stringify(this.activeFilters);
  }
  
  updateTableScroll() {
    // Зачем: Обновляем прокрутку таблицы так, чтобы выбранная строка была видна
    if (this.selectedIndex < this.tableScroll) {
      this.tableScroll = this.selectedIndex;
    } else if (this.selectedIndex >= this.tableScroll + this.tableVisibleRows) {
      this.tableScroll = this.selectedIndex - this.tableVisibleRows + 1;
    }
  }
  
  render() {
    // Зачем: Дебаунсинг рендеринга - откладываем перерисовку при частых обновлениях для оптимизации узкого SSH канала
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    
    this.renderTimer = setTimeout(() => {
      this.renderImmediate();
    }, RENDER_DEBOUNCE_MS);
  }
  
  renderImmediate() {
    // Зачем: Оптимизированный рендер без полной очистки экрана для предотвращения мерцания
    // Обновляем только измененные части экрана
    
    // Зачем: Рендерим заголовок
    this.renderHeader();
    
    // Зачем: Рендерим три панели
    this.renderFilters();
    this.renderTable();
    this.renderDeviceInfo();
    
    // Зачем: Рендерим статистику
    this.renderStats();
  }
  
  // Зачем: Полный рендер с очисткой экрана (используется только при первом запуске и изменении размера)
  renderFull() {
    term.clear();
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.renderImmediate();
  }
  
  renderHeader() {
    const status = this.isConnected ? '🟢 ПОДКЛЮЧЕНО' : '🔴 ОТКЛЮЧЕНО';
    const time = new Date().toLocaleTimeString('ru-RU');
    const headerText = `${status} | ${time}`;
    
    term.moveTo(1, 1);
    term.bold.cyan(headerText);
    term(' '.repeat(this.width - headerText.length));
  }
  
  // Зачем: Рисуем рамку вокруг панели с заголовком
  drawPanelBox(x, y, width, height, title, isActive) {
    // Верхняя граница с заголовком
    term.moveTo(x, y);
    term(BOX_CHARS.tl);
    if (title && title.length > 0) {
      const titleText = isActive ? ` ${title} ` : ` ${title} `;
      const titleLen = Math.min(titleText.length, width - 4);
      if (isActive) {
        term.bgBlue.white(titleText.substring(0, titleLen));
        term.styleReset();
      } else {
        term.bold(titleText.substring(0, titleLen));
        term.styleReset();
      }
      const remaining = width - titleLen - 2;
      if (remaining > 0) {
        term(BOX_CHARS.h.repeat(remaining));
      }
    } else {
      term(BOX_CHARS.h.repeat(width - 2));
    }
    term(BOX_CHARS.tr);
    
    // Боковые границы
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
  
  renderFilters() {
    const startY = 2;
    const height = this.height - 3; // Высота минус заголовок и статистика

    this.buildFilterRows();

    // Зачем: Рисуем рамку вокруг панели фильтров
    this.drawPanelBox(this.leftX, startY, this.leftWidth, height, 'Фильтры', this.activePanel === 0);

    let y = startY + 1;
    // Зачем: Получаем индекс выбранной строки с проверкой границ
    // filterIndex - это индекс в массиве filterSelectable
    // selectedRowIndex - это индекс строки в массиве filterRows
    const selectedRowIndex = (this.filterIndex >= 0 && this.filterIndex < this.filterSelectable.length) 
      ? this.filterSelectable[this.filterIndex] 
      : null;

    const maxY = startY + height - 2; // Учитываем рамку
    this.filterRows.forEach((row, rowIndex) => {
      if (y > maxY) return;
      term.moveTo(this.leftX + 1, y++); // +1 для отступа от левой границы
      // Зачем: Выделяем строку только если она selectable, совпадает с выбранным индексом и панель активна
      // Проверяем, что rowIndex точно соответствует selectedRowIndex из filterSelectable
      const isHighlighted = row.selectable && selectedRowIndex !== null && rowIndex === selectedRowIndex && this.activePanel === 0;
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
    
    // Зачем: Очищаем оставшиеся строки
    for (let clearY = y; clearY <= maxY; clearY++) {
      term.moveTo(this.leftX + 1, clearY);
      term.styleReset();
      term(' '.repeat(this.leftWidth - 2));
    }
  }
  
  renderTable() {
    // Зачем: Рендерим таблицу устройств в центре
    const startY = 2;
    const height = this.height - 3; // Высота минус заголовок и статистика
    
    // Зачем: Рисуем рамку вокруг панели таблицы
    this.drawPanelBox(this.centerX, startY, this.centerWidth, height, 'Устройства', this.activePanel === 1);
    
    // Зачем: Заголовки таблицы с увеличенным пространством между полями (+5 символов)
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
    
    // Зачем: Рендерим видимые строки таблицы
    const visibleDevices = this.devices.slice(this.tableScroll, this.tableScroll + this.tableVisibleRows);
    const maxY = startY + height - 2; // Учитываем рамку
    visibleDevices.forEach((device, idx) => {
      const actualIndex = this.tableScroll + idx;
      const y = startY + 2 + idx;
      if (y > maxY) return;
      const isSelected = actualIndex === this.selectedIndex;
      
      // Зачем: Выделяем выбранную строку ярким фоном
      if (isSelected && this.activePanel === 1) {
        term.bgBrightBlue.black();
      } else {
        term.styleReset(); // Зачем: Сбрасываем стили для невыбранных строк
      }
      
      // Название
      term.moveTo(nameX, y);
      const icon = getDeviceIcon(device.type, device.category) || '';
      const name = (device.name || device.id || '—').substring(0, nameWidth - (icon ? 2 : 0));
      const namePadded = name.padEnd(nameWidth - (icon ? 2 : 0));
      term(`${icon}${icon ? ' ' : ''}${namePadded}`);
      
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
      
      // Зачем: Сбрасываем стили после строки
      term.styleReset();
    });
    
    // Зачем: Очищаем оставшиеся строки
    for (let clearY = startY + 2 + visibleDevices.length; clearY <= maxY; clearY++) {
      term.moveTo(nameX, clearY);
      term.styleReset();
      term(' '.repeat(this.centerWidth - 2));
    }
  }
  
  renderDeviceInfo() {
    // Зачем: Рендерим панель параметров справа
    const startY = 2;
    const height = this.height - 3; // Высота минус заголовок и статистика
    
    // Зачем: Рисуем рамку вокруг панели параметров
    const label = 'Устройство (c - копировать)';
    this.drawPanelBox(this.rightX, startY, this.rightWidth, height, label, this.activePanel === 2);
    
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
    
    // Зачем: Разбиваем текст на строки и выводим
    const lines = deviceInfo.split('\n');
    const maxY = startY + height - 2; // Учитываем рамку
    const contentHeight = maxY - startY - 1;
    lines.slice(0, contentHeight).forEach((line, idx) => {
      term.moveTo(this.rightX + 1, startY + 1 + idx);
      term.styleReset();
      // Зачем: Обрезаем строку до ширины панели минус рамки
      const truncated = line.substring(0, this.rightWidth - 2);
      term(truncated);
      if (truncated.length < this.rightWidth - 2) {
        term(' '.repeat(this.rightWidth - 2 - truncated.length));
      }
    });
    
    // Зачем: Очищаем оставшиеся строки
    for (let y = startY + 1 + lines.length; y <= maxY; y++) {
      term.moveTo(this.rightX + 1, y);
      term.styleReset();
      term(' '.repeat(this.rightWidth - 2));
    }
  }
  
  renderStats() {
    // Зачем: Рендерим статистику внизу экрана
    const stats = this.getStats();
    const statsText = `Всего: ${stats.total} | Показано: ${stats.visible} | Ready: ${stats.ready} | Not Ready: ${stats.notReady}`;
    
    term.moveTo(1, this.height - 1);
    term.bold(statsText);
    term(' '.repeat(this.width - statsText.length));
  }
  
  // Зачем: Обновляем панель параметров устройства
  // Эта функция вызывается при изменении выбранного устройства
  updateDeviceInfo() {
    // Зачем: Просто перерисовываем панель параметров через renderDeviceInfo
    // которая вызывается внутри render()
    // Но для оптимизации можно перерисовать только панель параметров
    this.renderDeviceInfo();
  }
  
  // Зачем: Определяет количество каналов актуатора по типу устройства
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
      0xa5: { count: 8, types: ['dim'] },  0xaf: { count: 8, types: ['dim'] },
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
    };
    return channelConfigs[deviceType] || null;
  }
  
  // Зачем: Получает все каналы актуатора с их состояниями и связанными устройствами
  getActuatorChannels(actuatorId, deviceType) {
    const channelConfig = this.getActuatorChannelCount(deviceType);
    if (!channelConfig) return [];
    
    const channels = [];
    const channelTypes = channelConfig.types;
    const channelCount = channelConfig.count;
    
    // Зачем: Для смешанных устройств определяем количество каналов каждого типа
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
    
    // Зачем: Собираем все каналы актуатора
    for (let i = 1; i <= doCount; i++) {
      const channelId = `${actuatorId}/do/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
      }
      channels.push({ channelId, channelType: 'do', channelIndex: i, channelState, linkedDevice });
    }
    
    for (let i = 1; i <= dimCount; i++) {
      const channelId = `${actuatorId}/dim/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
      }
      channels.push({ channelId, channelType: 'dim', channelIndex: i, channelState, linkedDevice });
    }
    
    for (let i = 1; i <= aoCount; i++) {
      const channelId = `${actuatorId}/ao/${i}`;
      const channelData = this.deviceStates.get(channelId);
      const channelState = channelData?.state || null;
      let linkedDevice = null;
      if (channelState && channelState.bind) {
        linkedDevice = this.allDevices.find(d => d.id === channelState.bind);
      }
      channels.push({ channelId, channelType: 'ao', channelIndex: i, channelState, linkedDevice });
    }
    
    return channels;
  }
  
  // Зачем: Получает информацию о связи потребителя с актуатором
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
    // Зачем: Формируем полный текст информации об устройстве со всеми параметрами
    const data = this.deviceStates.get(device.id);
    const state = data?.state;
    
    // Зачем: Проверяем кэш по deviceId
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
    
    // Зачем: Проверяем кэш по deviceId
    const cachedByDeviceId = this.cache.deviceInfoByDeviceId.get(device.id);
    if (cachedByDeviceId && cachedByDeviceId.hash === deviceInfoHash) {
      this.devicePopupText = cachedByDeviceId.text;
      return cachedByDeviceId.content;
    }
    
    // Зачем: Формируем информацию об устройстве
    let info = [];
    info.push(`Информация об устройстве`);
    info.push('');
    info.push(`Название: ${device.name || '—'}`);
    info.push(`ID: ${device.id}`);
    info.push(`Тип: ${device.typeName} (${device.type})`);
    info.push(`Категория: ${device.category || '—'}`);
    info.push(`Помещение: ${device.site || '—'}`);
    if (device.siteId && device.siteId !== device.site) {
      info.push(`UUID помещения: ${device.siteId}`);
    }
    info.push('');
    info.push(`Статус подключения:`);
    
    const stateValue = state?.value;
    const stateInitialized = state?.initialized;
    const stateOnline = state?.online;
    const stateReady = state?.ready;
    const stateIp = state?.ip;
    const stateLastUpdate = state?.lastUpdate || data?.lastUpdate;
    const stateLastStateChange = data?.lastStateChange;
    
    info.push(`  Значение (value): ${stateValue !== undefined && stateValue !== null ? stateValue : '—'}`);
    info.push(`  Инициализировано (initialized): ${stateInitialized !== undefined && stateInitialized !== null ? (stateInitialized ? 'Да' : 'Нет') : '—'}`);
    info.push(`  Онлайн (online): ${stateOnline !== undefined && stateOnline !== null ? (stateOnline ? 'Да' : 'Нет') : '—'}`);
    info.push(`  Готов (ready): ${stateReady !== undefined && stateReady !== null ? (stateReady ? '🟢 Да' : '🔴 Нет') : '—'}`);
    info.push(`  IP-адрес (ip): ${stateIp || '—'}`);
    
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
    info.push(`Параметры:`);
    
    // Зачем: Отслеживание известных параметров
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
    
    // Зачем: Параметры сенсоров
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
    
    // Зачем: Специфичные параметры температуры BB/PLC
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
    
    // Зачем: Параметры актуаторов
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
      info.push(`  Значение (value): ${value !== undefined && value !== null ? value : '—'}`);
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
    
    // Зачем: Параметры кондиционеров
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
    
    // Зачем: Параметры счётчиков
    for (let i = 1; i <= 4; i++) {
      const counter = state?.[`water_counter_${i}`];
      if (shouldShowParam(`water_counter_${i}`, counter)) {
        info.push(`  Счётчик воды ${i}: ${counter !== undefined && counter !== null ? counter : '—'}`);
      }
    }
    
    // Зачем: Параметры электропитания
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
    
    // Зачем: Специальные параметры
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
    
    // Зачем: Параметры панелей
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
    
    // Зачем: Ошибки
    const error = state?.error;
    if (shouldShowParam('error', error)) {
      info.push(`  Ошибка: ${error !== undefined && error !== null ? error : '—'}`);
    }
    
    // Зачем: Дополнительные параметры
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
        'button_states', 'display_content',
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
        info.push(`Дополнительные параметры:`);
        fieldsToShow.forEach(key => {
          const value = state[key];
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
      
      if (state.timestamp !== undefined && state.timestamp !== null) {
        info.push('');
        info.push(`Временные метки:`);
        const timestampDate = new Date(state.timestamp);
        info.push(`  Timestamp: ${timestampDate.toLocaleString('ru-RU')} (${state.timestamp})`);
      }
    } else {
      info.push('');
      info.push(`Временные метки:`);
      info.push(`  Timestamp: —`);
    }
    
    // Зачем: Связь потребителя с актуатором
    const isConsumer = device.category === 'Потребитель' || 
                       (typeof device.type === 'string' && CONSUMER_TYPES.includes(device.type));
    const bindValue = (state && state.bind) || device.bind;
    
    if (isConsumer && bindValue) {
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
        const channelTypeName = binding.channelType === 'do' ? 'DO' : binding.channelType === 'dim' ? 'DIM' : binding.channelType === 'ao' ? 'AO' : binding.channelType;
        info.push(`  Канал: ${channelTypeName}/${binding.channelIndex}`);
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
      info.push('');
      info.push(`Связь с актуатором:`);
      info.push(`  ⚠️  Не привязан к актуатору (bind отсутствует)`);
    }
    
    // Зачем: Каналы актуатора
    const isActuator = device.category === 'Актуатор' && typeof device.type === 'number';
    if (isActuator) {
      const channels = this.getActuatorChannels(device.id, device.type);
      if (channels.length > 0) {
        info.push('');
        info.push(`Каналы актуатора:`);
        
        const channelsByType = {};
        channels.forEach(channel => {
          if (!channelsByType[channel.channelType]) {
            channelsByType[channel.channelType] = [];
          }
          channelsByType[channel.channelType].push(channel);
        });
        
        Object.keys(channelsByType).sort().forEach(channelType => {
          const typeChannels = channelsByType[channelType];
          const typeName = channelType === 'do' ? 'Реле (DO)' : channelType === 'dim' ? 'Диммер (DIM)' : channelType === 'ao' ? 'Аналоговый выход (AO)' : channelType;
          
          info.push(`  ${typeName} каналы:`);
          
          typeChannels.forEach(channel => {
            const channelValue = channel.channelState && channel.channelState.value !== undefined 
              ? channel.channelState.value 
              : '—';
            const channelValueStr = channel.channelType === 'dim' 
              ? `${channelValue} (0-255)` 
              : channel.channelType === 'do' 
                ? (channelValue ? 'ВКЛ' : 'ВЫКЛ')
                : `${channelValue}`;
            
            const channelTypeName = channel.channelType === 'do' ? 'DO' : channel.channelType === 'dim' ? 'DIM' : channel.channelType === 'ao' ? 'AO' : channel.channelType;
            info.push(`    ${channelTypeName}/${channel.channelIndex}: ${channelValueStr}`);
            
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
        const channelConfig = this.getActuatorChannelCount(device.type);
        if (channelConfig) {
          info.push('');
          info.push(`Каналы актуатора:`);
          info.push(`  Типы каналов: ${channelConfig.types.join(', ')}`);
          info.push(`  Количество: ${channelConfig.count}`);
          info.push(`  ⚠️  Состояние каналов не получено (данные не загружены через WebSocket)`);
        }
      }
    }
    
    const deviceInfoContent = info.join('\n');
    
    // Зачем: Сохраняем текст для копирования (без форматирования)
    this.devicePopupText = deviceInfoContent;
    
    // Зачем: Сохраняем в кэш по deviceId
    this.cache.deviceInfoByDeviceId.set(device.id, {
      content: deviceInfoContent,
      hash: deviceInfoHash,
      text: deviceInfoContent
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
    // Зачем: Создаем хеш состояния всех устройств для кэширования
    // Зачем: Учитываем только видимые устройства и их ключевые поля
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
    
    // Зачем: Используем сохраненный текст для копирования или формируем заново
    let textToCopy = this.devicePopupText;
    
    if (!textToCopy) {
      textToCopy = this.getDeviceInfoText(device);
    }
    
    if (!textToCopy) return;
    
    copyToClipboard(textToCopy);
    
    // Зачем: Показываем уведомление
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
    
    // Зачем: Показываем уведомление
    term.moveTo(this.centerX, 1);
    term.bgGreen.black('✅ Строка скопирована');
    setTimeout(() => {
      this.render();
    }, 2000);
  }
  
  setDeviceState(deviceId, newState) {
    const existing = this.deviceStates.get(deviceId);
    const now = Date.now();
    
    // Зачем: Объединяем старое и новое состояние, чтобы не потерять поля при частичных обновлениях
    const oldState = existing?.state || {};
    const mergedState = { ...oldState, ...newState };
    
    // Зачем: Проверяем изменения состояния по ключевым полям
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
    
    // Зачем: Сохраняем объединенное состояние
    this.deviceStates.set(deviceId, {
      ...existing,
      state: mergedState,
      lastUpdate: now,
      lastStateChange: lastStateChange,
    });
    
    // Зачем: Проверяем, нужно ли обновлять информацию об устройстве
    let shouldUpdateDeviceInfo = false;
    if (this.selectedIndex >= 0 && this.selectedIndex < this.devices.length) {
      const selectedDevice = this.devices[this.selectedIndex];
      
      if (selectedDevice && selectedDevice.id === deviceId) {
        this.cache.deviceInfoByDeviceId.delete(deviceId);
        shouldUpdateDeviceInfo = true;
      }
      
      // Зачем: Проверяем, обновляется ли канал актуатора
      if (selectedDevice && selectedDevice.category === 'Актуатор' && typeof selectedDevice.type === 'number') {
        const isChannel = deviceId.includes('/do/') || deviceId.includes('/dim/') || deviceId.includes('/ao/');
        if (isChannel && deviceId.startsWith(selectedDevice.id + '/')) {
          this.cache.deviceInfoByDeviceId.delete(selectedDevice.id);
          shouldUpdateDeviceInfo = true;
        }
      }
    }
    
    // Зачем: Инвалидируем кэш при изменении состояния
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
    
    // Зачем: Обновляем отображение только если не идет навигация
    if (!this.isNavigating && stateChanged) {
      if (shouldUpdateDeviceInfo) {
        this.updateDeviceInfo();
      }
      this.render();
    } else if (shouldUpdateDeviceInfo) {
      this.updateDeviceInfo();
    }
  }
  
  setConnected(connected) {
    this.isConnected = connected;
    this.render();
  }
  
  stop() {
    // Зачем: Очищаем экран и восстанавливаем курсор при выходе
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    term.grabInput(false); // Зачем: Отключаем захват ввода
    term.fullscreen(false);
    term.clear();
    // Зачем: Восстанавливаем курсор (в terminal-kit используется метод showCursor если доступен)
    if (term.showCursor) {
      term.showCursor();
    } else {
      // Зачем: Альтернативный способ показать курсор через escape-последовательность
      process.stdout.write('\x1b[?25h');
    }
    term.styleReset();
    term.moveTo(1, 1);
    process.exit(0);
  }
}

// Зачем: Основная функция запуска
async function main() {
  try {
    // Зачем: Загружаем устройства и помещения из БД
    const { devices, sites } = await getDevicesAndSitesFromDB();
    
    if (devices.length === 0) {
      console.error('Устройства не найдены в БД');
      process.exit(1);
    }
    
    // Зачем: Создаем UI
    const display = new TerminalKitStatusDisplay(devices, sites);
    
    // Зачем: Подключаемся к WebSocket
    const ws = new WebSocket(WS_URI);
    
    ws.on('open', () => {
      display.setConnected(true);
      
      // Зачем: Запрашиваем состояние всех устройств и их каналов
      devices.forEach(device => {
        ws.send(JSON.stringify({ type: 'get', id: device.id }));
        
        // Зачем: Для актуаторов запрашиваем состояние всех каналов
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
              ws.send(JSON.stringify({ type: 'get', id: `${device.id}/do/${i}` }));
            }
            for (let i = 1; i <= dimCount; i++) {
              ws.send(JSON.stringify({ type: 'get', id: `${device.id}/dim/${i}` }));
            }
            for (let i = 1; i <= aoCount; i++) {
              ws.send(JSON.stringify({ type: 'get', id: `${device.id}/ao/${i}` }));
            }
          }
        }
      });
      
      // Зачем: Периодически обновляем только основные устройства (без каналов) с увеличенным интервалом
      // Каналы актуаторов обновляются автоматически через ACTION_SET при изменениях
      // Это снижает нагрузку на узкий SSH канал
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          // Зачем: Запрашиваем только основные устройства, каналы обновляются через ACTION_SET
          devices.forEach(device => {
            ws.send(JSON.stringify({ type: 'get', id: device.id }));
          });
        }
      }, UPDATE_INTERVAL);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        // Зачем: Обрабатываем ACTION_SET сообщения от сервера (автоматические обновления при изменениях)
        // Это более эффективно, чем периодические GET запросы для узкого SSH канала
        if (message.type === 'ACTION_SET' && message.id && message.payload) {
          display.setDeviceState(message.id, message.payload);
        } else if (message.type === 'state' && message.id && message.state) {
          // Зачем: Поддержка старого формата для обратной совместимости
          display.setDeviceState(message.id, message.state);
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
    
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

// Зачем: Запускаем приложение
if (require.main === module) {
  main();
}

module.exports = { TerminalKitStatusDisplay };
