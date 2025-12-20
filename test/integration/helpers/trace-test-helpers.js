const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const yaml = require('js-yaml');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Нормализация device.human для матчей в боевых логах.
 * Зачем: требование — точное совпадение строки после trim().
 */
function normalizeHuman(human) {
  if (human == null) return null;
  return String(human).trim();
}

/**
 * Читает JSONL файл событий и возвращает массив событий.
 * Зачем: единая точка парсинга и диагностики проблем формата.
 */
function readJsonlEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // игнорируем битые строки
    }
  }
  return events;
}

/**
 * Фильтрует события по logger_pid.
 * Зачем: в одном файле могут быть события от разных запусков логгера.
 */
function filterByLoggerPid(events, loggerPid) {
  return events.filter((e) => e && e.logger_pid === loggerPid);
}

/**
 * Загружает YAML сценарий.
 * Зачем: сеты трейсов храним в YAML, чтобы их было легко расширять.
 */
function loadScenarioYaml(scenarioPath) {
  const raw = fs.readFileSync(scenarioPath, 'utf8');
  const scenario = yaml.load(raw);
  assert(scenario && typeof scenario === 'object', `Некорректный YAML: ${scenarioPath}`);
  // Новый формат: sets[].
  // Зачем: каждый set — один сценарий (одна цепочка) с явным input/output.
  if (Array.isArray(scenario.sets)) {
    return scenario;
  }

  // Обратная совместимость: старые форматы (пока не удаляем).
  assert(Array.isArray(scenario.input), `Сценарий должен содержать input[]: ${scenarioPath}`);
  assert(scenario.expected && typeof scenario.expected === 'object', `Сценарий должен содержать expected: ${scenarioPath}`);
  if (!Array.isArray(scenario.expected.sets) && Array.isArray(scenario.expected.traces)) {
    scenario.expected.sets = [{
      name: scenario.name || path.basename(scenarioPath),
      description: scenario.description || null,
      chains: scenario.expected.traces.map((t) => ({
        name: t.name,
        anchor: {
          consumer_human: t.consumer_human,
          consumer_id: t.consumer_id,
          consumer_param: t.consumer_param,
          consumer_new: t.consumer_new
        },
        checks: t.checks || []
      })),
      set_checks: []
    }];
  }
  return scenario;
}

/**
 * Разделяет input на init-state и runtime по маркеру e2e_build_index.
 * Зачем: в e2e init идёт через GET, а последующие события — как live ACTION_SET.
 */
function splitScenarioInput(input) {
  const idx = input.findIndex((m) => m && m.type === 'e2e_build_index');
  if (idx === -1) {
    return { init: input.slice(), runtime: [] };
  }
  return { init: input.slice(0, idx), runtime: input.slice(idx + 1) };
}

/**
 * Собирает init-state map из init input (type=action_set).
 * Зачем: ответ на GET должен вернуть полные payload для всех устройств.
 */
function buildInitStateMap(initInput) {
  const map = new Map();
  for (const msg of initInput) {
    if (!msg || msg.type !== 'action_set') continue;
    assert(msg.id, 'action_set должен содержать id');
    map.set(String(msg.id), msg.payload || {});
  }
  return map;
}

/**
 * Поднимает fake daemon (WS server) с LIST/GET и возможностью отправлять live ACTION_SET.
 * Зачем: тестируем event-logger без реального демона и без сети.
 */
async function createFakeDaemonFromScenario({ initStateMap }) {
  const wss = new WebSocket.Server({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  /** @type {WebSocket|null} */
  let client = null;
  let listReceived = false;
  let getReceived = false;

  const now = Date.now();
  const allIds = Array.from(initStateMap.keys());

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
        // Зачем: LIST возвращает [[id, timestamp]] — логгер потом делает GET по ids.
        ws.send(JSON.stringify({ type: 'list', state: allIds.map((id) => [id, now]) }));
        return;
      }

      if (msg && (msg.type === 'get' || msg.type === 'GET') && Array.isArray(msg.state)) {
        getReceived = true;
        for (const id of msg.state) {
          const payload = initStateMap.get(String(id)) || {};
          ws.send(JSON.stringify({ type: 'ACTION_SET', id, payload: { ...payload, timestamp: payload.timestamp ?? now } }));
        }
      }
    });
  });

  return {
    port,
    wss,
    getClient: () => client,
    waitForHandshake: async (timeoutMs = 5000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (client && listReceived && getReceived) return;
        await sleep(25);
      }
      throw new Error('Timeout waiting for fake daemon LIST/GET handshake');
    }
  };
}

/**
 * Находит trace_id кандидатов по якорю consumer_human.
 * Зачем: требование — боевой анализ опирается на device.human (CONSUMER).
 */
function findTraceIdsByConsumerAnchor(events, { consumer_human, consumer_param, consumer_new }) {
  const wanted = normalizeHuman(consumer_human);
  assert(wanted, 'consumer_human должен быть задан');
  const traceIds = new Set();
  for (const e of events) {
    if (!e || !e.device || e.device.consumer !== true) continue;
    const human = normalizeHuman(e.device.human);
    if (human !== wanted) continue;
    if (consumer_param != null && e.param !== consumer_param) continue;
    if (consumer_new != null && e.new !== consumer_new) continue;
    if (e.trace_id) traceIds.add(e.trace_id);
  }
  return Array.from(traceIds);
}

/**
 * Новый якорь (минимализм): human/id/param/new.
 * Зачем: в YAML теперь якорь хранится как output.anchor.
 */
function findTraceIdsByAnchor(events, anchor) {
  const wanted = normalizeHuman(anchor.device_human);
  assert(wanted, 'anchor.device_human должен быть задан');
  const wantedId = anchor.id ? String(anchor.id) : null;
  const wantedParam = anchor.param != null ? String(anchor.param) : null;
  const wantedNew = anchor.new !== undefined ? anchor.new : undefined;

  const traceIds = new Set();
  for (const e of events) {
    if (!e || !e.device || e.device.consumer !== true) continue;
    const human = normalizeHuman(e.device.human);
    if (human !== wanted) continue;
    if (wantedId && String(e.id) !== wantedId) continue;
    if (wantedParam && String(e.param) !== wantedParam) continue;
    if (wantedNew !== undefined && e.new !== wantedNew) continue;
    if (e.trace_id) traceIds.add(e.trace_id);
  }
  return Array.from(traceIds);
}

function splitWsByPhase(wsSteps) {
  const init = [];
  const run = [];
  for (const s of wsSteps || []) {
    if (!s || !s.msg) continue;
    if (s.phase === 'run') run.push(s);
    else init.push(s);
  }
  return { init, run };
}

function buildInitStateMapFromWsInit(wsInitSteps) {
  const map = new Map();
  for (const s of wsInitSteps || []) {
    if (!s || !s.msg) continue;
    const msg = s.msg;
    if (msg.type !== 'ACTION_SET') continue;
    if (!msg.id) continue;
    map.set(String(msg.id), msg.payload || {});
  }
  return map;
}

module.exports = {
  sleep,
  assert,
  normalizeHuman,
  readJsonlEvents,
  filterByLoggerPid,
  loadScenarioYaml,
  splitScenarioInput,
  buildInitStateMap,
  createFakeDaemonFromScenario,
  findTraceIdsByConsumerAnchor,
  findTraceIdsByAnchor,
  splitWsByPhase,
  buildInitStateMapFromWsInit
};


