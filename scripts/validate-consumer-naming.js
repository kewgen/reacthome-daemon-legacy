#!/usr/bin/env node
/**
 * Зачем ?
 * Валидатор спецификации именования потребителей: читает текущие {code,title} всех потребителей из WebSocket демона,
 * вычисляет ожидаемый префикс по спецификации (ROOM.ACT.KIND.CH) и помечает соответствие 🟢/🟡/🔴.
 *
 * Важно:
 * - Скрипт НЕ отправляет ACTION_SET и НЕ меняет состояние — только list/get и локальная проверка.
 * - Логгер и монитор используются только как знания (типы потребителей/формат WS), но НЕ запускаются.
 * - Подключение к демону — ТОЛЬКО через внешний шлюз (wss://), прямые ws:// запрещены.
 *
 * Запуск:
 *   node scripts/validate-consumer-naming.js --daemon <uuid> [--gate wss://gate.reacthome.net] [--timeout <ms>] [--json]
 */

const WebSocket = require('ws');

const DEFAULT_GATE = process.env.REACTHOME_GATE_URL || 'wss://gate.reacthome.net';
const DEFAULT_TIMEOUT_MS = 15000;
const GET_BATCH_SIZE = 500;
const PROTOCOL = 'listen';

// Зачем: список типов потребителей должен совпадать с тем, как классифицируют монитор/логгер.
// ВАЖНО: это КОПИЯ знания, скрипт не зависит от src/ и не требует правок в src/.
const CONSUMER_TYPES = new Set([
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'fan', 'BOILER', 'PUMP',
  'curtains', 'curtain', 'blind', 'blinds', 'roller',
  'multiroom', 'NOVA',
]);

// Зачем: сенсоры тоже приводим к спецификации (пример: датчик протечки 1.LE.1).
const SENSOR_TYPES = new Set([
  'leakage_sensor',
  'thermostat',
  'hygrostat',
  'co2_stat',
]);

// Зачем: маппинг KIND из спецификации именования (docs/DEVICE_NAMING_SPEC.md).
const KIND_BY_TYPE = new Map([
  ['light_220', 'L'],
  ['light_led', 'LED'],
  ['light_LED', 'LED'],
  ['light_RGB', 'RGB'],
  ['light_rgb', 'RGB'],
  ['socket_220', 'S220'],
  ['warm_floor', 'WF'],
  ['fan', 'VN'],
  ['FAN', 'VN'],
  ['NOVA', 'VN'],
  ['curtains', 'C'],
  ['curtain', 'C'],
  ['blind', 'C'],
  ['blinds', 'C'],
  ['roller', 'C'],
  ['multiroom', 'MR'],
  ['valve_heating', 'VALVEH'],
  ['valve_water', 'VALVEW'],
]);

// Зачем: запрещаем кириллицу в машинной части; но для обнаружения/миграции
// поддерживаем "канонизацию" популярных омографов (С->C, Р->P и т.п.).
const CYR_TO_LAT = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
  а: 'A', в: 'B', с: 'C', е: 'E', н: 'H', к: 'K', м: 'M', о: 'O', р: 'P', т: 'T', х: 'X', у: 'Y',
};

const SPEC_RE_GLOBAL = /(\d{1,3})\.([A-Z]{1,2})\.([A-Z0-9]{1,12})\.(\d{1,3})/g; // канон: ROOM.ACT.KIND.CH
const SPEC_RE_COMPACT = /(\d{1,3})\.([A-Z]{1,2})\.([A-Z]{1,12})(\d{1,3})\b/g;   // легаси: ROOM.ACT.KINDCH
const SPEC_RE_THREE = /(\d{1,3})\.([A-Z]{1,12})\.(\d{1,3})\b/g;                               // легаси: ROOM.KIND.CH (без ACT)

const SPEC_AT_START_CANON = /^\s*(\d{1,3})\.([A-Z]{1,2})\.([A-Z0-9]{1,12})\.(\d{1,3})\b/;
const SPEC_AT_START_COMPACT = /^\s*(\d{1,3})\.([A-Z]{1,2})\.([A-Z]{1,12})(\d{1,3})\b/;
const SPEC_AT_START_THREE = /^\s*(\d{1,3})\.([A-Z]{1,12})\.(\d{1,3})\b/;

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { gate: DEFAULT_GATE, daemon: null, timeout: DEFAULT_TIMEOUT_MS, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--daemon' && argv[i + 1]) { opts.daemon = next(); continue; }
    if (a.startsWith('--daemon=')) { opts.daemon = a.slice('--daemon='.length); continue; }
    if (a === '--gate' && argv[i + 1]) { opts.gate = next(); continue; }
    if (a.startsWith('--gate=')) { opts.gate = a.slice('--gate='.length); continue; }
    if (a === '--timeout' && argv[i + 1]) { opts.timeout = Number(next()) || opts.timeout; continue; }
    if (a.startsWith('--timeout=')) { opts.timeout = Number(a.slice('--timeout='.length)) || opts.timeout; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
  }
  return opts;
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/validate-consumer-naming.js --daemon <uuid> [--gate wss://gate.reacthome.net]',
    '  node scripts/validate-consumer-naming.js --json',
    '',
    'Env:',
    '  REACTHOME_GATE_URL=wss://gate.reacthome.net',
  ].join('\n'));
}

function safeStr(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeText(s) {
  // Зачем: стабильное сравнение "содержит/не содержит" и аккуратный вывод.
  return safeStr(s).replace(/\s+/g, ' ').trim();
}

function canonicalizeMachineText(s) {
  // Зачем: сравнение по спецификации делаем на канонизированном тексте (верхний регистр, без кириллических омографов).
  const raw = normalizeText(s);
  let out = '';
  for (const ch of raw) out += (CYR_TO_LAT[ch] || ch);
  return out.toUpperCase();
}

function hasCyrillic(s) {
  return /[А-Яа-яЁё]/.test(safeStr(s));
}

function canonicalKind(kindRaw) {
  const k = canonicalizeMachineText(kindRaw).replace(/[^A-Z0-9]/g, '');
  if (k === 'TRACK') return 'TREK';
  if (k === 'MULTIROOM') return 'MR';
  if (k === 'VALVEHEATING') return 'VALVEH';
  if (k === 'VALVEWATER') return 'VALVEW';
  return k;
}

function findSpecPrefix(text) {
  // Зачем: находим префикс (канон или легаси) в любом месте code/title (после канонизации).
  const t = canonicalizeMachineText(text);
  // 1) Канон: ROOM.ACT.KIND.CH
  SPEC_RE_GLOBAL.lastIndex = 0;
  const m1 = SPEC_RE_GLOBAL.exec(t);
  if (m1) {
    const room = Number(m1[1]);
    const act = canonicalizeMachineText(m1[2]).replace(/[^A-Z]/g, '');
    const kind = canonicalKind(m1[3]);
    const ch = Number(m1[4]);
    if (Number.isFinite(room) && Number.isFinite(ch) && act && kind) {
      return { room, act, kind, ch, prefix: `${room}.${act}.${kind}.${ch}`, source: 'canonical' };
    }
  }

  // 2) Легаси: ROOM.ACT.KINDCH (например 5.R2.C3 или 5.R2.С3)
  SPEC_RE_COMPACT.lastIndex = 0;
  const m2 = SPEC_RE_COMPACT.exec(t);
  if (m2) {
    const room = Number(m2[1]);
    const act = canonicalizeMachineText(m2[2]).replace(/[^A-Z]/g, '');
    const kind = canonicalKind(m2[3]);
    const ch = Number(m2[4]);
    if (Number.isFinite(room) && Number.isFinite(ch) && act && kind) {
      return { room, act, kind, ch, prefix: `${room}.${act}.${kind}.${ch}`, source: 'compact' };
    }
  }

  // 3) Легаси: ROOM.KIND.CH (например 1.BRA.1) — без ACT, но даёт KIND/CH.
  SPEC_RE_THREE.lastIndex = 0;
  const m3 = SPEC_RE_THREE.exec(t);
  if (m3) {
    const room = Number(m3[1]);
    const kind = canonicalKind(m3[2]);
    const ch = Number(m3[3]);
    if (Number.isFinite(room) && Number.isFinite(ch) && kind) {
      return { room, act: null, kind, ch, prefix: `${room}.${kind}.${ch}`, source: 'three' };
    }
  }

  return null;
}

function findSpecAtStart(text) {
  // Зачем: для генерации "ожидаемого" используем только префикс в начале строки (ROOM хранится в code),
  // чтобы не путать со строками вида "2.0/10.Valve.1".
  const t = canonicalizeMachineText(text);
  let m = t.match(SPEC_AT_START_CANON);
  if (m) {
    const room = Number(m[1]);
    const act = canonicalizeMachineText(m[2]).replace(/[^A-Z]/g, '');
    const kind = canonicalKind(m[3]);
    const ch = Number(m[4]);
    if (Number.isFinite(room) && Number.isFinite(ch) && act && kind) {
      return { room, act, kind, ch, prefix: `${room}.${act}.${kind}.${ch}`, source: 'canonical' };
    }
  }
  m = t.match(SPEC_AT_START_COMPACT);
  if (m) {
    const room = Number(m[1]);
    const act = canonicalizeMachineText(m[2]).replace(/[^A-Z]/g, '');
    const kind = canonicalKind(m[3]);
    const ch = Number(m[4]);
    if (Number.isFinite(room) && Number.isFinite(ch) && act && kind) {
      return { room, act, kind, ch, prefix: `${room}.${act}.${kind}.${ch}`, source: 'compact' };
    }
  }
  m = t.match(SPEC_AT_START_THREE);
  if (m) {
    const room = Number(m[1]);
    const kind = canonicalKind(m[2]);
    const ch = Number(m[3]);
    if (Number.isFinite(room) && Number.isFinite(ch) && kind) {
      return { room, act: null, kind, ch, prefix: `${room}.${kind}.${ch}`, source: 'three' };
    }
  }
  return null;
}

function extractRoomFromCodeStart(code) {
  const s = normalizeText(code);
  const m = s.match(/^\s*(\d{1,3})\./);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseBind(bindRaw) {
  // Зачем: ACT и CH берём из bind (dim/do) или из групп (curtains group).
  const bind = normalizeText(bindRaw);
  if (!bind) return { kind: 'missing', baseId: null, actBase: null, ch: null };

  const dimdo = bind.match(/^(.*?)\/(dim|do)\/(\d{1,3})\b/i);
  if (dimdo) {
    const baseId = normalizeText(dimdo[1]);
    const channelKind = dimdo[2].toLowerCase();
    const ch = Number(dimdo[3]);
    const actBase = channelKind === 'dim' ? 'D' : 'R';
    return { kind: channelKind, baseId, actBase, ch: Number.isFinite(ch) ? ch : null };
  }

  const di = bind.match(/^(.*?)\/di\/(\d{1,3})\b/i);
  if (di) {
    const baseId = normalizeText(di[1]);
    const ch = Number(di[2]);
    return { kind: 'di', baseId, actBase: null, ch: Number.isFinite(ch) ? ch : null };
  }

  const monostereo = bind.match(/^(.*?)\/(mono|stereo)\/(\d{1,3})\b/i);
  if (monostereo) {
    const baseId = normalizeText(monostereo[1]);
    const ch = Number(monostereo[3]);
    return { kind: monostereo[2].toLowerCase(), baseId, actBase: 'A', ch: Number.isFinite(ch) ? ch : null };
  }

  const modbus = bind.match(/^(.*?)\/modbus\/(\d{1,3})\b/i);
  if (modbus) {
    const baseId = normalizeText(modbus[1]);
    const ch = Number(modbus[2]);
    return { kind: 'modbus', baseId, actBase: 'M', ch: Number.isFinite(ch) ? ch : null };
  }

  const ao = bind.match(/^(.*?)\/ao\/(\d{1,3})\b/i);
  if (ao) {
    const baseId = normalizeText(ao[1]);
    const ch = Number(ao[2]);
    return { kind: 'ao', baseId, actBase: 'AO', ch: Number.isFinite(ch) ? ch : null };
  }

  const group = bind.match(/^(.*?)\/group\/(\d{1,3})\b/i);
  if (group) {
    const baseId = normalizeText(group[1]);
    const ch = Number(group[2]);
    // Зачем: group для relay — режим/объединение контактов; ACT определяется экземпляром реле (R1/R2), а не "R2".
    return { kind: 'group', baseId, actBase: 'R', ch: Number.isFinite(ch) ? ch : null };
  }

  return { kind: 'unknown', baseId: null, actBase: null, ch: null };
}

function isConsumerPayload(payload) {
  const t = payload && payload.type;
  return typeof t === 'string' && CONSUMER_TYPES.has(t);
}

function isSensorPayload(payload) {
  const t = payload && payload.type;
  return typeof t === 'string' && SENSOR_TYPES.has(t);
}

function isValidatedPayload(payload) {
  return isConsumerPayload(payload) || isSensorPayload(payload);
}

function extractRoomFromText(text) {
  // Зачем: ROOM хранится в code, но иногда префикс может быть не в начале (это и проверяем).
  const s = normalizeText(text);
  const m = s.match(/\b(\d{1,3})\./);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function buildExpectedPrefix({ room, act, kind, ch }) {
  if (!Number.isFinite(room) || !act || !kind || !Number.isFinite(ch)) return null;
  return `${room}.${act}.${kind}.${ch}`;
}

function buildExpectedSensorPrefix({ room, kind, ch }) {
  if (!Number.isFinite(room) || !kind || !Number.isFinite(ch)) return null;
  return `${room}.${kind}.${ch}`;
}

function inferKindFromNames({ type, code, title }) {
  // Зачем: единый словарь KIND строим из текущих названий/кодов, чтобы отражать реальный смысл устройства.
  const hay = `${normalizeText(code)} ${normalizeText(title)}`;
  const canonHay = canonicalizeMachineText(hay);

  // Сначала явные маркеры (в т.ч. кириллица).
  if (/\bBRA\b/.test(canonHay) || /БРА/.test(hay) || /Бра/i.test(hay)) return 'BRA';
  if (/\bTREK\b/.test(canonHay) || /ТРЕК/.test(hay) || /Трек/i.test(hay)) return 'TREK';
  if (/\bSCREEN\b/.test(canonHay) || /ЭКРАН/i.test(hay)) return 'SCREEN';
  if (/\bVN\b/.test(canonHay) || /Вентилятор|Приточка|Вытяжка/i.test(hay)) return 'VN';
  if (/\bMR\b/.test(canonHay) || /\bMULTIROOM\b/.test(canonHay) || /\bMR\b/i.test(hay) || /\bmr\b/.test(hay)) return 'MR';

  // Curtains/roller/blinds: в текущих данных чаще KIND=C (или "C"/"С").
  if (['curtains', 'curtain', 'blind', 'blinds', 'roller'].includes(type)) return 'C';

  // Фолбэк — по типу.
  return KIND_BY_TYPE.get(type) || canonicalKind(type).slice(0, 12) || null;
}

function kindBySensorType(type) {
  // Зачем: базовые KIND для сенсоров (короткий формат ROOM.KIND.CH).
  if (type === 'leakage_sensor') return 'LE';
  if (type === 'thermostat') return 'TH';
  if (type === 'hygrostat') return 'HYG';
  if (type === 'co2_stat') return 'CO2';
  return canonicalKind(type).slice(0, 12) || null;
}

function computeExpected({ id, payload, roomById, localToGlobalMap }) {
  const code = normalizeText(payload.code);
  const title = normalizeText(payload.title);
  const type = safeStr(payload.type);
  const bind = normalizeText(payload.bind);

  const startSpecCode = findSpecAtStart(code);
  const startSpecTitle = findSpecAtStart(title);

  // Зачем: ROOM извлекаем из существующих данных (первично из найденного префикса, затем из code/title).
  const room =
    startSpecCode?.room ??
    extractRoomFromCodeStart(code) ??
    (roomById ? roomById.get(id) : null) ??
    startSpecTitle?.room ??
    extractRoomFromText(title);

  const bindInfo = parseBind(bind);

  const isSensor = isSensorPayload(payload);

  let expectedPrefix = null;
  let expectedCh = null;       // сквозной для потребителей / локальный для сенсоров
  let localCh = Number.isFinite(bindInfo.ch) ? bindInfo.ch : null; // локальный номер из bind
  let act = null;
  let kind = null;

  if (isSensor) {
    kind = startSpecCode?.kind || startSpecTitle?.kind || kindBySensorType(type);
    
    // Fallback для KIND сенсоров: если не определён, используем canonicalKind
    if (!kind) {
      kind = canonicalKind(type).slice(0, 12) || type.slice(0, 12).toUpperCase();
    }
    
    // Зачем: для leakage_sensor берём канал из bind .../di/<n>.
    expectedCh = (bindInfo.kind === 'di') ? localCh : (startSpecCode?.ch ?? startSpecTitle?.ch ?? null);
    expectedCh = Number.isFinite(expectedCh) ? expectedCh : null;
    
    // Fallback для CH сенсоров: если не определён, используем localCh из bind
    if (!Number.isFinite(expectedCh) && Number.isFinite(localCh)) {
      expectedCh = localCh;
    }
    
    expectedPrefix = buildExpectedSensorPrefix({ room, kind, ch: expectedCh });
  } else {
    // KIND: либо явно из префикса, либо по текущим названиям.
    kind = startSpecCode?.kind || startSpecTitle?.kind || inferKindFromNames({ type, code, title });
    
    // Fallback для KIND: если не определён, используем KIND_BY_TYPE или canonicalKind
    if (!kind) {
      kind = KIND_BY_TYPE.get(type) || canonicalKind(type).slice(0, 12);
      // Если всё ещё null, используем первые буквы типа (макс 12 символов)
      if (!kind && type) {
        kind = canonicalKind(type).slice(0, 12) || type.slice(0, 12).toUpperCase();
      }
    }

    // ACT: выводим из bind (dim/do/group). Номер экземпляра актуатора в code НЕ кодируем.
    if (bindInfo.kind === 'dim' || bindInfo.kind === 'do') {
      const actBase = bindInfo.actBase; // D/R
      act = actBase;
    } else if (bindInfo.kind === 'group') {
      act = bindInfo.actBase; // R (режим group)
    } else if (startSpecCode?.act) {
      act = startSpecCode.act;
    } else if (startSpecTitle?.act) {
      act = startSpecTitle.act;
    }

    // CH: для dim/do/group — сквозной, поэтому учим маппинг local->global из текущих code.
    const mapKey =
      (Number.isFinite(room) && bindInfo.baseId && Number.isFinite(localCh))
        ? `${room}|${bindInfo.kind}|${bindInfo.baseId}|${localCh}`
        : null;
    const mapped = mapKey ? localToGlobalMap.get(mapKey) : null;
    expectedCh = Number.isFinite(mapped) ? mapped : (startSpecCode?.ch ?? startSpecTitle?.ch ?? null);
    expectedCh = Number.isFinite(expectedCh) ? expectedCh : null;

    // Fallback для ACT: если не определён, пытаемся определить по типу устройства
    if (!act) {
      // Для штор используем 'R'
      if (kind === 'C') {
        act = 'R';
      } else if (bindInfo.kind === 'dim' || bindInfo.kind === 'do') {
        // Если bind dim/do, но actBase не определён, используем дефолтное значение
        act = bindInfo.kind === 'dim' ? 'D' : 'R';
      } else if (bindInfo.kind === 'mono' || bindInfo.kind === 'stereo') {
        act = 'A';
      } else if (bindInfo.kind === 'modbus') {
        act = 'M';
      } else if (bindInfo.kind === 'ao') {
        act = 'AO';
      } else {
        // Дефолтное значение для потребителей
        act = 'R';
      }
    }

    // Fallback для CH: если не определён, используем localCh из bind
    if (!Number.isFinite(expectedCh) && Number.isFinite(localCh)) {
      expectedCh = localCh;
    }

    act = act ? canonicalizeMachineText(act).replace(/[^A-Z]/g, '').slice(0, 2) : null;
    expectedPrefix = buildExpectedPrefix({ room, act, kind, ch: expectedCh });
  }

  // Зачем: ожидаемый code = ожидаемый префикс + (по возможности) текущий "хвост" (site) без ломания парсинга.
  let site = '';
  const specPrefixRe4 = /^\s*\d{1,3}\.[A-Z][A-Z0-9]{0,2}\.[A-Z0-9]{1,12}\.\d{1,3}\s+(.+)\s*$/;
  const specPrefixRe3 = /^\s*\d{1,3}\.[A-Z0-9]{1,12}\.\d{1,3}\s+(.+)\s*$/;
  const siteFromCode = code.match(specPrefixRe4) || code.match(specPrefixRe3);
  if (siteFromCode && siteFromCode[1]) {
    site = normalizeText(siteFromCode[1]);
  } else if (code && !/[0-9]+\.[A-Z]\./.test(code) && !code.includes('.')) {
    // Зачем: если code просто "Лоджия", используем это как site-кандидат.
    site = code;
  }

  const expectedCode = expectedPrefix ? `${expectedPrefix}${site ? ` ${site}` : ''}` : null;

  const hasCyrInCode = hasCyrillic(code);
  const hasCyrInTitle = hasCyrillic(title);
  return {
    code, title, type, bind,
    room,
    act,
    kind,
    ch: expectedCh,
    localCh,
    expectedPrefix, expectedCode,
    foundSpecStart: startSpecCode?.prefix || null,
    foundSpecTitleStart: startSpecTitle?.prefix || null,
    bindKind: bindInfo.kind,
    bindBaseId: bindInfo.baseId,
    hasCyrInCode, hasCyrInTitle,
    isSensor,
  };
}

function classify({ currentCode, currentTitle, expectedPrefix }) {
  const codeRaw = normalizeText(currentCode);
  const titleRaw = normalizeText(currentTitle);
  const code = canonicalizeMachineText(codeRaw);
  const title = canonicalizeMachineText(titleRaw);
  if (!expectedPrefix) return { level: 'red', icon: '🔴', reason: 'не удалось вычислить префикс' };

  const parts = expectedPrefix.split('.');
  const compactExpected =
    parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}${parts[3]}` :
    parts.length === 3 ? `${parts[0]}.${parts[1]}${parts[2]}` :
    null;

  if (code.startsWith(expectedPrefix)) {
    // Зачем: зелёный — только если префикс в начале и в каноническом виде (без кириллицы/омографов).
    if (codeRaw.startsWith(expectedPrefix) && !hasCyrillic(codeRaw.slice(0, expectedPrefix.length + 2))) {
      return { level: 'green', icon: '🟢', reason: 'code начинается с префикса (канон)' };
    }
    return { level: 'yellow', icon: '🟡', reason: 'префикс в начале, но не канон (кириллица/регистр/символы)' };
  }
  // Легаси: слитый KIND+CH (например 5.R2.C3 вместо 5.R2.C.3)
  if (compactExpected && code.startsWith(compactExpected)) {
    return { level: 'yellow', icon: '🟡', reason: 'префикс в начале, но легаси-формат (KIND+CH слиты)' };
  }
  if (code.includes(expectedPrefix) || title.includes(expectedPrefix)) {
    return { level: 'yellow', icon: '🟡', reason: 'префикс найден не в начале code или в title' };
  }
  if (compactExpected && (code.includes(compactExpected) || title.includes(compactExpected))) {
    return { level: 'yellow', icon: '🟡', reason: 'префикс найден, но легаси-формат (KIND+CH слиты)' };
  }
  return { level: 'red', icon: '🔴', reason: 'префикс не найден' };
}

function padRight(s, n) {
  const str = safeStr(s);
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

function shortId(id) {
  const s = safeStr(id);
  if (s.length <= 10) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function sendJson(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function connect(wsUrl, timeoutMs) {
  // Зачем: единая точка подключения с таймаутом.
  const ws = new WebSocket(wsUrl, PROTOCOL);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('таймаут подключения')), timeoutMs);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
  return ws;
}

async function fetchAllState(ws, timeoutMs) {
  // Зачем: list -> get батчами, собираем payload по ACTION_SET.
  const ids = [];
  const payloadById = new Map();

  let listReceived = false;
  let pending = 0;
  let finished = false;

  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('таймаут получения данных')), timeoutMs);

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      const type = safeStr(msg.type).toLowerCase();
      if (!listReceived && type === 'list' && Array.isArray(msg.state)) {
        listReceived = true;
        for (const pair of msg.state) {
          const id = Array.isArray(pair) ? pair[0] : null;
          if (id) ids.push(id);
        }

        // Запрашиваем батчами, чтобы не слать гигантский get.
        for (let i = 0; i < ids.length; i += GET_BATCH_SIZE) {
          const batch = ids.slice(i, i + GET_BATCH_SIZE);
          pending += batch.length;
          sendJson(ws, { type: 'get', state: batch });
        }
        return;
      }

      const isActionSet = type === 'action_set';
      if (isActionSet && msg.id && msg.payload && typeof msg.payload === 'object') {
        if (!payloadById.has(msg.id)) {
          payloadById.set(msg.id, msg.payload);
          pending = Math.max(0, pending - 1);
        }

        if (listReceived && pending === 0 && !finished) {
          finished = true;
          clearTimeout(t);
          resolve({ ids, payloadById });
        }
      }
    });
  });

  sendJson(ws, { type: 'list' });
  return done;
}

function formatLine(row) {
  // Зачем: формат вывода фиксируем для отчётов: [иконка] [code | title] [по спецификации]
  const code = normalizeText(row.code) || '—';
  const title = normalizeText(row.title) || '—';
  const spec = row.expectedCode || row.expectedPrefix || '—';
  return `${row.icon} ${code} | ${title} ${spec}`;
}

async function main() {
  const opts = parseArgs();
  if (opts.help) { usage(); process.exit(0); }

  if (!opts.daemon) {
    console.error('Ошибка: требуется --daemon <uuid>');
    usage();
    process.exit(2);
  }

  // Зачем: подключаемся только через внешний шлюз wss:// (прямые ws:// и localhost запрещены).
  const providedGate = normalizeText(opts.gate || DEFAULT_GATE);
  if (!/^wss:\/\//i.test(providedGate) || /localhost|127\.0\.0\.1/.test(providedGate)) {
    console.error('Ошибка: подключение разрешено только через внешний шлюз вида wss://<host>. Укажи корректный --gate.');
    process.exit(2);
  }
  const wsUrl = `${providedGate.replace(/\/$/, '')}/${opts.daemon}`;
  const ws = await connect(wsUrl, Math.min(7000, opts.timeout));

  try {
    const { payloadById } = await fetchAllState(ws, opts.timeout);
    const rows = [];

    // --- 0) ROOM из type=site ---------------------------------------------------------------
    // Зачем: ROOM задаётся в объектах type=site (site.code = номер комнаты), а внутри лежат массивы UUID устройств.
    const roomById = new Map(); // deviceId -> roomNumber
    const roomNameByRoom = new Map(); // roomNumber -> roomTitle (из site.title)
    for (const [, p] of payloadById.entries()) {
      if (!p || typeof p !== 'object') continue;
      if (String(p.type || '').toLowerCase() !== 'site') continue;
      const room = Number(p.code);
      if (!Number.isFinite(room)) continue;
      const roomTitle = normalizeText(p.title) || '';
      if (roomTitle) roomNameByRoom.set(room, roomTitle);
      for (const [, v] of Object.entries(p)) {
        if (!Array.isArray(v)) continue;
        for (const maybeId of v) {
          if (typeof maybeId === 'string' && maybeId) roomById.set(maybeId, room);
        }
      }
    }

    // --- 0.1) Сквозной CH: учим mapping bind(local) -> CH(global) ---------------------------
    // Зачем: в коде CH может быть сквозным, а bind содержит локальный номер (dim/do/group).
    const localToGlobalMap = new Map(); // key `${room}|${bindKind}|${baseId}|${local}` -> globalCh
    const mappingConflicts = []; // [{ key, prev, next, examples[] }]
    for (const [id, payload] of payloadById.entries()) {
      if (!isValidatedPayload(payload) || isSensorPayload(payload)) continue;
      const code = normalizeText(payload.code);
      const title = normalizeText(payload.title);
      const start = findSpecAtStart(code) || findSpecAtStart(title);
      const globalCh = start?.ch;
      const room =
        start?.room ??
        extractRoomFromCodeStart(code) ??
        roomById.get(id) ??
        extractRoomFromText(title);

      const bindInfo = parseBind(payload.bind);
      if (!Number.isFinite(room) || !Number.isFinite(globalCh)) continue;
      if (!bindInfo.baseId || !Number.isFinite(bindInfo.ch)) continue;
      if (!(bindInfo.kind === 'dim' || bindInfo.kind === 'do' || bindInfo.kind === 'group' || bindInfo.kind === 'mono' || bindInfo.kind === 'stereo' || bindInfo.kind === 'modbus' || bindInfo.kind === 'ao')) continue;

      const key = `${room}|${bindInfo.kind}|${bindInfo.baseId}|${bindInfo.ch}`;
      const prev = localToGlobalMap.get(key);
      if (prev !== undefined && prev !== globalCh) {
        mappingConflicts.push({
          key,
          prev,
          next: globalCh,
          examples: [
            `${id}: code="${code}" title="${title}" bind="${normalizeText(payload.bind)}"`,
          ],
        });
        continue;
      }
      localToGlobalMap.set(key, globalCh);
    }

    for (const [id, payload] of payloadById.entries()) {
      if (!isValidatedPayload(payload)) continue;

      const exp = computeExpected({ id, payload, roomById, localToGlobalMap });
      const verdict = classify({ currentCode: exp.code, currentTitle: exp.title, expectedPrefix: exp.expectedPrefix });
      const roomName = Number.isFinite(exp.room) ? (roomNameByRoom.get(exp.room) || null) : null;

      rows.push({
        id,
        type: exp.type,
        bind: exp.bind,
        code: exp.code || '—',
        title: exp.title || '—',
        room: exp.room ?? null,
        roomName,
        act: exp.act ?? null,
        kind: exp.kind ?? null,
        ch: exp.ch ?? null,
        localCh: exp.localCh ?? null,
        expectedPrefix: exp.expectedPrefix,
        expectedCode: exp.expectedCode,
        foundSpecStart: exp.foundSpecStart,
        foundSpecTitleStart: exp.foundSpecTitleStart,
        bindKind: exp.bindKind,
        bindBaseId: exp.bindBaseId,
        hasCyrInCode: exp.hasCyrInCode,
        isSensor: exp.isSensor,
        level: verdict.level,
        icon: verdict.icon,
        reason: verdict.reason,
      });
    }

    rows.sort((a, b) => {
      const order = { red: 0, yellow: 1, green: 2 };
      const byLevel = (order[a.level] ?? 9) - (order[b.level] ?? 9);
      if (byLevel !== 0) return byLevel;
      return safeStr(a.expectedPrefix).localeCompare(safeStr(b.expectedPrefix)) || safeStr(a.type).localeCompare(safeStr(b.type));
    });

    // --- 2) Агрегации для отчёта ------------------------------------------------------------
    const stats = { green: 0, yellow: 0, red: 0 };
    for (const r of rows) stats[r.level] = (stats[r.level] || 0) + 1;

    // KIND: сводка по типам (для "единого словаря KIND").
    const kindStatsByType = {}; // type -> { KIND: count }
    for (const r of rows) {
      const t = r.type || '—';
      const k = r.kind || '—';
      kindStatsByType[t] = kindStatsByType[t] || {};
      kindStatsByType[t][k] = (kindStatsByType[t][k] || 0) + 1;
    }

    // Проблемные bind: missing/unknown (и вообще всё, что не dim/do/group).
    const problemBinds = []; // [{ bind, kind, count, examples: [...] }]
    const bindAgg = new Map(); // key `${kind}::${bind}` -> { kind, bind, count, examples[] }
    for (const r of rows) {
      const kind = r.bindKind || 'unknown';
      const bind = normalizeText(r.bind) || '—';
      const isProblem = kind === 'missing' || kind === 'unknown';
      if (!isProblem) continue;
      const key = `${kind}::${bind}`;
      if (!bindAgg.has(key)) bindAgg.set(key, { kind, bind, count: 0, examples: [] });
      const it = bindAgg.get(key);
      it.count += 1;
      if (it.examples.length < 5) it.examples.push(`${normalizeText(r.code)} | ${normalizeText(r.title)}`);
    }
    for (const it of bindAgg.values()) problemBinds.push(it);
    problemBinds.sort((a, b) => b.count - a.count || String(a.kind).localeCompare(String(b.kind)) || String(a.bind).localeCompare(String(b.bind)));

    // Несостыковки bind ↔ code/title:
    // - code (в начале) задаёт один CH, а bind указывает другой
    // - актуально для legacy-кодов штор (C9 vs group/3) и для dim/do.
    const bindMismatches = []; // [{ bind, expectedPrefix, foundPrefix, count, examples }]
    const mismatchAgg = new Map(); // key `${bind}::${foundPrefix}::${expectedPrefix}`
    for (const r of rows) {
      const found = r.foundSpecStart; // может быть null
      if (!found || !r.expectedPrefix) continue;
      if (found === r.expectedPrefix) continue;
      // Упрощённо считаем mismatch, если обе строки "похожи на префиксы" и различаются.
      const key = `${normalizeText(r.bind)}::${found}::${r.expectedPrefix}`;
      if (!mismatchAgg.has(key)) mismatchAgg.set(key, { bind: normalizeText(r.bind), foundPrefix: found, expectedPrefix: r.expectedPrefix, count: 0, examples: [] });
      const it = mismatchAgg.get(key);
      it.count += 1;
      if (it.examples.length < 5) it.examples.push(`${normalizeText(r.code)} | ${normalizeText(r.title)}`);
    }
    for (const it of mismatchAgg.values()) bindMismatches.push(it);
    bindMismatches.sort((a, b) => b.count - a.count || String(a.bind).localeCompare(String(b.bind)));

    // Проблемные ROOM:
    // - не удалось извлечь ROOM
    // - ROOM есть, но code НЕ начинается с "<ROOM>." (цель: начало code должно содержать код по спецификации)
    const problemRooms = {
      missing: [],
      notAtStart: [],
    };
    for (const r of rows) {
      const room = r.room;
      const codeRaw = normalizeText(r.code);
      const canonCode = canonicalizeMachineText(codeRaw);
      if (!Number.isFinite(room)) {
        if (problemRooms.missing.length < 50) problemRooms.missing.push(`${r.icon} ${codeRaw} | ${normalizeText(r.title)} —`);
        continue;
      }
      const roomPrefix = `${room}.`;
      if (!canonCode.startsWith(roomPrefix) && problemRooms.notAtStart.length < 50) {
        problemRooms.notAtStart.push(`${r.icon} ${codeRaw} | ${normalizeText(r.title)} (ROOM=${room})`);
      }
    }

    // Коллизии: одинаковый expectedPrefix у нескольких потребителей.
    const collisions = []; // [{ prefix, count, items: [{code,title,bind}] }]
    const byPrefix = new Map();
    for (const r of rows) {
      if (!r.expectedPrefix) continue;
      const p = r.expectedPrefix;
      if (!byPrefix.has(p)) byPrefix.set(p, []);
      byPrefix.get(p).push(r);
    }
    for (const [prefix, list] of byPrefix.entries()) {
      if (list.length <= 1) continue;
      collisions.push({
        prefix,
        count: list.length,
        items: list.slice(0, 10).map((x) => ({
          code: normalizeText(x.code),
          title: normalizeText(x.title),
          bind: normalizeText(x.bind),
        })),
      });
    }
    collisions.sort((a, b) => b.count - a.count || String(a.prefix).localeCompare(String(b.prefix)));

    // Проблемные ROOM (сводка по номерам): где больше всего 🔴.
    const roomStats = {}; // room -> { green,yellow,red,total }
    for (const r of rows) {
      const key = Number.isFinite(r.room) ? String(r.room) : '—';
      roomStats[key] = roomStats[key] || { green: 0, yellow: 0, red: 0, total: 0 };
      roomStats[key][r.level] = (roomStats[key][r.level] || 0) + 1;
      roomStats[key].total += 1;
    }

    if (opts.json) {
      console.log(JSON.stringify({
        ws: wsUrl,
        daemon: opts.daemon,
        total: rows.length,
        stats,
        kindStatsByType,
        mappingConflicts,
        problemBinds,
        bindMismatches,
        problemRooms,
        roomStats,
        collisions,
        rows,
      }, null, 2));
      return;
    }

    console.log(`WS: ${wsUrl}`);
    console.log(`daemon: ${opts.daemon}`);
    console.log(`Потребителей: ${rows.length}`);
    console.log(`Итого: 🟢 ${stats.green} 🟡 ${stats.yellow} 🔴 ${stats.red}`);
    console.log('Формат: [иконка] [code | title] [по спецификации]');
    for (const r of rows) {
      console.log(formatLine(r));
    }

    // --- 3) Дополнительные секции -----------------------------------------------------------
    console.log('');
    console.log('Проблемные bind (missing/unknown):');
    if (problemBinds.length === 0) console.log('—');
    for (const b of problemBinds.slice(0, 50)) {
      console.log(`- ${b.kind} bind="${b.bind}" count=${b.count} examples=${JSON.stringify(b.examples)}`);
    }

    console.log('');
    console.log('Несостыковки bind ↔ code (префикс в начале code != ожидаемому):');
    if (bindMismatches.length === 0) console.log('—');
    for (const m of bindMismatches.slice(0, 50)) {
      console.log(`- bind="${m.bind}" found="${m.foundPrefix}" expected="${m.expectedPrefix}" count=${m.count} examples=${JSON.stringify(m.examples)}`);
    }

    console.log('');
    console.log('Проблемные ROOM:');
    console.log(`- missing ROOM: ${problemRooms.missing.length}`);
    for (const line of problemRooms.missing.slice(0, 20)) console.log(`  ${line}`);
    console.log(`- ROOM не в начале code: ${problemRooms.notAtStart.length}`);
    for (const line of problemRooms.notAtStart.slice(0, 20)) console.log(`  ${line}`);

    // Сводка по проблемным ROOM (топ по 🔴)
    console.log('Топ ROOM по 🔴:');
    const roomTop = Object.entries(roomStats)
      .filter(([k]) => k !== '—')
      .sort((a, b) => (b[1].red - a[1].red) || (b[1].total - a[1].total) || a[0].localeCompare(b[0]))
      .slice(0, 15);
    if (roomTop.length === 0) console.log('—');
    for (const [room, s] of roomTop) {
      console.log(`  ROOM=${room}: total=${s.total} 🟢${s.green} 🟡${s.yellow} 🔴${s.red}`);
    }

    console.log('');
    console.log('Коллизии expectedPrefix (ROOM.ACT.KIND.CH):');
    if (collisions.length === 0) console.log('—');
    for (const c of collisions.slice(0, 50)) {
      console.log(`- ${c.prefix} x${c.count} examples=${JSON.stringify(c.items)}`);
    }
  } finally {
    try { ws.close(); } catch {}
  }
}

main().catch((e) => {
  // Зачем: AggregateError часто скрывает реальные причины (например ECONNREFUSED/ENOTFOUND).
  if (e && e.name === 'AggregateError' && Array.isArray(e.errors)) {
    console.error('Ошибка: не удалось подключиться к WebSocket (AggregateError). Причины:');
    for (const inner of e.errors) {
      const msg = inner && inner.message ? inner.message : String(inner);
      console.error(`- ${msg}`);
    }
    console.error(`Подсказка: используем только внешний шлюз. Укажи --daemon <uuid> и при необходимости --gate. По умолчанию gate: ${DEFAULT_GATE}`);
    process.exit(1);
    return;
  }

  console.error(`Ошибка: ${e && e.message ? e.message : String(e)}`);
  console.error(`Подсказка: используем только внешний шлюз. Укажи --daemon <uuid> и при необходимости --gate. По умолчанию gate: ${DEFAULT_GATE}`);
  process.exit(1);
});


