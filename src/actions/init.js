const {
  IR,
  DO,
  DI,
  DIM,
  GROUP,
  RS485,
  ARTNET,
  ACTION_INITIALIZE,
  DEVICE,
  DEVICE_PORT,
  DEVICE_TYPE_DO8,
  DEVICE_TYPE_DO12,
  DEVICE_TYPE_RELAY_2,
  DEVICE_TYPE_RELAY_2_DIN,
  DEVICE_TYPE_RELAY_6,
  DEVICE_TYPE_RELAY_12,
  DEVICE_TYPE_RELAY_24,
  DEVICE_TYPE_DI24,
  DEVICE_TYPE_DIM4,
  DEVICE_TYPE_DIM_4,
  DEVICE_TYPE_DIM8,
  DEVICE_TYPE_DIM_8,
  DEVICE_TYPE_ARTNET,
  DEVICE_TYPE_SMART_4G,
  DEVICE_TYPE_SMART_4GD,
  DEVICE_TYPE_SMART_4A,
  DEVICE_TYPE_SENSOR4,
  DEVICE_TYPE_PLC,
  DISCOVERY_INTERVAL,
  DEVICE_TYPE_MIX_1,
  DEVICE_TYPE_MIX_1_RS,
  DEVICE_TYPE_MIX_2,
  DEVICE_TYPE_IR_4,
  TV,
  DEVICE_TYPE_LANAMP,
  DEVICE_TYPE_SOUNDBOX,
  AO,
  DEVICE_TYPE_AO_4_DIN,
  DEVICE_TYPE_DIM_12_LED_RS,
  DEVICE_TYPE_DIM_12_AC_RS,
  DEVICE_TYPE_DIM_12_DC_RS,
  DEVICE_TYPE_DIM_1_AC_RS,
  DEVICE_TYPE_RELAY_12_RS,
  DEVICE_TYPE_DIM_8_RS,
  DEVICE_TYPE_RS_HUB1_RS,
  DEVICE_TYPE_RS_HUB1_LEGACY,
  DEVICE_TYPE_RS_HUB4_LEGACY,
  DEVICE_TYPE_RS_HUB4,
  DEVICE_TYPE_SERVER,
  DEVICE_TYPE_SMART_4AM,
  DEVICE_TYPE_SMART_6_PUSH,
  DEVICE_TYPE_MIX_6x12_RS,
  DEVICE_TYPE_MIX_H,
  DEVICE_TYPE_DI_4_RSM,
  DEVICE_TYPE_SMART_BOTTOM_1,
  DEVICE_TYPE_SMART_BOTTOM_2,
  DEVICE_TYPE_DOPPLER_1_DI_4,
  DEVICE_TYPE_DOPPLER_5_DI_4,
  DEVICE_TYPE_DI_4,
  DEVICE_TYPE_DI_4_LA,
} = require("../constants");
const { get, set, add } = require("./create");
const { device } = require("../sockets");
const mac = require("../mac");
const { codes } = require("reacthome-ircodes");
const { ip2int } = require("../util");

module.exports.initialized = (id) => {
  set(id, { initialized: true });
};

module.exports.initialize = (id) => {
  // add(mac(), DEVICE, id);
  set(id, { initialized: false });
  const dev = get(id);
  const a = [ACTION_INITIALIZE];
  switch (dev.type) {
    case DEVICE_TYPE_SENSOR4: {
      for (let i = 1; i <= 4; i++) {
        const channel = get(`${id}/di/${i}`);
        a[i] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_SMART_4G: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const { correct, vibro } = get(id);
      a[1] = correct * 10;
      a[2] = vibro;
      for (let i = 1; i <= 4; i++) {
        const channel = get(`${id}/rgb/${i}`);
        a[3 * i + 0] = (channel && channel.r) || 0;
        a[3 * i + 1] = (channel && channel.g) || 0;
        a[3 * i + 2] = (channel && channel.b) || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_SMART_4GD: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const { correct, vibro } = get(id);
      a[1] = correct * 10;
      a[2] = vibro;
      for (let i = 1; i <= 4; i++) {
        const channel = get(`${id}/rgb/${i}`);
        a[3 * i + 0] = (channel && channel.r) || 0;
        a[3 * i + 1] = (channel && channel.g) || 0;
        a[3 * i + 2] = (channel && channel.b) || 0;
      }
      const { image = [], level } = get(id);
      a[15] = level || 0;
      a[16] = image[0] || 0;
      a[17] = image[1] || 0;
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_SMART_4A:
    case DEVICE_TYPE_SMART_4AM: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const { correct, vibro } = get(id);
      a[1] = correct * 10;
      a[2] = vibro;
      for (let i = 1; i <= 5; i++) {
        const channel = get(`${id}/rgb/${i}`);
        a[3 * i + 0] = (channel && channel.r) || 0;
        a[3 * i + 1] = (channel && channel.g) || 0;
        a[3 * i + 2] = (channel && channel.b) || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_SMART_6_PUSH: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const { correct } = get(id);
      a[1] = correct * 10;
      for (let i = 1; i <= 6; i++) {
        const channel = get(`${id}/rgb/${i}`);
        a[3 * i + 0] = (channel && channel.r) || 0;
        a[3 * i + 1] = (channel && channel.g) || 0;
        a[3 * i + 2] = (channel && channel.b) || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_DI24: {
      for (let i = 1; i <= 24; i++) {
        const channel = get(`${id}/${DI}/${i}`);
        a[i] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DO8: {
      for (let i = 1; i <= 8; i++) {
        const channel = get(`${id}/${DO}/${i}`);
        a[i] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DO12: {
      for (let i = 1; i <= 12; i++) {
        const channel = get(`${id}/${DO}/${i}`);
        a[i] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_IR_4: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const { version = "" } = get(id) || {};
      const [major, minor] = version.split(".");
      if (major >= 3) {
        for (let i = 1; i <= 4; i++) {
          const channel = get(`${id}/${IR}/${i}`) || {};
          const { bind } = channel;
          const { type, brand, model } = get(bind) || {};
          const {
            frequency,
            count = [],
            header = [],
            trail,
          } = ((codes[type] || {})[brand] || {})[model] || {};
          a[14 * i - 13] = frequency & 0xff;
          a[14 * i - 12] = (frequency >> 8) & 0xff;
          a[14 * i - 11] = count[0] & 0xff;
          a[14 * i - 10] = (count[0] >> 8) & 0xff;
          a[14 * i - 9] = count[1] & 0xff;
          a[14 * i - 8] = (count[1] >> 8) & 0xff;
          a[14 * i - 7] = count[2] & 0xff;
          a[14 * i - 6] = (count[2] >> 8) & 0xff;
          a[14 * i - 5] = header[0] & 0xff;
          a[14 * i - 4] = (header[0] >> 8) & 0xff;
          a[14 * i - 3] = header[1] & 0xff;
          a[14 * i - 2] = (header[1] >> 8) & 0xff;
          a[14 * i - 1] = trail & 0xff;
          a[14 * i - 0] = (trail >> 8) & 0xff;
        }
      } else {
        for (let i = 1; i <= 4; i++) {
          const channel = get(`${id}/${IR}/${i}`) || {};
          const { bind } = channel;
          const { type, brand, model } = get(bind) || {};
          const {
            frequency,
            count = [],
            header = [],
            trail,
          } = ((codes[type] || {})[brand] || {})[model] || {};
          a[12 * i - 11] = frequency & 0xff;
          a[12 * i - 10] = (frequency >> 8) & 0xff;
          a[12 * i - 9] = count[0] & 0xff;
          a[12 * i - 8] = (count[0] >> 8) & 0xff;
          a[12 * i - 7] = count[1] & 0xff;
          a[12 * i - 6] = (count[1] >> 8) & 0xff;
          a[12 * i - 5] = header[0] & 0xff;
          a[12 * i - 4] = (header[0] >> 8) & 0xff;
          a[12 * i - 3] = header[1] & 0xff;
          a[12 * i - 2] = (header[1] >> 8) & 0xff;
          a[12 * i - 1] = trail & 0xff;
          a[12 * i - 0] = (trail >> 8) & 0xff;
        }
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_RELAY_2:
    case DEVICE_TYPE_RELAY_2_DIN: {
      const { version = "" } = get(id) || {};
      const [major, minor] = version.split(".");
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      if (major >= 2) {
        for (let i = 1; i <= 1; i++) {
          const channel = get(`${id}/${GROUP}/${i}`) || {};
          const { enabled = 0, delay = 0 } = channel;
          a[5 * i - 4] = enabled;
          a[5 * i - 3] = delay & 0xff;
          a[5 * i - 2] = (delay >> 8) & 0xff;
          a[5 * i - 1] = (delay >> 16) & 0xff;
          a[5 * i - 0] = (delay >> 24) & 0xff;
        }
        for (let i = 1; i <= 2; i++) {
          const channel = get(`${id}/${DO}/${i}`) || {};
          const { value = 0, timeout = 0 } = channel;
          a[5 * i + 1] = value;
          a[5 * i + 2] = timeout & 0xff;
          a[5 * i + 3] = (timeout >> 8) & 0xff;
          a[5 * i + 4] = (timeout >> 16) & 0xff;
          a[5 * i + 5] = (timeout >> 24) & 0xff;
        }
      } else {
        for (let i = 1; i <= 2; i++) {
          const channel = get(`${id}/${DO}/${i}`);
          a[i] = (channel && channel.value) || 0;
        }
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_MIX_1_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      for (let i = 1; i <= 3; i++) {
        const channel = get(`${id}/${GROUP}/${i}`) || {};
        const { enabled = 0, delay = 0 } = channel;
        a[5 * i - 4] = enabled;
        a[5 * i - 3] = delay & 0xff;
        a[5 * i - 2] = (delay >> 8) & 0xff;
        a[5 * i - 1] = (delay >> 16) & 0xff;
        a[5 * i - 0] = (delay >> 24) & 0xff;
      }
      for (let i = 1; i <= 6; i++) {
        const channel = get(`${id}/${DO}/${i}`) || {};
        const { value = 0, timeout = 0 } = channel;
        a[5 * i + 11] = value;
        a[5 * i + 12] = timeout & 0xff;
        a[5 * i + 13] = (timeout >> 8) & 0xff;
        a[5 * i + 14] = (timeout >> 16) & 0xff;
        a[5 * i + 15] = (timeout >> 24) & 0xff;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_MIX_6x12_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      for (let i = 1; i <= 6; i++) {
        const channel = get(`${id}/${GROUP}/${i}`) || {};
        const { enabled = 0, delay = 0 } = channel;
        a[5 * i - 4] = enabled;
        a[5 * i - 3] = delay & 0xff;
        a[5 * i - 2] = (delay >> 8) & 0xff;
        a[5 * i - 1] = (delay >> 16) & 0xff;
        a[5 * i - 0] = (delay >> 24) & 0xff;
      }
      for (let i = 1; i <= 6; i++) {
        const channel = get(`${id}/${DO}/${i}`) || {};
        const { value = 0, timeout = 0, group = i } = channel;
        a[6 * i + 25] = value;
        a[6 * i + 26] = group;
        a[6 * i + 27] = timeout & 0xff;
        a[6 * i + 28] = (timeout >> 8) & 0xff;
        a[6 * i + 29] = (timeout >> 16) & 0xff;
        a[6 * i + 30] = (timeout >> 24) & 0xff;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_MIX_H: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      let k=0;
      a[k++] = ACTION_INITIALIZE;
      for (let i = 1; i <= 2; i++) {
        const channel = get(`${id}/${GROUP}/${i}`) || {};
        const { enabled = 0, delay = 0 } = channel;
        a[k++] = enabled;
        a[k++] = delay & 0xff;
        a[k++] = (delay >> 8) & 0xff;
        a[k++] = (delay >> 16) & 0xff;
        a[k++] = (delay >> 24) & 0xff;
      }
      for (let i = 1; i <= 2; i++) {
        const channel = get(`${id}/${DO}/${i}`) || {};
        const { value = 0, timeout = 0, group = i } = channel;
        a[k++] = value;
        a[k++] = group;
        a[k++] = timeout & 0xff;
        a[k++] = (timeout >> 8) & 0xff;
        a[k++] = (timeout >> 16) & 0xff;
        a[k++] = (timeout >> 24) & 0xff;
      }
      for (let i = 1; i <= 6; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        a[k++] = (channel && channel.group) || i;
        a[k++] = (channel && channel.type) || 0;
        a[k++] = (channel && channel.value) || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_MIX_1:
    case DEVICE_TYPE_MIX_2:
    case DEVICE_TYPE_RELAY_6: {
      const { version = "" } = get(id) || {};
      const [major, minor] = version.split(".");
      if (major >= 2) {
        for (let i = 1; i <= 3; i++) {
          const channel = get(`${id}/${GROUP}/${i}`) || {};
          const { enabled = 0, delay = 0 } = channel;
          a[5 * i - 4] = enabled;
          a[5 * i - 3] = delay & 0xff;
          a[5 * i - 2] = (delay >> 8) & 0xff;
          a[5 * i - 1] = (delay >> 16) & 0xff;
          a[5 * i - 0] = (delay >> 24) & 0xff;
        }
        for (let i = 1; i <= 6; i++) {
          const channel = get(`${id}/${DO}/${i}`) || {};
          const { value = 0, timeout = 0 } = channel;
          a[5 * i + 11] = value;
          a[5 * i + 12] = timeout & 0xff;
          a[5 * i + 13] = (timeout >> 8) & 0xff;
          a[5 * i + 14] = (timeout >> 16) & 0xff;
          a[5 * i + 15] = (timeout >> 24) & 0xff;
        }
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/1`) || {};
        a[46] = is_rbus;
        a[47] = baud & 0xff;
        a[48] = (baud >> 8) & 0xff;
        a[49] = (baud >> 16) & 0xff;
        a[50] = (baud >> 24) & 0xff;
        a[51] = line_control;
      } else {
        for (let i = 1; i <= 6; i++) {
          const channel = get(`${id}/${DO}/${i}`);
          a[i] = (channel && channel.value) || 0;
        }
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/1`) || {};
        a[7] = is_rbus;
        a[8] = baud & 0xff;
        a[9] = (baud >> 8) & 0xff;
        a[10] = (baud >> 16) & 0xff;
        a[11] = (baud >> 24) & 0xff;
        a[12] = line_control;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }

    case DEVICE_TYPE_RELAY_12: {
      const { version = "" } = get(id) || {};
      const [major] = version.split(".");
      if (major >= 3) {
        for (let i = 1; i <= 12; i++) {
          const channel = get(`${id}/${GROUP}/${i}`) || {};
          const { enabled = 0, delay = 0 } = channel;
          a[5 * i - 4] = enabled;
          a[5 * i - 3] = delay & 0xff;
          a[5 * i - 2] = (delay >> 8) & 0xff;
          a[5 * i - 1] = (delay >> 16) & 0xff;
          a[5 * i - 0] = (delay >> 24) & 0xff;
        }
        for (let i = 1; i <= 12; i++) {
          const channel = get(`${id}/${DO}/${i}`) || {};
          const { value = 0, timeout = 0, group = i } = channel;
          a[6 * i + 55] = value;
          a[6 * i + 56] = group;
          a[6 * i + 57] = timeout & 0xff;
          a[6 * i + 58] = (timeout >> 8) & 0xff;
          a[6 * i + 59] = (timeout >> 16) & 0xff;
          a[6 * i + 60] = (timeout >> 24) & 0xff;
        }
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/1`) || {};
        a[133] = is_rbus;
        a[134] = baud & 0xff;
        a[135] = (baud >> 8) & 0xff;
        a[136] = (baud >> 16) & 0xff;
        a[137] = (baud >> 24) & 0xff;
        a[138] = line_control;
      } else if (major >= 2) {
        for (let i = 1; i <= 6; i++) {
          const channel = get(`${id}/${GROUP}/${i}`) || {};
          const { enabled = 0, delay = 0 } = channel;
          a[5 * i - 4] = enabled;
          a[5 * i - 3] = delay & 0xff;
          a[5 * i - 2] = (delay >> 8) & 0xff;
          a[5 * i - 1] = (delay >> 16) & 0xff;
          a[5 * i - 0] = (delay >> 24) & 0xff;
        }
        for (let i = 1; i <= 12; i++) {
          const channel = get(`${id}/${DO}/${i}`) || {};
          const { value = 0, timeout = 0 } = channel;
          a[5 * i + 26] = value;
          a[5 * i + 27] = timeout & 0xff;
          a[5 * i + 28] = (timeout >> 8) & 0xff;
          a[5 * i + 29] = (timeout >> 16) & 0xff;
          a[5 * i + 30] = (timeout >> 24) & 0xff;
        }
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/1`) || {};
        a[91] = is_rbus;
        a[92] = baud & 0xff;
        a[93] = (baud >> 8) & 0xff;
        a[94] = (baud >> 16) & 0xff;
        a[95] = (baud >> 24) & 0xff;
        a[96] = line_control;
      } else {
        for (let i = 1; i <= 12; i++) {
          const channel = get(`${id}/${DO}/${i}`);
          a[i] = (channel && channel.value) || 0;
        }
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/1`) || {};
        a[13] = is_rbus;
        a[14] = baud & 0xff;
        a[15] = (baud >> 8) & 0xff;
        a[16] = (baud >> 16) & 0xff;
        a[17] = (baud >> 24) & 0xff;
        a[18] = line_control;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_RELAY_12_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      for (let i = 1; i <= 12; i++) {
        const channel = get(`${id}/${GROUP}/${i}`) || {};
        const { enabled = 0, delay = 0 } = channel;
        a[5 * i - 4] = enabled;
        a[5 * i - 3] = delay & 0xff;
        a[5 * i - 2] = (delay >> 8) & 0xff;
        a[5 * i - 1] = (delay >> 16) & 0xff;
        a[5 * i - 0] = (delay >> 24) & 0xff;
      }
      for (let i = 1; i <= 12; i++) {
        const channel = get(`${id}/${DO}/${i}`) || {};
        const { value = 0, timeout = 0, group = i } = channel;
        a[6 * i + 55] = value;
        a[6 * i + 56] = group;
        a[6 * i + 57] = timeout & 0xff;
        a[6 * i + 58] = (timeout >> 8) & 0xff;
        a[6 * i + 59] = (timeout >> 16) & 0xff;
        a[6 * i + 60] = (timeout >> 24) & 0xff;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_RS_HUB1_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const {
        baud,
        line_control,
      } = get(`${id}/${RS485}/1`) || {};
      a[1] = 0;
      a[2] = baud & 0xff;
      a[3] = (baud >> 8) & 0xff;
      a[4] = (baud >> 16) & 0xff;
      a[5] = (baud >> 24) & 0xff;
      a[6] = line_control;
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_RS_HUB1_LEGACY: {
      a[0] = ACTION_INITIALIZE;
      const {
        is_rbus = true,
        baud,
        line_control,
      } = get(`${id}/${RS485}/1`) || {};
      a[1] = is_rbus;
      a[2] = baud & 0xff;
      a[3] = (baud >> 8) & 0xff;
      a[4] = (baud >> 16) & 0xff;
      a[5] = (baud >> 24) & 0xff;
      a[6] = line_control;
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_RS_HUB4_LEGACY: {
      a[0] = ACTION_INITIALIZE;
      for (i = 1; i <= 4; i++) {
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/${i}`) || {};
        a[i * 6 - 5] = is_rbus;
        a[i * 6 - 4] = baud & 0xff;
        a[i * 6 - 3] = (baud >> 8) & 0xff;
        a[i * 6 - 2] = (baud >> 16) & 0xff;
        a[i * 6 - 1] = (baud >> 24) & 0xff;
        a[i * 6] = line_control;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_RELAY_24: {
      for (let i = 1; i <= 24; i++) {
        const channel = get(`${id}/${DO}/${i}`);
        a[i] = (channel && channel.value) || 0;
      }
      const {
        is_rbus = true,
        baud,
        line_control,
      } = get(`${id}/${RS485}/1`) || {};
      a[25] = is_rbus;
      a[26] = baud & 0xff;
      a[27] = (baud >> 8) & 0xff;
      a[28] = (baud >> 16) & 0xff;
      a[29] = (baud >> 24) & 0xff;
      a[30] = line_control;
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_SERVER:
    case DEVICE_TYPE_RS_HUB4: {
      const { version = "" } = get(id) || {};
      const major = parseInt(version.split(".")[0], 10);
      for (i = 1; i <= 4; i++) {
        const {
          is_rbus = true,
          baud,
          line_control,
        } = get(`${id}/${RS485}/${i}`) || {};
        a[i * 6 - 5] = is_rbus;
        a[i * 6 - 4] = baud & 0xff;
        a[i * 6 - 3] = (baud >> 8) & 0xff;
        a[i * 6 - 2] = (baud >> 16) & 0xff;
        a[i * 6 - 1] = (baud >> 24) & 0xff;
        a[i * 6] = line_control;
      }
      for (let i = 1; i <= 3; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        a[3 * i + 22] = (channel && channel.group) || i;
        a[3 * i + 23] = (channel && channel.type) || 0;
        a[3 * i + 24] = (channel && channel.value) || 0;
      }
      if (major >= 5) {
        for (let i = 0; i < 10; i++) {
          const { brightness = 0 } = get(`${id}/LA/${i + 1}`) || {};
          a.push(brightness);
        }
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DIM4: {
      for (let i = 1; i <= 4; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        a[2 * i - 1] = (channel && channel.type) || 0;
        a[2 * i] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DIM_1_AC_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      const channel = get(`${id}/${DIM}/1`);
      a[1] = (channel && channel.group) || 1;
      a[2] = (channel && channel.type) || 0;
      a[3] = (channel && channel.value) || 0;
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_DIM_4: {
      const { version = "" } = get(id) || {};
      const major = parseInt(version.split(".")[0], 10);
      for (let i = 1; i <= 4; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        if (major < 2) {
          a[2 * i - 1] = (channel && channel.type) || 0;
          a[2 * i] = (channel && channel.value) || 0;
        } else {
          a[3 * i - 2] = (channel && channel.group) || i;
          a[3 * i - 1] = (channel && channel.type) || 0;
          a[3 * i] = (channel && channel.value) || 0;
        }
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DIM8: {
      for (let i = 1; i <= 8; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        a[2 * i - 1] = (channel && channel.type) || 0;
        a[2 * i] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DIM_8: {
      const { version = "" } = get(id) || {};
      const major = parseInt(version.split(".")[0], 10);
      for (let i = 1; i <= 8; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        if (major < 2) {
          a[2 * i - 1] = (channel && channel.type) || 0;
          a[2 * i] = (channel && channel.value) || 0;
        } else {
          a[3 * i - 2] = (channel && channel.group) || i;
          a[3 * i - 1] = (channel && channel.type) || 0;
          a[3 * i] = (channel && channel.value) || 0;
        }
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_DIM_12_LED_RS:
    case DEVICE_TYPE_DIM_12_AC_RS:
    case DEVICE_TYPE_DIM_12_DC_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      for (let i = 1; i <= 12; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        a[3 * i - 2] = (channel && channel.group) || i;
        a[3 * i - 1] = (channel && channel.type) || 0;
        a[3 * i - 0] = (channel && channel.value) || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_DIM_8_RS: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      for (let i = 1; i <= 8; i++) {
        const channel = get(`${id}/${DIM}/${i}`);
        a[3 * i - 2] = (channel && channel.group) || i;
        a[3 * i - 1] = (channel && channel.type) || 0;
        a[3 * i - 0] = (channel && channel.value) || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_AO_4_DIN: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      a[0] = ACTION_INITIALIZE;
      for (let i = 1; i <= 4; i++) {
        const channel = get(`${id}/${AO}/${i}`) || {};
        a[i] = channel.value || 0;
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_DI_4_RSM: {
      const mac = id.split(":").map((i) => parseInt(i, 16));
      const { version } = get(id) || {};
      const major = parseInt(version.split(".")[0], 10);
      const channel = get(`${id}/${AO}/${1}`);
      switch (major) {
        case 1:
          a[1] = channel.value || 0;
          break;
        case 2: {
          const { baud = 0, line_control = 0 } = get(`${id}/${RS485}/1`) || {};
          a[1] = baud & 0xff;
          a[2] = (baud >> 8) & 0xff;
          a[3] = (baud >> 16) & 0xff;
          a[4] = (baud >> 24) & 0xff;
          a[5] = line_control;
          a[6] = (channel && channel.value) || 0;
          break;
        }
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    case DEVICE_TYPE_LANAMP: {
      for (let i = 0; i < 2; i++) {
        const index = i + 1;
        const { mode, volume = [] } = get(`${id}/lanamp/${index}`) || {};
        let source = [[], []];
        switch (mode) {
          case 0b01:
          case 0b10: {
            const zone = get(`${id}/stereo/${index}`);
            source[0] = zone.source || [];
            break;
          }
          case 0b11: {
            const zone0 = get(`${id}/mono/${2 * index - 1}`);
            source[0] = zone0.source || [];
            const zone1 = get(`${id}/mono/${2 * index}`);
            source[1] = zone1.source || [];
            break;
          }
        }
        a[39 * i + 1] = mode;
        for (let j = 0; j < 2; j++) {
          a[39 * i + j + 2] = volume[j];
          for (let k = 0; k < 9; k++) {
            const { active = 0, volume = 0 } = source[j][k] || {};
            a[39 * i + j * 9 + k + 4] = active;
            a[39 * i + j * 9 + k + 4 + 9 * 2] = volume;
          }
        }
      }
      for (let i = 0; i < 8; i++) {
        const index = i + 1;
        const {
          active,
          group = "",
          port = 0,
        } = get(`${id}/rtp/${index}`) || {};
        const ip = ip2int(group);
        a[79 + i * 7] = active;
        a[80 + i * 7] = (ip >> 24) & 0xff;
        a[81 + i * 7] = (ip >> 16) & 0xff;
        a[82 + i * 7] = (ip >> 8) & 0xff;
        a[83 + i * 7] = ip & 0xff;
        a[84 + i * 7] = (port >> 8) & 0xff;
        a[85 + i * 7] = port & 0xff;
      }
      for (let i = 0; i < 4; i++) {
        const channel = get(`${id}/${IR}/${i + 1}`) || {};
        const { bind } = channel;
        const { type, brand, model } = get(bind) || {};
        const {
          frequency,
          count = [],
          header = [],
          trail,
        } = ((codes[type] || {})[brand] || {})[model] || {};
        a[14 * i + 135] = frequency & 0xff;
        a[14 * i + 136] = (frequency >> 8) & 0xff;
        a[14 * i + 137] = count[0] & 0xff;
        a[14 * i + 138] = (count[0] >> 8) & 0xff;
        a[14 * i + 139] = count[1] & 0xff;
        a[14 * i + 140] = (count[1] >> 8) & 0xff;
        a[14 * i + 141] = count[2] & 0xff;
        a[14 * i + 142] = (count[2] >> 8) & 0xff;
        a[14 * i + 143] = header[0] & 0xff;
        a[14 * i + 144] = (header[0] >> 8) & 0xff;
        a[14 * i + 145] = header[1] & 0xff;
        a[14 * i + 146] = (header[1] >> 8) & 0xff;
        a[14 * i + 147] = trail & 0xff;
        a[14 * i + 148] = (trail >> 8) & 0xff;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_SOUNDBOX: {
      for (let i = 0; i < 2; i++) {
        const index = i + 1;
        const { mode, volume = [] } = get(`${id}/lanamp/${index}`) || {};
        let source = [[], []];
        switch (mode) {
          case 0b01:
          case 0b10: {
            const zone = get(`${id}/stereo/${index}`);
            source[0] = zone.source || [];
            break;
          }
          case 0b11: {
            const zone0 = get(`${id}/mono/${2 * index - 1}`);
            source[0] = zone0.source || [];
            const zone1 = get(`${id}/mono/${2 * index}`);
            source[1] = zone1.source || [];
            break;
          }
        }
        a[39 * i + 1] = mode;
        for (let j = 0; j < 2; j++) {
          a[39 * i + j + 2] = volume[j];
          for (let k = 0; k < 9; k++) {
            const { active = 0, volume = 0 } = source[j][k] || {};
            a[39 * i + j * 9 + k + 4] = active;
            a[39 * i + j * 9 + k + 4 + 9 * 2] = volume;
          }
        }
      }
      for (let i = 0; i < 8; i++) {
        const index = i + 1;
        const {
          active,
          group = "",
          port = 0,
        } = get(`${id}/rtp/${index}`) || {};
        const ip = ip2int(group);
        a[79 + i * 7] = active;
        a[80 + i * 7] = (ip >> 24) & 0xff;
        a[81 + i * 7] = (ip >> 16) & 0xff;
        a[82 + i * 7] = (ip >> 8) & 0xff;
        a[83 + i * 7] = ip & 0xff;
        a[84 + i * 7] = (port >> 8) & 0xff;
        a[85 + i * 7] = port & 0xff;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_PLC: {
      for (let i = 1; i <= 36; i++) {
        const channel = get(`${id}/${DI}/${i}`);
        a[i] = (channel && channel.value) || 0;
      }
      for (let i = 1; i <= 24; i++) {
        const channel = get(`${id}/${DO}/${i}`);
        a[i + 36] = (channel && channel.value) || 0;
      }
      device.send(Buffer.from(a), dev.ip);
      break;
    }
    case DEVICE_TYPE_ARTNET: {
      const { host, port, net, subnet, universe, rate, size = 0 } = dev;
      const config = { host, port, net, subnet, universe, rate };
      a[1] = (size << 8) & 0xff;
      a[2] = size & 0xff;
      for (let i = 1; i <= size; i++) {
        const channel = get(`${id}/${ARTNET}/${i}`);
        a[2 * i + 1] = (channel && channel.type) || 0;
        a[2 * i + 2] = (channel && channel.value) || 0;
      }
      device.send(
        Buffer.concat([Buffer.from(a), Buffer.from(JSON.stringify(config))]),
        dev.ip
      );
      break;
    }
    case DEVICE_TYPE_DI_4_LA:
    case DEVICE_TYPE_SMART_BOTTOM_1:
    case DEVICE_TYPE_SMART_BOTTOM_2:
    case DEVICE_TYPE_DOPPLER_1_DI_4:
    case DEVICE_TYPE_DOPPLER_5_DI_4: {
      for (let i = 0; i < 10; i++) {
        const { brightness = 0 } = get(`${id}/LA/${i + 1}`) || {};
        a.push(brightness);
      }
      device.sendRBUS(Buffer.from(a), id);
      break;
    }
    default: {
      set(id, { initialized: true });
      return;
    }
  }
};
