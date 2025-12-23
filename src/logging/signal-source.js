/**
 * Резолвер источников сигнала (WS -> нормализованный объект).
 *
 * Зачем: унифицируем определение "кто/что запустило цепочку" и делаем это тестируемым.
 * Важно: мы НЕ обогащаем WS сообщения — добавляем метаданные только в события логгера.
 */

/**
 * @typedef {Object} SignalSource
 * @property {'manual'|'scheduler'|'timer'|'sensor'|'script'|'unknown'} kind
 * @property {string|null} channel - Подвид источника (например, 's4', 'doppler')
 * @property {string|null} description
 * @property {{id: string|null, human: string|null, channel_id: string|null}} device
 * @property {{phase: 'down'|'move'|'up'|'unknown', value: any, gesture_id: string|null, click_kind: 'press'|'click'|'double_click'|'hold'|'dimming'|'unknown', duration_ms: number|null}} action
 * @property {{trigger_scripts: {onClick: string[], onClick2: string[], onHold: string[]}, inferred_from: 'device'|'di'|'none'}} linked
 * @property {{confidence: 'high'|'medium'|'low', reason: string}} meta
 */

// Зачем: удержания/диммирование на S4 могут длиться несколько секунд; короткое окно рвёт жест и дробит trace_id.
const DEFAULT_GESTURE_MAX_IDLE_MS = 10000;
const DOUBLE_CLICK_WINDOW_MS = 350;
// Зачем: обычный "клик" на S4 часто длится ~1s; низкий порог ошибочно превращает клики в hold.
const HOLD_MIN_MS = 2500;

const pickStrings = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];

const isS4LikeText = (s) => typeof s === 'string' && /^S4\b/i.test(s.trim());

const inferHuman = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  return obj.human || obj.title || obj.code || obj.name || null;
};

const inferIsS4 = (id, payload, stateObj) => {
  if (typeof id === 'string' && id.includes('/di/')) return true; // DI под S4
  const p = payload && typeof payload === 'object' ? payload : null;
  const s = stateObj && typeof stateObj === 'object' ? stateObj : null;
  return Boolean(
    isS4LikeText(p?.code) ||
    isS4LikeText(p?.title) ||
    isS4LikeText(p?.name) ||
    isS4LikeText(s?.code) ||
    isS4LikeText(s?.title) ||
    isS4LikeText(s?.name) ||
    isS4LikeText(s?.human)
  );
};

const mergeTriggers = (dst, src) => {
  if (!src || typeof src !== 'object') return;
  for (const k of ['onClick', 'onClick2', 'onHold']) {
    for (const x of pickStrings(src[k])) dst[k].push(x);
  }
};

const uniq = (arr) => Array.from(new Set(arr));

/**
 * @param {any} message - WS сообщение (обычно {type:'ACTION_SET', id, payload})
 * @param {{state: Map<string, any>, cache: Map<string, any>}} deps
 * @returns {SignalSource}
 */
function resolveSignalSourceFromWs(message, deps) {
  const state = deps && deps.state;
  const cache = deps && deps.cache;

  const id = message && typeof message === 'object' ? message.id : null;
  const payload = message && typeof message === 'object' ? message.payload : null;
  const msgType = message && typeof message === 'object' ? message.type : null;

  /** @type {SignalSource} */
  const base = {
    kind: 'unknown',
    channel: null,
    description: null,
    device: { id: typeof id === 'string' ? id : null, human: null, channel_id: null },
    action: { phase: 'unknown', value: null, gesture_id: null, click_kind: 'unknown', duration_ms: null },
    linked: { trigger_scripts: { onClick: [], onClick2: [], onHold: [] }, inferred_from: 'none' },
    meta: { confidence: 'low', reason: 'unknown' }
  };

  if (msgType !== 'ACTION_SET' || !id || !payload || typeof payload !== 'object') return base;

  const ts = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
  const baseId = typeof id === 'string' ? id.split('/')[0] : String(id);

  const stateObj = state && typeof state.get === 'function' ? state.get(id) : null;
  const stateBase = state && typeof state.get === 'function' ? state.get(baseId) : null;
  const human = inferHuman(stateObj) || inferHuman(stateBase) || inferHuman(payload) || null;

  base.device.id = baseId;
  base.device.human = human;
  base.device.channel_id = (typeof id === 'string' && id !== baseId) ? id : null;

  // SCRIPT executed/last_execution (если придёт от демона)
  if (payload && (payload.executed !== undefined || payload.last_execution !== undefined) && (payload.type === 'script' || payload.type === 'SCRIPT')) {
    const isSchedulerLike = Boolean(payload.clock || payload.schedule || payload.timer || payload.duration);
    base.kind = isSchedulerLike ? 'scheduler' : 'script';
    base.channel = base.kind;
    base.description = isSchedulerLike ? 'Запуск скрипта по расписанию/таймеру' : 'Запуск скрипта';
    base.meta = { confidence: 'high', reason: 'payload.script.executed' };
    return base;
  }

  // Сенсоры (простое правило: наличие измерений в payload)
  for (const k of ['doppler', 'motion', 'temperature', 'humidity', 'co2', 'pressure']) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) {
      base.kind = 'sensor';
      base.channel = 'sensor';
      base.description = `Измерение датчика (${k})`;
      base.action = { phase: 'unknown', value: payload[k], gesture_id: null, click_kind: 'unknown', duration_ms: null };
      base.meta = { confidence: 'medium', reason: `payload.${k}` };
      return base;
    }
  }

  // Manual (S4/DI)
  const isS4 = inferIsS4(id, payload, stateBase);
  if (!isS4) return base;

  base.kind = 'manual';
  base.channel = 's4';
  base.description = 'Панель S4';
  base.meta = { confidence: 'medium', reason: 's4_detected' };

  // Триггеры скриптов храним обычно в DI snapshot
  const triggers = { onClick: [], onClick2: [], onHold: [] };
  const diObj = state && typeof state.get === 'function' ? state.get(`${baseId}/di/1`) : null;
  if (diObj && typeof diObj === 'object') {
    mergeTriggers(triggers, diObj);
    base.linked.inferred_from = 'di';
  } else {
    mergeTriggers(triggers, stateBase);
    base.linked.inferred_from = 'device';
  }
  triggers.onClick = uniq(triggers.onClick);
  triggers.onClick2 = uniq(triggers.onClick2);
  triggers.onHold = uniq(triggers.onHold);
  base.linked.trigger_scripts = triggers;

  // Зачем: в боевом WS клик по S4 иногда приходит НЕ через payload.value,
  // а через инкремент счётчиков в DI (`onClick1Count/onClick2Count/onHoldCount`).
  // Эти события тоже являются источником цепочки и должны нести gesture_id.
  const countKey = (Object.prototype.hasOwnProperty.call(payload, 'onHoldCount') && 'onHoldCount') ||
    (Object.prototype.hasOwnProperty.call(payload, 'onClick2Count') && 'onClick2Count') ||
    (Object.prototype.hasOwnProperty.call(payload, 'onClick1Count') && 'onClick1Count') ||
    null;

  if (countKey) {
    const countVal = payload[countKey];
    base.action.value = countVal;
    base.action.phase = 'down';
    base.action.duration_ms = null;
    base.action.click_kind =
      (countKey === 'onClick2Count') ? 'double_click' :
        (countKey === 'onHoldCount') ? 'hold' :
          'click';

    if (cache && typeof cache.get === 'function' && typeof cache.set === 'function') {
      const st = cache.get(baseId) || { active: null, last_up_ts: null, last_click_up_ts: null };
      const ck = base.action.click_kind;
      const prevKey = `last_count_${ck}`;
      const prevCount = st[prevKey];
      // Зачем: повторяющиеся DI обновления для одного и того же клика должны иметь один gesture_id.
      if (prevCount === countVal && typeof st.last_count_ts === 'number' && (ts - st.last_count_ts) <= DEFAULT_GESTURE_MAX_IDLE_MS && st.last_count_gesture_id) {
        base.action.gesture_id = st.last_count_gesture_id;
      } else {
        base.action.gesture_id = `${baseId}:${countKey}:${String(countVal)}`;
        st[prevKey] = countVal;
        st.last_count_ts = ts;
        st.last_count_gesture_id = base.action.gesture_id;
      }
      cache.set(baseId, st);
      base.meta = { confidence: 'high', reason: `s4_di_${countKey}` };
      return base;
    }

    base.meta = { confidence: 'medium', reason: `s4_di_${countKey}_no_cache` };
    return base;
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'value')) return base;

  const value = payload.value;
  base.action.value = value;

  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') {
    // Без кэша мы не сможем классифицировать double/hold, но всё равно отметим фазу.
    base.action.phase = (value === 0) ? 'up' : 'down';
    base.action.click_kind = (value === 0) ? 'unknown' : 'press';
    base.action.gesture_id = null;
    base.meta = { confidence: 'low', reason: 'no_cache' };
    return base;
  }

  const st = cache.get(baseId) || {
    active: null,
    last_up_ts: null,
    last_click_up_ts: null
  };

  // Истёкшая активность — закрываем жест, если завис
  if (st.active && typeof st.active.last_ts === 'number' && (ts - st.active.last_ts) > DEFAULT_GESTURE_MAX_IDLE_MS) {
    st.active = null;
  }

  if (value === 0) {
    // UP / release
    if (st.active) {
      const duration = Math.max(0, ts - st.active.down_ts);
      const changes = st.active.changes;
      const maxValue = st.active.max_value;

      let clickKind = 'click';
      const hasOnHold = Array.isArray(triggers.onHold) && triggers.onHold.length > 0;
      // Зачем: hold — только когда есть явный смысл (длительное удержание при наличии onHold) или явно был димминг.
      const isDimming = changes >= 2 || (typeof maxValue === 'number' && maxValue >= 10);
      const isHold = (hasOnHold && duration >= HOLD_MIN_MS) || isDimming;
      if (isHold) clickKind = 'hold';
      if (isDimming) clickKind = 'dimming';

      // Double-click эвристика: два завершённых клика подряд в небольшом окне
      if (clickKind === 'click' && typeof st.last_click_up_ts === 'number' && (ts - st.last_click_up_ts) <= DOUBLE_CLICK_WINDOW_MS) {
        clickKind = 'double_click';
      }

      base.action.phase = 'up';
      base.action.click_kind = clickKind;
      base.action.duration_ms = duration;
      base.action.gesture_id = st.active.gesture_id;

      st.last_up_ts = ts;
      st.last_click_up_ts = ts;
      st.active = null;
      cache.set(baseId, st);

      base.meta = { confidence: 'medium', reason: 's4_value_up' };
      return base;
    }

    base.action.phase = 'up';
    base.action.click_kind = 'unknown';
    base.meta = { confidence: 'low', reason: 's4_up_without_active' };
    cache.set(baseId, st);
    return base;
  }

  // DOWN / MOVE
  if (!st.active) {
    st.active = {
      gesture_id: `${baseId}:${ts}`,
      down_ts: ts,
      last_ts: ts,
      last_value: value,
      changes: 0,
      max_value: (typeof value === 'number') ? value : null
    };
    base.action.phase = 'down';
    base.action.click_kind = 'press';
    base.action.gesture_id = st.active.gesture_id;
    st.last_up_ts = null;
    cache.set(baseId, st);
    base.meta = { confidence: 'medium', reason: 's4_value_down' };
    return base;
  }

  // MOVE within same gesture
  const prev = st.active.last_value;
  if (prev !== value) st.active.changes += 1;
  if (typeof value === 'number' && (st.active.max_value == null || value > st.active.max_value)) st.active.max_value = value;
  st.active.last_ts = ts;
  st.active.last_value = value;
  cache.set(baseId, st);

  base.action.phase = 'move';
  base.action.click_kind = (st.active.changes >= 1) ? 'dimming' : 'press';
  base.action.gesture_id = st.active.gesture_id;
  base.meta = { confidence: 'medium', reason: 's4_value_move' };
  return base;
}

module.exports = {
  resolveSignalSourceFromWs
};

