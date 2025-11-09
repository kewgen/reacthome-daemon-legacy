const fs = require("fs");

process.on("uncaughtException", function (err) {
  console.error(err);
});

const { v4 } = require("uuid");
const {
  DAEMON,
  ACTION_SCRIPT_RUN,
  ACTION_SCHEDULE_START,
  ACTION_TIMER_START,
  ACTION_SHELL_STOP,
  PROJECT,
  LIGHT_220,
  LIGHT_RGB,
  LIGHT_LED,
  VALVE_WATER,
  VALVE_HEATING,
  WARM_FLOOR,
  AC,
  FAN,
  SOCKET_220,
  BOILER,
  PUMP,
  SITE,
  SCRIPT,
} = require("./src/constants");
const { state, device, service, cpu, weather } = require("./src/controllers");
const { get, set, count } = require("./src/actions");
const discovery = require("./src/discovery");
const drivers = require("./src/drivers");
const assets = require("./src/assets");
const websocket = require("./src/websocket");
const janus = require("./src/janus");
const sip = require("./src/sip");
const db = require("./src/db");
const { cleanup } = require("./src/gc");
const { initAssist } = require("./src/assist");

const init = {};

const start = (id) => {
  set(id, { type: DAEMON });
  const { project } = get(id) || {};
  if (project) {
    count(project);
    const { timer = [], schedule = [], shell = [] } = get(project) || {};
    for (const id of schedule) {
      const { script, state, schedule } = get(id) || {};
      if (state && schedule && script) {
        service.run({ id, type: ACTION_SCHEDULE_START, schedule, script });
      }
    }
    for (const id of shell) {
      service.run({ id, type: ACTION_SHELL_STOP });
    }
    for (const id of timer) {
      const { script, state, time = 0, timestamp = 0 } = get(id) || {};
      if (state && script) {
        let dt = Date.now() - timestamp;
        if (dt < time) {
          dt = time - dt;
        } else {
          dt = 0;
          service.run({ id, type: ACTION_TIMER_START, time: dt, script });
        }
      }
    }
    const { onStart } = get(project) || {};
    if (onStart) {
      setTimeout(() => {
        service.run({ type: ACTION_SCRIPT_RUN, id: onStart });
      }, 2000);
    }
  }
};
const load = async () => {
  for await (const [key, value] of db.iterator()) {
    init[key] = value;
  }

  if (!init.mac) {
    init.mac = v4();
    db.put("mac", init.mac);
  }
  const d = init[init.mac];
  if (d) {
    delete d.ip;
    set(init.mac, d);
  }
  // cleanup(init);
  assets.init();
  state.init(init);
  initAssist();
  weather.manage();
  device.manage();
  drivers.manage();
  cpu.manage();
  console.log(init.mac);
  discovery.start(init.mac);
  websocket.start(init.mac);
  janus.start();
  sip.start();
  start(init.mac);
  set(init.mac, { token: [] });
};

load();
