const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureLoggerPid } = require('../../src/logging/event-meta');

test('ensureLoggerPid: не трогает не-объекты', () => {
  assert.equal(ensureLoggerPid(null, 123), null);
  assert.equal(ensureLoggerPid(undefined, 123), undefined);
  assert.equal(ensureLoggerPid('x', 123), 'x');
  assert.equal(ensureLoggerPid(1, 123), 1);
});

test('ensureLoggerPid: добавляет logger_pid если его нет', () => {
  const input = { id: 'a', logger_pid: null };
  const out = ensureLoggerPid(input, 777);
  assert.notEqual(out, input); // Зачем: не мутируем исходный объект
  assert.equal(out.logger_pid, 777);
  assert.equal(input.logger_pid, null);
});

test('ensureLoggerPid: не перетирает logger_pid если он задан', () => {
  const input = { id: 'a', logger_pid: 42 };
  const out = ensureLoggerPid(input, 777);
  assert.equal(out, input); // Зачем: без необходимости не создаём копии
  assert.equal(out.logger_pid, 42);
});

test('ensureLoggerPid: не перетирает logger_pid=0', () => {
  const input = { id: 'a', logger_pid: 0 };
  const out = ensureLoggerPid(input, 777);
  assert.equal(out.logger_pid, 0);
});

