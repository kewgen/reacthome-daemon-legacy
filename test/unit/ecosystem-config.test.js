const test = require('node:test');
const assert = require('node:assert/strict');

test('ecosystem.config.js: logger env содержит обязательные переменные', () => {
  // Зачем: если запустить логгер без env (pm2 start напрямую), он уйдёт на localhost и выключит OpenSearch.
  const cfg = require('../../scripts/ecosystem.config');
  assert.ok(cfg && Array.isArray(cfg.apps), 'cfg.apps должен быть массивом');

  const loggerApp = cfg.apps.find(a => a && a.name === 'logger');
  assert.ok(loggerApp, 'должен существовать app с name=logger');
  assert.ok(loggerApp.env, 'logger.env должен существовать');

  assert.equal(loggerApp.env.OPENSEARCH_ENABLED, 'true');
  assert.ok(typeof loggerApp.env.OPENSEARCH_URL === 'string' && loggerApp.env.OPENSEARCH_URL.length > 0);

  assert.ok(typeof loggerApp.env.DAEMON_WS_URL === 'string' && loggerApp.env.DAEMON_WS_URL.length > 0);
  assert.equal(loggerApp.env.DAEMON_WS_URL.includes('localhost'), false, 'DAEMON_WS_URL не должен указывать на localhost');
});

