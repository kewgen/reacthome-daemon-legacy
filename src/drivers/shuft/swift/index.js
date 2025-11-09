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
  writeRegisters,
  readInputRegisters,
} = require("../../modbus");
const {
  READ_HOLDING_REGISTERS,
  WRITE_REGISTER,
} = require("../../modbus/constants");
const { ADDRESS, TIMEOUT } = require("./constants");

const instance = new Set();

const sync = (id) => {
  const dev = get(id) || {};
  const { bind, synced } = dev;
  const [modbus, , address] = bind.split("/");
  if (synced) {
    readInputRegisters(modbus, address, 0x2, 1);
  } else {
    writeRegister(modbus, address, 0x2, dev.value ? 1 : 0);
    setTimeout(() => {
      writeRegister(modbus, address, 0x20, dev.fan_speed);
    }, 100);
    // setTimeout(() => {
    //   writeRegister(modbus, address, 0x21, dev.fan_speed);
    // }, 200);
  }
  // writeRegister(modbus, address, 0x1, dev.setpoint * 10);
  set(id, { synced: true });

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
    case ACTION_SET_FAN_SPEED: {
      set(id, {
        fan_speed: action.value,
        value: !!action.value,
        synced: false,
      });
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
      // const value = data.readUInt16BE(2);
      // const fan_speed = data.readUInt16BE(2);
      // const setpoint = data.readUInt16BE(4) / 10;
      // if (dev.synced) {
      // set(id, {
      // value,// !!fan_speed,
      // fan_speed: fan_speed ? fan_speed : dev.fan_speed,
      // setpoint,
      // synced: true,
      // });
    }
      break;
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
