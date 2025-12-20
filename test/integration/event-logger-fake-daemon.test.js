const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForFileContainsJsonLine(filePath, predicate, timeoutMs = 10000) {
  const started = Date.now();
  let lastErr = null;

  while (Date.now() - started < timeoutMs) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (predicate(obj)) return obj;
          } catch {
            // ignore invalid lines
          }
        }
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(100);
  }

  if (lastErr) throw lastErr;
  throw new Error(`Timeout waiting for matching JSON line in ${filePath}`);
}

test('event-logger: пишет события и проставляет logger_pid (fake daemon)', { timeout: 20000 }, async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('RUN_INTEGRATION!=1');
    return;
  }

  // Зачем: используем папку внутри репозитория (os.tmpdir() может быть недоступен/чиститься системой)
  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'event-logger-test-'));

  const wss = new WebSocket.Server({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  const deviceId = 'device-1';
  const consumerId = 'consumer-1';
  const now = Date.now();

  /** @type {WebSocket|null} */
  let client = null;
  let getReceived = false;

  wss.on('connection', (ws) => {
    client = ws;
    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }

      if (msg && (msg.type === 'list' || msg.type === 'LIST')) {
        ws.send(JSON.stringify({ type: 'list', state: [[deviceId, now], [consumerId, now]] }));
        return;
      }

      if (msg && (msg.type === 'get' || msg.type === 'GET') && Array.isArray(msg.state)) {
        getReceived = true;
        // Инициализация: отдаём полное состояние через ACTION_SET без _context
        for (const id of msg.state) {
          if (id === consumerId) {
            ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { type: 'socket_220', title: 'Увлажнение', value: false, timestamp: now } }));
          } else {
            ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { type: 'DEVICE_TYPE_XX', title: 'Device', value: 0, timestamp: now } }));
          }
        }
        return;
      }
    });
  });

  const loggerScript = path.join(__dirname, '..', '..', 'src', 'logging', 'event-logger.js');
  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot, // Зачем: VAR вычисляется от process.cwd(), пишем в temp
    env: {
      ...process.env,
      DAEMON_WS_URL: `ws://127.0.0.1:${port}`,
      OPENSEARCH_ENABLED: 'false' // Зачем: исключаем сеть, проверяем только формирование/запись событий
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  t.after(async () => {
    try { child.kill('SIGTERM'); } catch {}
    try { wss.close(); } catch {}
    if (client) {
      try { client.terminate(); } catch {}
    }
  });

  // Ждём, пока логгер подключится и выполнит LIST/GET
  const startWait = Date.now();
  while (!client || !getReceived) {
    if (Date.now() - startWait > 5000) {
      throw new Error(`Timeout waiting for LIST/GET handshake. stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
    }
    await sleep(50);
  }

  // Ждём, пока логгер завершит начальную инициализацию (иначе следующие ACTION_SET будут восприняты как initial state)
  const startInit = Date.now();
  while (!stdout.includes('Восстановлено') && !stdout.includes('Инициализация state')) {
    if (Date.now() - startInit > 5000) {
      throw new Error(`Timeout waiting for initial state completion. stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
    }
    await sleep(50);
  }

  // Триггерим изменение consumer, чтобы логгер сформировал событие и записал в файл
  client.send(JSON.stringify({ type: 'ACTION_SET', id: consumerId, payload: { type: 'socket_220', title: 'Увлажнение', value: true, timestamp: now + 1 } }));

  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(tmpRoot, 'var', 'log', `events-${today}.jsonl`);

  const found = await waitForFileContainsJsonLine(
    logFile,
    (e) => e && e.id === consumerId && e.param === 'value' && e.logger_pid === child.pid,
    10000
  );

  assert.equal(found.logger_pid, child.pid);
  assert.equal(found.id, consumerId);
  assert.equal(found.param, 'value');

  // Зачем: если логгер пишет ошибки, покажем их в тексте падения (для диагностики)
  assert.equal(stderr.trim(), '');
});

