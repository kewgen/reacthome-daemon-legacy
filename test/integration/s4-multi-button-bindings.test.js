const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Зачем: у S4 4 кнопки (DI каналы /di/1..4) и триггеры (onClick/onHold/...) могут быть распределены по разным DI.
 * Этот тест гарантирует, что `extra.signal_source.linked.trigger_scripts` резолвится корректно по конкретному DI-каналу,
 * а не только из `${baseId}/di/1`.
 */

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJsonlSafe(filePath) {
  // Зачем: интеграционные тесты работают с JSONL событиями логгера.
  // Этот helper нужен, чтобы стабильно читать файл даже при параллельной записи.
  if (!fs.existsSync(filePath)) return [];
  const out = [];
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return out;
}

async function waitForLogLine(filePath, predicate, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const all = readJsonlSafe(filePath);
    for (const e of all) {
      if (predicate(e)) return e;
    }
    await wait(100);
  }
  throw new Error(`Timeout waiting for matching JSONL event in ${filePath}`);
}

test('S4: 4 DI buttons — trigger scripts are resolved per /di/k', { timeout: 30000 }, async () => {
  if (process.env.RUN_INTEGRATION !== '1') {
    return;
  }

  // Зачем: используем папку внутри репозитория (os.tmpdir() может быть недоступен/чиститься системой)
  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 's4-multi-button-test-'));

  const wss = new WebSocket.Server({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  const baseId = '90:89:d3:f1:2d:0f';
  const di2 = `${baseId}/di/2`;
  const di3 = `${baseId}/di/3`;

  const scriptClickDi2 = '11111111-1111-1111-1111-111111111111';
  const scriptHoldDi3 = '33333333-3333-3333-3333-333333333333';

  const now0 = Date.now();
  const initState = new Map([
    [baseId, { type: 37, code: 'S4 Лоджия', title: 'S4 Лоджия', timestamp: now0, value: 0 }],
    // Зачем: на разных DI лежат разные массивы триггеров — это и есть “4 кнопки”.
    [di2, { value: 0, timestamp: now0, onClick: [scriptClickDi2], onClick2: [], onHold: [] }],
    [di3, { value: 0, timestamp: now0, onClick: [], onClick2: [], onHold: [scriptHoldDi3] }],
    // Сами скрипты нужны, чтобы логгер мог построить device.human для SCRIPT, но для signal_source достаточно id.
    [scriptClickDi2, { type: 'script', title: 'S4 Lodgia DI2 click', action: [], timestamp: now0 }],
    [scriptHoldDi3, { type: 'script', title: 'S4 Lodgia DI3 hold', action: [], timestamp: now0 }],
  ]);

  /** @type {WebSocket|null} */
  let client = null;

  wss.on('connection', (ws) => {
    client = ws;
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      if (msg.type === 'list' || msg.type === 'LIST') {
        // Зачем: list отдаём в формате как в других тестах: [[id, ts], ...]
        ws.send(JSON.stringify({ type: 'list', state: Array.from(initState.keys()).map((k) => [k, now0]) }));
        return;
      }
      if ((msg.type === 'get' || msg.type === 'GET') && Array.isArray(msg.state)) {
        // Зачем: инициализация состояния — отдаём его через ACTION_SET, чтобы event-logger наполнил state.
        for (const k of msg.state) {
          if (!initState.has(k)) continue;
          ws.send(JSON.stringify({ type: 'ACTION_SET', id: k, payload: initState.get(k) }));
        }
        return;
      }
    });
  });

  const loggerScript = path.join(__dirname, '..', '..', 'src', 'logging', 'event-logger.js');
  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot, // Зачем: логгер пишет логи относительно cwd
    env: {
      ...process.env,
      DAEMON_WS_URL: `ws://127.0.0.1:${port}`,
      OPENSEARCH_ENABLED: 'false',
      SYNTHETIC_SCRIPT_EVENTS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Дадим логгеру подключиться и получить init (LIST/GET)
  await wait(800);

  // Эмулируем клик на DI2: value down/up
  const now = Date.now();
  assert.ok(client, 'WS клиент (event-logger) должен подключиться к fake-daemon');
  client.send(JSON.stringify({ type: 'ACTION_SET', id: di2, payload: { value: 1, timestamp: now } }));
  client.send(JSON.stringify({ type: 'ACTION_SET', id: di2, payload: { value: 0, timestamp: now + 50 } }));

  // Эмулируем hold на DI3: value down -> move -> up
  client.send(JSON.stringify({ type: 'ACTION_SET', id: di3, payload: { value: 10, timestamp: now + 100 } }));
  client.send(JSON.stringify({ type: 'ACTION_SET', id: di3, payload: { value: 20, timestamp: now + 300 } }));
  client.send(JSON.stringify({ type: 'ACTION_SET', id: di3, payload: { value: 0, timestamp: now + 2800 } }));

  // Проверяем события в JSONL.
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(tmpRoot, 'logs', 'logger', 'events', `events-${today}.jsonl`);

  const eDi2 = await waitForLogLine(logFile, (e) => (
    e &&
    e.extra &&
    e.extra.signal_source &&
    e.extra.signal_source.kind === 'manual' &&
    e.extra.signal_source.channel === 's4' &&
    e.extra.signal_source.device &&
    e.extra.signal_source.device.channel_id === di2
  ), 15000);

  const eDi3 = await waitForLogLine(logFile, (e) => (
    e &&
    e.extra &&
    e.extra.signal_source &&
    e.extra.signal_source.kind === 'manual' &&
    e.extra.signal_source.channel === 's4' &&
    e.extra.signal_source.device &&
    e.extra.signal_source.device.channel_id === di3
  ), 15000);

  const di2Trig = eDi2.extra.signal_source.linked.trigger_scripts;
  const di3Trig = eDi3.extra.signal_source.linked.trigger_scripts;

  assert.deepEqual(di2Trig.onClick, [scriptClickDi2], 'DI2 должен содержать onClick скрипт');
  assert.deepEqual(di3Trig.onHold, [scriptHoldDi3], 'DI3 должен содержать onHold скрипт');

  // Cleanup
  try { child.kill('SIGTERM'); } catch {}
  try { wss.close(); } catch {}
  if (client) {
    try { client.terminate(); } catch {}
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});


