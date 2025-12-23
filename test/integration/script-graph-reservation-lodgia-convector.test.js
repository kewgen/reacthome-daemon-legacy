const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const {
  sleep,
  createFakeDaemonFromScenario,
  readJsonlEvents,
  filterByLoggerPid,
} = require('./helpers/trace-test-helpers');

/**
 * Регресс: script-graph reservation (SOURCE → nested SCRIPT executed → CONSUMER).
 *
 * Зачем: в бою была ситуация, где долгий клик S4 Лоджия имел свой trace_id,
 * а "Эл.конвектор/Лоджия" попадал в другой trace_id, потому что nested script executed
 * стартовал новый trace (не был зарезервирован от SOURCE).
 *
 * Требование: вложенные скрипты (script→script) должны наследовать trace_id источника
 * без временной корреляции — только по явной связи графа action.
 */
test('script-graph reservation: S4 hold -> nested script -> Convector Lodgia in one trace', { timeout: 30000 }, async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('RUN_INTEGRATION!=1');
    return;
  }

  const baseS4Id = '90:89:d3:f1:2d:0f';
  const diId = `${baseS4Id}/di/1`;

  const holdScriptId = 'hold-script-lodgia-1';
  const nestedScriptId = 'nested-convector-script-1';
  const actionHoldId = 'action-hold-1';
  const actionNestedId = 'action-nested-1';

  const convectorId = '0e0f86b7-3397-443e-949a-6e66cb4be10f';
  const convectorChannelId = '68:27:19:e4:49:02/do/8';

  const t0 = 1766515620000;
  const tDown = t0 + 1000;
  const tNestedExecuted = tDown + 1200; // имитируем delayed effect от удержания
  const tConvectorOn = tNestedExecuted + 2;

  const initStateMap = new Map([
    [baseS4Id, { type: 37, code: 'S4 Лоджия', title: 'S4 Лоджия', timestamp: t0, value: 0 }],
    // Триггеры живут в DI snapshot:
    [diId, { value: 0, timestamp: t0, onHold: [holdScriptId], onClick: [], onClick2: [] }],

    // hold-script: через action.payload.onTrue запускает вложенный скрипт (явная связь).
    [holdScriptId, { type: 'script', title: 'S4 Lodgia hold root', action: [actionHoldId], timestamp: t0 }],
    [actionHoldId, { type: 'ACTION_RUN', payload: { onTrue: nestedScriptId }, timestamp: t0 }],

    // nested script: включает конкретный CONSUMER (конвектор) и канал.
    [nestedScriptId, { type: 'script', title: 'Convector Lodgia run', action: [actionNestedId], timestamp: t0 }],
    [actionNestedId, { type: 'ACTION_ON', payload: { id: convectorId }, timestamp: t0 }],

    [convectorId, { type: 'warm_floor', title: 'Эл.конвектор', code: 'Лоджия', bind: convectorChannelId, value: false, timestamp: t0 }],
    [convectorChannelId, { type: 2, value: 0, bind: convectorId, timestamp: t0 }],
  ]);

  const daemon = await createFakeDaemonFromScenario({ initStateMap });
  const loggerScript = path.join(process.cwd(), 'src', 'logging', 'event-logger.js');

  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'script-graph-reservation-'));

  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot,
    env: {
      ...process.env,
      DAEMON_WS_URL: `ws://127.0.0.1:${daemon.port}`,
      OPENSEARCH_ENABLED: 'false',
      SYNTHETIC_SCRIPT_EVENTS: 'false', // Зачем: в тесте используем реальный executed, без синтетики
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    await daemon.waitForHandshake(5000);

    const initStarted = Date.now();
    while (!stdout.includes('✅ Обратный индекс построен')) {
      if (Date.now() - initStarted > 7000) {
        throw new Error(`Timeout waiting for logger init. stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
      }
      await sleep(25);
    }

    const ws = daemon.getClient();
    assert.ok(ws, 'fake daemon client должен быть подключен');

    // SOURCE: имитация удержания (down достаточно, чтобы открыть trace и сделать reservation по графу)
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: baseS4Id, payload: { value: 1, timestamp: tDown } }));

    await sleep(50);

    // Effect: nested script executed + device changes.
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: nestedScriptId, payload: { executed: true, timestamp: tNestedExecuted } }));
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: convectorId, payload: { value: true, timestamp: tConvectorOn } }));
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: convectorChannelId, payload: { value: 1, timestamp: tConvectorOn + 1 } }));

    await sleep(400);

    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(tmpRoot, 'logs', 'logger', 'events', `events-${today}.jsonl`);
    const allEvents = filterByLoggerPid(readJsonlEvents(logFile), child.pid);

    const src = allEvents.find((e) => e && e.id === baseS4Id && e.param === 'value' && e.timestamp === tDown);
    assert.ok(src && typeof src.trace_id === 'string', 'SOURCE S4 должен иметь trace_id');

    const nested = allEvents.find((e) => e && e.id === nestedScriptId && e.param === 'executed' && e.new === true);
    assert.ok(nested && typeof nested.trace_id === 'string', 'nested SCRIPT executed должен иметь trace_id');
    assert.equal(nested.trace_id, src.trace_id, 'nested SCRIPT executed обязан наследовать trace_id источника (reservation по графу)');

    const conv = allEvents.find((e) => e && e.id === convectorId && e.param === 'value' && e.new === true);
    assert.ok(conv && typeof conv.trace_id === 'string', 'CONSUMER конвектора должен иметь trace_id');
    assert.equal(conv.trace_id, src.trace_id, 'CONSUMER конвектора обязан быть в trace_id источника');

    assert.equal(stderr.trim(), '');
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    try { daemon.wss.close(); } catch {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

