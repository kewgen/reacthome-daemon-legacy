
const { get, set } = require('../../actions');
const { ACTION_SET_FAN_SPEED, ACTION_ON, ACTION_OFF, ACTION_SET_MODE, ACTION_SETPOINT } = require('../../constants');
const { writeRegister, readHoldingRegisters, writeRegisters, readCoils } = require('../modbus');
const { READ_HOLDING_REGISTERS, WRITE_REGISTER, READ_COILS } = require('../modbus/constants');
const { delay } = require('../../util');

const instance = new Map();

let index = 0

const sync = async (id, modbus, address, n) => {
  for (let i = 0; i < n; i += 1) {
    const ch = `${id}/ac/${i + 1}`
    const { synced, value, mode, fan_speed, setpoint } = get(ch) || {};
    if (!synced) {
      const dataMode = (value ? 0b1000_0000 : 0) | (1 << mode);
      let dataFan = 0;
      switch (fan_speed) {
        case 0:
          dataFan = 0b1000_0000;
          break;
        case 1:
          dataFan = 0b0000_0100;
          break;
        case 2:
          dataFan = 0b0000_0010;
          break;
        case 3:
          dataFan = 0b0000_0001;
          break;
      }
      writeRegisters(modbus, address, 1 + i * 32, [dataMode, dataFan, setpoint]);
      set(ch, { synced: true });
    } else {
      index = i + 1;
      readCoils(modbus, address, i * 128, 16);
      await delay(300);
      readHoldingRegisters(modbus, address, 3 + i * 32, 1);
    }
    await delay(1000);
  }
};


const loop = (id) => async () => {
  const dev = get(id) || {};
  const { bind = "", numberAC } = dev;
  const [modbus, , address] = bind.split('/');
  await sync(id, modbus, address, numberAC);
  instance.set(id, setTimeout(loop(id), 100));
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
      set(ch, { setpoint: Math.max(17, Math.min(30, action.value)), synced: false });
      break;
    }
  }
};

module.exports.handle = (action) => {
  // const { id, data } = action;
  // switch (data[0]) {
  //   case READ_COILS: {
  //     let value = data[2] >> 7;
  //     let mode = 4;
  //     switch (data[2] & 0b11111) {
  //       case 0b00001:
  //         mode = 0;
  //         break;
  //       case 0b0010:
  //         mode = 1;
  //         break;
  //       case 0b00100:
  //         mode = 2;
  //         break;
  //       case 0b01000:
  //         mode = 3;
  //         break;
  //       case 0b10000:
  //         mode = 4;
  //         break;
  //     }
  //     let fan_speed = 0;
  //     switch (data[3] & 0b111) {
  //       case 0b100:
  //         fan_speed = 1;
  //         break;
  //       case 0b010:
  //         fan_speed = 2;
  //         break;
  //       case 0b001:
  //         fan_speed = 3;
  //         break;
  //     }
  //     set(`${id}/ac/${index}`, { value, mode, fan_speed });
  //     break;
  //   }
  //   case READ_HOLDING_REGISTERS: {
  //     const setpoint = data.readUInt16BE(2);
  //     set(`${id}/ac/${index}`, { setpoint });
  //     break;
  //   }
  // }
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
