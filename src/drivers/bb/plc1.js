
const { get, set, count_on, count_off } = require('../../actions');
const service = require('../../controllers/service');
const { DI, DO, ACTION_SCRIPT_RUN } = require('../../constants');
const Master = require('./master');
const Slave = require('./slave');

const TIMEOUT = 1000;
const DI_N = 85;
const DO_N = 7;

function bit(buff, n) {
  n += 4;
  const offset = n >> 3;
  const shift = n - (offset << 3);
  return 1 & buff[offset] >> shift
}

module.exports = class {

  constructor(id) {
    this.id = id;
    this.timestamp = [];
    this.start();
  }

  start() {
    const { host, port = 502 } = get(this.id) || {};
    this.master = new Master({ host, port, device: 1 });
    this.master.on('error', console.error);
    this.master.on('data', (event) => {
      this.masterHandle(event);
    });
    this.slave = new Slave({ port: 2502 });
    this.slave.on('error', console.error);
    this.slave.on('data', (event) => {
      this.slaveHandle(event);
    });
    this.timer = setInterval(() => {
      this.master.readHoldingRegisters(0, 7);
      this.timeout();
    }, 500);
  }

  stop() {
    clearInterval(this.timer);
    this.master.destroy();
    this.slave.close();
  }

  channelDI(i) {
    return `${this.id}/${DI}/${i + 1}`;
  }

  channelDO(i) {
    return `${this.id}/${DO}/${i + 1}`;
  }

  run({ index, value }) {
    if (index < 1 || index > DO_N) return;
    const i = index - 1;
    if (i >= 1) value = 1 - value;
    this.master.writeSingleOutputRegister(i, value);
  }

  masterHandle({ cmd, data }) {
    if (cmd !== 3) return;
    for (let i = 0; i < DO_N; i++)
      try {
        const channel = this.channelDO(i);
        const { bind, value, onOn, onOff } = get(channel) || {};
        const t = i < 3 ? 1 : 0;
        const f = 1 - t;
        let v;
        switch (i) {
          case 1:
            v = (get(this.channelDI(71)).value || get(this.channelDI(72)).value || get(this.channelDI(73)).value) ? 1 : 0;
            const { leakage1 } = get(this.id);
            if (leakage1) set(leakage1, { value });
            break;
          case 2:
            v = (get(this.channelDI(74)).value || get(this.channelDI(75)).value || get(this.channelDI(76)).value) ? 1 : 0;
            const { leakage2 } = get(this.id);
            if (leakage2) set(leakage2, { value });
            break;
          default:
            v = data.readUInt16BE(i * 2) ? t : f;
        }
        set(channel, { value: v });
        if (v) {
          count_on(bind);
        } else {
          count_off(bind);
        }
        if (v !== value) {
          const script = v === 1 ? onOn : onOff;
          if (script) {
            service.run({ type: ACTION_SCRIPT_RUN, id: script });
          }
        }
      } catch (e) {
        console.error(e);
      }
  }

  slaveHandle({ cmd, data }) {
    if (cmd !== 16) return;
    const now = Date.now();
    const timeout = now + TIMEOUT;
    for (let i = 0; i < DI_N; i++)
      try {
        let v;
        if (i === 0) {
          v = data[3] ? 1 : 0;
        } else {
          v = bit(data.slice(4), i - 1);
        }
        const channel = this.channelDI(i);
        const { value, onOn, onOff, onClick } = get(channel) || {};
        if (v !== value) {
          set(channel, { value: v });
          if (v) {
            this.timestamp[i] = now;
            if (onOn) {
              service.run({ type: ACTION_SCRIPT_RUN, id: onOn });
            }
          } else {
            if (onClick && (this.timestamp[i] < timeout)) {
              service.run({ type: ACTION_SCRIPT_RUN, id: onClick });
            }
            if (onOff) {
              service.run({ type: ACTION_SCRIPT_RUN, id: onOff });
            }
          }
        }
      } catch (e) {
        console.error(w);
      }
  }

  timeout() {
    const now = Date.now() + TIMEOUT;
    for (let i = 0; i < DI_N; i++) {
      const channel = this.channelDI(i);
      const { value, onHold } = get(channel) || {};
      if (value === 1) {
        if (now > this.timestamp[i]) {
          set(channel, { value: 2 })
          if (onHold) {
            service.run({ type: ACTION_SCRIPT_RUN, id: onHold });
          }
        }
      }
    }
  }

}
