const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createFakeDaemonFromScenario, sleep, readJsonlEvents, filterByLoggerPid } = require('../../test/integration/helpers/trace-test-helpers');

async function run() {
  const baseS4Id = '90:89:d3:f1:2d:0f';
  const diId = `${baseS4Id}/di/1`;
  const holdScriptId = 'hold-script-lodgia-1';
  const nestedScriptId = 'nested-convector-script-1';
  const actionHoldId = 'action-hold-1';
  const actionNestedId = 'action-nested-1';
  const convectorId = '0e0f86b7-3397-443e-949a-6e66cb4be10f';
  const convectorChannelId = '68:27:19:e4:49:02/do/8';

  const t0 = Date.now();
  const tDown = t0 + 1000;
  const tNestedExecuted = tDown + 1200;
  const tConvectorOn = tNestedExecuted + 2;

  const initStateMap = new Map([
    [baseS4Id, { type: 37, code: 'S4 Лоджия', title: 'S4 Лоджия', timestamp: t0, value: 0 }],
    [diId, { value: 0, timestamp: t0, onHold: [holdScriptId], onClick: [], onClick2: [] }],
    [holdScriptId, { type: 'script', title: 'S4 Lodgia hold root', action: [actionHoldId], timestamp: t0 }],
    [actionHoldId, { type: 'ACTION_RUN', payload: { onTrue: nestedScriptId }, timestamp: t0 }],
    [nestedScriptId, { type: 'script', title: 'Convector Lodgia run', action: [actionNestedId], timestamp: t0 }],
    [actionNestedId, { type: 'ACTION_ON', payload: { id: convectorId }, timestamp: t0 }],
    [convectorId, { type: 'warm_floor', title: 'Эл.конвектор', code: 'Лоджия', bind: convectorChannelId, value: false, timestamp: t0 }],
    [convectorChannelId, { type: 2, value: 0, bind: convectorId, timestamp: t0 }],
  ]);

  const daemon = await createFakeDaemonFromScenario({ initStateMap });

  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'repro-lodgia-'));

  const loggerScript = path.join(process.cwd(), 'src', 'logging', 'event-logger.js');
  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot,
    env: {
      ...process.env,
      DAEMON_WS_URL: `ws://127.0.0.1:${daemon.port}`,
      OPENSEARCH_ENABLED: 'false',
      SYNTHETIC_SCRIPT_EVENTS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  await daemon.waitForHandshake(5000);

  const ws = daemon.getClient();
  // send down
  ws.send(JSON.stringify({ type: 'ACTION_SET', id: baseS4Id, payload: { value: 1, timestamp: tDown } }));
  await sleep(50);
  // send executed + device changes
  ws.send(JSON.stringify({ type: 'ACTION_SET', id: nestedScriptId, payload: { executed: true, timestamp: tNestedExecuted } }));
  ws.send(JSON.stringify({ type: 'ACTION_SET', id: convectorId, payload: { value: true, timestamp: tConvectorOn } }));
  ws.send(JSON.stringify({ type: 'ACTION_SET', id: convectorChannelId, payload: { value: 1, timestamp: tConvectorOn + 1 } }));

  // wait a bit for logger to write files
  await sleep(800);

  const today = new Date().toISOString().split('T')[0];
  const eventsFile = path.join(tmpRoot, 'logs', 'logger', 'events', `events-${today}.jsonl`);
  const wsDir = path.join(tmpRoot, 'logs', 'logger', 'ws');

  console.log('tmpRoot:', tmpRoot);
  console.log('eventsFile:', eventsFile);
  console.log('wsDir:', wsDir);

  // Dump a short verification
  if (fs.existsSync(eventsFile)) {
    const ev = readJsonlEvents(eventsFile);
    const my = filterByLoggerPid(ev, child.pid);
    console.log('events written count:', my.length);
  } else {
    console.log('events file not found yet');
  }

  // Keep processes alive for inspection; do not cleanup
  console.log('Reproduction finished — artifacts preserved in tmpRoot.');
  console.log('Do NOT delete tmpRoot if you want to collect raw files.');
}

run().catch((err) => { console.error(err); process.exit(1); });

