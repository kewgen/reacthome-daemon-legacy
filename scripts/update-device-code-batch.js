#!/usr/bin/env node

/**
 * Пакетный скрипт для переименования устройств: сбор списка → утверждение → применение
 * 
 * Зачем: Сначала собираем список всех переименований, утверждаем его, затем применяем все изменения одним разом
 * 
 * Использование:
 *   node scripts/update-device-code-batch.js collect    # Собрать список переименований
 *   node scripts/update-device-code-batch.js apply      # Применить сохранённый список
 *   node scripts/update-device-code-batch.js preview    # Показать сохранённый список
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/update-device-code-batch.js collect
 */

const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTION_SET = 'ACTION_SET';
const RENAMES_FILE = path.join(__dirname, '..', 'device-renames.json');

/**
 * Зачем: Универсально отправить ACTION_SET (code) для любого объекта по id.
 * Можно применять и к устройствам, и к скриптам, если сервер принимает поле code.
 * @param {WebSocket} ws
 * @param {Array<{id:string, code:string}>} items
 */
function applySetCodes(ws, items = []) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  items
    .filter(i => i && i.id && i.code)
    .forEach(({ id, code }) => {
      ws.send(JSON.stringify({
        type: ACTION_SET,
        id,
        payload: { code }
      }));
    });
}

// Зачем: Названия типов устройств для определения префиксов
const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x20: 'DI_4', 0x22: 'DOPPLER', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xf0: 'TEMPERATURE_EXT',
  0x0a: 'DO8', 0x0b: 'DO16', 0x11: 'DO12', 0x23: 'RELAY_2',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa2: 'RELAY_24', 0xa7: 'RELAY_2_DIN', 0xae: 'RELAY_12_RS',
  0x0e: 'DIM4', 0x0f: 'DIM8',
  0xa3: 'DIM_4', 0xa4: 'DIM_8', 0xa5: 'LANAMP', 0xaf: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS', 0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb6: 'DIM_1_AC_RS',
  0xa9: 'AO_4_DIN',
  0x41: 'MIX_H', 0xaa: 'MIX_2', 0xab: 'MIX_1', 0xac: 'MIX_1_RS', 0xb5: 'MIX_6x12_RS',
  0x25: 'SMART_4G',
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
};

// Зачем: Правильные названия помещений (для исправления ошибок)
// Примечание: "Кухня" и "Коридор" - валидные негласные помещения в проекте "Почтовая", не исправляем
const CORRECT_ROOM_NAMES = {
  'Ванна': 'Ванная',
  'Спальня': 'Спальная',
};

// Зачем: Автоправка текущего code при ошибках (сохраняем исходную структуру, правим только явные косяки)
function patchCodeKeepingOriginal(codeRaw) {
  const original = String(codeRaw || '');
  let code = original;

  // Зачем: Сначала исправляем очевидные опечатки (двойные буквы в конце слов)
  code = code.replace(/Ваннаяя+/g, 'Ванная');
  code = code.replace(/Спальнаяя+/g, 'Спальная');

  // Зачем: Исправляем частые опечатки/варианты названий помещений
  for (const [wrong, correct] of Object.entries(CORRECT_ROOM_NAMES)) {
    if (!code.includes(correct)) {
      code = code.replace(new RegExp(wrong, 'g'), correct);
    }
  }

  // Зачем: Нормализуем CO2 (часто встречается кириллицей "СО2")
  code = code.replace(/[Сс][Оо]2/g, 'CO2');

  // Зачем: Убираем “мусорные” символы (кроме "?" - маркер "помещение не определено")
  code = code.replace(/[@#$%^&*()+=]/g, '');

  // Зачем: Подчищаем края и лишние пробелы
  code = code.trim().replace(/\s{2,}/g, ' ');

  return { original, patched: code };
}

// Зачем: Конвенции формата code для внешних устройств (проверка соответствия)
function getExpectedCodePrefixByType(deviceType, siteCode) {
  if (!siteCode) return null;
  switch (deviceType) {
    case 0x25: return `S4${siteCode}`;
    case 0x2b: return `CO2${siteCode}`;
    case 0x04:
    case 0x22: return `DP${siteCode}`;
    case 0x20: return `DI${siteCode}`;
    case 0xf0: return `T${siteCode}`;
    default: return null;
  }
}

// Зачем: ANSI escape codes для цветного вывода
const ANSI_RESET = '\x1b[0m';
const ANSI_RED_BG = '\x1b[41m';
const ANSI_GREEN_BG = '\x1b[42m';
const ANSI_BLACK_FG = '\x1b[30m';

function redBg(text) {
  return `${ANSI_RED_BG}${ANSI_BLACK_FG}${text}${ANSI_RESET}`;
}

function greenBg(text) {
  return `${ANSI_GREEN_BG}${ANSI_BLACK_FG}${text}${ANSI_RESET}`;
}

// Зачем: Проверяем, есть ли ошибки в code устройства
function hasCodeErrors(device, sitesMap) {
  const code = device.code || '';
  const errors = [];
  
  if (/[@#$%^&*()+=]/.test(code)) {
    errors.push('специальные символы в code');
  }
  if (/[Сс][Оо]2/.test(code)) {
    errors.push('CO2 записан кириллицей ("СО2" вместо "CO2")');
  }
  for (const [wrong, correct] of Object.entries(CORRECT_ROOM_NAMES)) {
    if (code.includes(wrong)) {
      errors.push(`неправильное название помещения: "${wrong}" (должно быть "${correct}")`);
    }
  }
  
  return errors.length > 0 ? errors : null;
}

// Зачем: Проверяем соответствие code ожидаемым правилам
function getConformanceIssues(device, sitesMap) {
  const code = device.code || '';
  const issues = [];
  if (!code) {
    issues.push('code не задан');
    return issues;
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(code)) {
    issues.push('code не соответствует базовому формату (латиница+цифры, без пробелов)');
  }

  let siteId = null;
  if (device.site) {
    siteId = Array.isArray(device.site) ? (device.site[0] || null) : device.site;
  }
  const site = siteId ? sitesMap.get(siteId) : null;
  const siteCode = site?.code ? String(site.code) : null;
  const expectedPrefix = getExpectedCodePrefixByType(device.type, siteCode);
  if (expectedPrefix) {
    if (!code.startsWith(expectedPrefix)) {
      issues.push(`code не соответствует ожидаемому префиксу "${expectedPrefix}" (тип+site)`);
    }
  }

  return issues.length > 0 ? issues : null;
}

// Зачем: Предлагаем правильное название code
function suggestCode(device, sitesMap) {
  const deviceType = device.type;
  const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`;
  const currentCode = device.code || '';
  
  let siteId = null;
  let siteCode = null;
  
  if (device.site) {
    if (Array.isArray(device.site)) {
      siteId = device.site.length > 0 ? device.site[0] : null;
    } else {
      siteId = device.site;
    }
    
    if (siteId && sitesMap.has(siteId)) {
      const site = sitesMap.get(siteId);
      siteCode = site.code || null;
    }
  }
  
  if (deviceType === 0x25) {
    if (siteCode) return `S4${siteCode}`;
    return 'S4';
  }
  if (deviceType === 0x2b) {
    if (siteCode) return `CO2${siteCode}1`;
    return 'CO201';
  }
  if (deviceType === 0x04 || deviceType === 0x22) {
    if (siteCode) return `DP${siteCode}1`;
    return 'DP01';
  }
  if (deviceType === 0x20) {
    if (siteCode) return `DI${siteCode}1`;
    return 'DI01';
  }
  if (deviceType === 0xf0) {
    if (siteCode) return `T${siteCode}1`;
    return 'T01';
  }
  
  if (currentCode && /^[A-Za-z][A-Za-z0-9]*$/.test(currentCode) && !currentCode.includes(' ')) {
    return currentCode;
  }
  
  const prefixMap = {
    'RELAY_12': 'R', 'RELAY_6': 'R', 'RELAY_2': 'R',
    'DIM_8': 'Dim', 'DIM_4': 'Dim', 'DIM8': 'Dim', 'DIM4': 'Dim',
    'DO8': 'DO', 'DO16': 'DO',
    'SENSOR4': 'S', 'SENSOR6': 'S',
  };
  
  const fallbackPrefix = prefixMap[deviceTypeName] || 'DEV';
  const typeSuffix = Number.isFinite(deviceType) ? deviceType.toString(16).toUpperCase().padStart(2, '0') : '00';
  return `${fallbackPrefix}${typeSuffix}`;
}

// Зачем: Создаем интерфейс readline (нужен только для команд apply и preview)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve, reject) => {
    if (rl.closed) {
      reject(new Error('readline interface is closed'));
      return;
    }
    try {
      rl.question(prompt, resolve);
    } catch (error) {
      reject(error);
    }
  });
}

// Зачем: Формат JSON для списка переименований
// {
//   "version": "1.0",
//   "createdAt": "2025-01-XX...",
//   "total": 10,
//   "renames": [
//     {
//       "mac": "50:35:cc:2d:8e:fe",
//       "currentCode": "S4 Ванна",
//       "newCode": "S4 Ванная",
//       "deviceType": "SMART_4G",
//       "deviceTypeHex": "0x25",
//       "site": "Ванная",
//       "siteCode": "8",
//       "issues": ["неправильное название помещения..."],
//       "cycle": "1/2 — Ошибки"
//     }
//   ]
// }

async function collectRenames() {
  const ws = new WebSocket(WS_URI);
  const sitesMap = new Map();
  const deviceDataMap = new Map();
  let listReceived = false;
  let getSent = false;
  let pendingGetRequests = 0;
  let processingStarted = false;
  let expectedIds = new Set();
  let receivedIds = new Set();
  const pendingGetResolvers = new Map();
  
  const timeout = setTimeout(() => {
    console.error('❌ Таймаут ожидания ответов');
    ws.close();
    rl.close();
    process.exit(1);
  }, 30000);
  
  ws.on('open', () => {
    console.log('✅ Подключено к WebSocket');
    console.log('📥 Запрашиваю список всех устройств...');
    ws.send(JSON.stringify({ type: 'list' }));
  });
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'list' && msg.state && Array.isArray(msg.state) && !listReceived) {
        listReceived = true;
        const allIds = msg.state.map(([id]) => id).filter(Boolean);
        
        if (allIds.length > 0) {
          getSent = true;
          expectedIds = new Set(allIds);
          receivedIds = new Set();
          pendingGetRequests = expectedIds.size;
          console.log(`📥 Запрашиваю данные ${allIds.length} объектов...`);
          ws.send(JSON.stringify({ type: 'get', state: allIds }));
        } else {
          clearTimeout(timeout);
          ws.close();
          console.log('Устройства не найдены');
          rl.close();
          process.exit(0);
        }
      }
      
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const payload = msg.payload;
        
        const resolver = pendingGetResolvers.get(msg.id);
        if (resolver) {
          pendingGetResolvers.delete(msg.id);
          resolver(payload);
        }
        
        if (payload.type === 'site' || payload.type === 'SITE') {
          sitesMap.set(msg.id, { id: msg.id, ...payload });
        }
        
        if (typeof payload.type === 'number' && !msg.id.includes('/')) {
          deviceDataMap.set(msg.id, { id: msg.id, ...payload });
        }
        
        if (!processingStarted && getSent && expectedIds.has(msg.id) && !receivedIds.has(msg.id)) {
          receivedIds.add(msg.id);
          pendingGetRequests--;
        }
        
        if (!processingStarted && getSent && pendingGetRequests <= 0) {
          processingStarted = true;
          clearTimeout(timeout);
          
          const devicesWithErrors = [];
          const devicesNonConforming = [];
          
          for (const device of deviceDataMap.values()) {
            const errors = hasCodeErrors(device, sitesMap);
            if (errors) {
              devicesWithErrors.push({ device, issues: errors });
              continue;
            }
            const confIssues = getConformanceIssues(device, sitesMap);
            if (confIssues) {
              devicesNonConforming.push({ device, issues: confIssues });
            }
          }
          
          console.log(`\n🔁 Цикл 1/2: найдено устройств с ошибками: ${devicesWithErrors.length}`);
          console.log(`🔁 Цикл 2/2: найдено устройств с несоответствием: ${devicesNonConforming.length}\n`);
          
          if (devicesWithErrors.length === 0 && devicesNonConforming.length === 0) {
            console.log('✅ Нечего исправлять: ошибок и несоответствий не найдено.');
            ws.close();
            rl.close();
            process.exit(0);
          }
          
          await buildRenamesList(ws, sitesMap, devicesWithErrors, devicesNonConforming);
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });
  
  ws.on('error', (error) => {
    clearTimeout(timeout);
    console.error(`❌ Ошибка подключения: ${error.message}`);
    rl.close();
    process.exit(1);
  });
  
  ws.on('close', () => {
    clearTimeout(timeout);
  });
  
  async function buildRenamesList(ws, sitesMap, cycle1, cycle2) {
    const renames = [];
    
    // Зачем: Обрабатываем цикл 1 (ошибки)
    for (const { device, issues } of cycle1) {
      const deviceType = device.type;
      const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`;
      const currentCode = device.code || '';
      
      let siteId = null;
      let siteInfo = null;
      
      if (device.site) {
        if (Array.isArray(device.site)) {
          siteId = device.site.length > 0 ? device.site[0] : null;
        } else {
          siteId = device.site;
        }
        
        if (siteId && sitesMap.has(siteId)) {
          siteInfo = sitesMap.get(siteId);
        }
      }
      
      const { original, patched } = patchCodeKeepingOriginal(device.code || '');
      const suggestedCode = (patched && patched !== original) ? patched : suggestCode(device, sitesMap);
      
      if (currentCode !== suggestedCode) {
        renames.push({
          mac: device.id,
          currentCode: currentCode,
          newCode: suggestedCode,
          deviceType: deviceTypeName,
          deviceTypeHex: `0x${deviceType.toString(16)}`,
          site: siteInfo ? (siteInfo.title || siteInfo.code || siteId) : null,
          siteCode: siteInfo?.code ? String(siteInfo.code) : null,
          issues: issues,
          cycle: '1/2 — Ошибки',
          checked: false  // Зачем: отметка для обучения - если true, используется для улучшения алгоритма предложений
        });
      }
    }
    
    // Зачем: Обрабатываем цикл 2 (соответствие)
    for (const { device, issues } of cycle2) {
      const deviceType = device.type;
      const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`;
      const currentCode = device.code || '';
      
      let siteId = null;
      let siteInfo = null;
      
      if (device.site) {
        if (Array.isArray(device.site)) {
          siteId = device.site.length > 0 ? device.site[0] : null;
        } else {
          siteId = device.site;
        }
        
        if (siteId && sitesMap.has(siteId)) {
          siteInfo = sitesMap.get(siteId);
        }
      }
      
      const suggestedCode = suggestCode(device, sitesMap);
      
      if (currentCode !== suggestedCode) {
        renames.push({
          mac: device.id,
          currentCode: currentCode,
          newCode: suggestedCode,
          deviceType: deviceTypeName,
          deviceTypeHex: `0x${deviceType.toString(16)}`,
          site: siteInfo ? (siteInfo.title || siteInfo.code || siteId) : null,
          siteCode: siteInfo?.code ? String(siteInfo.code) : null,
          issues: issues,
          cycle: '2/2 — Соответствие',
          checked: false  // Зачем: отметка для обучения - если true, используется для улучшения алгоритма предложений
        });
      }
    }
    
    if (renames.length === 0) {
      console.log('✅ Нет переименований для сохранения.');
      ws.close();
      rl.close();
      process.exit(0);
    }
    
    // Зачем: Показываем список и сохраняем
    console.log('\n' + '='.repeat(60));
    console.log(`📋 Собрано переименований: ${renames.length}`);
    console.log('='.repeat(60));
    
    for (let i = 0; i < Math.min(renames.length, 10); i++) {
      const r = renames[i];
      console.log(`${i + 1}. ${r.mac.substring(0, 17)}... | ${redBg(r.currentCode)} → ${greenBg(r.newCode)} | ${r.cycle}`);
    }
    if (renames.length > 10) {
      console.log(`... и ещё ${renames.length - 10} переименований`);
    }
    
    const data = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      total: renames.length,
      renames: renames
    };
    
    fs.writeFileSync(RENAMES_FILE, JSON.stringify(data, null, 2));
    console.log(`\n✅ Список сохранён в: ${RENAMES_FILE}`);
    console.log(`📊 Всего переименований: ${renames.length}`);
    console.log(`\n💡 Следующие шаги:`);
    console.log(`   1. Проверьте файл: ${RENAMES_FILE}`);
    console.log(`   2. При необходимости отредактируйте его`);
    console.log(`   3. Запустите: node scripts/update-device-code-batch.js apply`);
    
    ws.close();
    rl.close();
    process.exit(0);
  }
}

async function applyRenames() {
  if (!fs.existsSync(RENAMES_FILE)) {
    console.error(`❌ Файл не найден: ${RENAMES_FILE}`);
    console.error(`   Сначала запустите: node scripts/update-device-code-batch.js collect`);
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(RENAMES_FILE, 'utf8'));
  let renames = data.renames || [];
  
  if (renames.length === 0) {
    console.log('❌ Список переименований пуст');
    process.exit(1);
  }
  
  const checkedCount = renames.filter(r => r.checked).length;
  console.log(`📋 Загружено переименований: ${renames.length} (проверено: ${checkedCount})`);
  console.log(`📅 Создан: ${data.createdAt}\n`);
  
  // Зачем: Спрашиваем, применять только проверенные или все
  if (checkedCount > 0 && checkedCount < renames.length) {
    console.log('💡 Найдены проверенные записи. Что применить?');
    console.log(`   1. Только проверенные (${checkedCount} шт.)`);
    console.log(`   2. Все переименования (${renames.length} шт.)`);
    const mode = await question('\nВаш выбор (1/2): ');
    
    if (mode === '1') {
      renames = renames.filter(r => r.checked);
      console.log(`\n✅ Будут применены только проверенные переименования (${renames.length} шт.)\n`);
    } else {
      console.log(`\n✅ Будут применены все переименования (${renames.length} шт.)\n`);
    }
  }
  
  if (renames.length === 0) {
    console.log('❌ Нет переименований для применения');
    rl.close();
    process.exit(0);
  }
  
  // Зачем: Показываем первые 10 для подтверждения
  for (let i = 0; i < Math.min(renames.length, 10); i++) {
    const r = renames[i];
    const checkMark = r.checked ? '✅' : '⏳';
    console.log(`${i + 1}. ${checkMark} ${r.mac} | ${redBg(r.currentCode)} → ${greenBg(r.newCode)}`);
  }
  if (renames.length > 10) {
    console.log(`... и ещё ${renames.length - 10} переименований`);
  }
  
  const answer = await question(`\n⚠️  Применить ${renames.length} переименований? (yes/no): `);
  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Отменено');
    rl.close();
    process.exit(0);
  }
  
  const ws = new WebSocket(WS_URI);
  let connected = false;
  let applied = 0;
  let failed = 0;
  const pendingGetResolvers = new Map();
  
  const timeout = setTimeout(() => {
    console.error('❌ Таймаут');
    ws.close();
    rl.close();
    process.exit(1);
  }, 60000);
  
  ws.on('open', () => {
    connected = true;
    console.log('\n✅ Подключено к WebSocket');
    console.log('📤 Применяю переименования...\n');
    
    // Зачем: Применяем все переименования
    for (const rename of renames) {
      ws.send(JSON.stringify({
        type: ACTION_SET,
        id: rename.mac,
        payload: { code: rename.newCode }
      }));
    }
    
    // Зачем: Проверяем результаты через небольшую задержку
    setTimeout(() => {
      console.log('📥 Проверяю результаты...\n');
      for (const rename of renames) {
        ws.send(JSON.stringify({ type: 'get', state: [rename.mac] }));
      }
    }, 1000);
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const resolver = pendingGetResolvers.get(msg.id);
        if (resolver) {
          pendingGetResolvers.delete(msg.id);
          resolver(msg.payload);
        }
      }
    } catch (e) {
      // Игнорируем
    }
  });
  
  // Зачем: Проверяем результаты
  setTimeout(async () => {
    for (const rename of renames) {
      try {
        const payload = await new Promise((resolve, reject) => {
          const t = setTimeout(() => {
            pendingGetResolvers.delete(rename.mac);
            reject(new Error('timeout'));
          }, 3000);
          
          pendingGetResolvers.set(rename.mac, (p) => {
            clearTimeout(t);
            resolve(p);
          });
          
          ws.send(JSON.stringify({ type: 'get', state: [rename.mac] }));
        });
        
        if (payload.code === rename.newCode) {
          console.log(`✅ ${rename.mac.substring(0, 17)}... | ${redBg(rename.currentCode)} → ${greenBg(rename.newCode)}`);
          applied++;
        } else {
          console.log(`⚠️  ${rename.mac.substring(0, 17)}... | ожидалось "${rename.newCode}", получено "${payload.code || '(не задано)'}"`);
          failed++;
        }
      } catch (e) {
        console.log(`❌ ${rename.mac.substring(0, 17)}... | ошибка проверки: ${e.message}`);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Итоги:');
    console.log('='.repeat(60));
    console.log(`   Применено: ${applied}`);
    console.log(`   Ошибок: ${failed}`);
    console.log(`   Всего: ${renames.length}`);
    console.log('='.repeat(60) + '\n');
    
    ws.close();
    rl.close();
    process.exit(failed > 0 ? 1 : 0);
  }, 2000);
  
  ws.on('error', (error) => {
    clearTimeout(timeout);
    console.error(`❌ Ошибка подключения: ${error.message}`);
    rl.close();
    process.exit(1);
  });
}

async function previewRenames() {
  if (!fs.existsSync(RENAMES_FILE)) {
    console.error(`❌ Файл не найден: ${RENAMES_FILE}`);
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(RENAMES_FILE, 'utf8'));
  const renames = data.renames || [];
  const checkedCount = renames.filter(r => r.checked).length;
  
  console.log(`📋 Список переименований (${renames.length} шт., проверено: ${checkedCount})`);
  console.log(`📅 Создан: ${data.createdAt}\n`);
  console.log('='.repeat(80));
  
  for (let i = 0; i < renames.length; i++) {
    const r = renames[i];
    const checkMark = r.checked ? '✅' : '⏳';
    console.log(`${(i + 1).toString().padStart(3, ' ')}. ${checkMark} ${r.mac} | ${r.deviceType} (${r.deviceTypeHex})`);
    console.log(`     ${redBg(r.currentCode)} → ${greenBg(r.newCode)}`);
    if (r.site) {
      console.log(`     Помещение: ${r.site}${r.siteCode ? ` (code: ${r.siteCode})` : ''}`);
    }
    console.log(`     ${r.cycle} | ${r.issues.join(', ')}`);
    console.log('');
  }
  
  rl.close();
  process.exit(0);
}

async function checkRenames() {
  if (!fs.existsSync(RENAMES_FILE)) {
    console.error(`❌ Файл не найден: ${RENAMES_FILE}`);
    console.error(`   Сначала запустите: node scripts/update-device-code-batch.js collect`);
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(RENAMES_FILE, 'utf8'));
  const renames = data.renames || [];
  
  if (renames.length === 0) {
    console.log('❌ Список переименований пуст');
    process.exit(1);
  }
  
  console.log(`📋 Интерактивная проверка переименований (${renames.length} шт.)`);
  console.log(`📅 Файл создан: ${data.createdAt}\n`);
  console.log('💡 Для каждого устройства введите:');
  console.log('   y/yes/1 - отметить как проверенное (будет использовано для обучения)');
  console.log('   n/no/0 - пропустить (не проверено)');
  console.log('   s/skip - пропустить все оставшиеся');
  console.log('   q/quit - завершить проверку\n');
  console.log('='.repeat(80) + '\n');
  
  let checked = 0;
  let skipped = 0;
  
  for (let i = 0; i < renames.length; i++) {
    const r = renames[i];
    const status = r.checked ? '✅ Проверено' : '⏳ Не проверено';
    
    console.log(`\n[${i + 1}/${renames.length}] ${status}`);
    console.log(`MAC: ${r.mac}`);
    console.log(`Тип: ${r.deviceType} (${r.deviceTypeHex})`);
    console.log(`Текущий code: ${redBg(r.currentCode)}`);
    console.log(`Предлагаемый code: ${greenBg(r.newCode)}`);
    if (r.site) {
      console.log(`Помещение: ${r.site}${r.siteCode ? ` (code: ${r.siteCode})` : ''}`);
    }
    console.log(`Цикл: ${r.cycle}`);
    console.log(`Проблемы: ${r.issues.join(', ')}`);
    
    let answer;
    try {
      answer = await question('\nПроверено? (y/n/s/q): ');
    } catch (error) {
      console.error('❌ Ошибка чтения ввода:', error.message);
      break;
    }
    
    answer = answer.toLowerCase().trim();
    
    if (answer === 'q' || answer === 'quit') {
      console.log('\n👋 Завершаю проверку.');
      break;
    }
    
    if (answer === 's' || answer === 'skip') {
      console.log('⏭️  Пропускаю все оставшиеся.');
      skipped += renames.length - i;
      break;
    }
    
    if (answer === 'y' || answer === 'yes' || answer === '1') {
      r.checked = true;
      checked++;
      console.log('✅ Отмечено как проверенное');
    } else {
      r.checked = false;
      console.log('⏳ Не проверено');
    }
  }
  
  // Зачем: Сохраняем обновлённый список
  data.renames = renames;
  data.checkedCount = checked;
  data.lastCheckedAt = new Date().toISOString();
  
  fs.writeFileSync(RENAMES_FILE, JSON.stringify(data, null, 2));
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Итоги проверки:');
  console.log('='.repeat(80));
  console.log(`   Проверено: ${checked}`);
  console.log(`   Пропущено: ${skipped}`);
  console.log(`   Всего обработано: ${checked + skipped} из ${renames.length}`);
  console.log(`\n✅ Список обновлён: ${RENAMES_FILE}`);
  console.log(`💡 Проверенные записи будут использованы для обучения алгоритма предложений`);
  
  rl.close();
  process.exit(0);
}

// Зачем: Обучение на основе проверенных записей и обновление предложений для непроверенных
async function learnAndUpdate() {
  if (!fs.existsSync(RENAMES_FILE)) {
    console.error(`❌ Файл не найден: ${RENAMES_FILE}`);
    console.error(`   Сначала запустите: node scripts/update-device-code-batch.js collect`);
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(RENAMES_FILE, 'utf8'));
  const renames = data.renames || [];
  
  const checked = renames.filter(r => r.checked === true);
  const unchecked = renames.filter(r => !r.checked);
  
  console.log(`📚 Обучение на основе проверенных записей`);
  console.log(`✅ Проверено: ${checked.length}`);
  console.log(`⏳ Не проверено: ${unchecked.length}\n`);
  
  if (checked.length === 0) {
    console.log('❌ Нет проверенных записей для обучения');
    process.exit(1);
  }
  
  // Зачем: Анализируем паттерны из проверенных записей
  const patterns = new Map(); // deviceTypeHex -> { prefix, format }
  
  // Зачем: Считаем устройства каждого типа в каждом помещении (включая проверенные)
  const deviceCountBySite = new Map(); // "deviceTypeHex-siteCode" -> count
  
  // Зачем: Сначала считаем проверенные устройства
  for (const r of checked) {
    if (!r.siteCode) continue;
    const key = `${r.deviceTypeHex}-${r.siteCode}`;
    const count = deviceCountBySite.get(key) || 0;
    deviceCountBySite.set(key, count + 1);
    
    // Зачем: Извлекаем паттерн из проверенного переименования
    const prefix = getPrefixFromCode(r.newCode, r.deviceTypeHex);
    if (prefix) {
      patterns.set(r.deviceTypeHex, {
        prefix: prefix,
        format: r.newCode,
        siteCode: r.siteCode,
        example: r
      });
    }
  }
  
  console.log('📊 Извлечённые паттерны:');
  for (const [typeHex, pattern] of patterns.entries()) {
    console.log(`   ${typeHex}: ${pattern.format} (префикс: ${pattern.prefix}, siteCode: ${pattern.siteCode})`);
  }
  console.log('');
  
  // Зачем: Обновляем предложения для всех непроверенных записей на основе паттернов
  let updated = 0;
  
  // Зачем: Группируем непроверенные по типу и помещению для правильного подсчёта порядковых номеров
  const uncheckedByTypeSite = new Map();
  for (const r of unchecked) {
    const key = r.siteCode ? `${r.deviceTypeHex}-${r.siteCode}` : `${r.deviceTypeHex}-no-site`;
    if (!uncheckedByTypeSite.has(key)) {
      uncheckedByTypeSite.set(key, []);
    }
    uncheckedByTypeSite.get(key).push(r);
  }
  
  // Зачем: Считаем устройства без siteCode отдельно по типам (для правильной нумерации)
  const deviceCountNoSite = new Map(); // deviceTypeHex -> count
  for (const r of unchecked) {
    if (!r.siteCode) {
      const count = deviceCountNoSite.get(r.deviceTypeHex) || 0;
      deviceCountNoSite.set(r.deviceTypeHex, count + 1);
    }
  }
  
  // Зачем: Отслеживаем порядковый номер для устройств без siteCode
  const noSiteCounters = new Map(); // deviceTypeHex -> currentIndex
  
  for (const [key, devices] of uncheckedByTypeSite.entries()) {
    const [typeHex, siteCodePart] = key.split('-');
    const siteCode = siteCodePart === 'no-site' ? null : siteCodePart;
    const checkedKey = siteCode ? `${typeHex}-${siteCode}` : null;
    const checkedCount = checkedKey ? (deviceCountBySite.get(checkedKey) || 0) : 0;
    
    // Зачем: Для устройств без siteCode считаем отдельно
    if (!siteCode) {
      const currentCount = deviceCountNoSite.get(typeHex) || 0;
      deviceCountNoSite.set(typeHex, currentCount + devices.length);
    }
    
    // Зачем: Обновляем каждое устройство в группе с правильным порядковым номером
    devices.forEach((r, index) => {
      let newSuggestion = '';
      
      // Зачем: Для SMART_4G формат S4{siteCode} (без порядкового номера)
      if (typeHex === '0x25') {
        if (siteCode) {
          newSuggestion = `S4${siteCode}`;
        } else {
          newSuggestion = 'S4'; // Без siteCode
        }
      }
      // Зачем: Для DOPPLER формат DP{siteCode}{порядковый_номер}
      else if (typeHex === '0x22' || typeHex === '0x04') {
        if (siteCode) {
          newSuggestion = `DP${siteCode}${checkedCount + index + 1}`;
        } else {
          // Зачем: Для устройств без siteCode используем глобальный порядковый номер для этого типа
          const currentNoSiteIndex = noSiteCounters.get(typeHex) || 0;
          noSiteCounters.set(typeHex, currentNoSiteIndex + 1);
          newSuggestion = `DP${String(currentNoSiteIndex + 1).padStart(2, '0')}`;
        }
      }
      // Зачем: Для CO2_SENSOR формат CO2{siteCode}{порядковый_номер}
      else if (typeHex === '0x2b') {
        if (siteCode) {
          newSuggestion = `CO2${siteCode}${checkedCount + index + 1}`;
        } else {
          const currentNoSiteIndex = noSiteCounters.get(typeHex) || 0;
          noSiteCounters.set(typeHex, currentNoSiteIndex + 1);
          newSuggestion = `CO2${String(currentNoSiteIndex + 1).padStart(2, '0')}`;
        }
      }
      // Зачем: Для DI_4 формат DI{siteCode}{порядковый_номер}
      else if (typeHex === '0x20') {
        if (siteCode) {
          newSuggestion = `DI${siteCode}${checkedCount + index + 1}`;
        } else {
          const currentNoSiteIndex = noSiteCounters.get(typeHex) || 0;
          noSiteCounters.set(typeHex, currentNoSiteIndex + 1);
          newSuggestion = `DI${String(currentNoSiteIndex + 1).padStart(2, '0')}`;
        }
      }
      // Зачем: Для TEMPERATURE_EXT формат T{siteCode}{порядковый_номер}
      else if (typeHex === '0xf0') {
        if (siteCode) {
          newSuggestion = `T${siteCode}${checkedCount + index + 1}`;
        } else {
          // Зачем: Для устройств без siteCode используем глобальный порядковый номер для этого типа
          const currentNoSiteIndex = noSiteCounters.get(typeHex) || 0;
          noSiteCounters.set(typeHex, currentNoSiteIndex + 1);
          newSuggestion = `T${String(currentNoSiteIndex + 1).padStart(2, '0')}`;
        }
      }
      
      // Зачем: Обновляем предложение для всех непроверенных на основе обучения
      if (newSuggestion) {
        // Зачем: Убеждаемся, что предложение не содержит "no" (исправление бага)
        if (newSuggestion.includes('no')) {
          newSuggestion = newSuggestion.replace(/no/g, '');
          if (newSuggestion.match(/^[A-Z]+[0-9]+$/)) {
            const match = newSuggestion.match(/^([A-Z]+)([0-9]+)$/);
            if (match) {
              const prefix = match[1];
              const num = parseInt(match[2]) || 1;
              newSuggestion = prefix + String(num).padStart(2, '0');
            }
          }
        }
        
        const oldSuggestion = r.newCode;
        if (newSuggestion !== oldSuggestion) {
          r.newCode = newSuggestion;
          r.learnedFrom = `Паттерн из проверенных записей (было: ${oldSuggestion})`;
          updated++;
        } else {
          // Зачем: Если предложение уже правильное, всё равно отмечаем что оно основано на обучении
          if (!r.learnedFrom || !r.learnedFrom.includes('проверенных записей')) {
            r.learnedFrom = `Подтверждено паттерном из проверенных записей`;
          }
        }
      }
    });
  }
  
  // Зачем: Постобработка - удаляем "no" из всех сгенерированных кодов (исправление бага)
  let fixedNo = 0;
  for (const r of renames) {
    if (!r.checked && r.newCode && r.newCode.includes('no')) {
      const old = r.newCode;
      r.newCode = r.newCode.replace(/no/g, '');
      if (r.newCode.match(/^[A-Z]+[0-9]+$/)) {
        const match = r.newCode.match(/^([A-Z]+)([0-9]+)$/);
        if (match) {
          const prefix = match[1];
          const num = parseInt(match[2]) || 1;
          r.newCode = prefix + String(num).padStart(2, '0');
        }
      }
      if (!r.learnedFrom || !r.learnedFrom.includes('Исправлено')) {
        r.learnedFrom = `Исправлено: удалён "no" (было: ${old})`;
      }
      fixedNo++;
    }
  }
  
  // Зачем: Сохраняем обновлённый список
  data.renames = renames;
  data.learnedAt = new Date().toISOString();
  data.learnedFrom = checked.length;
  data.updated = updated;
  data.fixedNo = fixedNo;
  
  fs.writeFileSync(RENAMES_FILE, JSON.stringify(data, null, 2));
  
  console.log('='.repeat(80));
  console.log('📊 Результаты обучения:');
  console.log('='.repeat(80));
  console.log(`   Обучено на: ${checked.length} проверенных записях`);
  console.log(`   Обновлено предложений: ${updated}`);
  if (fixedNo > 0) {
    console.log(`   Исправлено записей с "no": ${fixedNo}`);
  }
  console.log(`   Осталось без изменений: ${unchecked.length - updated - fixedNo}`);
  console.log(`\n✅ Файл обновлён: ${RENAMES_FILE}`);
  console.log(`💡 Проверьте обновлённые предложения: node scripts/update-device-code-batch.js preview`);
  
  rl.close();
  process.exit(0);
}

// Зачем: Извлекаем префикс из code для определения паттерна
function getPrefixFromCode(code, deviceTypeHex) {
  if (!code) return null;
  
  // Зачем: Определяем префикс на основе типа устройства
  if (deviceTypeHex === '0x25') return 'S4'; // SMART_4G
  if (deviceTypeHex === '0x22' || deviceTypeHex === '0x04') return 'DP'; // DOPPLER
  if (deviceTypeHex === '0x2b') return 'CO2'; // CO2_SENSOR
  if (deviceTypeHex === '0x20') return 'DI'; // DI_4
  if (deviceTypeHex === '0xf0') return 'T'; // TEMPERATURE_EXT
  
  // Зачем: Пытаемся извлечь префикс из самого code
  if (code.startsWith('S4')) return 'S4';
  if (code.startsWith('DP')) return 'DP';
  if (code.startsWith('CO2')) return 'CO2';
  if (code.startsWith('DI')) return 'DI';
  if (code.startsWith('T')) return 'T';
  
  return null;
}

// Зачем: Главная функция
const command = process.argv[2] || 'collect';

if (command === 'collect') {
  collectRenames().catch(error => {
    console.error('❌ Ошибка:', error.message);
    rl.close();
    process.exit(1);
  });
} else if (command === 'check') {
  checkRenames().catch(error => {
    console.error('❌ Ошибка:', error.message);
    rl.close();
    process.exit(1);
  });
} else if (command === 'apply') {
  applyRenames().catch(error => {
    console.error('❌ Ошибка:', error.message);
    rl.close();
    process.exit(1);
  });
} else if (command === 'preview') {
  previewRenames().catch(error => {
    console.error('❌ Ошибка:', error.message);
    rl.close();
    process.exit(1);
  });
} else if (command === 'learn') {
  learnAndUpdate().catch(error => {
    console.error('❌ Ошибка:', error.message);
    rl.close();
    process.exit(1);
  });
} else {
  console.error('❌ Неизвестная команда:', command);
  console.error('   Использование:');
  console.error('     node scripts/update-device-code-batch.js collect  # Собрать список переименований');
  console.error('     node scripts/update-device-code-batch.js check    # Проверить и отметить записи');
  console.error('     node scripts/update-device-code-batch.js learn    # Обучиться на проверенных и обновить предложения');
  console.error('     node scripts/update-device-code-batch.js preview # Показать список');
  console.error('     node scripts/update-device-code-batch.js apply   # Применить список');
  process.exit(1);
}
