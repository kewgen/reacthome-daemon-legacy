const { test } = require('node:test');
const assert = require('assert').strict;
const http = require('http');
const fetch = require('node-fetch');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../../tools/naming-ui/server.js');

// Зачем: получаем состояние устройства через реальный WebSocket gate
async function getDeviceState(gateUrl, daemonId, deviceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${gateUrl}/${daemonId}`, 'listen');
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout waiting for device state'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'get', state: [deviceId] }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ACTION_SET' && msg.id === deviceId && msg.payload) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.payload);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Зачем: находим device ID по code через validate API
async function findDeviceByCode(apiUrl, gateUrl, daemonId, code) {
  const res = await fetch(`${apiUrl}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daemonId, gateUrl }),
  });
  const data = await res.json();
  if (!data.ok || !data.result || !Array.isArray(data.result.rows)) {
    throw new Error(`Validate failed: ${data.error || 'unknown'}`);
  }
  const row = data.result.rows.find((r) => r.code === code || r.code?.trim() === code);
  if (!row || !row.id) {
    throw new Error(`Device with code "${code}" not found in validate results`);
  }
  return row.id;
}

test('naming-ui apply sends action_set and rollback for 1.BRA.1', async () => {
  // Зачем: используем реальный боевой gate и демон
  const gateUrl = process.env.GATE_URL || 'wss://gate.reacthome.net';
  const knownDaemons = JSON.parse(fs.readFileSync(path.resolve('tools/naming-ui/known-daemons.json'), 'utf8'));
  const daemonId = knownDaemons[0]?.id; // Первый реальный демон
  assert.ok(daemonId, 'No daemon found in known-daemons.json');

  // Start app
  const app = createApp({ knownDaemonsPath: path.resolve('tools/naming-ui/known-daemons.json') });
  const srv = http.createServer(app);
  await new Promise((res) => srv.listen(0, res));
  const port = srv.address().port;

  const targetCode = '1.BRA.1';
  const newCode = '1.D.BRA.1 Младшая';
  const title = 'Бра кровати Лёвы2';

  try {
    // Находим device ID по code через validate API
    console.log(`Finding device with code "${targetCode}"...`);
    const apiUrl = `http://127.0.0.1:${port}`;
    const deviceId = await findDeviceByCode(apiUrl, gateUrl, daemonId, targetCode);
    assert.ok(deviceId, `Device with code "${targetCode}" not found`);

    // Получаем старое состояние
    console.log(`Getting old state for device ${deviceId}...`);
    const oldState = await getDeviceState(gateUrl, daemonId, deviceId);
    const oldCode = oldState.code || targetCode;
    const oldTitle = oldState.title || '';

    console.log(`Old state: code="${oldCode}", title="${oldTitle}"`);

    // Apply new code/title через /api/apply
    console.log(`Applying: code="${newCode}", title="${title}"...`);
    const applyRes = await fetch(`http://127.0.0.1:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daemonId, gateUrl, id: deviceId, newCode, newTitle: title }),
    });
    const applyResult = await applyRes.json();
    assert.ok(applyResult.ok, `Apply failed: ${applyResult.error || 'unknown'}`);

    // Ждём немного для применения изменений
    await new Promise((r) => setTimeout(r, 1500));

    // Проверяем новое состояние через GET
    console.log(`Verifying new state...`);
    const newState = await getDeviceState(gateUrl, daemonId, deviceId);
    assert.equal(newState.code, newCode, `Code not updated: expected "${newCode}", got "${newState.code}"`);
    assert.equal(newState.title, title, `Title not updated: expected "${title}", got "${newState.title}"`);

    // Rollback к старому состоянию
    console.log(`Rolling back to: code="${oldCode}", title="${oldTitle}"...`);
    const rollbackRes = await fetch(`http://127.0.0.1:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daemonId, gateUrl, id: deviceId, newCode: oldCode, newTitle: oldTitle }),
    });
    const rollbackResult = await rollbackRes.json();
    assert.ok(rollbackResult.ok, `Rollback failed: ${rollbackResult.error || 'unknown'}`);

    // Ждём немного для применения отката
    await new Promise((r) => setTimeout(r, 1500));

    // Проверяем возврат к старому состоянию
    console.log(`Verifying rollback...`);
    const rolledState = await getDeviceState(gateUrl, daemonId, deviceId);
    assert.equal(rolledState.code, oldCode, `Code not rolled back: expected "${oldCode}", got "${rolledState.code}"`);
    assert.equal(rolledState.title, oldTitle, `Title not rolled back: expected "${oldTitle}", got "${rolledState.title}"`);

    console.log('✅ Test passed: apply and rollback successful');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

