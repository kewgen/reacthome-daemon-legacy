/**
 * Резолв целевых устройств скрипта.
 *
 * Зачем: в проде цепочки часто выглядят как schedule/clock → script → device,
 * а также встречаются вложенные скрипты (script → onTrue → script → device).
 * Эту логику нужно покрывать юнит‑тестами, поэтому держим её «чистой» (без I/O).
 */

/**
 * @typedef {{ get: (id: string) => any }} StateLike
 */

/**
 * @param {StateLike} stateLike
 * @param {string} scriptId
 * @param {{ visitedScripts?: Set<string> }} [opts]
 * @returns {Set<string>}
 */
function getScriptTargetDeviceIds(stateLike, scriptId, opts = {}) {
  const visitedScripts = opts.visitedScripts || new Set();

  if (!scriptId || typeof scriptId !== 'string') return new Set();
  if (!stateLike || typeof stateLike.get !== 'function') return new Set();
  if (visitedScripts.has(scriptId)) return new Set(); // Зачем: защита от циклов script→script
  visitedScripts.add(scriptId);

  const script = stateLike.get(scriptId);
  if (!script || typeof script !== 'object' || !Array.isArray(script.action)) return new Set();

  const targets = new Set();

  /** @param {any} maybeId */
  const addId = (maybeId) => {
    if (!maybeId || typeof maybeId !== 'string') return;

    const obj = stateLike.get(maybeId);
    const isNestedScript = !!(obj && typeof obj === 'object' && Array.isArray(obj.action));
    if (isNestedScript) {
      // Зачем: вложенный скрипт — это тоже явная цель.
      // Добавляем ЕГО id в targets, чтобы родитель мог проставить trace_id дочернему скрипту без временных эвристик.
      targets.add(maybeId);
      const nestedTargets = getScriptTargetDeviceIds(stateLike, maybeId, { visitedScripts });
      for (const t of nestedTargets) targets.add(t);
      return;
    }

    targets.add(maybeId);
  };

  for (const actionId of script.action) {
    const actionObj = stateLike.get(actionId);
    if (!actionObj || typeof actionObj !== 'object') continue;

    // Прямые ссылки
    addId(actionObj.id);
    addId(actionObj.ref);
    addId(actionObj.target);

    // payload.* ссылки
    const p = actionObj.payload;
    if (p && typeof p === 'object') {
      addId(p.id);
      addId(p.target);

      // Зачем: многие action-объекты хранят целевые ссылки во вложенном payload.payload.*
      // (например ACTION_ON/OFF → payload: { payload: { id: <deviceId> } }).
      const pp = p.payload;
      if (pp && typeof pp === 'object') {
        addId(pp.id);
        addId(pp.target);
        if (Array.isArray(pp.test)) {
          for (const t of pp.test) addId(t);
        }
        addId(pp.onOn);
        addId(pp.onOff);
        addId(pp.onTrue);
        addId(pp.onFalse);
        addId(pp.onOpen);
        addId(pp.onClose);
        addId(pp.onChange);
        addId(pp.onDoppler);
      }

      // Зачем: ACTION_TOGGLE хранит список целевых устройств в payload.test[],
      // без этого consumer не попадает в trace_id (пример: 6.D.L.3 Toggle).
      if (Array.isArray(p.test)) {
        for (const t of p.test) addId(t);
      }

      // Зачем: ветки toggle часто задаются как onOn/onOff (а не onTrue/onFalse),
      // иначе "6.D.L.3 on/off" выпадают из цепочки целей.
      addId(p.onOn);
      addId(p.onOff);

      // Зачем: clock/timer/датчики запускают скрипты через onTrue/onFalse/...,
      // без этого "Ежеминутник" не связывается с устройствами и выпадает из OFF-трейса.
      addId(p.onTrue);
      addId(p.onFalse);
      addId(p.onOpen);
      addId(p.onClose);
      addId(p.onChange);
      addId(p.onDoppler);
    }

    // site → устройства локации
    if (Array.isArray(actionObj.site)) {
      for (const siteId of actionObj.site) {
        const siteObj = stateLike.get(siteId);
        if (!siteObj || typeof siteObj !== 'object') continue;
        const siteDevices = [
          ...(siteObj.device || []),
          ...(siteObj.do || []),
          ...(siteObj.dim || [])
        ];
        for (const devId of siteDevices) addId(devId);
      }
    }
  }

  // Зачем: если целевое устройство привязано к каналу/актуатору через bind,
  // добавляем и его, чтобы trace_id переносился на канал даже если канал-событие пришло раньше consumer.
  for (const id of Array.from(targets)) {
    const obj = stateLike.get(id);
    if (obj && typeof obj === 'object' && typeof obj.bind === 'string' && obj.bind) {
      targets.add(obj.bind);
    }
  }

  return targets;
}

module.exports = {
  getScriptTargetDeviceIds
};

