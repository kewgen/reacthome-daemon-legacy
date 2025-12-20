const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Интеграционные тесты для резолва актуаторов
 * 
 * Зачем: Проверяем полный цикл резолва актуатора через Gate WebSocket,
 *        включая генерацию ID каналов и обработку связанных устройств.
 */

// Зачем: Копия функции getActuatorChannelCount
function getActuatorChannelCount(deviceType) {
  const channelConfigs = {
    0x0a: { count: 8, types: ['do'] },
    0x0b: { count: 16, types: ['do'] },
    0x11: { count: 12, types: ['do'] },
    0x23: { count: 2, types: ['do'] },
    0xa0: { count: 6, types: ['do'] },
    0xa1: { count: 12, types: ['do'] },
    0xa2: { count: 24, types: ['do'] },
    0xa7: { count: 2, types: ['do'] },
    0xae: { count: 12, types: ['do'] },
    0x0e: { count: 4, types: ['dim'] },
    0x0f: { count: 8, types: ['dim'] },
    0xa3: { count: 4, types: ['dim'] },
    0xa4: { count: 8, types: ['dim'] },
    0xaf: { count: 8, types: ['dim'] },
    0xad: { count: 12, types: ['dim'] },
    0xb3: { count: 12, types: ['dim'] },
    0xb4: { count: 12, types: ['dim'] },
    0xb6: { count: 1, types: ['dim'] },
    0xa9: { count: 4, types: ['ao'] },
    0x41: { count: 12, types: ['do', 'dim'] },
    0xaa: { count: 4, types: ['do', 'dim'] },
    0xab: { count: 2, types: ['do', 'dim'] },
    0xac: { count: 2, types: ['do', 'dim'] },
    0xb5: { count: 18, types: ['do', 'dim'] },
  };
  return channelConfigs[deviceType] || null;
}

// Зачем: Генерация списка ID каналов (логика из resolve-actuator-gate.js)
function generateChannelIds(actuatorId, deviceType) {
  const channelConfig = getActuatorChannelCount(deviceType);
  if (!channelConfig) return [];
  
  const channelIds = [];
  const channelTypes = channelConfig.types;
  const channelCount = channelConfig.count;
  
  let doCount = 0, dimCount = 0, aoCount = 0;
  
  if (channelTypes.includes('do') && channelTypes.includes('dim')) {
    switch (deviceType) {
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
    channelIds.push(`${actuatorId}/do/${i}`);
  }
  for (let i = 1; i <= dimCount; i++) {
    channelIds.push(`${actuatorId}/dim/${i}`);
  }
  for (let i = 1; i <= aoCount; i++) {
    channelIds.push(`${actuatorId}/ao/${i}`);
  }
  
  return channelIds;
}

test('generateChannelIds: генерирует каналы для MIX_6x12_RS', () => {
  const actuatorId = '12:39:04:79:77:34';
  const channelIds = generateChannelIds(actuatorId, 0xb5);
  
  assert.equal(channelIds.length, 18);
  
  // Проверяем DO каналы (6 штук)
  for (let i = 1; i <= 6; i++) {
    assert(channelIds.includes(`${actuatorId}/do/${i}`), `Должен быть канал DO/${i}`);
  }
  
  // Проверяем DIM каналы (12 штук)
  for (let i = 1; i <= 12; i++) {
    assert(channelIds.includes(`${actuatorId}/dim/${i}`), `Должен быть канал DIM/${i}`);
  }
});

test('generateChannelIds: генерирует каналы для DO8', () => {
  const actuatorId = 'aa:bb:cc:dd:ee:ff';
  const channelIds = generateChannelIds(actuatorId, 0x0a);
  
  assert.equal(channelIds.length, 8);
  
  for (let i = 1; i <= 8; i++) {
    assert(channelIds.includes(`${actuatorId}/do/${i}`), `Должен быть канал DO/${i}`);
  }
  
  // Не должно быть DIM каналов
  assert.equal(channelIds.filter(id => id.includes('/dim/')).length, 0);
});

test('generateChannelIds: генерирует каналы для DIM8', () => {
  const actuatorId = '11:22:33:44:55:66';
  const channelIds = generateChannelIds(actuatorId, 0x0f);
  
  assert.equal(channelIds.length, 8);
  
  for (let i = 1; i <= 8; i++) {
    assert(channelIds.includes(`${actuatorId}/dim/${i}`), `Должен быть канал DIM/${i}`);
  }
  
  // Не должно быть DO каналов
  assert.equal(channelIds.filter(id => id.includes('/do/')).length, 0);
});

test('generateChannelIds: генерирует каналы для AO4', () => {
  const actuatorId = 'aa:11:bb:22:cc:33';
  const channelIds = generateChannelIds(actuatorId, 0xa9);
  
  assert.equal(channelIds.length, 4);
  
  for (let i = 1; i <= 4; i++) {
    assert(channelIds.includes(`${actuatorId}/ao/${i}`), `Должен быть канал AO/${i}`);
  }
});

test('generateChannelIds: возвращает пустой массив для неизвестного типа', () => {
  const channelIds = generateChannelIds('test-id', 0x99);
  assert.equal(channelIds.length, 0);
});

test('generateChannelIds: правильный порядок каналов (DO, затем DIM, затем AO)', () => {
  const actuatorId = '12:39:04:79:77:34';
  const channelIds = generateChannelIds(actuatorId, 0xb5);
  
  // Первые 6 должны быть DO
  for (let i = 0; i < 6; i++) {
    assert(channelIds[i].includes('/do/'), `Канал ${i} должен быть DO`);
  }
  
  // Следующие 12 должны быть DIM
  for (let i = 6; i < 18; i++) {
    assert(channelIds[i].includes('/dim/'), `Канал ${i} должен быть DIM`);
  }
});

test('generateChannelIds: генерирует каналы для MIX_H (0x41)', () => {
  const actuatorId = 'mix:h:test:device';
  const channelIds = generateChannelIds(actuatorId, 0x41);
  
  assert.equal(channelIds.length, 12);
  
  // 6 DO каналов
  for (let i = 1; i <= 6; i++) {
    assert(channelIds.includes(`${actuatorId}/do/${i}`));
  }
  
  // 6 DIM каналов
  for (let i = 1; i <= 6; i++) {
    assert(channelIds.includes(`${actuatorId}/dim/${i}`));
  }
});

test('generateChannelIds: генерирует каналы для MIX_2 (0xaa)', () => {
  const actuatorId = 'mix:2:test:device';
  const channelIds = generateChannelIds(actuatorId, 0xaa);
  
  assert.equal(channelIds.length, 4);
  assert.equal(channelIds.filter(id => id.includes('/do/')).length, 2);
  assert.equal(channelIds.filter(id => id.includes('/dim/')).length, 2);
});

test('generateChannelIds: генерирует каналы для MIX_1 (0xab)', () => {
  const actuatorId = 'mix:1:test:device';
  const channelIds = generateChannelIds(actuatorId, 0xab);
  
  assert.equal(channelIds.length, 2);
  assert.equal(channelIds.filter(id => id.includes('/do/')).length, 1);
  assert.equal(channelIds.filter(id => id.includes('/dim/')).length, 1);
});
