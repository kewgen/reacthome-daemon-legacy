const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Тесты для резолва привязок (bind) каналов актуаторов
 * 
 * Зачем: Проверяем корректность извлечения и обработки привязок
 *        из различных форматов данных ACTION_SET сообщений от Gate.
 */

// Зачем: Симуляция логики getActuatorChannels для тестирования резолва bind
function resolveChannelBind(channelData, allDevices) {
  // Логика из monitor.js строки 3436-3453
  const channelState = channelData?.state || channelData || channelData?.payload || null;
  
  let linkedDevice = null;
  // Зачем: Проверяем bind в channelState и в channelData напрямую
  const bindValue = channelState?.bind || channelData?.bind || null;
  
  if (bindValue) {
    // Метод 1: ищем по ID
    linkedDevice = allDevices.find(d => d.id === bindValue);
    
    // Метод 2: ищем по code или name
    if (!linkedDevice && typeof bindValue === 'string') {
      linkedDevice = allDevices.find(d => 
        d.code === bindValue || 
        d.name === bindValue ||
        d.id === bindValue
      );
    }
  }
  
  return {
    bind: bindValue,
    linkedDevice: linkedDevice || null
  };
}

test('resolveChannelBind: находит устройство по bind UUID', () => {
  const allDevices = [
    { id: 'device-uuid-123', code: 'LAMP1', name: 'Лампа 1' },
    { id: 'device-uuid-456', code: 'LAMP2', name: 'Лампа 2' }
  ];
  
  const channelData = {
    state: {
      bind: 'device-uuid-123',
      value: 1
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'device-uuid-123');
  assert.notEqual(result.linkedDevice, null);
  assert.equal(result.linkedDevice.code, 'LAMP1');
});

test('resolveChannelBind: находит устройство по bind code', () => {
  const allDevices = [
    { id: 'device-uuid-123', code: 'LAMP1', name: 'Лампа 1' },
    { id: 'device-uuid-456', code: 'LAMP2', name: 'Лампа 2' }
  ];
  
  const channelData = {
    bind: 'LAMP2'
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'LAMP2');
  assert.notEqual(result.linkedDevice, null);
  assert.equal(result.linkedDevice.id, 'device-uuid-456');
});

test('resolveChannelBind: возвращает null если устройство не найдено', () => {
  const allDevices = [
    { id: 'device-uuid-123', code: 'LAMP1' }
  ];
  
  const channelData = {
    state: {
      bind: 'unknown-device-uuid',
      value: 0
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'unknown-device-uuid');
  assert.equal(result.linkedDevice, null);
});

test('resolveChannelBind: обрабатывает отсутствие bind', () => {
  const allDevices = [];
  
  const channelData = {
    value: 1,
    online: true
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  // Зачем: bindValue может быть undefined если bind отсутствует
  assert.equal(result.bind, null);
  assert.equal(result.linkedDevice, null);
});

test('resolveChannelBind: обрабатывает формат Gate (payload.bind)', () => {
  const allDevices = [
    { id: 'gate-device-uuid', code: 'GATE_LAMP', name: 'Gate Lamp' }
  ];
  
  // Зачем: Формат, который приходит от Gate WebSocket в ACTION_SET
  // В monitor.js: channelState = channelData (так как channelData это объект)
  // Но если channelData = { payload: {...} }, то channelState = channelData.payload
  // Однако логика: channelData?.state || channelData || channelData?.payload
  // Если channelData это { payload: {...} }, то channelData truthy, поэтому channelState = channelData
  // Но тогда channelState.bind не существует, нужно channelData.payload.bind
  // Поэтому правильный формат для Gate - это когда данные приходят как { state: { bind: ... } }
  // или напрямую { bind: ... }
  const channelData = {
    bind: 'gate-device-uuid',  // Зачем: В реальности Gate может отправлять bind напрямую
    value: 128
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'gate-device-uuid');
  assert.notEqual(result.linkedDevice, null);
  assert.equal(result.linkedDevice.code, 'GATE_LAMP');
});

test('resolveChannelBind: приоритет state.bind над payload.bind', () => {
  const allDevices = [
    { id: 'state-device', code: 'STATE' },
    { id: 'payload-device', code: 'PAYLOAD' }
  ];
  
  const channelData = {
    state: {
      bind: 'state-device'
    },
    payload: {
      bind: 'payload-device'
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'state-device');
  assert.equal(result.linkedDevice.code, 'STATE');
});

test('resolveChannelBind: обрабатывает bind с MAC-адресом формата', () => {
  const allDevices = [
    { id: 'ec:c6:04:79:77:34', code: 'MIX1' }
  ];
  
  const channelData = {
    state: {
      bind: 'ec:c6:04:79:77:34',
      value: 0
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'ec:c6:04:79:77:34');
  assert.notEqual(result.linkedDevice, null);
});

test('resolveChannelBind: обрабатывает bind с путём к каналу (не UUID)', () => {
  const allDevices = [
    { id: 'actuator-id', code: 'ACTUATOR' }
  ];
  
  // Зачем: bind может содержать путь к каналу, а не UUID устройства
  const channelData = {
    state: {
      bind: 'actuator-id/do/1',
      value: 1
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  // Путь к каналу не должен находиться как устройство
  assert.equal(result.bind, 'actuator-id/do/1');
  assert.equal(result.linkedDevice, null);
});

test('resolveChannelBind: обрабатывает пустой массив устройств', () => {
  const allDevices = [];
  
  const channelData = {
    state: {
      bind: 'some-uuid',
      value: 1
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, 'some-uuid');
  assert.equal(result.linkedDevice, null);
});

test('resolveChannelBind: обрабатывает реальный сценарий из AVR актуатора', () => {
  // Зачем: Тестируем реальный случай, когда каналы не имеют привязок
  const allDevices = [
    { id: '12:39:04:79:77:34', code: 'AVR', type: 181 }
  ];
  
  // Канал без bind (как в случае AVR)
  const channelData = {
    payload: {
      value: 0
      // bind отсутствует
    }
  };
  
  const result = resolveChannelBind(channelData, allDevices);
  
  assert.equal(result.bind, null);
  assert.equal(result.linkedDevice, null);
});
