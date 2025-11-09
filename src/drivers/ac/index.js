const ircodes = require("reacthome-ircodes");
const { get, set } = require("../../actions");
const { device } = require("../../sockets");
const {
  ACTION_IR,
  ON,
  OFF,
  ACTION_ON,
  ACTION_OFF,
  ACTION_ENABLE,
  ACTION_DISABLE,
  DEVICE_TYPE_IR_4,
} = require("../../constants");

const manage = (power, setpoint, ac) => {
  if (!ac.bind) return;
  const [dev, , index] = ac.bind.split("/");
  const { ip, type, version = "" } = get(dev) || {};
  const model = (ircodes.codes.AC[ac.brand] || {})[ac.model];
  if (!model) return;
  const command = model.command(power, setpoint);
  switch (type) {
    case DEVICE_TYPE_IR_4: {
      const [major] = version.split(".");
      if (major < 2) return;
      for (let i = 0; i < command.length; i++) {
        const code = command[i];
        setTimeout(
          device.send,
          i * model.delay,
          Buffer.from([ACTION_IR, index, ...code]),
          ip
        );
      }
      break;
    }
    default:
      for (let i = 0; i < command.length; i++) {
        const code = command[i];
        const data = ircodes.encode(
          model.count,
          model.header,
          model.trail,
          code
        );
        const buff = Buffer.alloc(data.length * 2 + 5);
        buff.writeUInt8(ACTION_IR, 0);
        buff.writeUInt8(index, 1);
        buff.writeUInt8(0, 2);
        buff.writeUInt16BE(model.frequency, 3);
        for (let i = 0; i < data.length; i++) {
          buff.writeUInt16BE(data[i], i * 2 + 5);
        }
        setTimeout(device.send, i * model.delay, buff, ip);
      }
  }
};

module.exports.run = ({ type, id }) => {
  const ac = get(id) || {};
  let enabled = ac.enabled;
  const { setpoint } = get(ac.thermostat) || {};
  switch (type) {
    case ACTION_ENABLE:
      enabled = true;
      set(ac.bind, { value: ON });
    case ACTION_ON: {
      if (!enabled) return;
      if (ac.value === ON && ac.setpoint == setpoint) return;
      manage(ON, setpoint, ac);
      set(id, { value: ON, setpoint, enabled });
      break;
    }
    case ACTION_DISABLE:
      enabled = false;
      set(ac.bind, { value: OFF });
    case ACTION_OFF: {
      if (ac.value === OFF) return;
      manage(OFF, setpoint, ac);
      set(id, { value: OFF, setpoint, enabled });
      break;
    }
  }
};

module.exports.handle = () => { }
