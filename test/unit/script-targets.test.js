const test = require('node:test');
const assert = require('node:assert/strict');

const { getScriptTargetDeviceIds } = require('../../src/logging/script-targets');

function makeState(objects) {
  return {
    get: (id) => objects[id]
  };
}

test('getScriptTargetDeviceIds: пусто если скрипт не найден/нет action[]', () => {
  const state = makeState({});
  assert.deepEqual(getScriptTargetDeviceIds(state, 'missing'), new Set());

  const state2 = makeState({ s: { type: 'script', action: null } });
  assert.deepEqual(getScriptTargetDeviceIds(state2, 's'), new Set());
});

test('getScriptTargetDeviceIds: собирает target из id/ref/target/payload.id/payload.target', () => {
  const state = makeState({
    s: { action: ['a1', 'a2'] },
    a1: { id: 'dev1', ref: 'dev2', target: 'dev3', payload: { id: 'dev4', target: 'dev5' } },
    a2: { payload: { id: 'dev6' } }
  });
  const out = getScriptTargetDeviceIds(state, 's');
  assert.equal(out.has('dev1'), true);
  assert.equal(out.has('dev2'), true);
  assert.equal(out.has('dev3'), true);
  assert.equal(out.has('dev4'), true);
  assert.equal(out.has('dev5'), true);
  assert.equal(out.has('dev6'), true);
});

test('getScriptTargetDeviceIds: собирает target из payload.payload.id (вложенный payload)', () => {
  const state = makeState({
    s1: { action: ['a1'] },
    a1: { payload: { type: 'ACTION_ON', payload: { id: 'dev1' } } },
    dev1: { type: 'light_220' }
  });

  const ids = getScriptTargetDeviceIds(state, 's1');
  assert.ok(ids.has('dev1'));
});

test('getScriptTargetDeviceIds: резолвит onTrue → вложенный скрипт → конечное устройство', () => {
  const consumer = 'consumer-1';
  const state = makeState({
    ez: { action: ['clock_test'] }, // "Ежеминутник"
    clock_test: { type: 'ACTION_CLOCK_TEST', payload: { onTrue: 'toggle' } },
    toggle: { action: ['on_action'] },
    on_action: { type: 'ACTION_ON', payload: { id: consumer } }
  });

  const out = getScriptTargetDeviceIds(state, 'ez');
  assert.equal(out.has(consumer), true);
  assert.equal(out.has('toggle'), false); // Зачем: скрипты не должны попадать как "устройства"
});

test('getScriptTargetDeviceIds: поддерживает site[] → устройства локации', () => {
  const state = makeState({
    s: { action: ['a1'] },
    a1: { site: ['site1'] },
    site1: { device: ['d1'], do: ['d2'], dim: ['d3'] }
  });
  const out = getScriptTargetDeviceIds(state, 's');
  assert.deepEqual(new Set(['d1', 'd2', 'd3']), out);
});

test('getScriptTargetDeviceIds: защита от циклов (script A -> onTrue B -> onTrue A)', () => {
  const state = makeState({
    A: { action: ['a'] },
    a: { payload: { onTrue: 'B' } },
    B: { action: ['b'] },
    b: { payload: { onTrue: 'A', id: 'devX' } }
  });
  const out = getScriptTargetDeviceIds(state, 'A');
  assert.equal(out.has('devX'), true);
});

