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

async function waitForCondition(name, predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`Timeout waiting for condition: ${name}`);
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
  let listReceived = false;

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
        listReceived = true;
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
    // Зачем: не засоряем репо временными папками после теста.
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  // Ждём, пока логгер подключится и выполнит LIST/GET
  await waitForCondition(
    'LIST/GET handshake',
    () => Boolean(client && listReceived && getReceived),
    5000
  );

  // Зачем: даём логгеру завершить обработку init-state (не завязываемся на stdout строках).
  await sleep(300);

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
  assert.ok(found.trace_id, 'trace_id должен быть заполнен');
  assert.ok(found.device && typeof found.device === 'object', 'device должен быть объектом');
  assert.equal(found.device.consumer, true);
  assert.equal(found.device.human, 'Увлажнение');

  // Зачем: если логгер пишет ошибки, покажем их в тексте падения (для диагностики)
  assert.equal(stderr.trim(), '');
});

test('event-logger: consumer.value не должен переиспользовать trace_id при auto-off (>2s) без явного клика', { timeout: 25000 }, async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('RUN_INTEGRATION!=1');
    return;
  }

  // Зачем: регрессия по бою — при быстрых колебаниях consumer.value в одном trace_id появлялись обе ветки on+off.
  // Алгоритм должен либо разнести события по разным trace_id, либо связать второе событие только если оно явно от SCRIPT.
  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'event-logger-trace-flap-test-'));

  const wss = new WebSocket.Server({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  const consumerId = 'consumer-flap-1';
  const now = Date.now();
  const tsOn = now + 1;
  const tsOff = now + 3000; // > RECENT_EVENT_WINDOW_MS (2s)

  /** @type {WebSocket|null} */
  let client = null;
  let listReceived = false;
  let getReceived = false;

  wss.on('connection', (ws) => {
    client = ws;
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      if (msg && (msg.type === 'list' || msg.type === 'LIST')) {
        listReceived = true;
        ws.send(JSON.stringify({ type: 'list', state: [[consumerId, now]] }));
        return;
      }
      if (msg && (msg.type === 'get' || msg.type === 'GET') && Array.isArray(msg.state)) {
        getReceived = true;
        for (const id of msg.state) {
          if (id === consumerId) {
            ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { type: 'socket_220', title: 'FlapConsumer', value: false, timestamp: now } }));
          }
        }
      }
    });
  });

  const loggerScript = path.join(__dirname, '..', '..', 'src', 'logging', 'event-logger.js');
  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot,
    env: {
      ...process.env,
      DAEMON_WS_URL: `ws://127.0.0.1:${port}`,
      OPENSEARCH_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  t.after(async () => {
    try { child.kill('SIGTERM'); } catch {}
    try { wss.close(); } catch {}
    if (client) {
      try { client.terminate(); } catch {}
    }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  await waitForCondition('LIST/GET handshake', () => Boolean(client && listReceived && getReceived), 5000);
  await sleep(300); // Зачем: даём дописать init-state.

  // Триггерим auto-off через >2s (по payload.timestamp), без отдельного источника/клика.
  client.send(JSON.stringify({ type: 'ACTION_SET', id: consumerId, payload: { type: 'socket_220', title: 'FlapConsumer', value: true, timestamp: tsOn } }));
  client.send(JSON.stringify({ type: 'ACTION_SET', id: consumerId, payload: { type: 'socket_220', title: 'FlapConsumer', value: false, timestamp: tsOff } }));

  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(tmpRoot, 'var', 'log', `events-${today}.jsonl`);

  const evOn = await waitForFileContainsJsonLine(
    logFile,
    // Зачем: точный timestamp может отличаться (формирование timestamp события может зависеть от формата payload),
    // поэтому здесь ищем по смыслу: consumer.value=true от текущего logger_pid.
    (e) => e && e.id === consumerId && e.param === 'value' && e.new === true && e.logger_pid === child.pid,
    10000
  );
  // Ждём, пока появится OFF (может прийти чуть позже из-за обработки/буфера).
  await waitForCondition(
    'consumer OFF event is written',
    () => readJsonlSafe(logFile).some((e) => e && e.id === consumerId && e.param === 'value' && e.new === false && e.logger_pid === child.pid),
    10000
  );
  const evOff = readJsonlSafe(logFile)
    .filter((e) => e && e.id === consumerId && e.param === 'value' && e.new === false && e.logger_pid === child.pid)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-1)[0];

  assert.ok(evOn.trace_id, 'trace_id должен быть заполнен для ON');
  assert.ok(evOff.trace_id, 'trace_id должен быть заполнен для OFF');
  assert.notEqual(evOn.trace_id, evOff.trace_id, 'auto-off через >2s не должен жить в одном trace_id с ON');

  assert.equal(stderr.trim(), '');
});

test('event-logger: не назначает trace_id для SITE/PROJECT/DAEMON (anti-noise)', { timeout: 25000 }, async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('RUN_INTEGRATION!=1');
    return;
  }

  // Зачем: в бою события локаций/проекта/демона давали “шум” и ложные склейки цепочек.
  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'event-logger-untraceable-test-'));

  const wss = new WebSocket.Server({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  const ids = ['site-1', 'project-1', 'daemon-1'];
  const now = Date.now();

  /** @type {WebSocket|null} */
  let client = null;
  let listReceived = false;
  let getReceived = false;

  wss.on('connection', (ws) => {
    client = ws;
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      if (msg && (msg.type === 'list' || msg.type === 'LIST')) {
        listReceived = true;
        ws.send(JSON.stringify({ type: 'list', state: ids.map((id) => [id, now]) }));
        return;
      }
      if (msg && (msg.type === 'get' || msg.type === 'GET') && Array.isArray(msg.state)) {
        getReceived = true;
        for (const id of msg.state) {
          if (id === 'site-1') ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { type: 'site', title: 'Room', value: 1, timestamp: now } }));
          if (id === 'project-1') ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { type: 'project', title: 'Project', value: 1, timestamp: now } }));
          if (id === 'daemon-1') ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { type: 'daemon', title: 'Daemon', value: 1, timestamp: now } }));
        }
      }
    });
  });

  const loggerScript = path.join(__dirname, '..', '..', 'src', 'logging', 'event-logger.js');
  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot,
    env: { ...process.env, DAEMON_WS_URL: `ws://127.0.0.1:${port}`, OPENSEARCH_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  t.after(async () => {
    try { child.kill('SIGTERM'); } catch {}
    try { wss.close(); } catch {}
    if (client) {
      try { client.terminate(); } catch {}
    }
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  await waitForCondition('LIST/GET handshake', () => Boolean(client && listReceived && getReceived), 5000);
  await sleep(300);

  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(tmpRoot, 'var', 'log', `events-${today}.jsonl`);

  for (const id of ids) {
    // Зачем: такие события могут быть отфильтрованы и не попасть в лог событий вообще.
    // Если они всё же попали, то обязаны иметь trace_id=null.
    await waitForCondition(
      `either untraceable ${id} absent or has trace_id=null`,
      () => {
        const all = readJsonlSafe(logFile).filter((e) => e && e.id === id && e.logger_pid === child.pid);
        if (!all.length) return true; // отсутствует в логах — нормальный вариант
        return all.every((e) => (e.trace_id ?? null) === null);
      },
      10000
    );
  }

  assert.equal(stderr.trim(), '');
});

