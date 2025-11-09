const { get, set, count_on, count_off } = require('../../actions');
const service = require('../../controllers/service');
const mac = require('../../mac');
const Master = require('./master');

const scale = 10;
const limit = 99999999;

const param = [
  "water_counter_1",
  "water_counter_2",
  "water_counter_3",
  "water_counter_4",

  "1", //"vent_power",
  "vent_fan_speed",
  "vent_damper",

  "2", //"acc1_power",
  "acc1_mode",
  "acc1_fan_speed",
  "acc1_vane_position",

  "3", //"acc2_power",
  "acc2_mode",
  "acc2_fan_speed",
  "acc2_vane_position",

  "4", //"acc3_power",
  "acc3_mode",
  "acc3_fan_speed",
  "acc3_vane_position",

  "5", //"acc4_power",
  "acc4_mode",
  "acc4_fan_speed",
  "acc4_vane_position",

  "t1_air_temperature",
  "t1_humidity",
  "t1_floor_temperature",

  "t2_air_temperature",
  "t2_humidity",
  "t2_floor_temperature",

  "t3_air_temperature",
  "t3_humidity",

  "t4_air_temperature",
  "t4_humidity",
  "t4_floor_temperature",

  "t5_air_temperature",
  "t5_humidity",

  "t6_air_temperature",
  "t6_humidity",
  "t6_floor_temperature",

  "t7_air_temperature",
  "t7_humidity",
  "t7_floor_temperature",

  "t8_air_temperature",
  "t8_humidity",
  "t8_floor_temperature",

  "6", //"ventilator_relay_k1",
  "7", //"ventilator_relay_k6",
  "8", //"ventilator_relay_k7",
  "9", //"ventilator_relay_k8",

  "voltage_phase_a",
  "voltage_phase_b",
  "voltage_phase_c",

  "current_phase_a",
  "current_phase_b",
  "current_phase_c",

  "power_phase_a",
  "power_phase_b",
  "power_phase_c",

  "room1_set_point", // 68
  "room2_set_point", // 69
  "room3_set_point", // 70
  "room4_set_point", // 71
  "room5_set_point", // 72
  "room6_set_point", // 73
  "room7_set_point", // 74
  "room8_set_point", // 75

  "10", //"room1_floor_power",
  "11", //"room2_floor_power",
  "12", //"room4_floor_power",
  "13", //"room6_floor_power",
  "14", //"room7_floor_power",
  "15", //"room8_floor_power"
];

const setpoint = [
  "room1_set_point",
  "room2_set_point",
  "room3_set_point",
  "room4_set_point",
  "room5_set_point",
  "room6_set_point",
  "room7_set_point",
  "room8_set_point"
];

const offset = [4, 7, 11, 15, 19, 45, 46, 47, 48, 76, 77, 78, 79, 80, 81]


module.exports = class {

  constructor(id) {
    this.id = id;
    this.temperature = {};
    this.start();
  }

  start() {
    const { host, port = 502 } = get(this.id) || {};
    this.master = new Master({ host, port, device: 2 });
    this.master.on('error', console.error);
    this.master.on('data', (event) => {
      this.masterHandle(event);
    });
    this.timer = setInterval(() => {
      this.master.readHoldingRegisters(0, 83);
      for (let i = 0; i < setpoint.length; i++) {
        const id = setpoint[i];
        const { value, thermostat } = get(this.channel(id)) || {};
        if (thermostat) {
          const { setpoint } = get(thermostat);
          if (setpoint === value) return;
          this.master.writeSingleOutputRegister(i + 68, setpoint * 100);
        }
      }
      const { project } = get(mac()) || {};
      const { weather: { main: { temp } = {} } = {} } = get(project) || {};
      if (temp !== undefined) {
        this.master.writeSingleOutputRegister(82, temp * 100);
      }
    }, 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.master.destroy();
  }

  channel = (id) => `${this.id}/channel/${id}`;

  set(id, value, type) {
    switch (id) {
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
      case "10":
      case "11":
      case "12":
      case "13":
      case "14":
      case "15":
        set(`${this.id}/do/${id}`, { value });
        break;
      default:
        set(this.channel(id), { value });
    }
  }

  setWaterCounter(id, amount) {
    let { water_counter, value: prev = 0 } = get(id) || {};
    let { value = 0 } = get(water_counter) || {};

    const diff = prev === amount ? 0 : scale;
    set(water_counter, { value: (value + diff) % (99999999 + 1) });
    set(id, { value: amount });
  };

  run({ type, index, value }) {
    switch (type) {
      default: {
        if (index < 1 || index > 15) return;
        this.master.writeSingleOutputRegister(offset[index - 1], value);
      }
    }
  }

  masterHandle({ cmd, data }) {
    let offset = 0;
    for (const id of param) {
      if (id)
        switch (id) {
          case "voltage_phase_a":
          case "voltage_phase_b":
          case "voltage_phase_c":
          case "current_phase_a":
          case "current_phase_b":
          case "current_phase_c":
          case "power_phase_a":
          case "power_phase_b":
          case "power_phase_c": {
            offset += offset % 4;
            const buff = Buffer.alloc(4);
            data.copy(buff, 0, offset + 2, offset + 4);
            data.copy(buff, 2, offset + 0, offset + 2);
            const value = buff.readFloatBE();
            this.set(id, value);
            offset += 4;
            break;
          }
          case "water_counter_1":
          case "water_counter_2":
          case "water_counter_3":
          case "water_counter_4": {
            const amount = data.readUInt16BE(offset);
            const channel = this.channel(id);
            this.setWaterCounter(channel, amount);
            offset += 2;
            break;
          }
          case "room1_set_point":
          case "room2_set_point":
          case "room3_set_point":
          case "room4_set_point":
          case "room5_set_point":
          case "room6_set_point":
          case "room7_set_point":
          case "room8_set_point":
          case "t1_air_temperature":
          case "t1_floor_temperature":
          case "t2_air_temperature":
          case "t2_floor_temperature":
          case "t3_air_temperature":
          case "t4_air_temperature":
          case "t4_floor_temperature":
          case "t5_air_temperature":
          case "t6_air_temperature":
          case "t6_floor_temperature":
          case "t7_air_temperature":
          case "t7_floor_temperature":
          case "t8_air_temperature":
          case "t8_floor_temperature": {
            let value = Math.round(data.readUInt16BE(offset) / 10) / 10;
            if (!this.temperature[id]) {
              this.temperature[id] = [value];
            } else {
              this.temperature[id].push(value);
              if (this.temperature[id].length > 60) {
                this.temperature[id].shift();
                value = this.temperature[id].sort((a, b) => a > b)[30];
                this.set(id, value);
                const o = get(this.channel(id));
                if (o && o.site) {
                  switch (id) {
                    case "t1_air_temperature":
                    case "t2_air_temperature":
                    case "t3_air_temperature":
                    case "t4_air_temperature":
                    case "t4_floor_temperature":
                    case "t5_air_temperature":
                    case "t6_air_temperature":
                    case "t7_air_temperature":
                    case "t8_air_temperature": {
                      set(o.site, { temperature: value });
                      break;
                    }
                    case "t1_floor_temperature":
                    case "t2_floor_temperature":
                    case "t4_floor_temperature":
                    case "t6_floor_temperature":
                    case "t7_floor_temperature":
                    case "t8_floor_temperature": {
                      set(o.site, { temperature_ext: value });
                      break;
                    }
                  }
                }
              }
            }
            offset += 2;
            break;
          }
          case "t1_humidity":
          case "t2_humidity":
          case "t3_humidity":
          case "t4_humidity":
          case "t5_humidity":
          case "t6_humidity":
          case "t7_humidity":
          case "t8_humidity": {
            const value = Math.round(data.readUInt16BE(offset) / 10);
            this.set(id, value);
            const o = get(this.channel(id));
            if (o && o.site) {
              set(o.site, { humidity: value });
            }
            offset += 2;
            break;
          }
          default: {
            const value = data.readUInt16BE(offset);
            this.set(id, value);
            const { bind } = get(this.channel(id)) || {};
            if (bind) {
              if (value) {
                count_on(bind);
              } else {
                count_off(bind);
              }
            }
            offset += 2;
          }
        }
      else offset += 2;
    }
  }

}
