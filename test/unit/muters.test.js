const test = require('node:test');
const assert = require('node:assert');
const muters = require('../../src/logging/muters');

test('muters: RULE_DOPPLER_NOISE', async (t) => {
  const rule = muters.MUTE_RULES.find(r => r.id === 'doppler_noise');
  assert.ok(rule, 'Правило doppler_noise должно существовать');

  await t.test('мьютит значения ниже дефолтного порога (0)', () => {
    // При пороге 0 мьютироваться будут только отрицательные значения (если они придут)
    const event = { param: 'doppler', new: -5 };
    assert.strictEqual(rule.check(event), true, '-5 < 0 должно быть мьютировано');
  });

  await t.test('не мьютит значения выше или равные дефолтному порогу (0)', () => {
    const event1 = { param: 'doppler', new: 0 };
    const event2 = { param: 'doppler', new: 10 };
    assert.strictEqual(rule.check(event1), false, '0 >= 0 не должно быть мьютировано');
    assert.strictEqual(rule.check(event2), false, '10 > 0 не должно быть мьютировано');
  });

  await t.test('использует индивидуальный порог из метаданных устройства', () => {
    const event = { 
      param: 'doppler', 
      new: 25, 
      device: { doppler_threshold: 30 } 
    };
    assert.strictEqual(rule.check(event), true, '25 < 30 (индивидуальный порог) должно быть мьютировано');
  });

  await t.test('не мьютит другие параметры', () => {
    const event = { param: 'temperature', new: 10 };
    assert.strictEqual(rule.check(event), false, 'temperature не должна мьютироваться этим правилом');
  });

  await t.test('обрабатывает невалидные значения', () => {
    const event1 = { param: 'doppler', new: null };
    const event2 = { param: 'doppler', new: 'high' };
    assert.strictEqual(rule.check(event1), false, 'null не должен мьютироваться (не число)');
    assert.strictEqual(rule.check(event2), false, 'строка не должна мьютироваться (не число)');
  });
});

test('muters: shouldMuteOpenSearch', async (t) => {
  await t.test('возвращает true если правило сработало', () => {
    // Используем индивидуальный порог для теста срабатывания, т.к. дефолтный 0
    const event = { param: 'doppler', new: 5, device: { doppler_threshold: 10 } };
    assert.strictEqual(muters.shouldMuteOpenSearch(event), true);
  });

  await t.test('возвращает false если правило не сработало', () => {
    const event = { param: 'doppler', new: 50 };
    assert.strictEqual(muters.shouldMuteOpenSearch(event), false);
  });

  await t.test('не мьютит если правило выключено', () => {
    const event = { param: 'doppler', new: 5 };
    muters.setRuleEnabled('doppler_noise', false);
    try {
      assert.strictEqual(muters.shouldMuteOpenSearch(event), false, 'Должно вернуть false, так как правило выключено');
    } finally {
      muters.setRuleEnabled('doppler_noise', true); // возвращаем для других тестов
    }
  });
});
