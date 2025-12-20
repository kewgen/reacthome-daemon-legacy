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

  return targets;
}

module.exports = {
  getScriptTargetDeviceIds
};

