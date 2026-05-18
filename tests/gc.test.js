#!/usr/bin/env node
// Standalone unit-тесты для src/gc.js — без jest, через native assert.
// Запуск: node tests/gc.test.js (или npm test после добавления script).
//
// Покрывает 4 фикса из INC-049 + safety-механизмы (Commit 2).

const assert = require('assert');
const path = require('path');

// Mock db/asset/fs/child_process до загрузки gc — модуль кеширует require()
const dbMock = { puts: [], dels: [] };
require.cache[require.resolve('../src/db')] = {
  exports: {
    put: (id, value, cb) => { dbMock.puts.push({ id, value }); if (cb) cb(); },
    del: (id, cb) => { dbMock.dels.push(id); if (cb) cb(); },
  },
};
require.cache[require.resolve('../src/fs')] = {
  exports: { asset: (i) => `/tmp/test-assets/${i}` },
};
// Подменяем все используемые константы (DB, ASSETS, BACKUPS_GC)
const TEST_TMP = require('fs').mkdtempSync('/tmp/gc-test-');
const TEST_DB = `${TEST_TMP}/db`;
const TEST_BACKUPS = `${TEST_TMP}/backups/gc`;
require('fs').mkdirSync(TEST_DB, { recursive: true });
require('fs').mkdirSync(TEST_BACKUPS, { recursive: true });
require.cache[require.resolve('../src/assets/constants')] = {
  exports: {
    ASSETS: `${TEST_TMP}/assets-nonexistent`,
    DB: TEST_DB,
    BACKUPS_GC: TEST_BACKUPS,
  },
};
// Mock execSync чтобы tar-команда в backupDb не падала на CI
const cpMock = { execCalls: [] };
require.cache[require.resolve('child_process')] = {
  exports: Object.assign({}, require('child_process'), {
    execSync: (cmd) => { cpMock.execCalls.push(cmd); return ''; },
  }),
};
// Mock readdirSync чтобы не падать на assets cleanup
require.cache[require.resolve('fs')] = {
  exports: Object.assign({}, require('fs'), {
    readdirSync: () => [],
    existsSync: () => false,
    unlinkSync: () => {},
  }),
};

const { cleanup } = require('../src/gc');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ============ Fixtures ============
function makePool() {
  return {
    mac: '01:02:03:04:05:06',
    pool: {},
    // DAEMON-объект (корень mark'а)
    '01:02:03:04:05:06': {
      type: 'daemon',
      project: 'proj-1',
    },
    // Project → site
    'proj-1': { type: 'project', site: ['site-1'] },
    // Site → device массив (с MAC) + script
    'site-1': {
      type: 'site',
      device: ['aa:bb:cc:dd:ee:ff'],
      script: ['script-1'],
    },
    // Реальное устройство DEVICE
    'aa:bb:cc:dd:ee:ff': { type: 'device', online: true },
    // Физические подканалы устройства (id вида MAC/channel/N)
    'aa:bb:cc:dd:ee:ff/dim/1': { type: 3, value: 50 },
    'aa:bb:cc:dd:ee:ff/dim/2': { type: 3, value: 0 },
    'aa:bb:cc:dd:ee:ff/do/3': { type: 'relay', value: false },
    // Script с action массивом
    'script-1': {
      type: 'script',
      action: ['action-shell-1'],
    },
    // Action — ACTION_SHELL_START со ссылкой по command
    'action-shell-1': {
      type: 'ACTION_SHELL_START',
      payload: { command: 'play_music' },
      script: 'script-1',
    },
    // Shell-объект, вызывается через command-match
    'shell-1': {
      type: 'shell',
      command: 'play_music',
      title: 'Музыка',
    },
    // СИРОТА: shell с другой command, не используется
    'shell-orphan': {
      type: 'shell',
      command: 'old_unused_command',
      title: 'Старая музыка',
    },
    // СИРОТА: action без живого parent
    'action-orphan': {
      type: 'ACTION_SHELL_START',
      payload: { command: 'old_unused_command' },
      script: 'dead-script-uuid',  // нет в pool
    },
  };
}

function resetDbMock() { dbMock.puts.length = 0; dbMock.dels.length = 0; }

// ============ Тесты ============

test('Bug 1 fix: физические каналы устройства MAC/channel/N помечаются как достижимые', () => {
  const pool = makePool();
  resetDbMock();
  cleanup(pool);
  // Каналы НЕ должны быть удалены
  assert.ok(pool['aa:bb:cc:dd:ee:ff/dim/1'], 'dim/1 удалён по ошибке');
  assert.ok(pool['aa:bb:cc:dd:ee:ff/dim/2'], 'dim/2 удалён по ошибке');
  assert.ok(pool['aa:bb:cc:dd:ee:ff/do/3'], 'do/3 удалён по ошибке');
  assert.ok(!dbMock.dels.includes('aa:bb:cc:dd:ee:ff/dim/1'), 'dim/1 послан в db.del');
});

test('Bug 2 fix: shell с command, упомянутой в живом ACTION_SHELL_START, не считается сиротой', () => {
  const pool = makePool();
  resetDbMock();
  cleanup(pool);
  assert.ok(pool['shell-1'], 'shell-1 удалён несмотря на live command-match');
  assert.ok(!dbMock.dels.includes('shell-1'), 'shell-1 послан в db.del');
});

test('Bug 3 fix: mark-фаза не пишет в db (pure read)', () => {
  const pool = makePool();
  // Добавим объект с числовыми ключами — old build() писал бы в db до конца mark
  pool['site-1']['0'] = 'orphan-numeric-key';
  pool['site-1']['1'] = 'another-orphan';
  resetDbMock();
  cleanup(pool);
  // db.put должен быть вызван только 1 раз — для site-1 после cleanup-фазы чистки
  // (числовые ключи удалены, нужна одна запись). Не должно быть множественных put во
  // время рекурсивного mark.
  const sitePuts = dbMock.puts.filter(p => p.id === 'site-1');
  assert.strictEqual(sitePuts.length, 1, `ожидался 1 db.put для site-1, было ${sitePuts.length}`);
  // Сами числовые ключи должны быть удалены
  assert.ok(!('0' in pool['site-1']), 'числовой ключ "0" не удалён');
  assert.ok(!('1' in pool['site-1']), 'числовой ключ "1" не удалён');
});

test('Bug 4 fix: DEVICE с массивом-ссылкой на script помечает script (default-case)', () => {
  const pool = makePool();
  // Добавим DEVICE с массивом ссылок на script (как S4 с onShortClick[])
  pool['aa:bb:cc:dd:ee:ff'].script = ['script-via-device'];
  pool['script-via-device'] = { type: 'script', action: [] };
  resetDbMock();
  cleanup(pool);
  assert.ok(pool['script-via-device'], 'script через DEVICE.script[] удалён');
});

test('Сироты (action и shell без связей) корректно удалены', () => {
  const pool = makePool();
  resetDbMock();
  cleanup(pool);
  assert.ok(!pool['shell-orphan'], 'shell-orphan не удалён');
  assert.ok(!pool['action-orphan'], 'action-orphan не удалён');
  assert.ok(dbMock.dels.includes('shell-orphan'), 'shell-orphan не послан в db.del');
  assert.ok(dbMock.dels.includes('action-orphan'), 'action-orphan не послан в db.del');
});

test('Daemon-объект корня (pool.mac) не удалён', () => {
  const pool = makePool();
  resetDbMock();
  cleanup(pool);
  assert.ok(pool['01:02:03:04:05:06'], 'DAEMON-корень удалён');
  assert.ok(pool.mac === '01:02:03:04:05:06', 'pool.mac затёрт');
});

test('Backup создаётся перед удалением (execSync с tar)', () => {
  const pool = makePool();
  resetDbMock();
  cpMock.execCalls.length = 0;
  cleanup(pool);
  // Должен быть один execSync с tar czf
  const tarCalls = cpMock.execCalls.filter(c => c.startsWith('tar czf'));
  assert.strictEqual(tarCalls.length, 1, `ожидался 1 tar-вызов, было ${tarCalls.length}`);
});

test('MAX_DELETE_PER_RUN: abort если orphan > 50, без force', () => {
  const pool = makePool();
  // Добавим 55 сирот
  for (let i = 0; i < 55; i++) {
    pool[`orphan-${i}`] = { type: 'shell', command: `unused-${i}` };
  }
  resetDbMock();
  cpMock.execCalls.length = 0;
  const result = cleanup(pool);
  assert.strictEqual(result.aborted, true, 'cleanup не отменился при превышении лимита');
  assert.strictEqual(result.deleted, 0, 'cleanup удалил несмотря на abort');
  assert.strictEqual(dbMock.dels.length, 0, 'db.del вызван несмотря на abort');
  // Сироты остались
  assert.ok(pool['orphan-0'], 'orphan-0 удалён при aborted cleanup');
});

test('MAX_DELETE_PER_RUN: с force=true удаляет даже больше лимита', () => {
  const pool = makePool();
  for (let i = 0; i < 55; i++) {
    pool[`orphan-${i}`] = { type: 'shell', command: `unused-${i}` };
  }
  resetDbMock();
  const result = cleanup(pool, { force: true });
  assert.ok(result.deleted >= 55, `ожидалось >= 55 удалений, было ${result.deleted}`);
});

test('keep: true в payload защищает объект от удаления (whitelist через флаг)', () => {
  const pool = makePool();
  // Сирота с keep=true — например, заготовка под будущую миграцию (INC-051)
  pool['protected-orphan'] = {
    type: 'shell',
    title: 'Уведомление',
    command: 'curl https://...',
    keep: true,
  };
  // Обычная сирота для сравнения
  pool['unprotected-orphan'] = { type: 'shell', command: 'old-stuff' };
  resetDbMock();
  cleanup(pool, { force: true });
  assert.ok(pool['protected-orphan'], 'удалён объект с keep:true');
  assert.ok(!pool['unprotected-orphan'], 'не удалён обычный сирота');
});

test('MAC-style id (физические устройства) НИКОГДА не удаляются, даже если mark их не достиг', () => {
  const pool = makePool();
  // Добавим 1-Wire slave-устройства (28: семейство), которые в реальной БД
  // привязаны к master через device-specific массивы (temperature_ext[]),
  // которые build() не обходит. Без MAC-protect они бы удалились.
  pool['28:38:be:96:51:21:01:dc'] = { type: 240, master: '90:89:d3:f1:2d:0f', code: 'Улица' };
  pool['28:10:f7:f7:44:21:01:b1'] = { type: 240, master: '90:89:d3:f1:2d:0f', code: 'Пол лоджия' };
  // Добавим UUID-подканал IntesisBox
  pool['51cb6aba-557a-457b-8344-b13748540c9e/modbus/1'] = { type: 'modbus', bind: '364c5a4f-a335-4b0d-81b0-1cfdd7ae6278' };
  resetDbMock();
  cleanup(pool, { force: true });
  assert.ok(pool['28:38:be:96:51:21:01:dc'], 'удалён 1-Wire 28:38:be:... (Геркон Улица)');
  assert.ok(pool['28:10:f7:f7:44:21:01:b1'], 'удалён 1-Wire 28:10:f7:... (Пол лоджия)');
  assert.ok(pool['51cb6aba-557a-457b-8344-b13748540c9e/modbus/1'], 'удалён UUID-канал IntesisBox modbus/1');
  assert.ok(!dbMock.dels.includes('28:38:be:96:51:21:01:dc'), 'db.del вызван для MAC-устройства');
  assert.ok(!dbMock.dels.includes('51cb6aba-557a-457b-8344-b13748540c9e/modbus/1'), 'db.del для UUID-канала');
});

// ============ Runner ============
let passed = 0, failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
