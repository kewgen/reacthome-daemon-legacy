const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const {
  loadScenarioYaml,
  normalizeHuman,
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
  if (event && event.param === 'value' && typeof event.id === 'string' && event.id.includes('/di/')) {
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

function validateExpectations(traceEvents, outputSpec, policy, opts = {}) {
  const errors = [];
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
      idx = found.i + 1;
      for (const fieldPath of requirePresent) {
        if (deepGet(found.e, fieldPath) == null) {
          errors.push(`policy: отсутствует поле ${fieldPath} у события "${step.name || 'без имени'}"`);
        }
      }
    }
  } else {
    // Зачем: в боевых логах порядок сообщений от демона и “синтетических” SCRIPT может отличаться,
    // но нам важно наличие полного набора событий в одном trace_id.
    const used = new Set(); // индексы уже сопоставленных событий
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

  return errors;
}

function runChecks(traceEvents, traceSpec) {
  const errors = [];
  for (const check of traceSpec.checks || []) {
    switch (check.type) {
      case 'full_chain': {
        // Зачем: в боевых логах роль ACTUATOR может быть как отдельным событием канала,
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
        // Зачем: в боевых логах порядок по timestamp может быть “перевёрнут” из-за синтетики и источников времени.
        // Строгий порядок включаем только по явному флагу.
        if (check.order && process.env.PROD_TRACE_STRICT_ORDER === '1') {
          const isActuatorMarker = (e) => !!(e?.extra && (e.extra.actuator_on || e.extra.actuator_off || e.extra.actuator_update));
          const isEndDeviceMarker = (e) => !!(e?.extra && (e.extra.end_device_on || e.extra.end_device_off || e.extra.end_device_update));
          const isActuatorForOrder = (e) => (getEventRole(e) === 'ACTUATOR') || ((getEventRole(e) !== 'SOURCE') && (isActuatorMarker(e) || isEndDeviceMarker(e)));
          const firstTs = {
            SCRIPT: Math.min(...traceEvents.filter((e) => getEventRole(e) === 'SCRIPT').map((e) => e.timestamp)),
            ACTUATOR: Math.min(...traceEvents.filter(isActuatorForOrder).map((e) => e.timestamp)),
            CONSUMER: Math.min(...traceEvents.filter((e) => e?.device?.consumer === true).map((e) => e.timestamp))
          };
          const ok = (a, b) => Number.isFinite(firstTs[a]) && Number.isFinite(firstTs[b]) ? firstTs[a] <= firstTs[b] : true;
          if (!ok('SCRIPT', 'ACTUATOR')) errors.push('full_chain order: SCRIPT должен быть раньше ACTUATOR');
          if (!ok('ACTUATOR', 'CONSUMER')) errors.push('full_chain order: ACTUATOR должен быть раньше CONSUMER');
        }
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
          if (!allowed.has(role)) errors.push(`no_other: найдено событие роли ${role}: ${e.id}/${e.param}`);
        }
        break;
      }
      case 'action_type': {
        if (check.script_events_must_have) {
          for (const e of traceEvents.filter((x) => getEventRole(x) === 'SCRIPT')) {
            if (!e.extra || !e.extra.action_type) errors.push(`action_type: SCRIPT ${e.id} без extra.action_type`);
          }
        }
        for (const expected of check.expected_action_types || []) {
          const e = traceEvents.find((x) => getEventRole(x) === 'SCRIPT' && x.id === expected.script_id);
          if (!e) errors.push(`action_type: не найден SCRIPT ${expected.script_id}`);
          else if (e.extra?.action_type !== expected.action_type) {
            errors.push(`action_type: ${expected.script_id} ожидался ${expected.action_type}, получен ${e.extra?.action_type}`);
          }
        }
        break;
      }
      case 'different_trace_id':
        break;
      default:
        errors.push(`Неизвестный check.type=${check.type}`);
    }
  }
  return errors;
}

function runChecksProd(traceEvents, traceSpec) {
  // Зачем: в боевых логах ID скриптов отличаются от тестовых, поэтому проверки по script_id неприменимы.
  const spec = JSON.parse(JSON.stringify(traceSpec));
  if (spec.checks) {
    spec.checks = spec.checks.filter((c) => c.type !== 'no_other'); // Зачем: в бою в trace_id часто попадают телеметрии (humidity/температура), это нормально.
    for (const c of spec.checks) {
      if (c.type === 'action_type' && Array.isArray(c.expected_action_types)) delete c.expected_action_types;
    }
  }
  return runChecks(traceEvents, spec);
}

async function scanJsonlForCandidateTraceIds(filePath, anchors) {
  /** @type {Map<string, Set<string>>} */
  const found = new Map(); // anchorKey -> traceIds
  for (const a of anchors) found.set(a.key, new Set());

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || !e.trace_id) continue;
    if (!e.device || e.device.consumer !== true) continue;
    const human = normalizeHuman(e.device.human);
    for (const a of anchors) {
      if (human !== a.consumerHuman) continue;
      if (a.consumerId != null && String(e.id) !== a.consumerId) continue;
      if (a.consumerParam != null && e.param !== a.consumerParam) continue;
      if (a.consumerNew != null && e.new !== a.consumerNew) continue;
      found.get(a.key).add(e.trace_id);
    }
  }

  return found;
}

async function collectEventsForTraceIds(filePath, traceIds) {
  /** @type {Map<string, any[]>} */
  const map = new Map();
  for (const id of traceIds) map.set(id, []);

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || !e.trace_id) continue;
    if (!map.has(e.trace_id)) continue;
    map.get(e.trace_id).push(e);
  }

  for (const [tid, events] of map.entries()) {
    events.sort((a, b) => a.timestamp - b.timestamp);
    map.set(tid, events);
  }
  return map;
}

function pickBestTraceId(traceIds, eventsByTraceId, traceSpec) {
  let best = null;
  for (const tid of traceIds) {
    const events = eventsByTraceId.get(tid) || [];
    const errors = runChecksProd(events, traceSpec);
    const score = errors.length;
    if (!best || score < best.score || (score === best.score && events.length > best.events.length)) {
      best = { traceId: tid, errors, events, score };
    }
  }
  return best;
}

function formatTraceLine(e) {
  const ts = typeof e.timestamp === 'number' ? new Date(e.timestamp).toISOString() : 'N/A';
  const role = getEventRole(e);
  const human = e.device?.human != null ? String(e.device.human) : 'N/A';
  const id = e.id != null ? String(e.id) : 'N/A';
  const param = e.param != null ? String(e.param) : 'N/A';
  const newVal = e.new === undefined ? '∅' : JSON.stringify(e.new);
  const at = e.extra?.action_type != null ? String(e.extra.action_type) : 'N/A';
  const lp = e.logger_pid != null ? String(e.logger_pid) : 'N/A';
  return `${ts} [${role}] id=${id} param=${param} new=${newVal} action_type=${at} human="${human}" logger_pid=${lp}`;
}

test('prod-log: валидация боевых логов по YAML сетам', { timeout: 600000 }, async (t) => {
  if (process.env.RUN_PROD_TRACE_VALIDATION !== '1') {
    t.skip('RUN_PROD_TRACE_VALIDATION!=1');
    return;
  }

  const repoRoot = process.cwd();
  const scenariosDir = path.join(repoRoot, 'scripts', 'test', 'scenarios');
  const scenarios = fs.readdirSync(scenariosDir).filter((f) => f.endsWith('.yaml'));
  assert.ok(scenarios.length > 0, 'Нет YAML сетов в scripts/test/scenarios');

  const today = new Date().toISOString().split('T')[0];
  const logDir = path.join(repoRoot, 'var', 'log');

  const explicitFiles = process.env.TRACE_PROD_LOG_FILES
    ? process.env.TRACE_PROD_LOG_FILES.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const logFiles = explicitFiles && explicitFiles.length
    ? explicitFiles.map((p) => path.isAbsolute(p) ? p : path.join(repoRoot, p))
    : fs.readdirSync(logDir)
      .filter((f) => f.startsWith(`events-${today}`) && f.endsWith('.jsonl'))
      .map((f) => path.join(logDir, f));

  // Зачем: на локальной машине могут отсутствовать логи за "сегодня" (ротация/перенос),
  // тогда берём самые свежие events-*.jsonl в var/log.
  if (!logFiles.length && (!explicitFiles || !explicitFiles.length)) {
    const candidates = fs.readdirSync(logDir)
      .filter((f) => f.startsWith('events-') && f.endsWith('.jsonl') && !f.startsWith('events-test-'))
      .map((f) => path.join(logDir, f))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3)
      .map((x) => x.p);
    logFiles.push(...candidates);
  }

  assert.ok(logFiles.length > 0, `Не найдены боевые логи events-${today}*.jsonl (и не найдено fallback events-*.jsonl) и не задан TRACE_PROD_LOG_FILES`);

  const reportLines = [];
  reportLines.push(`# Валидация боевых логов по TraceSet\n`);
  reportLines.push(`Дата: ${today}\n`);
  reportLines.push(`Файлы:`);
  for (const f of logFiles) reportLines.push(`- \`${f}\``);
  reportLines.push('');

  let totalFailures = 0;

  for (const scenarioFile of scenarios) {
    const scenarioPath = path.join(scenariosDir, scenarioFile);
    const scenario = loadScenarioYaml(scenarioPath);
    reportLines.push(`## YAML: ${scenario.name || scenarioFile}`);
    if (scenario.description) reportLines.push(`Описание: ${scenario.description}`);
    reportLines.push('');

    const anchors = [];
    assert.ok(Array.isArray(scenario.sets), `YAML должен содержать sets[]: ${scenarioFile}`);
    for (const setSpec of scenario.sets) {
      const setName = setSpec.name || setSpec.id || 'Без имени';
      reportLines.push(`### Set: ${setName}`);
      reportLines.push('');

      const anchor = setSpec.output?.anchor;
      assert.ok(anchor && anchor.device_human, `Set "${setName}" в ${scenarioFile}: отсутствует output.anchor.device_human`);
      anchors.push({
        key: `${scenarioFile}::${setSpec.id || setName}`,
        consumerHuman: normalizeHuman(anchor.device_human),
        consumerId: anchor.id ? String(anchor.id) : null,
        consumerParam: anchor.param,
        consumerNew: anchor.new,
        setSpec,
        setName
      });
    }

    // 1) находим кандидаты trace_id для каждого якоря по всем файлам
    /** @type {Map<string, Set<string>>} */
    const anchorToTraceIds = new Map();
    for (const a of anchors) anchorToTraceIds.set(a.key, new Set());

    for (const filePath of logFiles) {
      const found = await scanJsonlForCandidateTraceIds(filePath, anchors);
      for (const [key, ids] of found.entries()) {
        const set = anchorToTraceIds.get(key);
        for (const id of ids) set.add(id);
      }
    }

    // 2) собираем события для всех найденных trace_id (по всем файлам)
    const allTraceIds = new Set();
    for (const ids of anchorToTraceIds.values()) for (const id of ids) allTraceIds.add(id);

    /** @type {Map<string, any[]>} */
    const eventsByTraceId = new Map();
    for (const id of allTraceIds) eventsByTraceId.set(id, []);

    for (const filePath of logFiles) {
      const partial = await collectEventsForTraceIds(filePath, allTraceIds);
      for (const [tid, arr] of partial.entries()) {
        eventsByTraceId.set(tid, (eventsByTraceId.get(tid) || []).concat(arr));
      }
    }
    for (const [tid, arr] of eventsByTraceId.entries()) {
      arr.sort((a, b) => a.timestamp - b.timestamp);
      eventsByTraceId.set(tid, arr);
    }

    // 3) проверяем каждый traceSpec, выбираем лучший traceId кандидата
    const resolved = new Map(); // anchorKey -> {traceId, errors}
    for (const a of anchors) {
      const ids = Array.from(anchorToTraceIds.get(a.key));
      reportLines.push(`#### Set: ${a.setName}`);
      reportLines.push(`Якорь (CONSUMER human): \`${a.consumerHuman}\``);
      reportLines.push(`Кандидаты trace_id: ${ids.length}`);

      if (!ids.length) {
        totalFailures++;
        reportLines.push(`Статус: FAIL (не найдено ни одного trace_id по якорю)`);
        reportLines.push('');
        continue;
      }

      // Выбираем лучший trace_id по ошибкам (валидация внутри одного trace_id).
      let best = null;
      for (const tid of ids) {
        const events = (eventsByTraceId.get(tid) || []).slice().sort((x, y) => x.timestamp - y.timestamp);
        const errors = [];
        errors.push(...validateExpectations(events, a.setSpec.output, scenario.policy, { ordered: false }));
        errors.push(...runChecksProd(events, { checks: a.setSpec.output?.checks || [] }));
        const score = errors.length;
        if (!best || score < best.score || (score === best.score && events.length > best.events.length)) {
          best = { traceId: tid, errors, events, score };
        }
      }
      resolved.set(a.key, { traceId: best.traceId, errors: best.errors });

      reportLines.push(`Выбран trace_id: \`${String(best.traceId).slice(0, 8)}...\` (событий: ${best.events.length})`);
      // Компактный таймлайн событий в выбранном trace_id (по timestamp).
      // Зачем: быстро глазами понять последовательность без ручного grep по JSONL.
      const maxLines = process.env.TRACE_REPORT_MAX_LINES ? Number(process.env.TRACE_REPORT_MAX_LINES) : 80;
      const lines = best.events.slice(0, Number.isFinite(maxLines) ? maxLines : 80).map(formatTraceLine);
      reportLines.push('');
      reportLines.push('Таймлайн (выбранный trace_id):');
      reportLines.push('```');
      for (const l of lines) reportLines.push(l);
      if (best.events.length > lines.length) {
        reportLines.push(`... truncated: показано ${lines.length} из ${best.events.length}`);
      }
      reportLines.push('```');
      if (best.errors.length) {
        totalFailures++;
        reportLines.push(`Статус: FAIL`);
        reportLines.push(`Ошибки:`);
        for (const err of best.errors) reportLines.push(`- ${err}`);
      } else {
        reportLines.push(`Статус: OK`);
      }
      reportLines.push('');
    }

    // В новом формате каждый set самодостаточен и валидируется в рамках одного trace_id.
  }

  const reportsDir = path.join(repoRoot, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `trace-test-prod-${today}.md`);
  fs.writeFileSync(reportPath, reportLines.join('\n') + '\n', 'utf8');

  // Жёсткий режим по умолчанию.
  // Зачем: в CI/при ручной проверке хотим падать при любом расхождении.
  // Для "только отчёт" режима используем TRACE_PROD_SOFT=1.
  if (process.env.TRACE_PROD_SOFT === '1') {
    assert.ok(true, `SOFT: ошибки=${totalFailures}, отчёт=${reportPath}`);
    return;
  }

  assert.equal(totalFailures, 0, `Найдены ошибки валидации боевых логов. Отчёт: ${reportPath}`);
});


