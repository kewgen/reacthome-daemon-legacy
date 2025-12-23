const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const {
  sleep,
  loadScenarioYaml,
  createFakeDaemonFromScenario,
  readJsonlEvents,
  filterByLoggerPid,
  findTraceIdsByAnchor,
  splitWsByPhase,
  buildInitStateMapFromWsInit,
} = require('./helpers/trace-test-helpers');

function deepGet(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function normalizeExactPath(p) {
  const s = String(p);
  return s.startsWith('msg.') ? s.slice('msg.'.length) : s;
}

function getEventRole(event) {
  // Зачем: кнопки/датчики‑триггеры должны учитываться как SOURCE в цепочке трассировки.
  // В логах они часто выглядят как param=value и могут иметь extra.actuator_*,
  // но по смыслу это инициатор (S4 Лоджия / Click).
  // Также в бою клик S4 может приходить как инкремент DI-счётчиков (onClick1Count/onClick2Count/onHoldCount).
  if (
    event &&
    typeof event.id === 'string' &&
    event.id.includes('/di/') &&
    (event.param === 'value' || event.param === 'onClick1Count' || event.param === 'onClick2Count' || event.param === 'onHoldCount')
  ) {
    return 'SOURCE';
  }
  if (event && event.param === 'value' && event.device) {
    const t = event.device.type;
    if (t === 'DOPPLER' || t === 'doppler') return 'SOURCE';
    const title = event.device.title;
      if (typeof title === 'string' && /^S\d+/i.test(title.trim())) return 'SOURCE';
      const human = event.device.human;
      if (typeof human === 'string' && /^S\d+/i.test(human.trim())) return 'SOURCE';
  }
  if (event.param === 'executed' || (event.device && event.device.type === 'SCRIPT')) return 'SCRIPT';
  if (event.device && event.device.consumer === true) return 'CONSUMER';
  if (event.extra) {
    const ex = event.extra;
    if (ex.actuator_on || ex.actuator_off || ex.actuator_update ||
        ex.end_device_on || ex.end_device_off || ex.end_device_update) {
      return 'ACTUATOR';
    }
  }
  if (typeof event.id === 'string' && (event.id.includes('/dim/') || event.id.includes('/do/')) && event.param === 'value') {
    return 'ACTUATOR';
  }
  return 'OTHER';
}

function matchesExpected(event, expectedMsg, exactPaths) {
  for (const rawPath of exactPaths) {
    const path = normalizeExactPath(rawPath);
    if (path === 'role') {
      if (getEventRole(event) !== deepGet(expectedMsg, 'role')) return false;
      continue;
    }
    const expectedVal = deepGet(expectedMsg, path);
    const actualVal = deepGet(event, path);
    if (actualVal !== expectedVal) return false;
  }
  return true;
}

function matchExpectations(traceEvents, outputSpec, policy, opts = {}) {
  const errors = [];
  const used = new Set(); // индексы событий, сопоставленных с expect шагами
  const expectList = Array.isArray(outputSpec.expect) ? outputSpec.expect : [];
  const requirePresent = (policy && Array.isArray(policy.require_present)) ? policy.require_present : [];

  const ordered = opts.ordered !== false;
  if (ordered) {
  let idx = 0;
  for (const step of expectList) {
    const expectedMsg = step.msg || {};
    const exact = Array.isArray(step.exact) ? step.exact : [];
    let found = null;
    for (let i = idx; i < traceEvents.length; i++) {
      const e = traceEvents[i];
      if (matchesExpected(e, expectedMsg, exact)) {
        found = { i, e };
        break;
      }
    }
    if (!found) {
      errors.push(`expect: не найден шаг "${step.name || 'без имени'}"`);
      continue;
    }
      used.add(found.i);
    idx = found.i + 1;
    for (const fieldPath of requirePresent) {
      if (deepGet(found.e, fieldPath) == null) {
        errors.push(`policy: отсутствует поле ${fieldPath} у события "${step.name || 'без имени'}"`);
      }
    }
  }
  } else {
    // Зачем: если checks.full_chain.order=false, то важен набор событий в trace_id,
    // а порядок в e2e может меняться из-за синтетики и порядка сообщений WS.
    for (const step of expectList) {
      const expectedMsg = step.msg || {};
      const exact = Array.isArray(step.exact) ? step.exact : [];
      let found = null;
      for (let i = 0; i < traceEvents.length; i++) {
        if (used.has(i)) continue;
        const e = traceEvents[i];
        if (matchesExpected(e, expectedMsg, exact)) {
          found = { i, e };
          break;
        }
      }
      if (!found) {
        errors.push(`expect: не найден шаг "${step.name || 'без имени'}"`);
        continue;
      }
      used.add(found.i);
      for (const fieldPath of requirePresent) {
        if (deepGet(found.e, fieldPath) == null) {
          errors.push(`policy: отсутствует поле ${fieldPath} у события "${step.name || 'без имени'}"`);
        }
      }
    }
  }

  if (opts.no_extra_events) {
    // Зачем: хотим гарантировать, что trace_id содержит ровно “набор теста” (кроме допустимого шума).
    const ignoreRoles = Array.isArray(opts.ignore_extra_roles) ? opts.ignore_extra_roles : ['OTHER'];
    const ignore = new Set(ignoreRoles);
    const extras = [];
    for (let i = 0; i < traceEvents.length; i++) {
      if (used.has(i)) continue;
      const role = getEventRole(traceEvents[i]);
      if (ignore.has(role)) continue;
      const e = traceEvents[i];
      const devType = e.device?.type ?? 'N/A';
      const devHuman = e.device?.human ?? 'N/A';
      const at = e.extra?.action_type ?? 'N/A';
      extras.push(`[${role}] id=${e.id} param=${e.param} device.type=${devType} device.human="${devHuman}" new=${String(e.new)} action_type=${at} ts=${e.timestamp}`);
    }
    if (extras.length) {
      const max = Number.isFinite(opts.max_extra_lines) ? opts.max_extra_lines : 12;
      errors.push(`no_extra_events: найдено лишних событий в trace_id: ${extras.length}`);
      for (const l of extras.slice(0, max)) errors.push(`no_extra_events: лишнее: ${l}`);
      if (extras.length > max) errors.push(`no_extra_events: ... truncated: показано ${max} из ${extras.length}`);
    }
  }

  return { errors, used };
}

function runChecks(traceEvents, traceSpec) {
  const errors = [];

  for (const check of traceSpec.checks || []) {
    switch (check.type) {
      case 'full_chain': {
        // Зачем: в боевых и e2e логах роль ACTUATOR может быть представлена как отдельным событием канала,
        // так и маркерами extra.actuator_* на CONSUMER событии.
        const roles = traceEvents.map(getEventRole);
        const has = {
          SCRIPT: roles.includes('SCRIPT'),
          CONSUMER: traceEvents.some((e) => e?.device?.consumer === true),
          ACTUATOR: roles.includes('ACTUATOR') || traceEvents.some((e) => !!(e?.extra && (e.extra.actuator_on || e.extra.actuator_off || e.extra.actuator_update)))
        };
        const foundRoles = Object.entries(has).filter(([, v]) => v).map(([k]) => k);
        for (const required of check.roles || []) {
          if (!has[required]) {
            errors.push(`full_chain: отсутствует роль ${required} (найдено: ${foundRoles.join(', ') || '—'})`);
          }
        }
        if (check.order) {
          const isActuatorMarker = (e) => !!(e?.extra && (e.extra.actuator_on || e.extra.actuator_off || e.extra.actuator_update));
          const isEndDeviceMarker = (e) => !!(e?.extra && (e.extra.end_device_on || e.extra.end_device_off || e.extra.end_device_update));
          const isActuatorForOrder = (e) => (getEventRole(e) === 'ACTUATOR') || ((getEventRole(e) !== 'SOURCE') && (isActuatorMarker(e) || isEndDeviceMarker(e)));
          const firstTs = {
            SCRIPT: Math.min(...traceEvents.filter((e) => getEventRole(e) === 'SCRIPT').map((e) => e.timestamp)),
            ACTUATOR: Math.min(...traceEvents.filter(isActuatorForOrder).map((e) => e.timestamp)),
            CONSUMER: Math.min(...traceEvents.filter((e) => e?.device?.consumer === true).map((e) => e.timestamp))
          };
          const ok = (a, b) => Number.isFinite(firstTs[a]) && Number.isFinite(firstTs[b]) ? firstTs[a] <= firstTs[b] : true;
          // Зачем: в реальном WS (и в наших логах) обновление CONSUMER и канала (/dim/*) может приходить
          // с разницей в 1–3мс в любом порядке. Жёстко требуем только причинный порядок:
          // SCRIPT должен быть раньше любых изменений устройств.
          if (!ok('SCRIPT', 'ACTUATOR')) errors.push('full_chain order: SCRIPT должен быть раньше ACTUATOR');
          if (!ok('SCRIPT', 'CONSUMER')) errors.push('full_chain order: SCRIPT должен быть раньше CONSUMER');
        }
        break;
      }
      case 'no_extra_events': {
        // Зачем: сам контроль “нет лишних событий” делаем в matchExpectations(),
        // чтобы можно было вывести список лишних событий в отчёт/ошибку.
        break;
      }
      case 'sequence': {
        const minDiff = typeof check.min_timestamp_diff_ms === 'number' ? check.min_timestamp_diff_ms : 1;
        for (let i = 1; i < traceEvents.length; i++) {
          const diff = traceEvents[i].timestamp - traceEvents[i - 1].timestamp;
          if (diff < minDiff) errors.push(`sequence: timestamp не возрастает (diff=${diff} < ${minDiff})`);
        }
        break;
      }
      case 'logger_pid': {
        if (check.all_events_must_have) {
          for (const e of traceEvents) {
            if (!e.logger_pid) errors.push(`logger_pid: событие ${e.id}/${e.param} без logger_pid`);
          }
        }
        break;
      }
      case 'no_other': {
        const allowed = new Set(check.only_roles || []);
        for (const e of traceEvents) {
          const role = getEventRole(e);
          if (!allowed.has(role)) {
            errors.push(`no_other: найдено событие роли ${role}: ${e.id}/${e.param}`);
          }
        }
        break;
      }
      case 'action_type': {
        if (check.script_events_must_have) {
          for (const e of traceEvents.filter((x) => getEventRole(x) === 'SCRIPT')) {
            if (!e.extra || !e.extra.action_type) {
              errors.push(`action_type: SCRIPT ${e.id} без extra.action_type`);
            }
          }
        }
        for (const expected of check.expected_action_types || []) {
          const e = traceEvents.find((x) => getEventRole(x) === 'SCRIPT' && x.id === expected.script_id);
          if (!e) {
            errors.push(`action_type: не найден SCRIPT ${expected.script_id}`);
          } else if (e.extra?.action_type !== expected.action_type) {
            errors.push(`action_type: ${expected.script_id} ожидался ${expected.action_type}, получен ${e.extra?.action_type}`);
          }
        }
        break;
      }
      case 'different_trace_id': {
        // Этот check проверяется на уровне набора traces (см. ниже).
        break;
      }
      default:
        errors.push(`Неизвестный check.type=${check.type}`);
    }
  }

  return errors;
}

function pickBestTraceIdByChecks(allEvents, candidates, chainSpec) {
  // Зачем: даже в e2e возможны несколько trace_id по одному якорю (флап/шум/дубли),
  // выбираем тот, который лучше всего проходит checks.
  let best = null;
  for (const traceId of candidates) {
    const traceEvents = allEvents
      .filter((e) => e.trace_id === traceId)
      .sort((a, b) => a.timestamp - b.timestamp);
    const errors = runChecks(traceEvents, chainSpec);
    const score = errors.length;
    if (!best || score < best.score || (score === best.score && traceEvents.length > best.traceEvents.length)) {
      best = { traceId, traceEvents, errors, score };
    }
  }
  return best;
}

test('trace-chain: YAML сеты (Увлажнение)', { timeout: 30000 }, async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('RUN_INTEGRATION!=1');
    return;
  }

  const scenarioPath = path.join(process.cwd(), 'scripts', 'test', 'scenarios', 'trace-scenarios.yaml');
  const scenario = loadScenarioYaml(scenarioPath);
  assert.ok(Array.isArray(scenario.sets) && scenario.sets.length > 0, 'YAML должен содержать sets[]');

  for (const setSpec of scenario.sets) {
    const setName = setSpec.name || setSpec.id || 'Без имени';

    const wsSteps = setSpec.input?.ws || [];
    const { init, run } = splitWsByPhase(wsSteps);
    const initMap = buildInitStateMapFromWsInit(init);
    assert.ok(initMap.size > 0, `Set="${setName}": init state пустой`);

    const daemon = await createFakeDaemonFromScenario({ initStateMap: initMap });
    const loggerScript = path.join(process.cwd(), 'src', 'logging', 'event-logger.js');

    const baseTmp = path.join(process.cwd(), 'var', 'tmp');
    fs.mkdirSync(baseTmp, { recursive: true });
    const tmpRoot = fs.mkdtempSync(path.join(baseTmp, 'trace-chain-test-'));

    const child = spawn(process.execPath, [loggerScript], {
      cwd: tmpRoot,
      env: {
        ...process.env,
        DAEMON_WS_URL: `ws://127.0.0.1:${daemon.port}`,
        OPENSEARCH_ENABLED: 'false',
        // Зачем: в боевом WS факты выполнения скриптов часто отсутствуют, и SCRIPT executed восстанавливаем синтетикой
        // на основании явных связей (action graph) и изменений устройств. Поэтому в trace-chain тесте синтетику включаем.
        SYNTHETIC_SCRIPT_EVENTS: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
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
          throw new Error(`Timeout waiting for logger init. set="${setName}" stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`);
        }
        await sleep(25);
      }

      const ws = daemon.getClient();
      assert.ok(ws, 'fake daemon client должен быть подключен');

      for (const step of run) {
        const delay = typeof step.delay_ms === 'number' ? step.delay_ms : 0;
        if (delay) await sleep(delay);
        ws.send(JSON.stringify(step.msg));
      }

      await sleep(300);

      const today = new Date().toISOString().split('T')[0];
      // Зачем: логгер хранит события в logs/logger/events (новая структура), но оставляем fallback на старый var/log.
      const logFileCandidates = [
        path.join(tmpRoot, 'logs', 'logger', 'events', `events-${today}.jsonl`),
        path.join(tmpRoot, 'var', 'log', `events-${today}.jsonl`),
      ];
      const logFile = logFileCandidates.find((p) => fs.existsSync(p)) || logFileCandidates[0];
      const allEvents = filterByLoggerPid(readJsonlEvents(logFile), child.pid);
      assert.ok(allEvents.length > 0, `Set="${setName}": должны быть события от тестового логгера`);

      const anchor = setSpec.output?.anchor;
      assert.ok(anchor && anchor.device_human, `Set="${setName}": отсутствует output.anchor`);
      const candidates = findTraceIdsByAnchor(allEvents, anchor);
      assert.ok(candidates.length > 0, `Set="${setName}": не найдено trace_id по якорю consumer_human=${anchor.device_human}`);

      // Выбор trace_id и валидация внутри одного trace_id.
      let best = null;
      for (const traceId of candidates) {
        const traceEvents = allEvents.filter((e) => e.trace_id === traceId).sort((a, b) => a.timestamp - b.timestamp);
        const errors = [];
        const fullChain = Array.isArray(setSpec.output?.checks)
          ? setSpec.output.checks.find((c) => c && c.type === 'full_chain')
          : null;
        const ordered = !(fullChain && fullChain.order === false);
        const noExtra = Array.isArray(setSpec.output?.checks)
          ? setSpec.output.checks.find((c) => c && c.type === 'no_extra_events')
          : null;
        const ignoreExtraRoles = Array.isArray(noExtra?.ignore_roles) ? noExtra.ignore_roles : ['OTHER'];
        const { errors: expErrors } = matchExpectations(traceEvents, setSpec.output, scenario.policy, {
          ordered,
          no_extra_events: Boolean(noExtra),
          ignore_extra_roles: ignoreExtraRoles,
          max_extra_lines: process.env.TRACE_REPORT_MAX_EXTRA ? Number(process.env.TRACE_REPORT_MAX_EXTRA) : 12,
        });
        errors.push(...expErrors);
        errors.push(...runChecks(traceEvents, { checks: setSpec.output?.checks || [] }));
        const score = errors.length;
        if (!best || score < best.score || (score === best.score && traceEvents.length > best.traceEvents.length)) {
          best = { traceId, traceEvents, errors, score };
        }
      }

      if (best.errors.length) {
        const dump = best.traceEvents.map((e) => {
          const role = getEventRole(e);
          const devType = e.device?.type ?? 'N/A';
          const devHuman = e.device?.human ?? 'N/A';
          const at = e.extra?.action_type ?? 'N/A';
          return `[${role}] id=${e.id} param=${e.param} device.type=${devType} device.human="${devHuman}" new=${String(e.new)} action_type=${at} ts=${e.timestamp}`;
        }).join('\n');
        const dimEvents = allEvents
          .filter((e) => typeof e.id === 'string' && e.id.includes('/dim/3'))
          .slice(0, 20)
          .map((e) => `id=${e.id} trace=${String(e.trace_id || '').slice(0, 8)} param=${e.param} new=${String(e.new)} extraKeys=${e.extra ? Object.keys(e.extra).join(',') : 'none'}`)
          .join('\n');
        assert.fail(
          `Set="${setName}" failed:\n- ${best.errors.join('\n- ')}\n\n` +
          `Candidates: ${candidates.length}\nSelected trace_id=${String(best.traceId).slice(0, 8)}...\n\n` +
          `Events in selected trace:\n${dump}\n\n` +
          `Dim events sample (first 20):\n${dimEvents || '(none)'}`
        );
      }

      assert.equal(stderr.trim(), '', `Set="${setName}": stderr должен быть пустым`);
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      try { daemon.wss.close(); } catch {}
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    }
  }
});


