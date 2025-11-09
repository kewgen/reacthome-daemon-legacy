
const { get, set } = require('../../actions');
const { ACTION_SET_ADDRESS, ACTION_SET_FAN_SPEED, ACTION_ON, ACTION_OFF, ACTION_SET_MODE, ACTION_SET_DIRECTION, ACTION_SETPOINT } = require('../../constants');
const { writeRegister, readHoldingRegisters, writeRegisters } = require('../modbus');
const { READ_HOLDING_REGISTERS, WRITE_REGISTER } = require('../modbus/constants');
const { BROADCAST_ADDRESS, TIMEOUT } = require('./constants');
const { del } = require('../../db');
const { delay } = require('../../util');
const { timeout } = require('cron');

const instance = new Set();

const sync = async (id) => {
  const dev = get(id) || {};
  const { bind, synced } = dev;
  const [modbus, , address] = bind.split('/');
  if (synced) {
    // readHoldingRegisters(modbus, address, 0x1, 5);
  } else {
    writeRegisters(modbus, address, 0x1, [dev.setpoint, dev.fan_speed, dev.mode, dev.direction, dev.value]);
    // writeRegister(modbus, address, 0x3, dev.mode);
    // await delay(300);
    // writeRegister(modbus, address, 0x2, dev.fan_speed);
    // await delay(300);
    // writeRegister(modbus, address, 0x4, dev.direction);
    // await delay(300);
    // writeRegister(modbus, address, 0x1, dev.setpoint);
    // await delay(300);
    // writeRegister(modbus, address, 0x5, dev.value);
    set(id, { synced: true });
  }
};

module.exports.run = (action) => {
  const { id, type } = action;
  switch (type) {
    case ACTION_ON: {
      set(id, { value: true, synced: false });
      break;
    }
    case ACTION_OFF: {
      set(id, { value: false, synced: false });
      break;
    }
    case ACTION_SET_MODE: {
      set(id, { mode: action.value, synced: false });
      break;
    }
    case ACTION_SET_FAN_SPEED: {
      set(id, { fan_speed: action.value, synced: false });
      break;
    }
    case ACTION_SET_DIRECTION: {
      set(id, { direction: action.value, synced: false });
      break;
    }
    case ACTION_SETPOINT: {
      set(id, { setpoint: action.value, synced: false });
      break;
    }
  }
};

module.exports.handle = (action) => {
  const { id, data } = action;
  switch (data[0]) {
    case READ_HOLDING_REGISTERS: {
      const dev = get(id) || {};
      if (dev.synced) {
        set(id, {
          value: data.readUInt16BE(5),
          mode: data.readUInt16BE(3),
          fan_speed: data.readUInt16BE(2),
          direction: data.readUInt16BE(4),
          setpoint: data.readUInt16BE(1),
          synced: true
        })
      }
      break;
    }
  }
};

module.exports.clear = () => {
  instance.clear();
}

module.exports.add = (id) => {
  instance.add(id);
};

let index = 0;

setInterval(() => {
  const arr = Array.from(instance);
  if (arr.length > 0) {
    sync(arr[index % arr.length]);
    index++;
  }
}, TIMEOUT);
