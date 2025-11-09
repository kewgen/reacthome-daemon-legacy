'use strict';

const crc16 = require('crc').crc16modbus;
const { get, set } = require('../../actions');
const { device } = require('../../sockets');
const { ACTION_RS485_TRANSMIT, DEVICE_TYPE_RS_HUB1_RS, DEVICE_TYPE_DI_4_RSM } = require('../../constants');

const address = 27321232;
const delay = 500;
const period = 15000;

const cmd = [0x27, 0x85, 0x63, 0x81];

const number = x =>
  x.reduce((a, b) => (100 * a) + (10 * (b >> 4 & 0xf) + (b & 0xf)), 0);


module.exports = class {

  constructor(id) {
    this.id = id;
    this.start();
  }

  start() {
    this.t = setInterval(this.request, period);
  }

  stop() {
    clearTimeout(this.t);
  }

  handle({ id, data }) {
    switch (data[4]) {
      case 0x27: {
        const t1 = number(data.slice(5, 9)) / 100;
        const t2 = number(data.slice(9, 13)) / 100;
        const t3 = number(data.slice(13, 17)) / 100;
        const t4 = number(data.slice(17, 21)) / 100;
        const e = t1 + t2 + t3 + t4;
        set(id, { active_energy: [e, t1, t2, t3, t4] });
        break;
      }
      case 0x85: {
        const t1 = number(data.slice(5, 9)) / 100;
        const t2 = number(data.slice(9, 13)) / 100;
        const t3 = number(data.slice(13, 17)) / 100;
        const t4 = number(data.slice(17, 21)) / 100;
        const e = t1 + t2 + t3 + t4;
        set(id, { reactive_energy: [e, t1, t2, t3, t4] });
        break;
      }
      case 0x63: {
        set(id, { voltage: number(data.slice(5, 7)) / 10 });
        set(id, { current: number(data.slice(7, 9)) / 100 });
        set(id, { power: number(data.slice(9, 12)) });
        break;
      }
      case 0x81: {
        set(id, { frequency: number(data.slice(5, 7)) / 100 });
        break;
      }
    }
  }

  request = () => {
    for (let i = 0; i < cmd.length; i++) {
      setTimeout(this.send, i * delay, cmd[i]);
    }
  };

  send = (cmd) => {
    const { bind } = get(this.id);
    if (!bind) return;
    const { is_rbus } = get(bind);
    if (is_rbus) return;
    const [dev, , index] = bind.split('/');
    const { ip, type } = get(dev);
    const header = Buffer.from([ACTION_RS485_TRANSMIT, index]);
    const payload = Buffer.alloc(5, 0);
    payload.writeUInt32BE(address, 0);
    payload.writeUInt8(cmd, 4);
    const crc = Buffer.alloc(2);
    crc.writeUInt16LE(crc16(payload), 0);
    const buffer = Buffer.concat([header, payload, crc]);
    switch (type) {
      case DEVICE_TYPE_DI_4_RSM:
      case DEVICE_TYPE_RS_HUB1_RS: {
        device.sendRBUS(buffer, dev);
        break;
      }
      default: {
        device.send(buffer, ip);
      }
    }

  };
}
