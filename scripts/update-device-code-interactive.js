#!/usr/bin/env node

/**
 * Интерактивный скрипт для автоматического поиска и исправления ошибок в code физических устройств
 * 
 * Зачем: Автоматически находит устройства с ошибками в названиях (пробелы, кириллица, неправильные названия помещений)
 *        и по очереди предлагает исправления
 * 
 * Использование:
 *   node scripts/update-device-code-interactive.js
 *   REACTHOME_WS_URI=ws://192.168.88.4:3000 node scripts/update-device-code-interactive.js
 */

const WebSocket = require('ws');
const readline = require('readline');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTION_SET = 'ACTION_SET';

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
  // Например: "Ваннаяя" → "Ванная", "Спальнаяя" → "Спальная"
  code = code.replace(/Ваннаяя+/g, 'Ванная');
  code = code.replace(/Спальнаяя+/g, 'Спальная');

  // Зачем: Исправляем частые опечатки/варианты названий помещений
  // Важно: заменяем только если правильного варианта еще нет в строке
  for (const [wrong, correct] of Object.entries(CORRECT_ROOM_NAMES)) {
    // Зачем: Проверяем, нет ли уже правильного варианта (чтобы не делать двойную замену)
    if (!code.includes(correct)) {
      code = code.replace(new RegExp(wrong, 'g'), correct);
    }
  }

  // Зачем: Нормализуем CO2 (часто встречается кириллицей "СО2")
  code = code.replace(/[Сс][Оо]2/g, 'CO2');

  // Зачем: Убираем “мусорные” символы, которые ломают ввод и создают неоднозначность
  // Примечание: "?" - специальный маркер "помещение не определено" в проекте "Почтовая", не удаляем
  code = code.replace(/[@#$%^&*()+=]/g, '');

  // Зачем: Подчищаем края и лишние пробелы (оставляем одиночные пробелы, если они были частью нейминга)
  code = code.trim().replace(/\s{2,}/g, ' ');

  return { original, patched: code };
}

// Зачем: Конвенции формата code для внешних устройств (проверка соответствия)
function getExpectedCodePrefixByType(deviceType, siteCode) {
  if (!siteCode) return null;
  switch (deviceType) {
    case 0x25: // SMART_4G
      return `S4${siteCode}`;
    case 0x2b: // CO2_SENSOR
      return `CO2${siteCode}`;
    case 0x04:
    case 0x22: // DOPPLER
      return `DP${siteCode}`;
    case 0x20: // DI_4
      return `DI${siteCode}`;
    case 0xf0: // TEMPERATURE_EXT
      return `T${siteCode}`;
    default:
      return null;
  }
}

// Зачем: Проверяем, что stdin доступен для интерактивного режима
if (!process.stdin.isTTY) {
  console.error('❌ Ошибка: stdin не доступен. Скрипт должен запускаться в интерактивном режиме.');
  process.exit(1);
}

// Зачем: Создаем интерфейс readline для интерактивного ввода
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

// Зачем: ANSI escape codes для цветного вывода в консоль
const ANSI_RESET = '\x1b[0m';
const ANSI_RED_BG = '\x1b[41m';      // Красный фон
const ANSI_GREEN_BG = '\x1b[42m';    // Зелёный фон
const ANSI_BLACK_FG = '\x1b[30m';    // Чёрный текст (для лучшей читаемости на цветном фоне)

// Зачем: Вывод текста с красным фоном (для старого значения)
function redBg(text) {
  return `${ANSI_RED_BG}${ANSI_BLACK_FG}${text}${ANSI_RESET}`;
}

// Зачем: Вывод текста с зелёным фоном (для предлагаемого значения)
function greenBg(text) {
  return `${ANSI_GREEN_BG}${ANSI_BLACK_FG}${text}${ANSI_RESET}`;
}

// Зачем: Проверяем, есть ли ошибки в code устройства
function hasCodeErrors(device, sitesMap) {
  const code = device.code || '';
  const errors = [];
  
  // Зачем: В “ошибках” держим только то, что правится точечно без смены структуры
  // (пробелы/кириллица в названиях помещений не считаем ошибкой — иначе слишком много ложных срабатываний)

  // Зачем: Проверяем специальные символы (кроме "?" - это маркер "помещение не определено" в проекте "Почтовая")
  if (/[@#$%^&*()+=]/.test(code)) {
    errors.push('специальные символы в code');
  }

  // Зачем: Отдельно ловим кириллический вариант CO2 ("СО2"), это частая реальная ошибка
  if (/[Сс][Оо]2/.test(code)) {
    errors.push('CO2 записан кириллицей ("СО2" вместо "CO2")');
  }
  
  // Зачем: Проверяем неправильные названия помещений
  for (const [wrong, correct] of Object.entries(CORRECT_ROOM_NAMES)) {
    if (code.includes(wrong)) {
      errors.push(`неправильное название помещения: "${wrong}" (должно быть "${correct}")`);
    }
  }
  
  return errors.length > 0 ? errors : null;
}

// Зачем: Проверяем соответствие code ожидаемым правилам (даже если явных ошибок нет)
function getConformanceIssues(device, sitesMap) {
  const code = device.code || '';
  const issues = [];
  if (!code) {
    issues.push('code не задан');
    return issues;
  }
  // Базовое правило: латиница/цифры, без пробелов
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(code)) {
    issues.push('code не соответствует базовому формату (латиница+цифры, без пробелов)');
  }

  // Для внешних устройств: префикс должен соответствовать типу и site (если site известен)
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

// Зачем: Предлагаем правильное название code на основе типа устройства и привязки к site
function suggestCode(device, sitesMap) {
  const deviceType = device.type;
  const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`;
  const currentCode = device.code || '';
  
  // Зачем: Определяем site устройства
  let siteId = null;
  let siteCode = null;
  let siteTitle = null;
  
  if (device.site) {
    if (Array.isArray(device.site)) {
      siteId = device.site.length > 0 ? device.site[0] : null;
    } else {
      siteId = device.site;
    }
    
    if (siteId && sitesMap.has(siteId)) {
      const site = sitesMap.get(siteId);
      siteCode = site.code || null;
      siteTitle = site.title || null;
    }
  }
  
  // Зачем: Для SMART_4G панелей - формат "S4{номер_помещения}"
  if (deviceType === 0x25) { // SMART_4G
    if (siteCode) {
      return `S4${siteCode}`;
    }
    return 'S4';
  }
  
  // Зачем: Для CO2 датчиков - формат "CO2{номер_помещения}{порядковый_номер}"
  if (deviceType === 0x2b) { // CO2_SENSOR
    if (siteCode) {
      return `CO2${siteCode}1`; // TODO: определить порядковый номер
    }
    return 'CO201';
  }
  
  // Зачем: Для DOPPLER датчиков - формат "DP{номер_помещения}{порядковый_номер}"
  if (deviceType === 0x04 || deviceType === 0x22) { // DOPPLER
    if (siteCode) {
      return `DP${siteCode}1`; // TODO: определить порядковый номер
    }
    return 'DP01';
  }
  
  // Зачем: Для DI_4 датчиков - формат "DI{номер_помещения}{порядковый_номер}"
  if (deviceType === 0x20) { // DI_4
    if (siteCode) {
      return `DI${siteCode}1`; // TODO: определить порядковый номер
    }
    return 'DI01';
  }
  
  // Зачем: Для TEMPERATURE_EXT датчиков - формат "T{номер_помещения}{порядковый_номер}"
  if (deviceType === 0xf0) { // TEMPERATURE_EXT
    if (siteCode) {
      return `T${siteCode}1`; // TODO: определить порядковый номер
    }
    return 'T01';
  }
  
  // Зачем: Для других устройств используем стандартные префиксы
  // Если текущий code уже в правильном формате - оставляем его
  if (currentCode && /^[A-Za-z][A-Za-z0-9]*$/.test(currentCode) && !currentCode.includes(' ')) {
    return currentCode;
  }
  
  // Зачем: Предлагаем базовый формат на основе типа
  const prefixMap = {
    'RELAY_12': 'R',
    'RELAY_6': 'R',
    'RELAY_2': 'R',
    'DIM_8': 'Dim',
    'DIM_4': 'Dim',
    'DIM8': 'Dim',
    'DIM4': 'Dim',
    'DO8': 'DO',
    'DO16': 'DO',
    'SENSOR4': 'S',
    'SENSOR6': 'S',
  };
  
  // Зачем: Fallback-префикс должен быть латиницей (иначе снова получим кириллицу в code)
  const fallbackPrefix = prefixMap[deviceTypeName]
    ? prefixMap[deviceTypeName]
    : 'DEV';
  // Зачем: Делаем стабильный латинский код даже для неизвестных типов (DEV00, DEV25, ...)
  const typeSuffix = Number.isFinite(deviceType) ? deviceType.toString(16).toUpperCase().padStart(2, '0') : '00';
  return `${fallbackPrefix}${typeSuffix}`;
}

async function findAndFixDevices() {
  const ws = new WebSocket(WS_URI);
  const sitesMap = new Map();
  const deviceDataMap = new Map();
  let listReceived = false;
  let getSent = false;
  let pendingGetRequests = 0;
  let processingStarted = false;
  let expectedIds = new Set();
  let receivedIds = new Set();
  const pendingGetResolvers = new Map(); // id -> resolve(payload)
  
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
      
      // Зачем: Обрабатываем ответ LIST
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
      
      // Зачем: Обрабатываем ответы ACTION_SET
      if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
        const payload = msg.payload;
        
        // Зачем: Если кто-то ждет результат GET по конкретному id — отдаем ему ответ
        const resolver = pendingGetResolvers.get(msg.id);
        if (resolver) {
          pendingGetResolvers.delete(msg.id);
          resolver(payload);
        }
        
        // Зачем: Сохраняем sites
        if (payload.type === 'site' || payload.type === 'SITE') {
          sitesMap.set(msg.id, {
            id: msg.id,
            ...payload
          });
        }
        
        // Зачем: Сохраняем физические устройства
        if (typeof payload.type === 'number' && !msg.id.includes('/')) {
          deviceDataMap.set(msg.id, {
            id: msg.id,
            ...payload
          });
        }
        
        // Зачем: Считаем завершение первичного GET только по ожидаемым id и только один раз
        if (!processingStarted && getSent && expectedIds.has(msg.id) && !receivedIds.has(msg.id)) {
          receivedIds.add(msg.id);
          pendingGetRequests--;
        }
        
        // Зачем: Когда получили все ответы, анализируем устройства
        if (!processingStarted && getSent && pendingGetRequests <= 0) {
          processingStarted = true;
          clearTimeout(timeout);
          
          // Зачем: Цикл 1 — только устройства с ошибками
          const devicesWithErrors = [];
          // Зачем: Цикл 2 — устройства без ошибок, но не соответствующие правилам
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
          
          console.log(`\n🔁 Цикл 1/2: найдено устройств с ошибками: ${devicesWithErrors.length}\n`);
          console.log(`🔁 Цикл 2/2: найдено устройств с несоответствием: ${devicesNonConforming.length}\n`);
          
          if (devicesWithErrors.length === 0 && devicesNonConforming.length === 0) {
            console.log('✅ Нечего исправлять: ошибок и несоответствий не найдено.');
            ws.close();
            rl.close();
            process.exit(0);
          }
          
          // Зачем: Запускаем цикл 1 (ошибки), затем цикл 2 (соответствие)
          runTwoCycles(ws, sitesMap, devicesWithErrors, devicesNonConforming).catch((e) => {
            console.error('❌ Ошибка обработки устройств:', e.message);
            ws.close();
            rl.close();
            process.exit(1);
          });
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
  
  function getByIdOnce(id, msTimeout = 3000) {
    // Зачем: Надежно получить актуальный payload объекта по id через GET
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pendingGetResolvers.delete(id);
        reject(new Error(`таймаут GET для ${id}`));
      }, msTimeout);
      
      pendingGetResolvers.set(id, (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
      
      ws.send(JSON.stringify({ type: 'get', state: [id] }));
    });
  }
  
  async function runTwoCycles(ws, sitesMap, cycle1, cycle2) {
    // Зачем: Циклы выполняются последовательно, чтобы не мешать вводу пользователя
    if (cycle1.length > 0) {
      await processDevices(ws, cycle1, sitesMap, {
        cycleLabel: 'Цикл 1/2 — Ошибки',
        issuesLabel: 'Ошибки',
        suggestionMode: 'patch_original',
      });
    } else {
      console.log('ℹ️  Цикл 1/2: ошибок нет, пропускаю.');
    }
    
    if (cycle2.length > 0) {
      await processDevices(ws, cycle2, sitesMap, {
        cycleLabel: 'Цикл 2/2 — Соответствие',
        issuesLabel: 'Несоответствия',
        suggestionMode: 'convention',
      });
    } else {
      console.log('ℹ️  Цикл 2/2: несоответствий нет, пропускаю.');
    }
    
    ws.close();
    rl.close();
    process.exit(0);
  }
  
  async function processDevices(ws, items, sitesMap, meta) {
    let fixedCount = 0;
    let skippedCount = 0;
    
    for (let i = 0; i < items.length; i++) {
      const { device, issues } = items[i];
      const deviceType = device.type;
      const deviceTypeName = DEVICE_TYPE_NAMES[deviceType] || `Тип0x${deviceType.toString(16)}`;
      const currentCode = device.code || '(не задан)';
      const currentTitle = device.title || '(не задан)';
      
      // Зачем: Определяем site устройства
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
      
      console.log('\n' + '='.repeat(60));
      console.log(`🔁 ${meta.cycleLabel}`);
      console.log(`📋 Устройство ${i + 1} из ${items.length}:`);
      console.log('='.repeat(60));
      console.log(`   MAC: ${device.id}`);
      console.log(`   Тип: ${deviceTypeName} (0x${deviceType.toString(16)})`);
      console.log(`   Текущий code: ${redBg(currentCode)}`);
      console.log(`   Текущий title: ${currentTitle}`);
      if (siteInfo) {
        console.log(`   Помещение: ${siteInfo.title || siteInfo.code || siteId} (code: ${siteInfo.code || '—'})`);
      } else {
        console.log(`   Помещение: (не привязано)`);
      }
      console.log(`   ${meta.issuesLabel}: ${issues.join(', ')}`);
      console.log('='.repeat(60) + '\n');
      
      // Зачем: Предлагаем правильное название
      let suggestedCode = '';
      if (meta.suggestionMode === 'patch_original') {
        // Зачем: Для ошибок предлагаем исходное название с правкой (не ломаем привычный нейминг)
        const { original, patched } = patchCodeKeepingOriginal(device.code || '');
        suggestedCode = (patched && patched !== original) ? patched : suggestCode(device, sitesMap);
      } else {
        // Зачем: Для соответствия предлагаем code по конвенции (тип + site.code)
        suggestedCode = suggestCode(device, sitesMap);
      }
      
      console.log(`💡 Предлагаю новое значение code: ${greenBg(suggestedCode)}`);
      
      if (currentCode === suggestedCode) {
        console.log(`\n✅ Устройство уже имеет правильное значение code. Пропускаю.`);
        skippedCount++;
        continue;
      }
      
      console.log(`\nВыберите действие:`);
      console.log(`  1. Принять предложение: ${greenBg(suggestedCode)}`);
      console.log(`  2. Ввести своё значение`);
      console.log(`  3. Пропустить это устройство`);
      console.log(`  4. Завершить работу`); // Зачем: дать возможность остановиться без обработки оставшихся
      
      let answer;
      try {
        if (rl.closed) {
          console.error('❌ readline interface закрыт');
          break;
        }
        answer = await question('\nВаш выбор (1/2/3/4): ');
      } catch (error) {
        console.error('❌ Ошибка чтения ввода:', error.message);
        break;
      }
      
      let newCode = null;
      
      if (answer === '1') {
        newCode = suggestedCode;
      } else if (answer === '2') {
        try {
          newCode = await question('Введите новое значение code: ');
          newCode = newCode.trim();
          if (!newCode) {
            console.log('❌ Пустое значение. Пропускаю.');
            skippedCount++;
            continue;
          }
        } catch (error) {
          console.error('❌ Ошибка чтения ввода:', error.message);
          skippedCount++;
          continue;
        }
      } else if (answer === '3') {
        console.log('⏭️  Пропускаю устройство.');
        skippedCount++;
        continue;
      } else if (answer === '4') {
        console.log('👋 Завершаю работу.');
        break;
      } else {
        console.log('❌ Неверный выбор. Пропускаю.');
        skippedCount++;
        continue;
      }
      
      // Зачем: Отправляем обновление
      console.log(`\n📤 Отправляю обновление code: "${newCode}"...`);
      ws.send(JSON.stringify({
        type: ACTION_SET,
        id: device.id,
        payload: {
          code: newCode
        }
      }));
      
      // Зачем: Проверяем результат через GET по конкретному id
      try {
        const updatedPayload = await getByIdOnce(device.id, 5000);
        const updatedCode = updatedPayload?.code;
        // Зачем: Обновляем кеш, чтобы следующие шаги работали с актуальным состоянием
        if (typeof updatedPayload?.type === 'number') {
          deviceDataMap.set(device.id, { id: device.id, ...updatedPayload });
        }
        if (updatedCode === newCode) {
          console.log(`✅ Обновление успешно!`);
        } else {
          console.log(`⚠️  Обновление отправлено, но code не совпал при проверке (ожидалось "${newCode}", получено "${updatedCode || '(не задано)'}")`);
        }
      } catch (e) {
        console.log(`⚠️  Обновление отправлено, но проверка не удалась: ${e.message}`);
      }
      
      fixedCount++;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`📊 Итоги: ${meta.cycleLabel}`);
    console.log('='.repeat(60));
    console.log(`   Исправлено: ${fixedCount}`);
    console.log(`   Пропущено: ${skippedCount}`);
    console.log(`   Всего обработано: ${fixedCount + skippedCount} из ${items.length}`);
    console.log('='.repeat(60) + '\n');
  }
}

// Запуск
findAndFixDevices().catch(error => {
  console.error('❌ Ошибка:', error.message);
  rl.close();
  process.exit(1);
});

