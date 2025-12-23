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
 * Регресс-тест: "опоздавший SOURCE" (S4) не должен создавать новый trace_id.
 *
 * Зачем: в бою встречается порядок, где эффект (SCRIPT+CONSUMER) приходит раньше источника (S4/DI).
 * Раньше это приводило к "украденному трейсу": эффект попадал в trace_id без SOURCE,
 * а SOURCE стартовал новый trace_id. Теперь SOURCE должен подцепиться к trace эффектов
 * по явной связи (onClick/onHold/... → scriptId) в маленьком окне времени.
 */
test('late SOURCE recovery: Lodgia S4 attaches to effect trace', { timeout: 30000 }, async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('RUN_INTEGRATION!=1');
    return;
  }

  // Идентификаторы из боевого конфига Лоджии (см. trace-scenarios.yaml).
  const baseId = '90:89:d3:f1:2d:0f';
  const diId = `${baseId}/di/1`;
  const toggleScriptId = '83db5b75-fa69-42f9-bd57-ee9f33d59ed7';
  const branchOnId = '41e5974e-d302-4eef-93c9-9d24231f7a41';
  const consumerId = '34731215-af9b-4847-b2f9-67c8940271c0';
  const dimId = '68:27:19:e4:49:17/dim/3';

  // Таймлайн (мс) — намеренно делаем "эффект раньше SOURCE".
  const t0 = 1766420734638; // просто валидный epoch-ms
  const tEffect = t0 + 500;
  const tSourceLate = tEffect + 200; // SOURCE "опаздывает" на 200мс

  // initState: минимум, чтобы резолвились триггеры и targets.
  const initStateMap = new Map([
    [baseId, { type: 37, code: 'S4 Лоджия', timestamp: t0, value: 0 }],
    // Триггеры на скрипт лежат в DI:
    [diId, { value: 0, timestamp: t0, onClick: [toggleScriptId] }],
    // Скрипты и action-объект (чтобы getScriptTargetDevices нашёл consumer и bind):
    [toggleScriptId, { type: 'script', title: '6.D.L.3 Toggle', action: ['d21fb8e9-e1da-45b0-a9d2-0ab4cb775a6a'], timestamp: t0 }],
    ['d21fb8e9-e1da-45b0-a9d2-0ab4cb775a6a', { type: 'ACTION_TOGGLE', script: toggleScriptId, payload: { test: [consumerId], onOn: branchOnId }, timestamp: t0 }],
    [branchOnId, { type: 'script', title: '6.D.L.3 on', action: [], timestamp: t0 }],
    // Consumer + bind на dim (чтобы traceIdCache резервировался и по bind)
    [consumerId, { type: 'light_220', title: 'Освещение', code: '6.D.L.3 Лоджия', bind: dimId, timestamp: t0, value: false }],
    [dimId, { type: 4, group: 3, value: 0, velocity: 0, dimmable: false, bind: consumerId, timestamp: t0 }],
  ]);

  const daemon = await createFakeDaemonFromScenario({ initStateMap });
  const loggerScript = path.join(process.cwd(), 'src', 'logging', 'event-logger.js');

  const baseTmp = path.join(process.cwd(), 'var', 'tmp');
  fs.mkdirSync(baseTmp, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'late-source-test-'));

  const child = spawn(process.execPath, [loggerScript], {
    cwd: tmpRoot,
    env: {
      ...process.env,
      DAEMON_WS_URL: `ws://127.0.0.1:${daemon.port}`,
      OPENSEARCH_ENABLED: 'false',
      SYNTHETIC_SCRIPT_EVENTS: 'true',
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
    while (!stdout.includes('Обратный индекс построен')) {
      if (Date.now() - initStarted > 7000) {
        throw new Error(`Timeout waiting for logger init. stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
      }
      await sleep(25);
    }

    const ws = daemon.getClient();
    assert.ok(ws, 'fake daemon client должен быть подключен');

    // 1) ЭФФЕКТ РАНЬШЕ ИСТОЧНИКА: в бою иногда приходит "факт выполнения скрипта"
    // раньше клика S4/DI (или SOURCE отфильтрован/опоздал).
    ws.send(JSON.stringify({
      type: 'ACTION_SET',
      id: toggleScriptId,
      payload: { type: 'script', title: '6.D.L.3 Toggle', executed: true, timestamp: tEffect }
    }));

    // Следом приходят изменения устройств.
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: consumerId, payload: { value: true, timestamp: tEffect + 1 } }));
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: dimId, payload: { type: 4, group: 3, value: 255, velocity: 0, dimmable: false, timestamp: tEffect + 4 } }));

    await sleep(50);

    // 2) ПОЗДНИЙ SOURCE: DI click приходит ПОСЛЕ эффекта.
    ws.send(JSON.stringify({ type: 'ACTION_SET', id: diId, payload: { value: 1, timestamp: tSourceLate } }));

    await sleep(400);

    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(tmpRoot, 'logs', 'logger', 'events', `events-${today}.jsonl`);
    const allEvents = filterByLoggerPid(readJsonlEvents(logFile), child.pid);
    assert.ok(allEvents.length > 0, 'должны быть события тестового логгера');

    // Находим trace_id эффекта (по SCRIPT executed).
    const scriptEv = allEvents.find((e) => e && e.id === toggleScriptId && e.param === 'executed' && e.new === true && e.timestamp === tEffect);
    assert.ok(scriptEv && typeof scriptEv.trace_id === 'string', 'SCRIPT executed должен иметь trace_id');
    const effectTraceId = scriptEv.trace_id;

    // Проверяем, что в trace эффекта есть SCRIPT toggle (синтетика) и поздний SOURCE di/1.
    const traceEvents = allEvents.filter((e) => e && e.trace_id === effectTraceId).sort((a, b) => a.timestamp - b.timestamp);

    const hasToggle = traceEvents.some((e) => e && e.id === toggleScriptId && e.param === 'executed');
    assert.ok(hasToggle, 'в trace эффекта должен быть SCRIPT toggle executed');

    const hasConsumer = traceEvents.some((e) => e && e.id === consumerId && e.param === 'value' && e.new === true);
    assert.ok(hasConsumer, 'в trace эффекта должен быть CONSUMER value=true');

    const lateSource = traceEvents.find((e) => e && e.id === diId && e.param === 'value' && e.timestamp === tSourceLate);
    assert.ok(lateSource, 'поздний SOURCE di/1 должен быть в trace эффекта');

    // И НЕ должен существовать отдельный trace_id, содержащий только этот SOURCE без эффекта.
    const lateSourceAll = allEvents.find((e) => e && e.id === diId && e.param === 'value' && e.timestamp === tSourceLate);
    assert.ok(lateSourceAll && lateSourceAll.trace_id === effectTraceId, 'поздний SOURCE обязан унаследовать trace_id эффекта');

    assert.equal(stderr.trim(), '', 'stderr должен быть пустым');
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    try { daemon.wss.close(); } catch {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

