
const { get, set } = require('../../actions');
const { ACTION_SET_ADDRESS, ACTION_SET_FAN_SPEED, ACTION_ON, ACTION_OFF, ACTION_SET_MODE, ACTION_SET_DIRECTION, ACTION_SETPOINT } = require('../../constants');
const { writeRegister, readHoldingRegisters, writeRegisters, readCoils, writeCoil } = require('../modbus');
const { READ_HOLDING_REGISTERS, WRITE_REGISTER, READ_COILS } = require('../modbus/constants');
const { BROADCAST_ADDRESS, TIMEOUT } = require('./constants');
const { del } = require('../../db');
const { delay } = require('../../util');

const instance = new Set();

const sync = async (id) => {
  const dev = get(id) || {};
  const { bind, synced } = dev;
  const [modbus, , address] = bind.split('/');
  if (synced) {
    readHoldingRegisters(modbus, address, 0, 11);
    await delay(1000);
    readCoils(modbus, address, 0, 11);
  } else {
    writeRegister(modbus, address, 2, dev.mode);
    await delay(1000);
    writeRegister(modbus, address, 3, dev.setpoint * 10);
    await delay(1000);
    writeRegister(modbus, address, 4, dev.fan_speed);
    await delay(1000);
    writeCoil(modbus, address, 1, dev.value ? 0xff00 : 0x0000);
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
    case ACTION_SETPOINT: {
      set(id, { setpoint: action.value, synced: false });
      break;
    }
  }
};

module.exports.handle = (action) => {
  const { id, data } = action;
  switch (data[0]) {
    case READ_COILS: {
      const dev = get(id) || {};
      if (dev.synced) {
        set(id, {
          value: Boolean(data[2] & 0b10),
          synced: true
        })
      }
      break;
    }
    case READ_HOLDING_REGISTERS: {
      const dev = get(id) || {};
      if (dev.synced) {
        set(id, {
          mode: data.readUInt16BE(6),
          setpoint: data.readUInt16BE(8) / 10,
          fan_speed: data.readUInt16BE(10),
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
