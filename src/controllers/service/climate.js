const {
  SITE, THERMOSTAT, HYGROSTAT, CO2_STAT,
  STOP, HEAT, COOL, DRY, WET, VENTILATION,
  ACTION_SCRIPT_RUN, ACTION_START_COOL, ACTION_STOP_COOL,
  ACTION_START_HEAT, ACTION_STOP_HEAT,
  ACTION_START_WET, ACTION_STOP_WET,
  ACTION_START_VENTILATION, ACTION_STOP_VENTILATION,
  ACTION_SETPOINT, ACTION_IMAGE,
  DRIVER_TYPE_INTESIS_BOX, DRIVER_TYPE_MD_CCM18_AN_E,
  DRIVER_TYPE_TICA, DRIVER_TYPE_NOVA, DRIVER_TYPE_SWIFT,
  DRIVER_TYPE_ALINK, DRIVER_TYPE_COMFOVENT,
} = require("../../constants");
const { get, set } = require("../../actions");
const drivers = require("../../drivers");

const handleStartStop = (actionType, stateProp, entityType, entityListProp, callbackProp) => (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const entity = get(id) || {};
      const list = entity[entityListProp] || [];
      for (const i of list) {
        run({ type: actionType, id: i });
      }
      break;
    }
    case entityType: {
      const entity = get(id) || {};
      const callback = entity[callbackProp];
      set(id, { [stateProp]: actionType.includes('START') });
      if (callback) run({ type: ACTION_SCRIPT_RUN, id: callback });
      break;
    }
  }
};

const handleStartCool = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { thermostat = [] } = get(id) || {};
      for (const i of thermostat) run({ type: ACTION_START_COOL, id: i });
      break;
    }
    case THERMOSTAT: {
      const { onStartCool } = get(id) || {};
      set(id, { cool: true });
      if (onStartCool) run({ type: ACTION_SCRIPT_RUN, id: onStartCool });
      break;
    }
  }
};

const handleStopCool = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { thermostat = [] } = get(id) || {};
      for (const i of thermostat) run({ type: ACTION_STOP_COOL, id: i });
      break;
    }
    case THERMOSTAT: {
      const { onStopCool } = get(id) || {};
      set(id, { cool: false });
      if (onStopCool) run({ type: ACTION_SCRIPT_RUN, id: onStopCool });
      break;
    }
  }
};

const handleStartHeat = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { thermostat = [] } = get(id) || {};
      for (const i of thermostat) run({ type: ACTION_START_HEAT, id: i });
      break;
    }
    case THERMOSTAT: {
      const { onStartHeat } = get(id) || {};
      set(id, { heat: true });
      if (onStartHeat) run({ type: ACTION_SCRIPT_RUN, id: onStartHeat });
      break;
    }
  }
};

const handleStopHeat = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { thermostat = [] } = get(id) || {};
      for (const i of thermostat) run({ type: ACTION_STOP_HEAT, id: i });
      break;
    }
    case THERMOSTAT: {
      const { onStopHeat } = get(id) || {};
      set(id, { heat: false });
      if (onStopHeat) run({ type: ACTION_SCRIPT_RUN, id: onStopHeat });
      break;
    }
  }
};

const handleStartWet = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { hygrostat = [] } = get(id) || {};
      for (const i of hygrostat) run({ type: ACTION_START_WET, id: i });
      break;
    }
    case HYGROSTAT: {
      const { onStartWet } = get(id) || {};
      set(id, { wet: true });
      if (onStartWet) run({ type: ACTION_SCRIPT_RUN, id: onStartWet });
      break;
    }
  }
};

const handleStopWet = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { hygrostat = [] } = get(id) || {};
      for (const i of hygrostat) run({ type: ACTION_STOP_WET, id: i });
      break;
    }
    case HYGROSTAT: {
      const { onStopWet } = get(id) || {};
      set(id, { wet: false });
      if (onStopWet) run({ type: ACTION_SCRIPT_RUN, id: onStopWet });
      break;
    }
  }
};

const handleStartVentilation = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { co2_stat = [] } = get(id) || {};
      for (const i of co2_stat) run({ type: ACTION_START_VENTILATION, id: i });
      break;
    }
    case CO2_STAT: {
      const { onStartVentilation } = get(id) || {};
      set(id, { ventilation: true });
      if (onStartVentilation) run({ type: ACTION_SCRIPT_RUN, id: onStartVentilation });
      break;
    }
  }
};

const handleStopVentilation = (action, run) => {
  const { id } = action;
  const { type } = get(id) || {};
  switch (type) {
    case SITE: {
      const { co2_stat = [] } = get(id) || {};
      for (const i of co2_stat) run({ type: ACTION_STOP_VENTILATION, id: i });
      break;
    }
    case CO2_STAT: {
      const { onStopVentilation } = get(id) || {};
      set(id, { ventilation: false });
      if (onStopVentilation) run({ type: ACTION_SCRIPT_RUN, id: onStopVentilation });
      break;
    }
  }
};

const handleSetpoint = (action, run) => {
  const [id_, t_, index] = action.id ? action.id.split("/") : [];
  if (t_ === 'ac') {
    action.id = id_;
    action.index = index;
  }
  const { id, value, temperature, humidity, co2 } = action;
  const dev = get(id) || {};
  if (temperature || value) {
    let setpoint = temperature || value;
    if (setpoint < 10) setpoint = 10;
    if (setpoint > 40) setpoint = 40;
    if (dev.type === SITE) {
      const { thermostat = [] } = dev;
      for (const t of thermostat) set(t, { setpoint });
      set(id, { setpoint });
    } else if (dev.type === DRIVER_TYPE_INTESIS_BOX || dev.type === DRIVER_TYPE_MD_CCM18_AN_E || dev.type === DRIVER_TYPE_TICA || dev.type === DRIVER_TYPE_NOVA || dev.type === DRIVER_TYPE_SWIFT || dev.type === DRIVER_TYPE_ALINK || dev.type === DRIVER_TYPE_COMFOVENT) {
      if (temperature) action.value = temperature;
      drivers.run(action);
    } else {
      set(id, { setpoint });
    }
  } else if (humidity) {
    let setpoint = humidity;
    if (setpoint < 10) setpoint = 10;
    if (setpoint > 90) setpoint = 90;
    if (dev.type === SITE) {
      const { hygrostat = [] } = dev;
      for (const t of hygrostat) set(t, { setpoint });
    } else {
      set(id, { setpoint });
    }
  } else if (co2) {
    let setpoint = co2;
    if (setpoint < 200) setpoint = 200;
    if (setpoint > 1200) setpoint = 1200;
    if (dev.type === SITE) {
      const { co2_stat = [] } = dev;
      for (const t of co2_stat) set(t, { setpoint });
    } else {
      set(id, { setpoint });
    }
  }
};

const handleSetpointMinMax = (action) => {
  const { id, min, max } = action;
  set(id, { min, max });
};

const handleIncSetpoint = (action, run) => {
  const { thermostat, display } = action;
  if (thermostat) {
    let { setpoint = 4 } = get(thermostat) || {};
    setpoint++;
    if (setpoint > 35) setpoint = 35;
    run({ type: ACTION_SETPOINT, id: thermostat, value: setpoint });
    if (display) {
      set(display, { lock: true });
      run({ type: ACTION_IMAGE, id: display, value: setpoint });
      setTimeout(set, 5000, display, { lock: false });
    }
  }
};

const handleDecSetpoint = (action, run) => {
  const { thermostat, display } = action;
  if (thermostat) {
    let { setpoint = 34 } = get(thermostat) || {};
    setpoint--;
    if (setpoint < 5) setpoint = 5;
    run({ type: ACTION_SETPOINT, id: thermostat, value: setpoint });
    if (display) {
      set(display, { lock: true });
      run({ type: ACTION_IMAGE, id: display, value: setpoint });
      setTimeout(set, 5000, display, { lock: false });
    }
  }
};

const handleThermostat = (action, run) => {
  const {
    id, cool = true, heat = true,
    cool_hysteresis, cool_threshold, cool_intensity,
    heat_hysteresis, heat_threshold, heat_intensity,
    onStartHeat, onStartCool, onStopHeat, onStopCool,
    onCoolIntensity, onHeatIntensity,
  } = action;
  const { setpoint, mode, site, auto_hysteresis } = get(id) || {};
  const { temperature } = get(site) || {};
  // INC-011: при отсутствии/невалидной температуре не дергаем контуры
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    if (temperature !== undefined && temperature !== null) {
      console.warn('[thermostat] invalid temperature', id, temperature);
    }
    return;
  }
  // INC-009: приводим к числу с безопасными дефолтами
  const toNum = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const S = toNum(setpoint, 24);
  const coolH = toNum(cool_hysteresis, 0.5);
  const coolTh = toNum(cool_threshold, 2);
  const heatH = toNum(heat_hysteresis, 0.5);
  const heatTh = toNum(heat_threshold, 2);
  // INC-012: нормализуем threshold >= hysteresis
  const coolThN = Math.max(coolTh, coolH);
  const heatThN = Math.max(heatTh, heatH);
  // INC-010: мёртвая зона AUTO
  const autoH = toNum(auto_hysteresis, 0.3);
  // INC-013: идемпотентность
  const make = (state, script, mode, enabled, intensity, onIntensity = []) => () => {
    if (!enabled) return;
    set(id, { state, mode });
    if (script) run({ type: ACTION_SCRIPT_RUN, id: script });
    if (intensity >= 0 && onIntensity[intensity]) {
      run({ type: ACTION_SCRIPT_RUN, id: onIntensity[intensity] });
    }
  };
  const stopCool = make(STOP, onStopCool, mode, cool);
  const stopHeat = make(STOP, onStopHeat, mode, heat);
  const startCool = make(COOL, onStartCool, COOL, cool, cool_intensity, onCoolIntensity);
  const startHeat = make(HEAT, onStartHeat, HEAT, heat, heat_intensity, onHeatIntensity);
  // INC-014: не вызываем start/stop повторно
  const runIfStateChanged = (nextState, fn) => {
    const { state: currentState } = get(id) || {};
    if (currentState === nextState) return;
    fn();
  };
  const stopCoolIfNeeded = () => runIfStateChanged(STOP, stopCool);
  const stopHeatIfNeeded = () => runIfStateChanged(STOP, stopHeat);
  const startCoolIfNeeded = () => runIfStateChanged(COOL, startCool);
  const startHeatIfNeeded = () => runIfStateChanged(HEAT, startHeat);
  switch (mode) {
    case HEAT: {
      if (temperature > S - (-heatThN)) {
        stopHeatIfNeeded(); startCoolIfNeeded();
      } else if (temperature > S - (-heatH)) {
        stopHeatIfNeeded();
      } else if (temperature < S - heatH) {
        startHeatIfNeeded();
      }
      break;
    }
    case COOL: {
      if (temperature < S - coolThN) {
        stopCoolIfNeeded(); startHeatIfNeeded();
      } else if (temperature < S - coolH) {
        stopCoolIfNeeded();
      } else if (temperature > S - (-coolH)) {
        startCoolIfNeeded();
      }
      break;
    }
    default: {
      if (temperature > S + autoH) {
        stopHeatIfNeeded(); startCoolIfNeeded();
      } else if (temperature < S - autoH) {
        stopCoolIfNeeded(); startHeatIfNeeded();
      } else {
        stopCoolIfNeeded(); stopHeatIfNeeded();
      }
    }
  }
};

const handleHygrostat = (action, run) => {
  const {
    id, dry = true, wet = true,
    dry_hysteresis, dry_threshold,
    wet_hysteresis, wet_threshold,
    onStartDry, onStartWet, onStopDry, onStopWet,
  } = action;
  const { setpoint, mode, site } = get(id) || {};
  const { humidity } = get(site) || {};
  const make = (state, script, mode, enabled) => () => {
    set(id, { state, mode });
    if (!enabled) return;
    if (script) run({ type: ACTION_SCRIPT_RUN, id: script });
  };
  const stopDry = make(STOP, onStopDry, DRY, dry);
  const stopWet = make(STOP, onStopWet, WET, wet);
  const startDry = make(DRY, onStartDry, DRY, dry);
  const startWet = make(WET, onStartWet, WET, wet);
  switch (mode) {
    case WET: {
      if (humidity > setpoint - (-wet_threshold)) { stopWet(); startDry(); }
      else if (humidity > setpoint - (-wet_hysteresis)) { stopWet(); }
      else if (humidity < setpoint - wet_hysteresis) { startWet(); }
      break;
    }
    case DRY: {
      if (humidity < setpoint - dry_threshold) { stopDry(); startWet(); }
      else if (humidity < setpoint - dry_hysteresis) { stopDry(); }
      else if (humidity > setpoint - (-dry_hysteresis)) { startDry(); }
      break;
    }
    default: {
      if (humidity > setpoint) { stopWet(); startDry(); }
      else if (humidity < setpoint) { stopDry(); startWet(); }
      else { stopDry(); stopWet(); }
    }
  }
};

const handleCo2Stat = (action, run) => {
  const {
    id, ventilation = true, hysteresis,
    ventilation_intensity,
    onStartVentilation, onStopVentilation, onVentilationIntensity,
  } = action;
  const { setpoint, site } = get(id) || {};
  const { co2 } = get(site) || {};
  const make = (state, script, intensity, onIntensity = []) => () => {
    set(id, { state });
    if (!ventilation) return;
    if (script) run({ type: ACTION_SCRIPT_RUN, id: script });
    if (intensity >= 0 && onIntensity[intensity]) {
      run({ type: ACTION_SCRIPT_RUN, id: onIntensity[intensity] });
    }
  };
  const stopVentilation = make(STOP, onStopVentilation);
  const startVentilation = make(VENTILATION, onStartVentilation, ventilation_intensity, onVentilationIntensity);
  if (co2 > setpoint - (-hysteresis)) { startVentilation(); }
  else if (co2 < setpoint - hysteresis) { stopVentilation(); }
};

const handleLimitHeating = (action, run) => {
  const { id, hysteresis, onStartHeat, onStopHeat } = action;
  const { min, max, sensor } = get(id) || {};
  if (!sensor) return;
  const { temperature } = get(sensor) || {};
  if (!temperature) return;
  const make = (script) => () => {
    if (script) run({ type: ACTION_SCRIPT_RUN, id: script });
  };
  const stopHeat = make(onStopHeat);
  const startHeat = make(onStartHeat);
  set(id, { disabled: false });
  if (temperature > max - (-hysteresis)) {
    stopHeat();
    set(id, { disabled: true });
  } else if (temperature < min - hysteresis) {
    startHeat();
    set(id, { disabled: true });
  }
};

module.exports = {
  handleStartCool, handleStopCool,
  handleStartHeat, handleStopHeat,
  handleStartWet, handleStopWet,
  handleStartVentilation, handleStopVentilation,
  handleSetpoint, handleSetpointMinMax,
  handleIncSetpoint, handleDecSetpoint,
  handleThermostat, handleHygrostat,
  handleCo2Stat, handleLimitHeating,
};
