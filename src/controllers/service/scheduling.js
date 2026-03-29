const { CronJob } = require("cron");
const {
  OPERATOR_LT, OPERATOR_LE, OPERATOR_EQ,
  OPERATOR_NE, OPERATOR_GE, OPERATOR_GT,
  ACTION_SCRIPT_RUN,
} = require("../../constants");
const { get, set } = require("../../actions");
const mac = require("../../mac");

const timers = {};
const schedules = {};

const handleTimerStart = (action, run) => {
  const { id, script, time } = action;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => {
    set(id, { time: 0, state: false });
    run({ type: ACTION_SCRIPT_RUN, id: script });
  }, parseInt(time));
  set(id, { time, script, state: true, timestamp: Date.now() });
};

const handleTimerStop = (action) => {
  const { id } = action;
  clearTimeout(timers[id]);
  set(id, { time: 0, state: false });
};

const handleScheduleStart = (action, run) => {
  const { id, script, schedule } = action;
  if (schedules[id]) {
    schedules[id].stop();
    delete schedules[id];
  }
  if (schedule && script) {
    schedules[id] = new CronJob(
      schedule,
      () => {
        run({ type: ACTION_SCRIPT_RUN, id: script });
      },
      () => {
        set(id, { state: false });
      },
      true
    );
    set(id, { state: true, script, schedule });
  } else {
    set(id, { state: false });
  }
};

const handleScheduleStop = (action) => {
  const { id } = action;
  if (schedules[id]) {
    schedules[id].stop();
    delete schedules[id];
  }
  set(id, { state: false });
};

const handleClockStart = (action) => {
  const { id } = action;
  const { state } = get(id);
  if (!state) {
    set(id, { timestamp: Date.now(), state: true });
  }
};

const handleClockStop = (action) => {
  const { id } = action;
  const { state } = get(id);
  if (state) {
    set(id, { timestamp: Date.now(), state: false });
  }
};

const handleClockTest = (action, run) => {
  const { id, time, onTrue, onFalse, operator } = action;
  const { timestamp, state } = get(id);
  const t = Date.now() - timestamp;
  let script;
  if (state) {
    switch (operator) {
      case OPERATOR_LT: script = t < time ? onTrue : onFalse; break;
      case OPERATOR_LE: script = t <= time ? onTrue : onFalse; break;
      case OPERATOR_EQ: script = t === time ? onTrue : onFalse; break;
      case OPERATOR_NE: script = t !== time ? onTrue : onFalse; break;
      case OPERATOR_GE: script = t >= time ? onTrue : onFalse; break;
      case OPERATOR_GT: script = t > time ? onTrue : onFalse; break;
    }
    if (script) {
      run({ type: ACTION_SCRIPT_RUN, id: script });
    }
  }
};

const handleDayTest = (action, run) => {
  const { project } = get(mac());
  if (project) {
    const { weather } = get(project);
    if (weather && weather.sys) {
      const { sunrise, sunset } = weather.sys;
      const { onFalse, onTrue } = action;
      const now = Date.now();
      const script = now > sunrise && now < sunset ? onTrue : onFalse;
      if (script) {
        run({ type: ACTION_SCRIPT_RUN, id: script });
      }
    }
  }
};

const handleNightTest = (action, run) => {
  const { project } = get(mac());
  if (project) {
    const { weather } = get(project);
    if (weather && weather.sys) {
      const { sunrise, sunset } = weather.sys;
      const { onFalse, onTrue } = action;
      const now = Date.now();
      const script = now < sunrise || now > sunset ? onTrue : onFalse;
      if (script) {
        run({ type: ACTION_SCRIPT_RUN, id: script });
      }
    }
  }
};

module.exports = {
  handleTimerStart,
  handleTimerStop,
  handleScheduleStart,
  handleScheduleStop,
  handleClockStart,
  handleClockStop,
  handleClockTest,
  handleDayTest,
  handleNightTest,
};
