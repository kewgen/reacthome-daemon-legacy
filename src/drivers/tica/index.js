
const { get, set } = require('../../actions');
const { ACTION_SET_FAN_SPEED, ACTION_ON, ACTION_OFF, ACTION_SET_MODE, ACTION_SETPOINT } = require('../../constants');
const { writeRegister, readHoldingRegisters, writeRegisters, readCoils, writeCoil } = require('../modbus');
const { READ_HOLDING_REGISTERS, WRITE_REGISTER, READ_COILS } = require('../modbus/constants');
const { delay } = require('../../util');

const instance = new Map();

let index = 0

const sync = async (id, modbus, address, n) => {
  for (let i = 0; i < n; i += 1) {
    const ch = `${id}/ac/${i + 1}`
    const { synced, value, mode, fan_speed, setpoint } = get(ch) || {};
    if (!synced) {
      writeCoil(modbus, address, i, value ? 0xff00 : 0);
      await delay(5000);
      writeRegisters(modbus, address, 0x1000 + i * 6, [mode, setpoint, fan_speed]);
      await delay(1000);
      set(ch, { synced: true });
    } else {
      index = i + 1;
      readCoils(modbus, address, i, 1);
      await delay(500);
      readHoldingRegisters(modbus, address, 0x1000 + i * 6, 3);
      await delay(500);
    }
  }
};


const loop = (id) => async () => {
  const dev = get(id) || {};
  const { bind = "", numberAC } = dev;
  const [modbus, , address] = bind.split('/');
  await sync(id, modbus, address, numberAC);
  instance.set(id, setTimeout(loop(id), 500));
}


module.exports.run = (action) => {
  const { id, type, index } = action;
  const ch = `${id}/ac/${index}`;
  switch (type) {
    case ACTION_ON: {
      set(ch, { value: true, synced: false });
      break;
    }
    case ACTION_OFF: {
      set(ch, { value: false, synced: false });
      break;
    }
    case ACTION_SET_MODE: {
      set(ch, { mode: action.value, synced: false });
      break;
    }
    case ACTION_SET_FAN_SPEED: {
      set(ch, { fan_speed: action.value, synced: false });
      break;
    }
    case ACTION_SETPOINT: {
      set(ch, { setpoint: Math.max(16, Math.min(30, action.value)), synced: false });
      break;
    }
  }
};

module.exports.handle = (action) => {
  const { id, data } = action;
  // console.log(index, data);
  switch (data[0]) {
    case READ_COILS: {
      const value = !!data.readUInt8(2);
      // console.log({ value });
      set(`${id}/ac/${index}`, { value });
      break;
    }
    case READ_HOLDING_REGISTERS: {
      const mode = data.readUInt16BE(2);
      const setpoint = data.readUInt16BE(4) & 0x1f;
      const fan_speed = data.readUInt16BE(6);
      // console.log({ mode, setpoint, fan_speed });
      set(`${id}/ac/${index}`, { mode, setpoint, fan_speed });
      break;
    }
  }
}

module.exports.clear = () => {
  instance.clear();
}

module.exports.add = (id) => {
  if (instance.has(id)) {
    clearTimeout(instance.get(id))
  }
  instance.set(id, setTimeout(loop(id), 100));
};
