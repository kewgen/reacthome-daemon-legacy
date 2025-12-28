const { test } = require('node:test');
const assert = require('node:assert');

// Зачем: тест для проверки логики определения ACT для групп
// Проблема: для устройства с кодом "1.R.C.1 Младшая" предлагается "1.R2.C.1" вместо "1.R.C.1"

// Зачем: копируем необходимые функции и константы из скрипта для тестирования
const CYR_TO_LAT = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', П: 'P', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
  а: 'A', в: 'B', с: 'C', е: 'E', н: 'H', к: 'K', м: 'M', о: 'O', п: 'P', р: 'P', т: 'T', х: 'X', у: 'Y',
};

const SPEC_AT_START_CANON = /^\s*(\d{1,3})\.([A-Z][0-9]*)\.([A-Z0-9]{1,12})\.(\d{1,3})\b/;

function safeStr(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeText(s) {
  return safeStr(s).replace(/\s+/g, ' ').trim();
}

function canonicalizeMachineText(s) {
  const raw = normalizeText(s);
  let out = '';
  for (const ch of raw) out += (CYR_TO_LAT[ch] || ch);
  return out.toUpperCase();
}

function canonicalKind(kindRaw) {
  const k = canonicalizeMachineText(kindRaw).replace(/[^A-Z0-9]/g, '');
  if (k === 'TRACK') return 'TREK';
  if (k === 'MULTIROOM') return 'MR';
  if (k === 'VALVEHEATING') return 'VALVEH';
  if (k === 'VALVEWATER') return 'VALVEW';
  if (k === 'HFU') return 'WF';
  if (k === 'CA' || k === 'C') return 'C';
  if (k === 'SCREEN') return 'SCREEN';
  return k;
}

function findSpecAtStart(text) {
  const t = canonicalizeMachineText(text);
  let m = t.match(SPEC_AT_START_CANON);
  if (m) {
    const room = Number(m[1]);
    const act = canonicalizeMachineText(m[2]).replace(/[^A-Z0-9]/g, '');
    const kind = canonicalKind(m[3]);
    const ch = Number(m[4]);
    if (Number.isFinite(room) && Number.isFinite(ch) && act && kind) {
      return { room, act, kind, ch, prefix: `${room}.${act}.${kind}.${ch}`, source: 'canonical' };
    }
  }
  return null;
}

function extractActuatorGroupFromCode(deviceCode) {
  if (!deviceCode) return null;
  const canonCode = canonicalizeMachineText(deviceCode);
  const m = canonCode.match(/^\s*\d{1,3}\.([A-Z][0-9]*)\./);
  if (m && m[1]) {
    return m[1];
  }
  // Зачем: если код реле - это просто имя типа "R2" (без полного кода), извлекаем номер группы напрямую
  const simpleNameMatch = canonCode.match(/^\s*([A-Z][0-9]+)\s*$/);
  if (simpleNameMatch && simpleNameMatch[1]) {
    return simpleNameMatch[1];
  }
  return null;
}

function parseBind(bindRaw) {
  const bind = normalizeText(bindRaw);
  if (!bind) return { kind: 'missing', baseId: null, actBase: null, ch: null };

  const group = bind.match(/^(.*?)\/group\/(\d{1,3})\b/i);
  if (group) {
    const baseId = normalizeText(group[1]);
    const ch = Number(group[2]);
    return { kind: 'group', baseId, actBase: 'R', ch: Number.isFinite(ch) ? ch : null };
  }

  return { kind: 'missing', baseId: null, actBase: null, ch: null };
}

// Зачем: упрощённая версия computeExpected для тестирования логики ACT
function testComputeAct({ code, bind, payloadById }) {
  const startSpecCode = findSpecAtStart(code);
  const bindInfo = parseBind(bind);
  
  let act = null;

  // Зачем: копируем логику из computeExpected
  if (bindInfo.kind === 'group') {
    // Зачем: для групп всегда используем номер группы из кода устройства реле (например R2, R3)
    // Имя реле определяет номер группы в спецификации (например реле R2 → код 1.R2.C.1)
    if (bindInfo.baseId && payloadById) {
      const relayPayload = payloadById.get(bindInfo.baseId);
      if (relayPayload) {
        const relayCode = normalizeText(relayPayload.code);
        const actuatorGroup = extractActuatorGroupFromCode(relayCode);
        if (actuatorGroup) {
          act = actuatorGroup;
          console.log('  [TEST] Извлекаем ACT из реле:', act);
        } else {
          act = startSpecCode?.act || bindInfo.actBase;
          console.log('  [TEST] Fallback ACT (в реле нет номера группы):', act);
        }
      } else {
        act = startSpecCode?.act || bindInfo.actBase;
        console.log('  [TEST] Fallback ACT (реле не найдено):', act);
      }
    } else {
      act = startSpecCode?.act || bindInfo.actBase;
      console.log('  [TEST] Fallback ACT (нет baseId или payloadById):', act);
    }
  }

  return { act, startSpecCode, bindInfo };
}

test('computeExpected для группы: должен использовать номер группы из реле R2, даже если текущий код "1.R.C.1"', () => {
  console.log('\n=== Тест 1: Устройство с кодом "1.R.C.1 Младшая", реле R2 ===');
  
  // Зачем: создаём устройство с кодом "1.R.C.1 Младшая" и bind на группу
  const curtainCode = '1.R.C.1 Младшая';
  const curtainBind = 'relay-uuid-123/group/1';

  // Зачем: создаём устройство реле с кодом "1.R2.L.1" (имя реле R2)
  const relayPayload = {
    code: '1.R2.L.1',
    title: 'Реле',
  };

  const payloadById = new Map([
    ['relay-uuid-123', relayPayload],
  ]);

  console.log('Код устройства:', curtainCode);
  console.log('Bind:', curtainBind);
  console.log('Код реле:', relayPayload.code);

  const result = testComputeAct({
    code: curtainCode,
    bind: curtainBind,
    payloadById,
  });

  console.log('Результат:');
  console.log('  ACT:', result.act);
  console.log('  startSpecCode:', result.startSpecCode);
  console.log('  bindInfo:', result.bindInfo);

  // Зачем: проверяем, что ACT равен "R2" из реле, а не "R" из текущего кода
  assert.strictEqual(result.act, 'R2', `ACT должен быть "R2" из реле (имя реле R2), а не "R" из текущего кода. Получено: ${result.act}`);
  assert(result.startSpecCode, 'startSpecCode должен быть найден для кода "1.R.C.1 Младшая"');
  assert.strictEqual(result.startSpecCode.act, 'R', 'startSpecCode.act должен быть "R" (но мы используем R2 из реле)');
});

test('computeExpected для группы без ACT в текущем коде: должен извлекать из реле', () => {
  console.log('\n=== Тест 2: Устройство без ACT в коде ===');
  
  // Зачем: создаём устройство без ACT в коде и bind на группу
  const curtainCode = 'Шторы';
  const curtainBind = 'relay-uuid-123/group/1';

  // Зачем: создаём устройство реле с кодом "1.R2.L.1"
  const relayPayload = {
    code: '1.R2.L.1',
    title: 'Реле',
  };

  const payloadById = new Map([
    ['relay-uuid-123', relayPayload],
  ]);

  console.log('Код устройства:', curtainCode);
  console.log('Bind:', curtainBind);
  console.log('Код реле:', relayPayload.code);

  const result = testComputeAct({
    code: curtainCode,
    bind: curtainBind,
    payloadById,
  });

  console.log('Результат:');
  console.log('  ACT:', result.act);
  console.log('  startSpecCode:', result.startSpecCode);
  console.log('  bindInfo:', result.bindInfo);

  // Зачем: проверяем, что ACT равен "R2" из реле
  assert.strictEqual(result.act, 'R2', `ACT должен быть "R2" из реле, так как в текущем коде нет ACT. Получено: ${result.act}`);
  assert(!result.startSpecCode, 'startSpecCode не должен быть найден для кода "Шторы"');
});

test('computeExpected для группы с простым именем реле R2: должен извлекать номер группы', () => {
  console.log('\n=== Тест 3: Устройство с кодом "1.R.C.1", реле с простым именем R2 ===');
  
  // Зачем: создаём устройство с кодом "1.R.C.1 Младшая" и bind на группу
  const curtainCode = '1.R.C.1 Младшая';
  const curtainBind = 'relay-uuid-123/group/1';

  // Зачем: создаём устройство реле с простым именем "R2" (без полного кода)
  const relayPayload = {
    code: 'R2',
    title: 'Реле',
  };

  const payloadById = new Map([
    ['relay-uuid-123', relayPayload],
  ]);

  console.log('Код устройства:', curtainCode);
  console.log('Bind:', curtainBind);
  console.log('Код реле (простое имя):', relayPayload.code);

  const result = testComputeAct({
    code: curtainCode,
    bind: curtainBind,
    payloadById,
  });

  console.log('Результат:');
  console.log('  ACT:', result.act);
  console.log('  startSpecCode:', result.startSpecCode);
  console.log('  bindInfo:', result.bindInfo);

  // Зачем: проверяем, что ACT равен "R2" из реле, даже если код реле - это просто "R2"
  assert.strictEqual(result.act, 'R2', `ACT должен быть "R2" из реле (простое имя R2), а не "R" из текущего кода. Получено: ${result.act}`);
  assert(result.startSpecCode, 'startSpecCode должен быть найден для кода "1.R.C.1 Младшая"');
  assert.strictEqual(result.startSpecCode.act, 'R', 'startSpecCode.act должен быть "R" (но мы используем R2 из реле)');
});
