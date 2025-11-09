'use strict';

const crc16 = require('crc').crc16modbus;
const { get, set } = require('../../actions');
const { device } = require('../../sockets');
const { ACTION_RS485_TRANSMIT, DEVICE_TYPE_RS_HUB1_RS, DEVICE_TYPE_DI_4_RSM } = require('../../constants');

const address = 0x46;
// const device = '/dev/ttyUSB0';
const delay = 200;
const period = 15000;

module.exports = class {

  constructor(id) {
    this.id = id;
    this.start();
  }

  start() {
    // this.socket = new SerialPort(device, {
    //   baudRate: 9600,
    //   dataBits: 8,
    //   parity: 'none',
    //   stopBits: 1,
    //   autoOpen: true
    // });
    // this.socket
    //     .on('data', this.process)
    //     .on('error', console.error);
    // this.request();
    this.t = setInterval(this.request, period);
  }

  stop() {
    clearTimeout(this.t);
  }

  login = () => {
    this.send([1, 1, 1, 1, 1, 1, 1, 1]);
  };

  request = () => {
    this.send([5, 0, 6]);
  };

  pool = [];
  handle = ({ id, data }) => {
    // clearTimeout(this.t);
    this.pool.push(data);
    this.t = setTimeout(() => {
      const buff = Buffer.concat(this.pool);
      this.pool = [];
      if (buff.length === 4)
        if (buff.readUInt8(1) === 5)
          this.login();
        else
          this.request();
      else if (buff.length === 99) {
        const v = [];
        for (let i = 0; i < 6; i++) {
          v[i] = ((buff.readUInt16LE(i * 16 + 1) << 16) | buff.readUInt16LE(i * 16 + 3)) / 100;
        }
        set(id, { value: [v[0], v[1]], total: v[4] });
        // this.t = setTimeout(this.request, period);
      }
    }, delay);
  };

  // send = (cmd) => {
  //   this.socket.write(this.query(cmd), err => {
  //     if (err) console.error('error');
  //   });
  // }

  send = (cmd) => {
    const { bind } = get(this.id);
    if (!bind) return;
    const { is_rbus } = get(bind);
    if (is_rbus) return;
    const [dev, , index] = bind.split('/');
    const { ip, type } = get(dev);
    const header = Buffer.from([ACTION_RS485_TRANSMIT, index]);
    const payload = this.query(cmd);
    const buffer = Buffer.concat([header, payload]);
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


  query = (cmd) => {
    const buff = Buffer.alloc(1 + cmd.length);
    buff.writeUInt8(address & 0xff, 0);
    for (let i = 0; i < cmd.length; i++) {
      buff.writeUInt8(cmd[i], i + 1);
    }
    const req = Buffer.alloc(buff.length + 2, buff);
    req.writeUInt16LE(crc16(buff), buff.length);
    return req;
  }

};
