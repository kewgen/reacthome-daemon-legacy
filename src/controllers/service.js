const { CronJob } = require("cron");
const color = require("color-convert");
const ircodes = require("reacthome-ircodes");
const drivers = require("../drivers");
const {
  AC,
  GROUP,
  ACTION_DO,
  ACTION_GROUP,
  ACTION_DI_RELAY_SYNC,
  ACTION_DOPPLER0,
  ACTION_DIMMER,
  ACTION_ARTNET,
  ACTION_FIND_ME,
  ACTION_RGB,
  ACTION_IR,
  ACTION_IR_CONFIG,
  ACTION_RGB_DIM,
  ACTION_ON,
  ACTION_OFF,
  ACTION_RS485_MODE,
  ACTION_DIM,
  ACTION_ENABLE,
  ACTION_DISABLE,
  ACTION_DIM_RELATIVE,
  ACTION_SITE_LIGHT_DIM_RELATIVE,
  ACTION_SITE_LIGHT_OFF,
  ACTION_SETPOINT,
  ACTION_TIMER_START,
  ACTION_TIMER_STOP,
  ACTION_SCHEDULE_START,
  ACTION_SCHEDULE_STOP,
  ACTION_CLOCK_START,
  ACTION_CLOCK_STOP,
  ACTION_CLOCK_TEST,
  ACTION_NIGHT_TEST,
  ACTION_DAY_TEST,
  ACTION_DOPPLER_HANDLE,
  ACTION_THERMOSTAT_HANDLE,
  ACTION_LIMIT_HEATING_HANDLE,
  ACTION_TOGGLE,
  ACTION_TV,
  ACTION_LEAKAGE_RESET,
  ACTION_SCRIPT_RUN,
  DEVICE_TYPE_DIM4,
  DEVICE_TYPE_DIM_4,
  DEVICE_TYPE_DIM8,
  DEVICE_TYPE_DIM_8,
  DEVICE_TYPE_RELAY_2,
  DEVICE_TYPE_RELAY_2_DIN,
  DEVICE_TYPE_RELAY_6,
  DEVICE_TYPE_RELAY_12,
  DEVICE_TYPE_IR_4,
  DEVICE_TYPE_SENSOR4,
  DRIVER_TYPE_ARTNET,
  DRIVER_TYPE_BB_PLC1,
  DRIVER_TYPE_BB_PLC2,
  DRIVER_TYPE_INTESIS_BOX,
  ON,
  OFF,
  DIM_ON,
  DIM_OFF,
  DIM_SET,
  DIM_FADE,
  DIM_TYPE,
  DIM_TYPE_FALLING_EDGE,
  DIM_TYPE_RISING_EDGE,
  DIM_TYPE_PWM,
  ARTNET_FADE,
  ARTNET_TYPE_DIMMER,
  OPERATOR_PLUS,
  OPERATOR_MINUS,
  OPERATOR_MUL,
  OPERATOR_DIV,
  OPERATOR_LT,
  OPERATOR_LE,
  OPERATOR_EQ,
  OPERATOR_NE,
  OPERATOR_GE,
  OPERATOR_GT,
  STOP,
  HEAT,
  COOL,
  LIGHT_RGB,
  CLOSURE,
  CLOSE,
  OPEN,
  ACTION_OPEN,
  ACTION_STOP,
  ACTION_CLOSE,
  CLOSE_OPEN,
  ACTION_SET_ADDRESS,
  ACTION_SET_FAN_SPEED,
  ACTION_SET_DIRECTION,
  ACTION_SET_MODE,
  DEVICE_TYPE_MIX_1,
  DEVICE_TYPE_MIX_1_RS,
  DEVICE_TYPE_MIX_2,
  IR,
  ACTION_LANAMP,
  ACTION_RTP,
  ACTION_MULTIROOM_ZONE,
  DEVICE_TYPE_AO_4_DIN,
  SITE,
  DEVICE_TYPE_SMART_4G,
  DEVICE_TYPE_SMART_4GD,
  DEVICE_TYPE_SMART_4A,
  ACTION_IMAGE,
  DEVICE_TYPE_LANAMP,
  ACTION_INC_SETPOINT,
  ACTION_DEC_SETPOINT,
  ACTION_TEMPERATURE_CORRECT,
  ACTION_VIBRO,
  DIM_GROUP,
  ACTION_RGB_BUTTON_SET,
  DEVICE_TYPE_DIM_12_LED_RS,
  DEVICE_TYPE_DIM_12_AC_RS,
  DEVICE_TYPE_DIM_12_DC_RS,
  DEVICE_TYPE_DIM_1_AC_RS,
  ACTION_SITE_LIGHT_ON,
  DEVICE_TYPE_RELAY_12_RS,
  ACTION_SCREEN,
  DRIVER_TYPE_NOVA,
  DEVICE_TYPE_DIM_8_RS,
  DEVICE_TYPE_RS_HUB1_RS,
  DEVICE_TYPE_SMART_4AM,
  DEVICE_TYPE_SMART_6_PUSH,
  DRIVER_TYPE_SWIFT,
  DRIVER_TYPE_ALINK,
  ACTION_SETPOINT_MIN_MAX,
  DEVICE_TYPE_MIX_6x12_RS,
  DEVICE_TYPE_MIX_H,
  ACTION_ATS_MODE,
  DEVICE_TYPE_SERVER,
  ACTION_ERROR,
  DRIVER_TYPE_DALI_GW,
  DALI_FADE,
  ACTION_DALI,
  DRIVER_TYPE_COMFOVENT,
  DEVICE_TYPE_RS_HUB4,
  DEVICE_TYPE_SMART_TOP_A6P,
  DEVICE_TYPE_SMART_BOTTOM_1,
  DEVICE_TYPE_SMART_BOTTOM_2,
  DEVICE_TYPE_SMART_TOP_G4D,
  ACTION_GRADIENT,
  ACTION_BLINK,
  ACTION_PRINT,
  ACTION_HYGROSTAT_HANDLE,
  DRY,
  WET,
  ACTION_CO2_STAT_HANDLE,
  ACTION_PALETTE,
  ACTION_START_COOL,
  THERMOSTAT,
  ACTION_STOP_COOL,
  ACTION_START_WET,
  ACTION_STOP_HEAT,
  ACTION_START_HEAT,
  ACTION_STOP_WET,
  ACTION_START_VENTILATION,
  HYGROSTAT,
  CO2_STAT,
  ACTION_STOP_VENTILATION,
  DEVICE_TYPE_DI_4_RSM,
  ACTION_INTENSITY,
  VENTILATION,
  DRIVER_TYPE_MD_CCM18_AN_E,
  DRIVER_TYPE_TICA,
  ACTION_ALED_ON,
  ACTION_ALED_BRIGHTNESS,
  ACTION_ALED_OFF,
  ACTION_ALED_CONFIG_GROUP,
  DRIVER_TYPE_DALI_DLC,
  ACTION_ALED_CLIP,
  ACTION_ALED_MASK_ANIMATION_STOP,
  ACTION_ALED_MASK_ANIMATION_PLAY,
  ACTION_ALED_COLOR_ANIMATION_STOP,
  ACTION_ALED_COLOR_ANIMATION_PLAY,
  DEVICE_TYPE_DOPPLER_1_DI_4,
  DEVICE_TYPE_DOPPLER_5_DI_4,
  ACTION_SET_POSITION,
  ACTION_UP,
  DRIVER_TYPE_DAUERHAFT,
  ACTION_DOWN,
  ACTION_LIMIT_UP,
  ACTION_LIMIT_DOWN,
  ACTION_LEARN,
  ACTION_DELETE_ADDRESS,
  DEVICE_TYPE_SMART_TOP_A4T,
  DEVICE_TYPE_SMART_TOP_A6T,
  DEVICE_TYPE_SMART_TOP_G6,
  DEVICE_TYPE_SMART_TOP_G4,
  DEVICE_TYPE_SMART_TOP_G2,
  DEVICE_TYPE_SMART_TOP_A4P,
  ACTION_SHELL_START,
  ACTION_SHELL_STOP,
  DEVICE_TYPE_DI_4_LA,
  DEVICE_TYPE_SMART_TOP_A4TD,
  ACTION_CORRECT,
  ACTION_SET,
  POOL,
  DIM,
  DO,
  DEVICE_TYPE_SMART_TOP_A4TD_7S,
} = require("../constants");
const { NOTIFY } = require("../notification/constants");
const notification = require("../notification");
const {
  get,
  set,
  makeBind,
  applySite,
} = require("../actions");
const { device } = require("../sockets");
const mac = require("../mac");
const { ac } = require("../drivers");
const { RING } = require("../ring/constants");
const { ip2int, toRelativeHumidity, toKelvin } = require("../util");
const { char2image } = require("../drivers/display");
const childProcess = require("child_process");

const timers = {};
const schedules = {};

const AO_VELOCITY = 0;
const DIM_VELOCITY = 180;
const ARTNET_VELOCITY = 1;

const bind = ["r", "g", "b", "bind"];
const rgb = ["r", "g", "b"];


const run = (action) => {
  try {
    switch (action.type) {
      case ACTION_FIND_ME: {
        const dev = get(action.id);
        switch (dev.type) {
          case DEVICE_TYPE_RELAY_12_RS:
          case DEVICE_TYPE_DIM_12_LED_RS:
          case DEVICE_TYPE_DIM_12_AC_RS:
          case DEVICE_TYPE_DIM_12_DC_RS:
          case DEVICE_TYPE_MIX_6x12_RS:
          case DEVICE_TYPE_SMART_4A:
          case DEVICE_TYPE_SMART_4AM:
          case DEVICE_TYPE_SMART_4G:
          case DEVICE_TYPE_SMART_4GD:
          case DEVICE_TYPE_SMART_6_PUSH:
          case DEVICE_TYPE_SMART_BOTTOM_1:
          case DEVICE_TYPE_SMART_BOTTOM_2: {
            device.sendRBUS(Buffer.from([
              ACTION_FIND_ME,
              action.finding,
            ]),
              action.id
            );
            break;
          }
          default: device.send(Buffer.from([ACTION_FIND_ME, action.finding]), dev.ip);

        }
        break;
      }
      case ACTION_OPEN:
      case ACTION_STOP:
      case ACTION_CLOSE: {
        const o = get(action.id) || {};
        if (o.type === DRIVER_TYPE_DAUERHAFT) {
          drivers.run(action);
          return;
        }
        if (o.disabled) return;
        if (o.bind) {
          const [dev, type, index] = o.bind.split("/");
          const { protocol } = get(dev) || {};
          run({ type: ACTION_DO, id: dev, index, value: action.type });
        }
        break;
      }
      case ACTION_DO: {
        const dev = get(action.id);
        const { version = "" } = dev;
        const [major, minor] = version.split(".");
        // const id = `${action.id}/${DO}/${action.index}`;
        switch (dev.type) {
          case DRIVER_TYPE_BB_PLC1:
          case DRIVER_TYPE_BB_PLC2: {
            drivers.run(action);
            break;
          }
          case DEVICE_TYPE_DI_4_RSM:
          case DEVICE_TYPE_AO_4_DIN:
          case DEVICE_TYPE_MIX_1_RS:
          case DEVICE_TYPE_MIX_6x12_RS:
          case DEVICE_TYPE_MIX_H:
          case DEVICE_TYPE_RELAY_2:
          case DEVICE_TYPE_RELAY_2_DIN:
          case DEVICE_TYPE_RELAY_12_RS: {
            switch (action.value) {
              case ACTION_OPEN:
              case ACTION_CLOSE:
              case ACTION_STOP: {
                const group = get(`${action.id}/${GROUP}/${action.index}`);
                if (!group || !group.enabled) return;
                switch (action.value) {
                  case ACTION_STOP: {
                    device.sendRBUS(Buffer.from([
                      ACTION_DO,
                      2 * action.index - 1,
                      0,
                    ]),
                      action.id
                    );
                    device.sendRBUS(Buffer.from([
                      ACTION_DO,
                      2 * action.index,
                      0,
                    ]),
                      action.id
                    );
                    break;
                  }
                  case ACTION_OPEN: {
                    if (group.type === CLOSE_OPEN) {
                      device.sendRBUS(Buffer.from([
                        ACTION_DO,
                        2 * action.index,
                        1,
                      ]),
                        action.id
                      );
                    } else {
                      device.sendRBUS(Buffer.from([
                        ACTION_DO,
                        2 * action.index - 1,
                        1,
                      ]),
                        action.id
                      );
                    }
                    break;
                  }
                  case ACTION_CLOSE: {
                    if (group.type === CLOSE_OPEN) {
                      device.sendRBUS(Buffer.from([
                        ACTION_DO,
                        2 * action.index - 1,
                        1,
                      ]),
                        action.id
                      );
                    } else {
                      device.sendRBUS(Buffer.from([
                        ACTION_DO,
                        2 * action.index,
                        1,
                      ]),
                        action.id
                      );
                    }
                    break;
                  }
                }
                break;
              }
              default: {
                const a = [
                  ACTION_DO,
                  action.index,
                ];
                if (action.value !== undefined) {
                  a.push(action.value);
                }
                if (action.timeout !== undefined) {
                  if (major >= 3) {
                    a.push(2);
                  }
                  a.push(action.timeout & 0xff);
                  a.push((action.timeout >> 8) & 0xff);
                  a.push((action.timeout >> 16) & 0xff);
                  a.push((action.timeout >> 24) & 0xff);
                } else if (action.group !== undefined) {
                  if (major >= 3) {
                    a.push(3);
                    a.push(action.group);
                  }
                }
                device.sendRBUS(Buffer.from(a), action.id);
              }
            }
            break;
          }
          case DEVICE_TYPE_MIX_1:
          case DEVICE_TYPE_MIX_2:
          case DEVICE_TYPE_RELAY_6:
          case DEVICE_TYPE_RELAY_12: {
            if (major >= 2) {
              switch (action.value) {
                case ACTION_OPEN:
                case ACTION_CLOSE:
                case ACTION_STOP: {
                  const group = get(`${action.id}/${GROUP}/${action.index}`);
                  if (!group || !group.enabled) return;
                  switch (action.value) {
                    case ACTION_STOP: {
                      device.send(
                        Buffer.from([ACTION_DO, 2 * action.index - 1, 0]),
                        dev.ip
                      );
                      device.send(
                        Buffer.from([ACTION_DO, 2 * action.index, 0]),
                        dev.ip
                      );
                      break;
                    }
                    case ACTION_OPEN: {
                      if (group.type === CLOSE_OPEN) {
                        device.send(
                          Buffer.from([ACTION_DO, 2 * action.index, 1]),
                          dev.ip
                        );
                      } else {
                        device.send(
                          Buffer.from([ACTION_DO, 2 * action.index - 1, 1]),
                          dev.ip
                        );
                      }
                      break;
                    }
                    case ACTION_CLOSE: {
                      if (group.type === CLOSE_OPEN) {
                        device.send(
                          Buffer.from([ACTION_DO, 2 * action.index - 1, 1]),
                          dev.ip
                        );
                      } else {
                        device.send(
                          Buffer.from([ACTION_DO, 2 * action.index, 1]),
                          dev.ip
                        );
                      }
                      break;
                    }
                  }
                  break;
                }
                default: {
                  const a = [ACTION_DO, action.index];
                  if (action.value !== undefined) {
                    a.push(action.value);
                  } else if (action.timeout !== undefined) {
                    if (major >= 3) {
                      a.push(2);
                    }
                    a.push(action.timeout & 0xff);
                    a.push((action.timeout >> 8) & 0xff);
                    a.push((action.timeout >> 16) & 0xff);
                    a.push((action.timeout >> 24) & 0xff);
                  } else if (action.group !== undefined) {
                    if (major >= 3) {
                      a.push(3);
                      a.push(action.group);
                    }
                  }
                  device.send(Buffer.from(a), dev.ip);
                }
              }
            } else {
              device.send(
                Buffer.from([ACTION_DO, action.index, action.value]),
                dev.ip
              );
            }
            break;
          }
          case DEVICE_TYPE_DI_4_RSM:
          case DEVICE_TYPE_AO_4_DIN: {
            device.sendRBUS(Buffer.from([
              ACTION_DO,
              action.index,
              action.value,
            ]),
              action.id
            );
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([
              ACTION_DO, action.value
            ]),
              action.id
            );
            break;
          }
          default: {
            device.send(
              Buffer.from([ACTION_DO, action.index, action.value]),
              dev.ip
            );
          }
        }
        break;
      }
      case ACTION_GROUP: {
        const dev = get(action.id);
        const group = `${action.id}/${GROUP}/${action.index}`;
        const buffer = Buffer.alloc(7);
        const { enabled, delay } = get(group) || {};
        buffer.writeUInt8(ACTION_GROUP, 0);
        buffer.writeUInt8(action.index, 1);
        buffer.writeUInt8(
          action.enabled === undefined ? enabled : action.enabled,
          2
        );
        buffer.writeUInt32LE(
          action.delay === undefined ? delay : action.delay,
          3
        );
        switch (dev.type) {
          case DEVICE_TYPE_MIX_1_RS:
          case DEVICE_TYPE_MIX_6x12_RS:
          case DEVICE_TYPE_MIX_H:
          case DEVICE_TYPE_RELAY_2:
          case DEVICE_TYPE_RELAY_2_DIN:
          case DEVICE_TYPE_RELAY_12_RS: {
            device.sendRBUS(buffer, action.id);
            break;
          }
          default:
            device.send(buffer, dev.ip);
        }
        break;
      }
      case ACTION_DI_RELAY_SYNC: {
        const dev = get(action.id);
        switch (dev.type) {
          case DEVICE_TYPE_MIX_1_RS:
          case DEVICE_TYPE_MIX_6x12_RS:
          case DEVICE_TYPE_MIX_H:
          case DEVICE_TYPE_RELAY_2:
          case DEVICE_TYPE_RELAY_2_DIN: {
            device.sendRBUS(Buffer.from([
              ACTION_DI_RELAY_SYNC,
              action.index,
              ...action.value[0],
              ...action.value[1],
            ]),
              action.id
            );
            break;
          }
          default:
            device.send(
              Buffer.from([
                ACTION_DI_RELAY_SYNC,
                action.index,
                ...action.value[0],
                ...action.value[1],
              ]),
              dev.ip
            );
        }
        break;
      }
      case ACTION_ATS_MODE: {
        const dev = get(action.id);
        switch (dev.type) {
          case DEVICE_TYPE_MIX_6x12_RS: {
            device.sendRBUS(Buffer.from([
              ACTION_ATS_MODE,
              action.value,
            ]),
              action.id
            );
            break;
          }
        }
        break;
      }
      case ACTION_DOPPLER0: {
        const dev = get(action.id);
        device.send(Buffer.from([ACTION_DOPPLER0, action.gain]), dev.ip);
        break;
      }
      case ACTION_DIMMER: {
        const dev = get(action.id) || {};
        switch (dev.type) {
          case DEVICE_TYPE_DIM_8_RS:
          case DEVICE_TYPE_MIX_H:
          case DEVICE_TYPE_DIM_12_LED_RS:
          case DEVICE_TYPE_DIM_12_AC_RS:
          case DEVICE_TYPE_DIM_12_DC_RS:
          case DEVICE_TYPE_DIM_1_AC_RS:
          case DEVICE_TYPE_DI_4_RSM:
          case DEVICE_TYPE_AO_4_DIN: {
            const velocity =
              dev.type === DEVICE_TYPE_DIM_12_LED_RS ||
                dev.type === DEVICE_TYPE_MIX_H ||
                dev.type === DEVICE_TYPE_DIM_12_AC_RS ||
                dev.type === DEVICE_TYPE_DIM_12_DC_RS ||
                dev.type === DEVICE_TYPE_DIM_1_AC_RS ||
                dev.type === DEVICE_TYPE_DIM_8_RS
                ? DIM_VELOCITY
                : AO_VELOCITY;
            switch (action.action) {
              case DIM_TYPE:
              case DIM_GROUP: {
                if (dev.type === DEVICE_TYPE_AO_4_DIN || dev.type === DEVICE_TYPE_DI_4_RSM) {
                  break;
                }
              }
              case DIM_SET:
                device.sendRBUS(Buffer.from([
                  ACTION_DIMMER,
                  action.index,
                  action.action,
                  action.value,
                ]),
                  action.id
                );
                break;
              case DIM_FADE:
                device.sendRBUS(Buffer.from([
                  ACTION_DIMMER,
                  action.index,
                  action.action,
                  action.value,
                  velocity,
                ]),
                  action.id
                );
                break;
              case DIM_ON:
                device.sendRBUS(Buffer.from([
                  ACTION_DIMMER,
                  action.index,
                  action.action,
                ]),
                  action.id
                );
                break;
              case DIM_OFF:
                device.sendRBUS(Buffer.from([
                  ACTION_DIMMER,
                  action.index,
                  action.action,
                ]),
                  action.id
                );
                break;
            }
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([
              ACTION_DIMMER,
              action.value,
            ]),
              action.id
            );
            break;
          }
          default: {
            let velocity = DIM_VELOCITY;
            if (dev.type === DRIVER_TYPE_ARTNET) {
              velocity = ARTNET_VELOCITY;
            }
            switch (action.action) {
              case DIM_ON:
              case DIM_OFF:
                device.send(
                  Buffer.from([ACTION_DIMMER, action.index, action.action]),
                  dev.ip
                );
                break;
              case DIM_SET:
              case DIM_TYPE:
              case DIM_GROUP:
                device.send(
                  Buffer.from([
                    ACTION_DIMMER,
                    action.index,
                    action.action,
                    action.value,
                  ]),
                  dev.ip
                );
                break;
              case DIM_FADE:
                device.send(
                  Buffer.from([
                    ACTION_DIMMER,
                    action.index,
                    action.action,
                    action.value,
                    velocity,
                  ]),
                  dev.ip
                );
                break;
            }
          }
        }
        break;
      }
      case ACTION_ARTNET: {
        drivers.run(action);
        break;
      }
      case ACTION_DALI: {
        drivers.run(action);
        break;
      }
      case ACTION_RGB_DIM: {
        const { id, value = {}, index = 0, palette = 1 } = action;
        const { r, g, b } = value;
        const o = get(id) || {};
        const { ip, type } = o;
        switch (type) {
          case DEVICE_TYPE_SENSOR4: {
            device.send(Buffer.from([ACTION_RGB, index, r, g, b]), ip);
            break;
          }
          case DEVICE_TYPE_SMART_4G:
          case DEVICE_TYPE_SMART_4GD:
          case DEVICE_TYPE_SMART_4A:
          case DEVICE_TYPE_SMART_4AM:
          case DEVICE_TYPE_SMART_6_PUSH: {
            device.sendRBUS(Buffer.from([
              ACTION_RGB,
              index,
              r,
              g,
              b,
            ]),
              action.id
            );
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            console.warn(action)
            device.sendTOP(Buffer.from([
              ACTION_RGB,
              palette,
              index,
              r,
              g,
              b,
            ]),
              action.id
            );
            break;
          }
          case LIGHT_RGB: {
            set(id, { last: { r, g, b } });
            for (const i of rgb) {
              if (!o[i]) continue;
              const [dev, kind, index] = o[i].split("/");
              const { ip, type: deviceType } = get(dev);
              const v = value[i];
              switch (deviceType) {
                case DEVICE_TYPE_SERVER:
                case DEVICE_TYPE_RS_HUB4:
                case DEVICE_TYPE_DIM4:
                case DEVICE_TYPE_DIM_4:
                case DEVICE_TYPE_DIM8:
                case DEVICE_TYPE_DIM_8: {
                  device.send(
                    Buffer.from([
                      ACTION_DIMMER,
                      index,
                      DIM_FADE,
                      v,
                      DIM_VELOCITY,
                    ]),
                    ip
                  );
                  break;
                }
                case DEVICE_TYPE_DI_4_RSM:
                case DEVICE_TYPE_AO_4_DIN:
                case DEVICE_TYPE_DIM_8_RS:
                case DEVICE_TYPE_MIX_H:
                case DEVICE_TYPE_DIM_12_LED_RS:
                case DEVICE_TYPE_DIM_12_AC_RS:
                case DEVICE_TYPE_DIM_12_DC_RS:
                case DEVICE_TYPE_DIM_1_AC_RS: {
                  device.sendRBUS(Buffer.from([
                    ACTION_DIMMER,
                    index,
                    DIM_FADE,
                    v,
                    dev.type === DEVICE_TYPE_DIM_12_LED_RS ||
                      dev.type === DEVICE_TYPE_MIX_H ||
                      dev.type === DEVICE_TYPE_DIM_12_AC_RS ||
                      dev.type === DEVICE_TYPE_DIM_12_DC_RS ||
                      dev.type === DEVICE_TYPE_DIM_1_AC_RS ||
                      dev.type === DEVICE_TYPE_DIM_8_RS
                      ? DIM_VELOCITY
                      : AO_VELOCITY,
                  ]),
                    dev
                  );
                  break;
                }
                case DRIVER_TYPE_ARTNET: {
                  drivers.run({
                    id: dev,
                    index,
                    action: ARTNET_FADE,
                    value: v,
                    velocity: ARTNET_VELOCITY,
                  });
                  break;
                }
                case DRIVER_TYPE_DALI_GW:
                case DRIVER_TYPE_DALI_DLC: {
                  drivers.run({
                    id: dev,
                    kind,
                    index,
                    value: v,
                  });
                  break;
                }
              }
            }
            break;
          }
        }
        break;
      }
      case ACTION_RGB_BUTTON_SET: {
        const { id, value = {}, index = 0, palette = 1 } = action;
        const { r, g, b } = value;
        const o = get(id) || {};
        const { ip, type } = o;
        switch (type) {
          case DEVICE_TYPE_SENSOR4: {
            device.send(Buffer.from([ACTION_RGB, index, r, g, b]), ip);
            break;
          }
          case DEVICE_TYPE_SMART_4G:
          case DEVICE_TYPE_SMART_4GD:
          case DEVICE_TYPE_SMART_4A:
          case DEVICE_TYPE_SMART_4AM:
          case DEVICE_TYPE_SMART_6_PUSH: {
            device.sendRBUS(Buffer.from([
              ACTION_RGB,
              index,
              r,
              g,
              b,
            ]),
              action.id
            );
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([
              ACTION_RGB,
              palette,
              index,
              r,
              g,
              b,
            ]),
              action.id
            );
            break;
          }
        }
        break;
      }
      case ACTION_GRADIENT: {
        const { id, palette, index, value } = action;
        const { type } = get(id) || {};
        switch (type) {
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4TD: {
            set(`${id}/gradient/${palette}.${index}`, value);
            const topLeft = get(`${id}/gradient/${palette}.1`) || {};
            const topRight = get(`${id}/gradient/${palette}.2`) || {};
            const bottomLeft = get(`${id}/gradient/${palette}.3`) || {};
            const bottomRight = get(`${id}/gradient/${palette}.4`) || {};
            const cmd = [ACTION_RGB, palette, type === DEVICE_TYPE_SMART_TOP_G4D ? 19 : 17];
            for (let i = 0; i < 5; i++) {
              const left = compose(topLeft, 5 - i, bottomLeft, i);
              const right = compose(topRight, 5 - i, bottomRight, i);
              for (let j = 0; j < 14; j++) {
                if (j === 0 && i !== 2) continue;
                if (j === 2) continue;
                if (j === 4 && i === 1) continue;
                if (j === 4 && i === 3) continue;
                if (j === 6) continue;
                if (j === 8 && i === 1) continue;
                if (j === 8 && i === 3) continue;
                if (j === 10 && i !== 4) continue;
                if (j === 12 && i === 1) continue;
                if (j === 12 && i === 3) continue;
                const { r, g, b } = compose(left, 13 - j, right, j);
                cmd.push(r);
                cmd.push(g)
                cmd.push(b);
              }
            }
            device.sendTOP(Buffer.from(cmd), action.id);
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            set(`${id}/gradient/${palette}.${index}`, value);
            const topLeft = get(`${id}/gradient/${palette}.1`) || {};
            const topRight = get(`${id}/gradient/${palette}.2`) || {};
            const bottomLeft = get(`${id}/gradient/${palette}.3`) || {};
            const bottomRight = get(`${id}/gradient/${palette}.4`) || {};
            const cmd = [ACTION_RGB, palette, 17];
            for (let i = 0; i < 5; i++) {
              const left = compose(topLeft, 5 - i, bottomLeft, i);
              const right = compose(topRight, 5 - i, bottomRight, i);
              for (let j = 0; j < 14; j++) {
                if (j === 0 && i !== 2) continue;
                if (j === 1 && (i === 0 || i === 2 || i === 4)) continue;
                if (j === 2) continue;
                if (j === 3 && (i === 0 || i === 2 || i === 4)) continue;
                if (j === 4 && i === 1) continue;
                if (j === 5 && (i === 0 || i === 2 || i === 4)) continue;
                if (j === 4 && i === 3) continue;
                if (j === 6) continue;
                if (j === 7 && (i === 0 || i === 2 || i === 4)) continue;
                if (j === 8 && i === 1) continue;
                if (j === 8 && i === 3) continue;
                if (j === 9 && (i === 0 || i === 2 || i === 4)) continue;
                if (j === 10 && i !== 4) continue;
                if (j === 11 && (i === 0 || i === 2 || i === 4)) continue;
                if (j === 12 && i === 1) continue;
                if (j === 12 && i === 3) continue;
                if (j === 13 && (i === 0 || i === 2 || i === 4)) continue;
                const { r, g, b } = compose(left, 13 - j, right, j);
                cmd.push(r);
                cmd.push(g)
                cmd.push(b);
              }
            }
            device.sendTOP(Buffer.from(cmd), action.id);
            break;
          }
        }
        break;
      }
      case ACTION_IMAGE: {
        const { id, level, value } = action;
        const { type } = get(id) || {};
        switch (type) {
          case DEVICE_TYPE_SMART_TOP_A6P:
            const buff = Buffer.alloc(2);
            buff[0] = ACTION_IMAGE;
            buff[1] = value[0] || 0;
            device.sendTOP(buff, action.id);
            break;
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4TD: {
            const buff = Buffer.alloc(9);
            buff[0] = ACTION_IMAGE;
            for (let i = 0; i < 8; i++) {
              buff[i + 1] = value[i] || 0;
            }
            device.sendTOP(buff, action.id);
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            const buff = Buffer.alloc(7);
            buff[0] = ACTION_IMAGE;
            for (let i = 0; i < 6; i++) {
              buff[i + 1] = value[i] || 0;
            }
            device.sendTOP(buff, action.id);
            break;
          }
          default:
            const [i2, i1] = Array.isArray(value)
              ? value
              : Array.from(String(value).padStart(2, " "))
                .slice(-2)
                .map((i) => char2image[i]);
            const dev = get(id) || {};
            device.sendRBUS(Buffer.from([
              ACTION_IMAGE,
              level || dev.level,
              i2,
              i1,
            ]),
              action.id
            );
        }
        break;
      }
      case ACTION_BLINK: {
        const { id, value } = action;
        const { type } = get(id) || {};
        switch (type) {
          case DEVICE_TYPE_SMART_TOP_A6P:
            const buff = Buffer.alloc(2);
            buff[0] = ACTION_BLINK;
            buff[1] = value[0] || 0;
            device.sendTOP(buff, action.id);
            break;
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4TD: {
            const buff = Buffer.alloc(9);
            buff[0] = ACTION_BLINK;
            for (let i = 0; i < 8; i++) {
              buff[i + 1] = value[i] || 0;
            }
            device.sendTOP(buff, action.id);
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            const buff = Buffer.alloc(7);
            buff[0] = ACTION_BLINK;
            for (let i = 0; i < 6; i++) {
              buff[i + 1] = value[i] || 0;
            }
            device.sendTOP(buff, action.id);
            break;
          }
        }
        break;
      }
      case ACTION_PALETTE: {
        const { id, value } = action;
        const dev = get(id) || {};
        switch (dev.type) {
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([ACTION_PALETTE, value]), action.id);
            break;
          }
        }
        break;
      }
      case ACTION_PRINT: {
        const { id, value, power, intensity = 0 } = action;
        const dev = get(id) || {};
        switch (dev.type) {
          case DEVICE_TYPE_SMART_TOP_G4D: {
            const dict = {
              " ": 0b000_00_000_00_000,
              "-": 0b000_00_011_00_000,
              "0": 0b111_11_101_11_111,
              "1": 0b001_01_001_01_001,
              "2": 0b111_01_111_10_111,
              "3": 0b111_01_111_01_111,
              "4": 0b101_11_111_01_001,
              "5": 0b111_10_111_01_111,
              "6": 0b111_10_111_11_111,
              "7": 0b111_01_001_01_001,
              "8": 0b111_11_111_11_111,
              "9": 0b111_11_111_01_111,
            }
            const offsets = [
              [
                25, 26, 27,
                33, 34,
                43, 44, 45,
                51, 52,
                61, 62, 63
              ],
              [
                22, 23, 24,
                31, 32,
                40, 41, 42,
                49, 50,
                57, 58, 59
              ],
              [
                19, 20, 21,
                29, 30,
                37, 38, 39,
                47, 48,
                54, 55, 56
              ],
              [
                18,
                28,
                35, 36,
                46,
                53
              ],
            ]
            const image = action.image ? action.image : [...dev.image];
            const setBit = (offset, v) => {
              const i = offset >> 3;
              const j = offset % 8;
              image[i] = v
                ? image[i] | (1 << j)
                : image[i] & ~(1 << j);
            }
            let j = value.length;
            if (j > 5) j = 5;
            for (let i = 0; i < 4; i++) {
              let c = value[--j] || " ";
              if (i === 1)
                if (c === ".") {
                  c = value[--j] || " ";
                  setBit(60, 1);
                } else {
                  setBit(60, 0);
                }
              const mask = dict[c] || 0;
              const offset = offsets[i];
              if (i === 3) {
                setBit(offset[0], (mask >> 10) & 1);
                setBit(offset[1], (mask >> 8) & 1);
                setBit(offset[2], (mask >> 6) & 1);
                setBit(offset[3], (mask >> 5) & 1);
                setBit(offset[4], (mask >> 3) & 1);
                setBit(offset[5], (mask >> 0) & 1);
              } else {
                for (let k = 0; k < 13; k++) {
                  setBit(offset[k], (mask >> (12 - k)) & 1);
                }
              }
            }
            setBit(11, power ? 1 : 0);
            switch (Math.round(3 * intensity)) {
              case 0:
                setBit(8, 0);
                setBit(9, 0);
                setBit(10, 0);
                break;
              case 1:
                setBit(8, 0);
                setBit(9, 0);
                setBit(10, 1);
                break;
              case 2:
                setBit(8, 0);
                setBit(9, 1);
                setBit(10, 1);
                break;
              default:
                setBit(8, 1);
                setBit(9, 1);
                setBit(10, 1);
            }
            run({ type: ACTION_IMAGE, id, value: image })
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A4TD: {
            const dict = {
              " ": 0b000_00_000_00_000,
              "-": 0b000_00_011_00_000,
              "0": 0b111_11_101_11_111,
              "1": 0b001_01_001_01_001,
              "2": 0b111_01_111_10_111,
              "3": 0b111_01_111_01_111,
              "4": 0b101_11_111_01_001,
              "5": 0b111_10_111_01_111,
              "6": 0b111_10_111_11_111,
              "7": 0b111_01_001_01_001,
              "8": 0b111_11_111_11_111,
              "9": 0b111_11_111_01_111,
            }
            const offsets = [
              [
                23, 24, 25,
                31, 32,
                41, 42, 43,
                49, 50,
                59, 60, 61
              ],
              [
                20, 21, 22,
                29, 30,
                38, 39, 40,
                47, 48,
                55, 56, 57
              ],
              [
                17, 18, 19,
                27, 28,
                35, 36, 37,
                45, 46,
                52, 53, 54
              ],
              [
                16,
                26,
                33, 34,
                44,
                51
              ],
            ]
            const image = action.image ? action.image : [...dev.image];
            const setBit = (offset, v) => {
              const i = offset >> 3;
              const j = offset % 8;
              image[i] = v
                ? image[i] | (1 << j)
                : image[i] & ~(1 << j);
            }
            let j = value.length;
            if (j > 5) j = 5;
            for (let i = 0; i < 4; i++) {
              let c = value[--j] || " ";
              if (i === 1)
                if (c === ".") {
                  c = value[--j] || " ";
                  setBit(58, 1);
                } else {
                  setBit(58, 0);
                }
              const mask = dict[c] || 0;
              const offset = offsets[i];
              if (i === 3) {
                setBit(offset[0], (mask >> 10) & 1);
                setBit(offset[1], (mask >> 8) & 1);
                setBit(offset[2], (mask >> 6) & 1);
                setBit(offset[3], (mask >> 5) & 1);
                setBit(offset[4], (mask >> 3) & 1);
                setBit(offset[5], (mask >> 0) & 1);
              } else {
                for (let k = 0; k < 13; k++) {
                  setBit(offset[k], (mask >> (12 - k)) & 1);
                }
              }
            }
            setBit(9, power ? 1 : 0);
            switch (Math.round(3 * intensity)) {
              case 0:
                setBit(6, 0);
                setBit(7, 0);
                setBit(8, 0);
                break;
              case 1:
                setBit(6, 0);
                setBit(7, 0);
                setBit(8, 1);
                break;
              case 2:
                setBit(6, 0);
                setBit(7, 1);
                setBit(8, 1);
                break;
              default:
                setBit(6, 1);
                setBit(7, 1);
                setBit(8, 1);
            }
            run({ type: ACTION_IMAGE, id, value: image })
            break;
          }
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            const dict = {
              " ": 0b0_00_0_00_0,
              "-": 0b0_00_1_00_0,
              "0": 0b1_11_0_11_1,
              "1": 0b0_01_0_01_0,
              "2": 0b1_01_1_10_1,
              "3": 0b1_01_1_01_1,
              "4": 0b0_11_1_01_0,
              "5": 0b1_10_1_01_1,
              "6": 0b1_10_1_11_1,
              "7": 0b1_01_0_01_0,
              "8": 0b1_11_1_11_1,
              "9": 0b1_11_1_01_1,
            }
            const offsets = [
              [
                18,
                24, 25,
                29,
                35, 36,
                40,
              ],
              [
                17,
                22, 23,
                28,
                33, 34,
                38,
              ],
              [
                16,
                20, 21,
                27,
                31, 32,
                37,
              ],
              [
                19,
                26,
                30,
              ],
            ]
            const image = action.image ? action.image : [...dev.image];
            const setBit = (offset, v) => {
              const i = offset >> 3;
              const j = offset % 8;
              image[i] = v
                ? image[i] | (1 << j)
                : image[i] & ~(1 << j);
            }
            let j = value.length;
            if (j > 5) j = 5;
            for (let i = 0; i < 4; i++) {
              let c = value[--j] || " ";
              if (i === 1)
                if (c === ".") {
                  c = value[--j] || " ";
                  setBit(39, 1);
                } else {
                  setBit(39, 0);
                }
              const mask = dict[c] || 0;
              const offset = offsets[i];
              if (i === 3) {
                setBit(offset[0], (mask >> 4) & 1);
                setBit(offset[1], (mask >> 3) & 1);
                setBit(offset[2], (mask >> 1) & 1);
              } else {
                for (let k = 0; k < 7; k++) {
                  setBit(offset[k], (mask >> (6 - k)) & 1);
                }
              }
            }
            setBit(9, power ? 1 : 0);
            switch (Math.round(3 * intensity)) {
              case 0:
                setBit(6, 0);
                setBit(7, 0);
                setBit(8, 0);
                break;
              case 1:
                setBit(6, 0);
                setBit(7, 0);
                setBit(8, 1);
                break;
              case 2:
                setBit(6, 0);
                setBit(7, 1);
                setBit(8, 1);
                break;
              default:
                setBit(6, 1);
                setBit(7, 1);
                setBit(8, 1);
            }
            run({ type: ACTION_IMAGE, id, value: image })
            break;
          }
        }
        break;
      }
      case ACTION_ENABLE: {
        const { type } = get(action.id) || {};
        switch (type) {
          case AC: {
            // ac.handle(action);
            run({ id: action.id, type: ACTION_ON })
            break;
          }
          default: {
            set(action.id, { disabled: false });
          }
        }
        break;
      }
      case ACTION_ON: {
        const [id_, t_, index] = action.id ? action.id.split("/") : [];
        if (t_ === 'ac') {
          action.id = id_;
          action.index = index;
        }
        const { id } = action;
        const o = get(id) || {};
        if (o.disabled) return;
        if (o.type === DRIVER_TYPE_INTESIS_BOX || o.type === DRIVER_TYPE_MD_CCM18_AN_E || o.type === DRIVER_TYPE_TICA || o.type === DRIVER_TYPE_NOVA || o.type === DRIVER_TYPE_SWIFT || o.type === DRIVER_TYPE_ALINK || o.type === DRIVER_TYPE_COMFOVENT) {
          drivers.run(action);
          return;
        }
        // if (o.type === AC) {
        //   ac.handle(action);
        //   return;
        // }
        set(id, { value: true });
        if (o.onOn) {
          run({ type: ACTION_SCRIPT_RUN, id: o.onOn });
        }
        const { last = {} } = o;
        const isOn = last.r > 0 || last.g > 0 || last.b > 0 || last.value > 0;
        switch (o.type) {
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([
              ACTION_DO, ON
            ]),
              action.id
            );
            break;
          }
          default: {
            for (const i of bind) {
              if (!o[i]) continue;
              const { type } = get(o[i]) || {};
              const [dev, kind, index] = o[i].split("/");
              const { ip, type: deviceType, protocol } = get(dev) || {};
              const value = isOn ? (i === "bind" ? last.value : last[i]) : 255;
              switch (deviceType) {
                case DEVICE_TYPE_SERVER:
                case DEVICE_TYPE_RS_HUB4:
                case DEVICE_TYPE_DIM4:
                case DEVICE_TYPE_DIM_4:
                case DEVICE_TYPE_DIM8:
                case DEVICE_TYPE_DIM_8: {
                  switch (type) {
                    case DIM_TYPE_PWM:
                    case DIM_TYPE_RISING_EDGE:
                    case DIM_TYPE_FALLING_EDGE: {
                      device.send(
                        Buffer.from([
                          ACTION_DIMMER,
                          index,
                          DIM_FADE,
                          value,
                          DIM_VELOCITY,
                        ]),
                        ip
                      );
                      break;
                    }
                    default: {
                      device.send(Buffer.from([ACTION_DO, index, ON]), ip);
                    }
                  }
                  break;
                }
                case DEVICE_TYPE_DIM_8_RS:
                case DEVICE_TYPE_DIM_12_LED_RS:
                case DEVICE_TYPE_DIM_12_AC_RS:
                case DEVICE_TYPE_DIM_12_DC_RS:
                case DEVICE_TYPE_DIM_1_AC_RS: {
                  switch (type) {
                    case DIM_TYPE_PWM:
                    case DIM_TYPE_RISING_EDGE:
                    case DIM_TYPE_FALLING_EDGE: {
                      device.sendRBUS(Buffer.from([
                        ACTION_DIMMER,
                        index,
                        DIM_FADE,
                        value,
                        DIM_VELOCITY,
                      ]),
                        dev
                      );
                      break;
                    }
                    default: {
                      device.sendRBUS(Buffer.from([
                        ACTION_DIMMER,
                        index,
                        ON,
                      ]),
                        dev
                      );
                    }
                  }
                  break;
                }
                case DEVICE_TYPE_DI_4_RSM:
                case DEVICE_TYPE_AO_4_DIN:
                case DEVICE_TYPE_MIX_1_RS:
                case DEVICE_TYPE_MIX_6x12_RS:
                case DEVICE_TYPE_RELAY_2:
                case DEVICE_TYPE_RELAY_2_DIN:
                case DEVICE_TYPE_RELAY_12_RS: {
                  device.sendRBUS(Buffer.from([
                    ACTION_DO,
                    index,
                    ON,
                  ]),
                    dev
                  );
                  break;
                }
                case DEVICE_TYPE_MIX_H: {
                  switch (kind) {
                    case DIM: {
                      switch (type) {
                        case DIM_TYPE_PWM:
                        case DIM_TYPE_RISING_EDGE:
                        case DIM_TYPE_FALLING_EDGE: {
                          device.sendRBUS(Buffer.from([
                            ACTION_DIMMER,
                            index,
                            DIM_FADE,
                            value,
                            DIM_VELOCITY,
                          ]),
                            dev
                          );
                          break;
                        }
                        default: {
                          device.sendRBUS(Buffer.from([
                            ACTION_DIMMER,
                            index,
                            ON,
                          ]),
                            dev
                          );
                        }
                      }
                      break;
                    }
                    case DO: {
                      device.sendRBUS(Buffer.from([
                        ACTION_DO,
                        index,
                        ON,
                      ]),
                        dev
                      );
                      break;
                    }
                  }
                  break;
                }
                case DRIVER_TYPE_ARTNET: {
                  switch (type) {
                    case ARTNET_TYPE_DIMMER:
                      drivers.run({
                        id: dev,
                        index,
                        action: ARTNET_FADE,
                        value,
                        velocity: ARTNET_VELOCITY,
                      });
                      break;
                    default:
                      drivers.run({
                        id: dev,
                        index,
                        type: ACTION_DO,
                        value: ON,
                        velocity: ARTNET_VELOCITY,
                      });
                  }
                  break;
                }
                case DRIVER_TYPE_DALI_GW:
                case DRIVER_TYPE_DALI_DLC: {
                  drivers.run({
                    id: dev,
                    kind,
                    index,
                    value,
                  });
                  break;
                }
                case DRIVER_TYPE_BB_PLC1:
                case DRIVER_TYPE_BB_PLC2: {
                  drivers.run({ id: dev, index, value: ON });
                  break;
                }
                default: {
                  device.send(Buffer.from([ACTION_DO, index, ON]), ip);
                }
              }
            }
          }
        }
        break;
      }
      case ACTION_DISABLE: {
        const { type } = get(action.id) || {};
        switch (type) {
          case AC: {
            // ac.handle(action);
            run({ id: action.id, type: ACTION_OFF })
            break;
          }
          default: {
            set(action.id, { disabled: true });
          }
        }
        break;
      }
      case ACTION_OFF: {
        const [id_, t_, index] = action.id ? action.id.split("/") : [];
        if (t_ === 'ac') {
          action.id = id_;
          action.index = index;
        }
        const { id } = action;
        const o = get(id) || {};
        if (o.disabled) return;
        if (o.type === DRIVER_TYPE_INTESIS_BOX || o.type === DRIVER_TYPE_MD_CCM18_AN_E || o.type === DRIVER_TYPE_TICA || o.type === DRIVER_TYPE_NOVA || o.type === DRIVER_TYPE_SWIFT || o.type === DRIVER_TYPE_ALINK || o.type === DRIVER_TYPE_COMFOVENT) {
          drivers.run(action);
          return;
        }
        // if (o.type === AC) {
        //   ac.handle(action);
        //   return;
        // }
        set(id, { value: false });
        if (o.onOff) {
          run({ type: ACTION_SCRIPT_RUN, id: o.onOff });
        }
        switch (o.type) {
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([
              ACTION_DO, OFF
            ]),
              action.id
            );
            break;
          }
          default: {
            for (const i of bind) {
              if (!o[i]) continue;
              const { type } = get(o[i]) || {};
              const [dev, kind, index] = o[i].split("/");
              const { ip, type: deviceType, protocol } = get(dev);
              switch (deviceType) {
                case DEVICE_TYPE_SERVER:
                case DEVICE_TYPE_RS_HUB4:
                case DEVICE_TYPE_DIM4:
                case DEVICE_TYPE_DIM_4:
                case DEVICE_TYPE_DIM8:
                case DEVICE_TYPE_DIM_8: {
                  switch (type) {
                    case DIM_TYPE_PWM:
                    case DIM_TYPE_RISING_EDGE:
                    case DIM_TYPE_FALLING_EDGE:
                      device.send(
                        Buffer.from([
                          ACTION_DIMMER,
                          index,
                          DIM_FADE,
                          0,
                          DIM_VELOCITY,
                        ]),
                        ip
                      );
                      break;
                    default:
                      device.send(Buffer.from([ACTION_DO, index, OFF]), ip);
                  }
                  break;
                }
                case DEVICE_TYPE_DIM_8_RS:
                case DEVICE_TYPE_DIM_12_LED_RS:
                case DEVICE_TYPE_DIM_12_AC_RS:
                case DEVICE_TYPE_DIM_12_DC_RS:
                case DEVICE_TYPE_DIM_1_AC_RS: {
                  switch (type) {
                    case DIM_TYPE_PWM:
                    case DIM_TYPE_RISING_EDGE:
                    case DIM_TYPE_FALLING_EDGE:
                      device.sendRBUS(Buffer.from([
                        ACTION_DIMMER,
                        index,
                        DIM_FADE,
                        0,
                        DIM_VELOCITY,
                      ]),
                        dev
                      );
                      break;
                    default:
                      device.sendRBUS(Buffer.from([
                        ACTION_DIMMER,
                        index,
                        OFF,
                      ]),
                        dev
                      );
                  }
                  break;
                }
                case DEVICE_TYPE_DI_4_RSM:
                case DEVICE_TYPE_AO_4_DIN:
                case DEVICE_TYPE_MIX_1_RS:
                case DEVICE_TYPE_MIX_6x12_RS:
                case DEVICE_TYPE_RELAY_2:
                case DEVICE_TYPE_RELAY_2_DIN:
                case DEVICE_TYPE_RELAY_12_RS: {
                  device.sendRBUS(Buffer.from([
                    ACTION_DO,
                    index,
                    OFF,
                  ]),
                    dev
                  );
                  break;
                }
                case DEVICE_TYPE_MIX_H: {
                  switch (kind) {
                    case DIM: {
                      switch (type) {
                        case DIM_TYPE_PWM:
                        case DIM_TYPE_RISING_EDGE:
                        case DIM_TYPE_FALLING_EDGE: {
                          device.sendRBUS(Buffer.from([
                            ACTION_DIMMER,
                            index,
                            DIM_FADE,
                            0,
                            DIM_VELOCITY,
                          ]),
                            dev
                          );
                          break;
                        }
                        default: {
                          device.sendRBUS(Buffer.from([
                            ACTION_DIMMER,
                            index,
                            OFF,
                          ]),
                            dev
                          );
                        }
                      }
                      break;
                    }
                    case DO: {
                      device.sendRBUS(Buffer.from([
                        ACTION_DO,
                        index,
                        OFF,
                      ]),
                        dev
                      );
                      break;
                    }
                  }
                  break;
                }
                case DRIVER_TYPE_ARTNET: {
                  switch (type) {
                    case ARTNET_TYPE_DIMMER:
                      drivers.run({
                        id: dev,
                        index,
                        action: ARTNET_FADE,
                        value: 0,
                        velocity: ARTNET_VELOCITY,
                      });
                      break;
                    default:
                      drivers.run({
                        id: dev,
                        index,
                        type: ACTION_DO,
                        value: OFF,
                        velocity: ARTNET_VELOCITY,
                      });
                  }
                  break;
                }
                case DRIVER_TYPE_DALI_GW:
                case DRIVER_TYPE_DALI_DLC: {
                  drivers.run({
                    id: dev,
                    kind,
                    index,
                    value: 0,
                  });
                  break;
                }
                case DRIVER_TYPE_BB_PLC1:
                case DRIVER_TYPE_BB_PLC2: {
                  drivers.run({ id: dev, index, value: OFF });
                  break;
                }
                default: {
                  device.send(Buffer.from([ACTION_DO, index, OFF]), ip);
                }
              }
            }
          }
        }
        break;
      }
      case ACTION_DIM: {
        const { id, value } = action;
        const o = get(id) || {};
        const { last } = o;
        const R = o.r ? (get(o.r) || {}).value || 0 : 0;
        const G = o.g ? (get(o.g) || {}).value || 0 : 0;
        const B = o.b ? (get(o.b) || {}).value || 0 : 0;
        const [h, s] = color.rgb.hsv(R, G, B);
        const rgb = color.hsv.rgb(h, s, value / 2.55);
        const [r, g, b] = rgb;
        set(id, { last: o.bind ? { value } : { r, g, b }, value: !!value });
        switch (o.type) {
          case DEVICE_TYPE_SMART_TOP_A6P:
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4P:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(Buffer.from([
              ACTION_DIMMER,
              value]),
              action.id
            );
            break;
          }
          default: {
            for (let i = 0; i < bind.length; i++) {
              const c = bind[i];
              if (!o[c]) continue;
              const [dev, kind, index] = o[c].split("/");
              const { ip, type: deviceType } = get(dev) || {};
              let v;
              if (c === "bind") {
                v = value;
              } else {
                v = rgb[i];
              }
              const dimVelocity = action.velocity === undefined ? DIM_VELOCITY : action.velocity
              switch (deviceType) {
                case DEVICE_TYPE_SERVER:
                case DEVICE_TYPE_RS_HUB4:
                case DEVICE_TYPE_DIM4:
                case DEVICE_TYPE_DIM_4:
                case DEVICE_TYPE_DIM8:
                case DEVICE_TYPE_DIM_8: {
                  device.send(
                    Buffer.from([ACTION_DIMMER, index, DIM_FADE, v, dimVelocity]),
                    ip
                  );
                  break;
                }
                case DEVICE_TYPE_DIM_8_RS:
                case DEVICE_TYPE_DIM_12_LED_RS:
                case DEVICE_TYPE_MIX_H:
                case DEVICE_TYPE_DIM_12_AC_RS:
                case DEVICE_TYPE_DIM_12_DC_RS:
                case DEVICE_TYPE_DIM_1_AC_RS:
                case DEVICE_TYPE_DI_4_RSM:
                case DEVICE_TYPE_AO_4_DIN: {
                  device.sendRBUS(Buffer.from([
                    ACTION_DIMMER,
                    index,
                    DIM_FADE,
                    v,
                    deviceType === DEVICE_TYPE_DI_4_RSM ||
                      deviceType === DEVICE_TYPE_AO_4_DIN
                      ? AO_VELOCITY
                      : dimVelocity,
                  ]),
                    dev
                  );
                  break;
                }
                case DRIVER_TYPE_ARTNET: {
                  drivers.run({
                    id: dev,
                    index,
                    action: ARTNET_FADE,
                    value: v,
                    velocity: ARTNET_VELOCITY,
                  });
                  break;
                }
                case DRIVER_TYPE_DALI_GW:
                case DRIVER_TYPE_DALI_DLC: {
                  drivers.run({
                    id: dev,
                    kind,
                    index,
                    value: v,
                  });
                  break;
                }
              }
            }
          }
        }
        break;
      }
      case ACTION_DIM_RELATIVE: {
        const { id, value, operator } = action;
        const o = get(id) || {};
        let h, s, v;
        if (o.bind) {
          v = (get(o.bind) || {}).value;
        } else {
          const R = o.r ? (get(o.r) || {}).value || 0 : 0;
          const G = o.g ? (get(o.g) || {}).value || 0 : 0;
          const B = o.b ? (get(o.b) || {}).value || 0 : 0;
          [h, s, v] = color.rgb.hsv(R, G, B);
        }
        switch (operator) {
          case OPERATOR_PLUS:
            v = Math.round(v + Number(value));
            break;
          case OPERATOR_MINUS:
            v = Math.round(v - Number(value));
            break;
          case OPERATOR_MUL:
            v = Math.round(v * Number(value));
            break;
          case OPERATOR_DIV:
            v = Math.round(v / Number(value));
            break;
        }
        if (v < 0) v = 0;
        if (o.bind) {
          if (v > 255) v = 255;
        } else {
          if (v > 100) v = 100;
        }
        const rgb = color.hsv.rgb(h, s, v);
        const [r, g, b] = rgb || [0, 0, 0];
        set(id, { last: o.bind ? { v } : { r, g, b }, value: !!v });
        for (let i = 0; i < bind.length; i++) {
          const c = bind[i];
          if (!o[c]) continue;
          const [dev, kind, index] = o[c].split("/");
          const { ip, type: deviceType } = get(dev);
          if (c !== "bind") {
            v = rgb[i];
          }
          switch (deviceType) {
            case DEVICE_TYPE_SERVER:
            case DEVICE_TYPE_RS_HUB4:
            case DEVICE_TYPE_DIM4:
            case DEVICE_TYPE_DIM_4:
            case DEVICE_TYPE_DIM8:
            case DEVICE_TYPE_DIM_8: {
              device.send(
                Buffer.from([ACTION_DIMMER, index, DIM_FADE, v, DIM_VELOCITY]),
                ip
              );
              break;
            }
            case DEVICE_TYPE_DIM_8_RS:
            case DEVICE_TYPE_DIM_12_LED_RS:
            case DEVICE_TYPE_MIX_H:
            case DEVICE_TYPE_DIM_12_AC_RS:
            case DEVICE_TYPE_DIM_12_DC_RS:
            case DEVICE_TYPE_DIM_1_AC_RS:
            case DEVICE_TYPE_DI_4_RSM:
            case DEVICE_TYPE_AO_4_DIN: {
              device.sendRBUS(Buffer.from([
                ACTION_DIMMER,
                index,
                DIM_FADE,
                v,
                deviceType === DEVICE_TYPE_DIM_12_LED_RS ||
                  deviceType === DEVICE_TYPE_MIX_H ||
                  deviceType === DEVICE_TYPE_DIM_12_AC_RS ||
                  deviceType === DEVICE_TYPE_DIM_12_DC_RS ||
                  deviceType === DEVICE_TYPE_DIM_1_AC_RS ||
                  deviceType === DEVICE_TYPE_DIM_8_RS
                  ? DIM_VELOCITY
                  : AO_VELOCITY
              ]),
                dev
              );
              break;
            }
            case DRIVER_TYPE_ARTNET: {
              drivers.run({
                id: dev,
                index,
                action: ARTNET_FADE,
                value: v,
                velocity: ARTNET_VELOCITY,
              });
              break;
            }
            case DRIVER_TYPE_DALI_GW:
            case DRIVER_TYPE_DALI_DLC: {
              drivers.run({
                id: dev,
                kind,
                index,
                value: v,
              });
              break;
            }
          }
        }
        break;
      }
      case ACTION_SITE_LIGHT_DIM_RELATIVE: {
        const { id, operator, value } = action;
        applySite(id, ({ light_220 = [], light_LED = [], light_RGB = [] }) => {
          for (const i of light_220) {
            run({ type: ACTION_DIM_RELATIVE, id: i, operator, value });
          }
          for (const i of light_LED) {
            run({ type: ACTION_DIM_RELATIVE, id: i, operator, value });
          }
          for (const i of light_RGB) {
            run({ type: ACTION_DIM_RELATIVE, id: i, operator, value });
          }
        });
        break;
      }
      case ACTION_SITE_LIGHT_ON: {
        const { id } = action;
        applySite(id, ({ light_220 = [], light_LED = [], light_RGB = [] }) => {
          for (const i of light_220) {
            run({ type: ACTION_ON, id: i });
          }
          for (const i of light_LED) {
            run({ type: ACTION_ON, id: i });
          }
          for (const i of light_RGB) {
            run({ type: ACTION_ON, id: i });
          }
        });
        break;
      }
      case ACTION_SITE_LIGHT_OFF: {
        const { id } = action;
        applySite(id, ({ light_220 = [], light_LED = [], light_RGB = [] }) => {
          for (const i of light_220) {
            run({ type: ACTION_OFF, id: i });
          }
          for (const i of light_LED) {
            run({ type: ACTION_OFF, id: i });
          }
          for (const i of light_RGB) {
            run({ type: ACTION_OFF, id: i });
          }
        });
        break;
      }
      case ACTION_RS485_MODE: {
        const { id, index, is_rbus, baud, line_control } = action;
        const { ip, type } = get(id) || {};
        const buffer = Buffer.alloc(8);
        buffer[0] = ACTION_RS485_MODE;
        buffer[1] = index;
        buffer[2] = is_rbus;
        buffer.writeUInt32LE(baud, 3);
        buffer[7] = line_control;
        switch (type) {
          case DEVICE_TYPE_DI_4_RSM:
          case DEVICE_TYPE_RS_HUB1_RS: {
            device.sendRBUS(buffer, action.id);
            break;
          }
          default: {
            device.send(buffer, ip);
          }
        }
        break;
      }
      case ACTION_START_COOL: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { thermostat = [] } = get(id) || {};
            for (const i of thermostat) {
              run({ type: ACTION_START_COOL, id: i });
            }
            break;
          }
          case THERMOSTAT: {
            const { onStartCool } = get(id) || {};
            set(id, { cool: true });
            if (onStartCool) run({ type: ACTION_SCRIPT_RUN, id: onStartCool });
            break;
          }
        }
        break;
      }
      case ACTION_STOP_COOL: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { thermostat = [] } = get(id) || {};
            for (const i of thermostat) {
              run({ type: ACTION_STOP_COOL, id: i });
            }
            break;
          }
          case THERMOSTAT: {
            const { onStopCool } = get(id) || {};
            set(id, { cool: false });
            if (onStopCool) run({ type: ACTION_SCRIPT_RUN, id: onStopCool });
            break;
          }
        }
        break;
      }
      case ACTION_START_HEAT: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { thermostat = [] } = get(id) || {};
            for (const i of thermostat) {
              run({ type: ACTION_START_HEAT, id: i });
            }
            break;
          }
          case THERMOSTAT: {
            const { onStartHeat } = get(id) || {};
            set(id, { heat: true });
            if (onStartHeat) run({ type: ACTION_SCRIPT_RUN, id: onStartHeat });
            break;
          }
        }
        break;
      }
      case ACTION_STOP_HEAT: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { thermostat = [] } = get(id) || {};
            for (const i of thermostat) {
              run({ type: ACTION_STOP_HEAT, id: i });
            }
            break;
          }
          case THERMOSTAT: {
            const { onStopHeat } = get(id) || {};
            set(id, { heat: false });
            if (onStopHeat) run({ type: ACTION_SCRIPT_RUN, id: onStopHeat });
            break;
          }
        }
        break;
      }
      case ACTION_START_WET: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { hygrostat = [] } = get(id) || {};
            for (const i of hygrostat) {
              run({ type: ACTION_START_WET, id: i });
            }
            break;
          }
          case HYGROSTAT: {
            const { onStartWet } = get(id) || {};
            set(id, { wet: true });
            if (onStartWet) run({ type: ACTION_SCRIPT_RUN, id: onStartWet });
            break;
          }
        }
        break;
      }
      case ACTION_STOP_WET: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { hygrostat = [] } = get(id) || {};
            for (const i of hygrostat) {
              run({ type: ACTION_STOP_WET, id: i });
            }
            break;
          }
          case HYGROSTAT: {
            const { onStopWet } = get(id) || {};
            set(id, { wet: false });
            if (onStopWet) run({ type: ACTION_SCRIPT_RUN, id: onStopWet });
            break;
          }
        }
        break;
      }
      case ACTION_START_VENTILATION: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { co2_stat = [] } = get(id) || {};
            for (const i of co2_stat) {
              run({ type: ACTION_START_VENTILATION, id: i });
            }
            break;
          }
          case CO2_STAT: {
            const { onStartVentilation } = get(id) || {};
            set(id, { ventilation: true });
            if (onStartVentilation) run({ type: ACTION_SCRIPT_RUN, id: onStartVentilation });
            break;
          }
        }
        break;
      }
      case ACTION_STOP_VENTILATION: {
        const { id } = action;
        const { type } = get(id) || {};
        switch (type) {
          case SITE: {
            const { co2_stat = [] } = get(id) || {};
            for (const i of co2_stat) {
              run({ type: ACTION_STOP_VENTILATION, id: i });
            }
            break;
          }
          case CO2_STAT: {
            const { onStopVentilation } = get(id) || {};
            set(id, { ventilation: false });
            if (onStopVentilation) run({ type: ACTION_SCRIPT_RUN, id: onStopVentilation });
            break;
          }
        }
        break;
      }
      case ACTION_SETPOINT: {
        const [id_, t_, index] = action.id ? action.id.split("/") : [];
        if (t_ === 'ac') {
          action.id = id_;
          action.index = index;
        }
        const { id, value, temperature, humidity, co2 } = action;
        const dev = get(id) || {};
        if (temperature || value) {
          let setpoint = temperature || value;
          if (setpoint < 10) setpoint = 10;
          if (setpoint > 40) setpoint = 40;
          if (dev.type === SITE) {
            const { thermostat = [] } = dev
            for (const t of thermostat) {
              set(t, { setpoint });
            }
            set(id, { setpoint });
          } else if (dev.type === DRIVER_TYPE_INTESIS_BOX || dev.type === DRIVER_TYPE_MD_CCM18_AN_E || dev.type === DRIVER_TYPE_TICA || dev.type === DRIVER_TYPE_NOVA || dev.type === DRIVER_TYPE_SWIFT || dev.type === DRIVER_TYPE_ALINK || dev.type === DRIVER_TYPE_COMFOVENT) {
            if (temperature) action.value = temperature;
            drivers.run(action);
          } else {
            set(id, { setpoint });
          }
        } else if (humidity) {
          let setpoint = humidity;
          if (setpoint < 10) setpoint = 10;
          if (setpoint > 90) setpoint = 90;
          if (dev.type === SITE) {
            const { hygrostat = [] } = dev;
            for (const t of hygrostat) {
              set(t, { setpoint });
            }
          } else {
            set(id, { setpoint });
          }
        } else if (co2) {
          let setpoint = co2;
          if (setpoint < 200) setpoint = 200;
          if (setpoint > 1200) setpoint = 1200;
          if (dev.type === SITE) {
            const { co2_stat = [] } = dev;
            for (const t of co2_stat) {
              set(t, { setpoint });
            }
          } else {
            set(id, { setpoint });
          }
        }
        break;
      }
      case ACTION_SETPOINT_MIN_MAX: {
        const { id, min, max } = action;
        const dev = get(id) || {};
        set(id, { min, max });
        break;
      }
      case ACTION_INC_SETPOINT: {
        const { thermostat, display } = action;
        if (thermostat) {
          let { setpoint = 4 } = get(thermostat) || {};
          setpoint++;
          if (setpoint > 35) setpoint = 35;
          run({ type: ACTION_SETPOINT, id: thermostat, value: setpoint });
          if (display) {
            set(display, { lock: true });
            run({ type: ACTION_IMAGE, id: display, value: setpoint });
            setTimeout(set, 5000, display, { lock: false });
          }
        }
        break;
      }
      case ACTION_DEC_SETPOINT: {
        const { thermostat, display } = action;
        if (thermostat) {
          let { setpoint = 34 } = get(thermostat) || {};
          setpoint--;
          if (setpoint < 5) setpoint = 5;
          run({ type: ACTION_SETPOINT, id: thermostat, value: setpoint });
          if (display) {
            set(display, { lock: true });
            run({ type: ACTION_IMAGE, id: display, value: setpoint });
            setTimeout(set, 5000, display, { lock: false });
          }
        }
        break;
      }
      case ACTION_INTENSITY: {
        const { id, cool, heat, ventilation } = action;
        const dev = get(id) || {};
        if (cool >= 0) {
          if (dev.type === SITE) {
            const { thermostat = [] } = dev
            for (const id of thermostat) {
              run({ type: ACTION_INTENSITY, id, cool });
            }
          } else {
            const { onCoolIntensity = [] } = get(id) || {};
            if (onCoolIntensity.length > 0) {
              const cool_intensity = Math.min(onCoolIntensity.length - 1, cool);
              set(id, { cool_intensity });
              const dev = get(id) || {};
              if (dev.cool && dev.state === COOL && onCoolIntensity[cool_intensity]) {
                run({ type: ACTION_SCRIPT_RUN, id: onCoolIntensity[cool_intensity] });
              }
            } else {
              set(id, { cool_intensity: 0 });
            }
          }
        } else if (heat >= 0) {
          if (dev.type === SITE) {
            const { thermostat = [] } = dev
            for (const id of thermostat) {
              run({ type: ACTION_INTENSITY, id, heat });
            }
          } else {
            const { onHeatIntensity = [] } = get(id) || {};
            if (onHeatIntensity.length > 0) {
              const heat_intensity = Math.min(onHeatIntensity.length - 1, heat);
              set(id, { heat_intensity });
              const dev = get(id) || {};
              if (dev.heat && dev.state === HEAT && onHeatIntensity[heat_intensity]) {
                run({ type: ACTION_SCRIPT_RUN, id: onHeatIntensity[heat_intensity] });
              }
            } else {
              set(id, { heat_intensity: 0 });
            }
          }
        } else if (ventilation >= 0) {
          if (dev.type === SITE) {
            const { co2_stat = [] } = dev
            for (const id of co2_stat) {
              run({ type: ACTION_INTENSITY, id, ventilation });
            }
          } else {
            const { onVentilationIntensity = [] } = get(id) || {};
            if (onVentilationIntensity.length > 0) {
              const ventilation_intensity = Math.min(onVentilationIntensity.length - 1, ventilation);
              set(id, { ventilation_intensity });
              const dev = get(id) || {};
              if (dev.ventilation && dev.state === VENTILATION && onVentilationIntensity[ventilation_intensity]) {
                run({ type: ACTION_SCRIPT_RUN, id: onVentilationIntensity[ventilation_intensity] });
              }
            } else {
              set(id, { ventilation_intensity: 0 });
            }
          }
        }
        break;
      }
      case ACTION_TIMER_START: {
        const { id, script, time } = action;
        clearTimeout(timers[id]);
        timers[id] = setTimeout(() => {
          set(id, { time: 0, state: false });
          run({ type: ACTION_SCRIPT_RUN, id: script });
        }, parseInt(time));
        set(id, { time, script, state: true, timestamp: Date.now() });
        break;
      }
      case ACTION_TIMER_STOP: {
        const { id } = action;
        clearTimeout(timers[id]);
        set(id, { time: 0, state: false });
        break;
      }
      case ACTION_SCHEDULE_START: {
        const { id, script, schedule } = action;
        if (schedules[id]) {
          schedules[id].stop();
          delete schedules[id];
        }
        if (schedule && script) {
          schedules[id] = new CronJob(
            schedule,
            () => {
              run({ type: ACTION_SCRIPT_RUN, id: script });
            },
            () => {
              set(id, { state: false });
            },
            true
          );
          set(id, { state: true, script, schedule });
        } else {
          set(id, { state: false });
        }
        break;
      }
      case ACTION_SCHEDULE_STOP: {
        const { id } = action;
        if (schedules[id]) {
          schedules[id].stop();
          delete schedules[id];
        }
        set(id, { state: false });
        break;
      }
      case ACTION_CLOCK_START: {
        const { id } = action;
        const { state } = get(id);
        if (!state) {
          set(id, { timestamp: Date.now(), state: true });
        }
        break;
      }
      case ACTION_CLOCK_STOP: {
        const { id } = action;
        const { state } = get(id);
        if (state) {
          set(id, { timestamp: Date.now(), state: false });
        }
        break;
      }
      case ACTION_CLOCK_TEST: {
        const { id, time, onTrue, onFalse, operator } = action;
        const { timestamp, state } = get(id);
        const t = Date.now() - timestamp;
        let script;
        if (state) {
          switch (operator) {
            case OPERATOR_LT: {
              script = t < time ? onTrue : onFalse;
              break;
            }
            case OPERATOR_LE: {
              script = t <= time ? onTrue : onFalse;
              break;
            }
            case OPERATOR_EQ: {
              script = t === time ? onTrue : onFalse;
              break;
            }
            case OPERATOR_NE: {
              script = t !== time ? onTrue : onFalse;
              break;
            }
            case OPERATOR_GE: {
              script = t >= time ? onTrue : onFalse;
              break;
            }
            case OPERATOR_GT: {
              script = t > time ? onTrue : onFalse;
              break;
            }
          }
          if (script) {
            run({ type: ACTION_SCRIPT_RUN, id: script });
          }
        }
        break;
      }
      case ACTION_DAY_TEST: {
        const { project } = get(mac());
        if (project) {
          const { weather } = get(project);
          if (weather && weather.sys) {
            const { sunrise, sunset } = weather.sys;
            const { onFalse, onTrue } = action;
            const now = Date.now();
            const script = now > sunrise && now < sunset ? onTrue : onFalse;
            if (script) {
              run({ type: ACTION_SCRIPT_RUN, id: script });
            }
          }
        }
        break;
      }
      case ACTION_NIGHT_TEST: {
        const { project } = get(mac());
        if (project) {
          const { weather } = get(project);
          if (weather && weather.sys) {
            const { sunrise, sunset } = weather.sys;
            const { onFalse, onTrue } = action;
            const now = Date.now();
            const script = now < sunrise || now > sunset ? onTrue : onFalse;
            if (script) {
              run({ type: ACTION_SCRIPT_RUN, id: script });
            }
          }
        }
        break;
      }
      case ACTION_DOPPLER_HANDLE: {
        const { id, low, high, onQuiet, onLowThreshold, onHighThreshold, index = 0 } =
          action;
        const { active } = get(action.action) || {};
        const { value } = get(id) || {};
        const process = (value) => {
          if (value >= high) {
            set(action.action, { active: true });
            if (onHighThreshold) {
              run({ type: ACTION_SCRIPT_RUN, id: onHighThreshold });
            }
            if (onLowThreshold) {
              run({ type: ACTION_SCRIPT_RUN, id: onLowThreshold });
            }
          } else if (value >= low) {
            set(action.action, { active: true });
            if (onLowThreshold) {
              run({ type: ACTION_SCRIPT_RUN, id: onLowThreshold });
            }
          } else if (active) {
            set(action.action, { active: false });
            if (onQuiet) {
              run({ type: ACTION_SCRIPT_RUN, id: onQuiet });
            }
          }
        }
        if (Array.isArray(value)) {
          if (index > 0 && index <= value.length) {
            process(value[index - 1]);
          }
        } else {
          process(value);
        }
        break;
      }
      case ACTION_THERMOSTAT_HANDLE: {
        const {
          id,
          cool = true,
          heat = true,
          cool_hysteresis,
          cool_threshold,
          cool_intensity,
          heat_hysteresis,
          heat_threshold,
          heat_intensity,
          onStartHeat,
          onStartCool,
          onStopHeat,
          onStopCool,
          onCoolIntensity,
          onHeatIntensity,
        } = action;
        const { setpoint, mode, site } = get(id) || {};
        const { temperature } = get(site) || {};
        const make = (state, script, mode, enabled, intensity, onIntensity = []) => () => {
          set(id, { state, mode });
          if (!enabled) return;
          if (script) {
            run({ type: ACTION_SCRIPT_RUN, id: script });
          }
          if (intensity >= 0 && onIntensity[intensity]) {
            run({ type: ACTION_SCRIPT_RUN, id: onIntensity[intensity] });
          }
        };
        const stopCool = make(STOP, onStopCool, mode, cool);
        const stopHeat = make(STOP, onStopHeat, mode, heat);
        const startCool = make(COOL, onStartCool, COOL, cool, cool_intensity, onCoolIntensity);
        const startHeat = make(HEAT, onStartHeat, HEAT, heat, heat_intensity, onHeatIntensity);
        switch (mode) {
          case HEAT: {
            // stopCool();
            if (temperature > setpoint - (- heat_threshold)) {
              stopHeat();
              startCool();
            } else if (temperature > setpoint - (- heat_hysteresis)) {
              // stopCool();
              stopHeat();
            } else if (temperature < setpoint - heat_hysteresis) {
              // stopCool();
              startHeat();
            }
            break;
          }
          case COOL: {
            // stopHeat();
            if (temperature < setpoint - cool_threshold) {
              stopCool();
              startHeat();
            } else if (temperature < setpoint - cool_hysteresis) {
              // stopHeat();
              stopCool();
            } else if (temperature > setpoint - (- cool_hysteresis)) {
              // stopHeat();
              startCool();
            }
            break;
          }
          default: {
            if (temperature > setpoint) {
              stopHeat();
              startCool();
            } else if (temperature < setpoint) {
              stopCool();
              startHeat();
            } else {
              stopCool();
              stopHeat();
            }
          }
        }
        break;
      }
      case ACTION_HYGROSTAT_HANDLE: {
        const {
          id,
          dry = true,
          wet = true,
          dry_hysteresis,
          dry_threshold,
          wet_hysteresis,
          wet_threshold,
          onStartDry,
          onStartWet,
          onStopDry,
          onStopWet,
        } = action;
        const { setpoint, mode, site } = get(id) || {};
        const { humidity } = get(site) || {};
        const make = (state, script, mode, enabled) => () => {
          set(id, { state, mode });
          if (!enabled) return;
          if (script) {
            run({ type: ACTION_SCRIPT_RUN, id: script });
          }
        };
        const stopDry = make(STOP, onStopDry, DRY, dry);
        const stopWet = make(STOP, onStopWet, WET, wet);
        const startDry = make(DRY, onStartDry, DRY, dry);
        const startWet = make(WET, onStartWet, WET, wet);
        switch (mode) {
          case WET: {
            if (humidity > setpoint - (- wet_threshold)) {
              stopWet();
              startDry();
            } else if (humidity > setpoint - (- wet_hysteresis)) {
              stopWet();
            } else if (humidity < setpoint - wet_hysteresis) {
              startWet();
            }
            break;
          }
          case DRY: {
            if (humidity < setpoint - dry_threshold) {
              stopDry();
              startWet();
            } else if (humidity < setpoint - dry_hysteresis) {
              stopDry();
            } else if (humidity > setpoint - (- dry_hysteresis)) {
              startDry();
            }
            break;
          }
          default: {
            if (humidity > setpoint) {
              stopWet();
              startDry();
            } else if (humidity < setpoint) {
              stopDry();
              startWet();
            } else {
              stopDry();
              stopWet();
            }
          }
        }
        break;
      }
      case ACTION_CO2_STAT_HANDLE: {
        const {
          id,
          ventilation = true,
          hysteresis,
          ventilation_intensity,
          onStartVentilation,
          onStopVentilation,
          onVentilationIntensity,
        } = action;
        const { setpoint, site } = get(id) || {};
        const { co2 } = get(site) || {};
        const make = (state, script, intensity, onIntensity = []) => () => {
          set(id, { state });
          if (!ventilation) return;
          if (script) {
            run({ type: ACTION_SCRIPT_RUN, id: script });
          }
          if (intensity >= 0 && onIntensity[intensity]) {
            run({ type: ACTION_SCRIPT_RUN, id: onIntensity[intensity] });
          }
        };
        const stopVentilation = make(STOP, onStopVentilation);
        const startVentilation = make(VENTILATION, onStartVentilation, ventilation_intensity, onVentilationIntensity);
        if (co2 > setpoint - (- hysteresis)) {
          startVentilation();
        } else if (co2 < setpoint - hysteresis) {
          stopVentilation();
        }
        break;
      }
      case ACTION_LIMIT_HEATING_HANDLE: {
        const { id, hysteresis, onStartHeat, onStopHeat } = action;
        const { min, max, sensor } = get(id) || {};
        if (!sensor) return;
        const { temperature } = get(sensor) || {};
        if (!temperature) return;
        const make = (script) => () => {
          if (script) {
            run({ type: ACTION_SCRIPT_RUN, id: script });
          }
        };
        const stopHeat = make(onStopHeat);
        const startHeat = make(onStartHeat);
        set(id, { disabled: false });
        if (temperature > max - (-hysteresis)) {
          stopHeat();
          set(id, { disabled: true });
        } else if (temperature < min - hysteresis) {
          startHeat();
          set(id, { disabled: true });
        }
        break;
      }
      case ACTION_TOGGLE: {
        const { test = [], onOn, onOff } = action;
        const f = test.find((i) => {
          const o = get(i);
          // if (true || o.value === undefined || o.value === null) {
          const b = bind.find((j) => {
            if (o[j]) {
              const { value = false } = get(o[j]) || {}
              return o.inverse ? !value : value
            }
          });
          return b !== undefined ? b : o.inverse ? !o.value : o.value;
          // }
        });
        if (f) {
          if (onOff) {
            run({ type: ACTION_SCRIPT_RUN, id: onOff });
          }
        } else {
          if (onOn) {
            run({ type: ACTION_SCRIPT_RUN, id: onOn });
          }
        }
        break;
      }
      case ACTION_IR_CONFIG: {
        const { id, dev, index, brand, model } = action;
        const bind = `${dev}/${IR}/${index}`;
        set(id, { brand, model });
        makeBind(id, "bind", bind);
        const { type: dev_type, version, ip } = get(dev) || {};
        const { type } = get(id);
        const {
          frequency,
          count = [],
          header = [],
          trail,
        } = ((ircodes.codes[type] || {})[brand] || {})[model] || {};
        const [major] = version.split(".");
        if (dev_type === DEVICE_TYPE_IR_4 && parseInt(major) === 2) {
          const buffer = Buffer.alloc(14);
          buffer.writeUInt8(ACTION_IR_CONFIG, 0);
          buffer.writeUInt8(index, 1);
          buffer.writeUInt16LE(frequency, 2);
          buffer.writeUInt16LE(count[0], 4);
          buffer.writeUInt16LE(count[1], 6);
          buffer.writeUInt16LE(header[0], 8);
          buffer.writeUInt16LE(header[1], 10);
          buffer.writeUInt16LE(trail, 12);
          device.sendRBUS(buffer, action.id);
        } else if (
          (dev_type === DEVICE_TYPE_IR_4 && parseInt(major) >= 3) ||
          dev_type === DEVICE_TYPE_SMART_4A ||
          dev_type === DEVICE_TYPE_SMART_4AM ||
          dev_type === DEVICE_TYPE_SMART_4G ||
          dev_type === DEVICE_TYPE_SMART_4GD ||
          dev_type === DEVICE_TYPE_SMART_6_PUSH
        ) {
          const buffer = Buffer.alloc(16);
          buffer.writeUInt8(ACTION_IR_CONFIG, 0);
          buffer.writeUInt8(index, 1);
          buffer.writeUInt16LE(frequency, 2);
          buffer.writeUInt16LE(count[0], 4);
          buffer.writeUInt16LE(count[1], 6);
          buffer.writeUInt16LE(count[2], 8);
          buffer.writeUInt16LE(header[0], 10);
          buffer.writeUInt16LE(header[1], 12);
          buffer.writeUInt16LE(trail, 14);
          device.sendRBUS(buffer, action.id);
        } else if (dev_type === DEVICE_TYPE_LANAMP) {
          const buffer = Buffer.alloc(16);
          buffer.writeUInt8(ACTION_IR_CONFIG, 0);
          buffer.writeUInt8(index, 1);
          buffer.writeUInt16LE(frequency, 2);
          buffer.writeUInt16LE(count[0], 4);
          buffer.writeUInt16LE(count[1], 6);
          buffer.writeUInt16LE(count[2], 8);
          buffer.writeUInt16LE(header[0], 10);
          buffer.writeUInt16LE(header[1], 12);
          buffer.writeUInt16LE(trail, 14);
          device.send(buffer, ip);
        }
        break;
      }
      case ACTION_SCREEN:
      case ACTION_TV: {
        const { id, command } = action;
        const { bind, brand, model } = get(id) || {};
        const [dev, , index] = bind.split("/");
        const { ip, type, version = "" } = get(dev);
        const kind = action.type === ACTION_SCREEN ? ircodes.codes.screen : ircodes.codes.TV;
        const codes = kind[brand][model];
        const code = codes.command[command];
        const legacy = (code) => {
          const data = ircodes.encode(
            codes.count,
            codes.header,
            codes.trail,
            code
          );
          const buff = Buffer.alloc(data.length * 2 + 5);
          buff.writeUInt8(ACTION_IR, 0);
          buff.writeUInt8(index, 1);
          buff.writeUInt8(0, 2);
          buff.writeUInt16BE(codes.frequency, 3);
          for (let i = 0; i < data.length; i++) {
            buff.writeUInt16BE(data[i], i * 2 + 5);
          }
          return buff;
        };
        for (const c of code) {
          setTimeout(() => {
            switch (type) {
              case DEVICE_TYPE_IR_4:
              case DEVICE_TYPE_SMART_4A:
              case DEVICE_TYPE_SMART_4AM:
              case DEVICE_TYPE_SMART_4G:
              case DEVICE_TYPE_SMART_4GD:
              case DEVICE_TYPE_SMART_6_PUSH: {
                const [major] = version.split(".");
                device.sendRBUS(
                  major < 2 ? legacy(c) : Buffer.from([ACTION_IR, index, ...c]),
                  dev
                );
                break;
              }
              case DEVICE_TYPE_LANAMP: {
                device.send(Buffer.from([ACTION_IR, index, ...c]), ip);
                break;
              }
              default:
                device.send(legacy(c), ip);
            }
          }, 100);
        }
        break;
      }
      case ACTION_LEAKAGE_RESET: {
        const { onLeakageReset } = get(action.id);
        set(action.id, { value: 0 });
        if (onLeakageReset) {
          run({ action: ACTION_SCRIPT_RUN, id: onLeakageReset });
        }
        break;
      }
      case NOTIFY: {
        notification.broadcastNotification(action);
        break;
      }
      case RING: {
        notification.broadcastAction(action);
        childProcess.exec("./ring.sh");
        break;
      }
      case CLOSURE: {
        const { id, index, value } = action;
        const { protocol } = get(id) || {};
        let type;
        switch (value) {
          case OPEN:
            type = ACTION_OPEN;
            break;
          case CLOSE:
            type = ACTION_CLOSE;
            break;
          case STOP:
            type = ACTION_STOP;
            break;
        }
        if (type) {
          run({ type: ACTION_DO, id, index, value: type });
        }
        break;
      }
      case ACTION_TEMPERATURE_CORRECT: {
        const buffer = Buffer.alloc(2);
        buffer.writeUInt8(ACTION_TEMPERATURE_CORRECT, 0);
        buffer.writeInt8(action.value * 10, 1);
        device.sendRBUS(buffer, action.id);
        break;
      }
      case ACTION_VIBRO: {
        const { type } = get(action.id) || {};
        const buffer = Buffer.alloc(2);
        buffer.writeUInt8(ACTION_VIBRO, 0);
        buffer.writeUInt8(action.value, 1);
        switch (type) {
          case DEVICE_TYPE_SMART_TOP_G4D:
          case DEVICE_TYPE_SMART_TOP_A4T:
          case DEVICE_TYPE_SMART_TOP_A6T:
          case DEVICE_TYPE_SMART_TOP_G6:
          case DEVICE_TYPE_SMART_TOP_G4:
          case DEVICE_TYPE_SMART_TOP_G2:
          case DEVICE_TYPE_SMART_TOP_A4TD:
          case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
            device.sendTOP(buffer, action.id);
            break;
          }
          default: {
            device.sendRBUS(buffer, action.id);
          }
        }
        break;
      }
      case ACTION_SET_POSITION: {
        const [id, type, index] = action.id ? action.id.split("/") : [];
        if (type === 'curtain') {
          drivers.run({
            type: ACTION_SET_POSITION,
            id,
            index,
            position: action.value
          })
        } else {
          drivers.run(action);
        }
        break;
      }
      case ACTION_SET_ADDRESS:
      case ACTION_DELETE_ADDRESS:
      case ACTION_UP:
      case ACTION_DOWN:
      case ACTION_LIMIT_UP:
      case ACTION_LIMIT_DOWN:
      case ACTION_LEARN:
      case ACTION_SET_MODE:
      case ACTION_SET_DIRECTION:
      case ACTION_SET_FAN_SPEED: {
        const [id_, t_, index] = action.id ? action.id.split("/") : [];
        if (t_ === 'ac') {
          action.id = id_;
          action.index = index;
        }
        drivers.run(action);
        break;
      }
      case ACTION_LANAMP: {
        const { id, index, mode = 0, volume = [] } = action;
        const { ip } = get(id);
        let source = [[], []];
        switch (mode) {
          case 0b01:
          case 0b10: {
            const zone = get(`${id}/stereo/${index}`) || {};
            source[0] = zone.source || [];
            break;
          }
          case 0b11: {
            const zone0 = get(`${id}/mono/${2 * index - 1}`) || {};
            source[0] = zone0.source || [];
            const zone1 = get(`${id}/mono/${2 * index}`) || {};
            source[1] = zone1.source || [];
            break;
          }
        }
        const buffer = Buffer.alloc(41);
        buffer.writeUInt8(ACTION_LANAMP, 0);
        buffer.writeUInt8(index, 1);
        buffer.writeUInt8(mode, 2);
        for (let i = 0; i < 2; i++) {
          buffer.writeUInt8(volume[i] || 0, i + 3);
          for (let j = 0; j < 9; j++) {
            const { active, volume } = source[i][j] || {};
            buffer.writeUInt8(active || 0, i * 9 + j + 5);
            buffer.writeUInt8(volume || 0, i * 9 + j + 5 + 9 * 2);
          }
        }
        device.send(buffer, ip);
        break;
      }
      case ACTION_RTP: {
        const { id, index, group, port, active } = action;
        const { ip } = get(id) || {};
        const buffer = Buffer.alloc(9);
        buffer.writeUInt8(ACTION_RTP, 0);
        buffer.writeUInt8(index, 1);
        buffer.writeUInt8(active, 2);
        buffer.writeUInt32BE(ip2int(String(group)), 3);
        buffer.writeUInt16BE(port, 7);
        device.send(buffer, ip);
        break;
      }
      case ACTION_MULTIROOM_ZONE: {
        const { id, source } = action;
        const [dev, type, index] = id.split("/");
        set(id, { source });
        switch (type) {
          case "stereo": {
            const { mode, volume } = get(`${dev}/lanamp/${index}`) || {};
            if (mode === 0b01 || mode === 0b10) {
              run({ type: ACTION_LANAMP, id: dev, index, mode, volume });
            }
            break;
          }
          case "mono": {
            const i = index > 2 ? 2 : 1;
            const { mode, volume } = get(`${dev}/lanamp/${i}`);
            if (mode === 0b11) {
              run({ type: ACTION_LANAMP, id: dev, index: i, mode, volume });
            }
            break;
          }
        }
        break;
      }
      case ACTION_SHELL_START: {
        const { id, command } = action;
        const { pid } = get(id) || {};
        if (pid) {
          try {
            process.kill(-pid);
          } catch (e) {
            set(id, { pid: null, value: false });
          }
        }
        const child = childProcess.spawn(command, { detached: true, shell: true });
        // child.stdout.on("data", (data) => {
        //   const { pid } = get(id) || {};
        //   if (pid === child.pid) {
        //     set(id, { stdout: data.toString() });
        //   }
        // });
        // child.stderr.on("data", (data) => {
        //   const { pid } = get(id) || {};
        //   if (pid === child.pid) {
        //     set(id, { stderr: data.toString() });
        //   }
        // })
        child.on("error", (e) => {
          set(id, { error: e.message });
        });
        child.on("close", () => {
          const { pid } = get(id) || {};
          if (pid === child.pid) {
            set(id, { value: false, pid: null })
          }
        });
        child.on("spawn", () => {
          set(id, { command, value: true, error: "", stdout: "", stderr: "", pid: child.pid });
        });
        break;
      }
      case ACTION_SHELL_STOP: {
        const { id } = action;
        const { pid } = get(id) || {};
        if (pid) {
          try {
            process.kill(-pid);
          } catch (e) {
            set(id, { pid: null, value: false });
          }
        }
        break;
      }
      case ACTION_SET: {
        const { id, payload = {} } = action;
        if (id !== POOL) {
          set(id, payload);
        }
        break;
      }
      case ACTION_SCRIPT_RUN: {
        const { id } = action;
        const script = get(id);
        if (script && Array.isArray(script.action)) {
          if (script.disabled) return;
          for (const i of script.action) {
            const { type, payload, delay } = get(i);
            const a = { action: i, type, ...payload };
            if (delay > 0) {
              setTimeout(run, delay, a);
            } else {
              run(a);
            }
          }
        }
        break;
      }
      case ACTION_ALED_ON:
      case ACTION_ALED_OFF: {
        const dev = get(action.id) || {};
        const buff = Buffer.from([
          action.type,
          action.index
        ]);
        switch (dev.type) {
          case DEVICE_TYPE_DI_4_LA:
          case DEVICE_TYPE_DOPPLER_1_DI_4:
          case DEVICE_TYPE_DOPPLER_5_DI_4:
          case DEVICE_TYPE_SMART_BOTTOM_1:
          case DEVICE_TYPE_SMART_BOTTOM_2: {
            device.sendRBUS(buff, action.id);
            break;
          }
          case DEVICE_TYPE_RS_HUB4:
          case DEVICE_TYPE_SERVER: {
            device.send(buff, dev.ip);
            break;
          }
        }
        break;
      }
      case ACTION_ALED_BRIGHTNESS: {
        const dev = get(action.id) || {};
        const buff = Buffer.from([
          action.type,
          action.index,
          action.value
        ]);
        switch (dev.type) {
          case DEVICE_TYPE_DI_4_LA:
          case DEVICE_TYPE_DOPPLER_1_DI_4:
          case DEVICE_TYPE_DOPPLER_5_DI_4:
          case DEVICE_TYPE_SMART_BOTTOM_1:
          case DEVICE_TYPE_SMART_BOTTOM_2: {
            device.sendRBUS(buff, action.id);
            break;
          }
          case DEVICE_TYPE_RS_HUB4:
          case DEVICE_TYPE_SERVER: {
            device.send(buff, dev.ip);
            break;
          }
        }
        break;
      }
      case 'ACTION_ALED_COLOR_ANIMATION_PLAY':
      case 'ACTION_ALED_MASK_ANIMATION_PLAY': {
        const { bind } = get(action.id) || {};
        if (bind) {
          const [id, , index] = bind.split('/');
          const dev = get(id) || {};
          const buff = Buffer.from([
            action.type === 'ACTION_ALED_COLOR_ANIMATION_PLAY'
              ? ACTION_ALED_COLOR_ANIMATION_PLAY
              : ACTION_ALED_MASK_ANIMATION_PLAY,
            parseInt(index, 10),
            action.animation,
            action.duration,
            action.phase,
            action.split,
            action.loop,
            action.inverseDirection,
            ...action.params || []
          ]);
          switch (dev.type) {
            case DEVICE_TYPE_DI_4_LA:
            case DEVICE_TYPE_DOPPLER_1_DI_4:
            case DEVICE_TYPE_DOPPLER_5_DI_4:
            case DEVICE_TYPE_SMART_BOTTOM_1:
            case DEVICE_TYPE_SMART_BOTTOM_2: {
              device.sendRBUS(buff, id);
              break;
            }
            case DEVICE_TYPE_RS_HUB4:
            case DEVICE_TYPE_SERVER: {
              device.send(buff, dev.ip);
              break;
            }
          }
        }
        break;
      }
      case 'ACTION_ALED_COLOR_ANIMATION_STOP':
      case 'ACTION_ALED_MASK_ANIMATION_STOP': {
        const { bind } = get(action.id) || {};
        if (bind) {
          const [id, , index] = bind.split('/');
          const dev = get(id) || {};
          const buff = Buffer.from([
            action.type === 'ACTION_ALED_COLOR_ANIMATION_STOP'
              ? ACTION_ALED_COLOR_ANIMATION_STOP
              : ACTION_ALED_MASK_ANIMATION_STOP,
            parseInt(index, 10),
          ]);
          switch (dev.type) {
            case DEVICE_TYPE_DI_4_LA:
            case DEVICE_TYPE_DOPPLER_1_DI_4:
            case DEVICE_TYPE_DOPPLER_5_DI_4:
            case DEVICE_TYPE_SMART_BOTTOM_1:
            case DEVICE_TYPE_SMART_BOTTOM_2: {
              device.sendRBUS(buff, id);
              break;
            }
            case DEVICE_TYPE_RS_HUB4:
            case DEVICE_TYPE_SERVER: {
              device.send(buff, dev.ip);
              break;
            }
          }
        }
        break;
      }
      case 'ACTION_ALED_CLIP': {
        const { bind } = get(action.id) || {};
        if (bind) {
          const [id, , index] = bind.split('/');
          const dev = get(id) || {};
          const buff = Buffer.from([
            ACTION_ALED_CLIP,
            parseInt(index, 10),
            action.start,
            action.end,
            action.inverse
          ]);
          switch (dev.type) {
            case DEVICE_TYPE_DI_4_LA:
            case DEVICE_TYPE_DOPPLER_1_DI_4:
            case DEVICE_TYPE_DOPPLER_5_DI_4:
            case DEVICE_TYPE_SMART_BOTTOM_1:
            case DEVICE_TYPE_SMART_BOTTOM_2: {
              device.sendRBUS(buff, id);
              break;
            }
            case DEVICE_TYPE_RS_HUB4:
            case DEVICE_TYPE_SERVER: {
              device.send(buff, dev.ip);
              break;
            }
          }
        }
        break;
      }
      case ACTION_ALED_CONFIG_GROUP: {
        const dev = get(action.id) || {};
        let { segments, colors } = get(`${action.id}/LA/${action.index}`) || {};
        segments = action.segments || (Array.isArray(segments) ? segments : []);
        colors = action.colors || colors || 0;
        const cmd = [
          action.type,
          action.index,
          colors,
          segments.length
        ];
        for (const { direction, size } of segments) {
          cmd.push(direction);
          cmd.push(size);
        }
        const buff = Buffer.from(cmd);
        switch (dev.type) {
          case DEVICE_TYPE_DI_4_LA:
          case DEVICE_TYPE_DOPPLER_1_DI_4:
          case DEVICE_TYPE_DOPPLER_5_DI_4:
          case DEVICE_TYPE_SMART_BOTTOM_1:
          case DEVICE_TYPE_SMART_BOTTOM_2: {
            device.sendRBUS(buff, action.id);
            break;
          }
          case DEVICE_TYPE_RS_HUB4:
          case DEVICE_TYPE_SERVER: {
            device.send(buff, dev.ip);
            break;
          }
        }
        break;
      }
      case ACTION_CORRECT: {
        const { id, temperature_correct, humidity_correct, illumination_correct, co2_correct } = action;
        const dev = get(id) || {};
        const { temperature = 0, humidity = 0, illumination = 0, co2 = 0 } = dev;
        const { temperature_raw = temperature, humidity_raw = humidity, illumination_raw = illumination, co2_raw = co2 } = dev;
        if (temperature_correct !== undefined) {
          const t = temperature_raw + temperature_correct;
          set(id, { temperature_correct, temperature: t });
          if (dev.humidity_absolute >= 0) {
            const humidity = toRelativeHumidity(dev.humidity_absolute, toKelvin(t)) + (dev.humidity_correct || 0);
            set(id, { humidity });
          }
        }
        if (humidity_correct !== undefined) {
          set(id, { humidity_correct, humidity: humidity_raw + humidity_correct });
        }
        if (illumination_correct !== undefined) {
          set(id, { illumination_correct, illumination: illumination_raw + illumination_correct });
        }
        if (co2_correct !== undefined) {
          set(id, { co2_correct, co2: co2_raw + co2_correct });
        }
      }
      case ACTION_ERROR: {
        const dev = get(action.id);
        switch (dev.type) {
          case DEVICE_TYPE_MIX_6x12_RS: {
            device.sendRBUS(Buffer.from([
              ACTION_ERROR,
            ]),
              action.id
            );
            break;
          }
        }
        break;
      }
    }
  } catch (e) {
    console.error(action);
    console.error(e);
  }
};

const compose = (ac = {}, am = 1, bc = {}, bm = 1) => {
  const s = am + bm;
  const blend = (a = 0, b = 0) => Math.floor((a * am + b * bm) / s);
  return ({
    r: blend(ac.r, bc.r),
    g: blend(ac.g, bc.g),
    b: blend(ac.b, bc.b),
  });
};

module.exports.run = run;
