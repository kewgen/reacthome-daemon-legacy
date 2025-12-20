const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Тесты для протокола Gate WebSocket и функций резолва актуаторов
 * 
 * Зачем: Проверяем корректность работы с Gate WebSocket протоколом,
 *        включая парсинг сообщений с UUID префиксом и без него.
 */

// Зачем: Импортируем функции из monitor.js для тестирования
// ВАЖНО: Эти функции должны быть экспортированы или вынесены в отдельный модуль
// Пока используем копии для тестирования логики

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Зачем: Копия функции parseGateMaybePrefixedJson из monitor.js
function parseGateMaybePrefixedJson(dataString) {
  try {
    return JSON.parse(dataString);
  } catch (_) {
    // Пробуем prefixed формат: первые 36 символов UUID, дальше JSON
    if (typeof dataString === 'string' && dataString.length >= 36) {
      const possibleSessionId = dataString.substring(0, 36);
      if (UUID_REGEX.test(possibleSessionId)) {
        const messageStr = dataString.substring(36);
        try {
          return JSON.parse(messageStr);
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }
}

// Зачем: Копия функции isGateWebSocketUri из monitor.js
function isGateWebSocketUri(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'wss:' && u.hostname === 'gate.reacthome.net';
  } catch (_) {
    return false;
  }
}

test('parseGateMaybePrefixedJson: парсит обычный JSON без префикса', () => {
  const plainJson = JSON.stringify({ type: 'ACTION_SET', id: 'test-id', payload: { value: 1 } });
  const result = parseGateMaybePrefixedJson(plainJson);
  
  assert.equal(result.type, 'ACTION_SET');
  assert.equal(result.id, 'test-id');
  assert.equal(result.payload.value, 1);
});

test('parseGateMaybePrefixedJson: парсит JSON с UUID префиксом', () => {
  const uuid = 'd31775ae-19e8-40c9-81df-d6d672379563';
  const message = { type: 'ACTION_SET', id: 'test-id', payload: { value: 1 } };
  const prefixedJson = uuid + JSON.stringify(message);
  
  const result = parseGateMaybePrefixedJson(prefixedJson);
  
  assert.equal(result.type, 'ACTION_SET');
  assert.equal(result.id, 'test-id');
  assert.equal(result.payload.value, 1);
});

test('parseGateMaybePrefixedJson: игнорирует невалидный UUID префикс', () => {
  const invalidPrefix = 'not-a-valid-uuid-36-chars-long!';
  const message = { type: 'ACTION_SET', id: 'test-id' };
  const invalidPrefixed = invalidPrefix + JSON.stringify(message);
  
  const result = parseGateMaybePrefixedJson(invalidPrefixed);
  
  // Должен вернуть null, так как префикс не валидный UUID
  assert.equal(result, null);
});

test('parseGateMaybePrefixedJson: обрабатывает короткие строки', () => {
  const shortString = '{"type":"test"}';
  const result = parseGateMaybePrefixedJson(shortString);
  
  assert.equal(result.type, 'test');
});

test('parseGateMaybePrefixedJson: возвращает null для невалидного JSON', () => {
  const invalidJson = 'not a json string';
  const result = parseGateMaybePrefixedJson(invalidJson);
  
  assert.equal(result, null);
});

test('parseGateMaybePrefixedJson: обрабатывает реальный формат Gate (LIST)', () => {
  const uuid = 'd31775ae-19e8-40c9-81df-d6d672379563';
  const listMessage = { type: 'LIST', state: [['device1'], ['device2']] };
  const prefixed = uuid + JSON.stringify(listMessage);
  
  const result = parseGateMaybePrefixedJson(prefixed);
  
  assert.equal(result.type, 'LIST');
  assert(Array.isArray(result.state));
  assert.equal(result.state.length, 2);
});

test('parseGateMaybePrefixedJson: обрабатывает реальный формат Gate (ACTION_SET)', () => {
  const uuid = 'd31775ae-19e8-40c9-81df-d6d672379563';
  const actionSet = {
    type: 'ACTION_SET',
    id: 'ec:c6:04:79:77:34',
    payload: { type: 181, value: 0, bind: 'some-uuid-here' }
  };
  const prefixed = uuid + JSON.stringify(actionSet);
  
  const result = parseGateMaybePrefixedJson(prefixed);
  
  assert.equal(result.type, 'ACTION_SET');
  assert.equal(result.id, 'ec:c6:04:79:77:34');
  assert.equal(result.payload.type, 181);
  assert.equal(result.payload.bind, 'some-uuid-here');
});

test('isGateWebSocketUri: определяет Gate URI', () => {
  assert.equal(isGateWebSocketUri('wss://gate.reacthome.net/d31775ae-19e8-40c9-81df-d6d672379563'), true);
  assert.equal(isGateWebSocketUri('wss://gate.reacthome.net/test'), true);
});

test('isGateWebSocketUri: отклоняет не-Gate URI', () => {
  assert.equal(isGateWebSocketUri('ws://localhost:3000'), false);
  assert.equal(isGateWebSocketUri('wss://other-host.net/path'), false);
  assert.equal(isGateWebSocketUri('http://gate.reacthome.net/path'), false);
});

test('isGateWebSocketUri: обрабатывает невалидные URI', () => {
  assert.equal(isGateWebSocketUri('not-a-uri'), false);
  assert.equal(isGateWebSocketUri(''), false);
});
