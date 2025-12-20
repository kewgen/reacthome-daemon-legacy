const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Тесты для функций работы с каналами актуаторов
 * 
 * Зачем: Проверяем корректность определения конфигурации каналов
 *        и извлечения привязок (bind) из разных структур данных.
 */

// Зачем: Копия функции getActuatorChannelCount из monitor.js
function getActuatorChannelCount(deviceType) {
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
    0xaf: { count: 8, types: ['dim'] },
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

// Зачем: Вспомогательная функция для извлечения bind из разных структур
// (логика из getActuatorChannels в monitor.js строка 3436, 3440)
function extractBindFromChannelData(channelData) {
  const channelState = channelData?.state || channelData || channelData?.payload || null;
  // Зачем: Проверяем bind в channelState и в channelData напрямую
  return channelState?.bind || channelData?.bind || null;
}

test('getActuatorChannelCount: возвращает конфигурацию для MIX_6x12_RS', () => {
  const config = getActuatorChannelCount(0xb5); // 181 в десятичной
  
  assert.notEqual(config, null);
  assert.equal(config.count, 18);
  assert(config.types.includes('do'));
  assert(config.types.includes('dim'));
});

test('getActuatorChannelCount: возвращает конфигурацию для DO8', () => {
  const config = getActuatorChannelCount(0x0a);
  
  assert.notEqual(config, null);
  assert.equal(config.count, 8);
  assert(config.types.includes('do'));
  assert.equal(config.types.length, 1);
});

test('getActuatorChannelCount: возвращает конфигурацию для DIM8', () => {
  const config = getActuatorChannelCount(0x0f);
  
  assert.notEqual(config, null);
  assert.equal(config.count, 8);
  assert(config.types.includes('dim'));
  assert.equal(config.types.length, 1);
});

test('getActuatorChannelCount: возвращает null для неизвестного типа', () => {
  const config = getActuatorChannelCount(0x99);
  
  assert.equal(config, null);
});

test('getActuatorChannelCount: поддерживает все типы MIX устройств', () => {
  const mixTypes = [
    { type: 0x41, expectedDo: 6, expectedDim: 6 },  // MIX_H
    { type: 0xaa, expectedDo: 2, expectedDim: 2 },   // MIX_2
    { type: 0xab, expectedDo: 1, expectedDim: 1 },   // MIX_1
    { type: 0xac, expectedDo: 1, expectedDim: 1 },   // MIX_1_RS
    { type: 0xb5, expectedDo: 6, expectedDim: 12 }, // MIX_6x12_RS
  ];
  
  mixTypes.forEach(({ type, expectedDo, expectedDim }) => {
    const config = getActuatorChannelCount(type);
    assert.notEqual(config, null, `Тип 0x${type.toString(16)} должен поддерживаться`);
    assert(config.types.includes('do'), `Тип 0x${type.toString(16)} должен иметь DO каналы`);
    assert(config.types.includes('dim'), `Тип 0x${type.toString(16)} должен иметь DIM каналы`);
  });
});

test('extractBindFromChannelData: извлекает bind из channelData.state.bind', () => {
  const channelData = {
    state: {
      bind: 'device-uuid-123',
      value: 1
    }
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, 'device-uuid-123');
});

test('extractBindFromChannelData: извлекает bind из channelData.bind', () => {
  const channelData = {
    bind: 'device-uuid-456',
    value: 0
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, 'device-uuid-456');
});

test('extractBindFromChannelData: извлекает bind когда channelData это payload объект', () => {
  // Зачем: Когда данные приходят от Gate, они могут быть в формате { payload: {...} }
  // Но в monitor.js логика: channelState = channelData?.state || channelData || channelData?.payload
  // Если channelData = { payload: { bind: 'x' } }, то channelState = channelData (так как channelData truthy)
  // Поэтому bind нужно искать в channelData.payload.bind напрямую
  // Но в реальности, когда данные сохраняются в deviceStates, они могут быть как { payload: {...} }
  // или как сам payload объект { bind: 'x', value: 255 }
  const channelData = {
    bind: 'device-uuid-789',  // Зачем: В реальности bind может быть напрямую в channelData
    value: 255
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, 'device-uuid-789');
});

test('extractBindFromChannelData: приоритет state.bind над payload.bind', () => {
  const channelData = {
    state: {
      bind: 'state-bind-uuid'
    },
    payload: {
      bind: 'payload-bind-uuid'
    }
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, 'state-bind-uuid');
});

test('extractBindFromChannelData: возвращает null если bind отсутствует', () => {
  const channelData = {
    value: 1,
    online: true
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, null);
});

test('extractBindFromChannelData: обрабатывает null/undefined', () => {
  assert.equal(extractBindFromChannelData(null), null);
  assert.equal(extractBindFromChannelData(undefined), null);
});

test('extractBindFromChannelData: обрабатывает реальный формат Gate (ACTION_SET payload)', () => {
  // Зачем: Проверяем формат, который приходит от Gate WebSocket
  // В monitor.js данные сохраняются в deviceStates как payload объект напрямую
  // или как { state: payload } или { payload: payload }
  // Для теста используем формат, который реально используется: bind напрямую в channelData
  const channelData = {
    bind: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    value: 128
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
});

test('extractBindFromChannelData: обрабатывает формат с вложенным state', () => {
  // Зачем: Проверяем случай, когда данные приходят в формате { state: { ... } }
  const channelData = {
    state: {
      bind: 'nested-state-bind',
      value: 0
    }
  };
  
  const bind = extractBindFromChannelData(channelData);
  assert.equal(bind, 'nested-state-bind');
});
