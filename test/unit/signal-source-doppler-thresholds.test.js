const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSignalSourceFromWs } = require('../../src/logging/signal-source');

test('signal-source: doppler thresholds use old→new crossing to select matched_trigger_scripts', () => {
  const baseId = '90:79:b7:8f:dc:90';
  const dopplerOnAny = '11111111-1111-1111-1111-111111111111';
  const onHigh = '33333333-3333-3333-3333-333333333333';
  const onLow = '44444444-4444-4444-4444-444444444444';

  const stateMap = new Map([
    [baseId, { onDoppler: dopplerOnAny, value: 90 }],
  ]);
  const deps = {
    state: { get: (k) => stateMap.get(k) },
    cache: new Map(),
    getDopplerHandle: () => ({ low: 10, high: 100, onHighThreshold: onHigh, onLowThreshold: onLow }),
    oldState: { value: 90 }, // Зачем: проверяем именно пересечение old→new.
  };

  // Пересечение high: 90 -> 120 (prev<=100 && next>100)
  const msgHigh = { type: 'ACTION_SET', id: baseId, payload: { value: 120, timestamp: Date.now() } };
  const sHigh = resolveSignalSourceFromWs(msgHigh, deps);
  assert.equal(sHigh.kind, 'sensor');
  assert.equal(sHigh.description, 'Измерение датчика (doppler)');
  assert.deepEqual(sHigh.linked.trigger_scripts.onClick.sort(), [dopplerOnAny, onHigh, onLow].sort());
  assert.deepEqual(sHigh.linked.matched_trigger_scripts, [onHigh]);
  assert.equal(sHigh.action.threshold_cross.kind, 'high');

  // Не пересечение (остались выше): 120 -> 130, matched должен уйти в base (onDoppler)
  const msgAbove = { type: 'ACTION_SET', id: baseId, payload: { value: 130, timestamp: Date.now() } };
  const sAbove = resolveSignalSourceFromWs(msgAbove, { ...deps, oldState: { value: 120 } });
  assert.deepEqual(sAbove.linked.matched_trigger_scripts, [dopplerOnAny]);
  assert.equal(sAbove.action.threshold_cross.kind, 'base');
});


