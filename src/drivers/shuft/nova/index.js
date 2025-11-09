const { get, set } = require("../../../actions");
const {
  ACTION_SET_FAN_SPEED,
  ACTION_ON,
  ACTION_OFF,
  ACTION_SETPOINT,
} = require("../../../constants");
const {
  writeRegister,
  readHoldingRegisters,
  readInputRegisters,
} = require("../../modbus");
const {
  READ_HOLDING_REGISTERS,
  WRITE_REGISTER,
  READ_INPUT_REGISTERS,
} = require("../../modbus/constants");
const { ADDRESS, TIMEOUT } = require("./constants");
const { delay } = require("../../../util");

const instance = new Set();

const sync = async (id) => {
  const dev = get(id) || {};
  const { bind } = dev;
  const [modbus, , address] = bind.split("/");
  let reading = true;
  const { value_, fan_speed_, setpoint_ } = dev
  if (value_ !== undefined) {
    reading = false;
    writeRegister(modbus, address, 0x2, value_);
    set(id, { value_: undefined });
  }
  if (fan_speed_ !== undefined) {
    reading = false;
    await delay(100);
    writeRegister(modbus, address, 0x20, fan_speed_);
    set(id, { fan_speed_: undefined });
  }
  if (setpoint_ !== undefined) {
    reading = false;
    await delay(100);
    writeRegister(modbus, address, 0x1f, setpoint_ * 10);
    set(id, { setpoint_: undefined });
  }
  if (reading) {
    readInputRegisters(modbus, address, 0x2, 1);
    await delay(100);
    readHoldingRegisters(modbus, address, 0x0, 33);
  }
};

module.exports.run = (action) => {
  const { id, type } = action;
  switch (type) {
    case ACTION_ON: {
      set(id, { value: 1, value_: 1 });
      break;
    }
    case ACTION_OFF: {
      set(id, { value: 0, value_: 0 });
      break;
    }
    case ACTION_SET_FAN_SPEED: {
      set(id, { fan_speed: action.value, fan_speed_: action.value });
      break;
    }
    case ACTION_SETPOINT: {
      set(id, { setpoint: action.value, setpoint_: action.value });
      break;
    }
  }
};

module.exports.handle = (action) => {
  const { id, data } = action;
  switch (data[0]) {
    case READ_HOLDING_REGISTERS: {
      const fan_speed = data.readUInt16BE(66);
      const setpoint = data.readUInt16BE(64) / 10;
      set(id, { fan_speed, setpoint });
      break;
    }
    case READ_INPUT_REGISTERS: {
      const value = data.readUInt16BE(2) & 0x1;
      set(id, { value });
      break;
    }
  }
};

module.exports.clear = () => {
  instance.clear();
};

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
