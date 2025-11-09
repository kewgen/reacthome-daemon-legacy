const crypto = require("crypto");
const {
  DO,
  DI,
  DIM,
  GROUP,
  RS485,
  POOL,
  DEVICE,
  DEVICE_TYPE_PLC,
  ACTION_DI,
  ACTION_DO,
  ACTION_GROUP,
  ACTION_IR,
  ACTION_RS485_MODE,
  ACTION_RS485_TRANSMIT,
  ACTION_TEMPERATURE,
  ACTION_TEMPERATURE_CORRECT,
  ACTION_HUMIDITY,
  ACTION_ILLUMINATION,
  ACTION_DIMMER,
  ACTION_DOPPLER0,
  ACTION_DOPPLER_RAW,
  ACTION_SCRIPT_RUN,
  ACTION_IP_ADDRESS,
  ACTION_MAC_ADDRESS,
  ACTION_DISCOVERY,
  ACTION_READY,
  ACTION_INITIALIZE,
  ACTION_INITIALIZED,
  ACTION_ERROR,
  ACTION_FIND_ME,
  ACTION_BOOTLOAD,
  DIM_TYPE_FALLING_EDGE,
  DIM_TYPE_RISING_EDGE,
  DIM_TYPE_PWM,
  DEVICE_GROUP,
  DEVICE_TYPE_TEMPERATURE_EXT,
  IP_ADDRESS_POOL_START,
  IP_ADDRESS_POOL_END,
  SUB_NET_MASK,
  onOff,
  onOn,
  onHold,
  onClick,
  CLOSE_OPEN,
  ACTION_DI_RELAY_SYNC,
  ACTION_IR_CONFIG,
  ACTION_LANAMP,
  AO,
  DEVICE_TYPE_AO_4_DIN,
  ACTION_RTP,
  ACTION_RGB,
  ACTION_IMAGE,
  ACTION_VIBRO,
  DEVICE_TYPE_DIM4,
  DEVICE_TYPE_DIM8,
  ACTION_CO2,
  ACTION_ATS_MODE,
  ACTION_TEMPERATURE_EXT_DEPRECATED,
  ACTION_TEMPERATURE_EXT_OLD,
  ACTION_TEMPERATURE_EXT,
  ACTION_RBUS_TRANSMIT,
  TEMPERATURE_EXT,
  ACTION_SMART_TOP,
  ACTION_SMART_TOP_DETECT,
  ACTION_DOPPLER1,
  DEVICE_TYPE_SMART_TOP_A6P,
  DEVICE_TYPE_SMART_TOP_G4D,
  ACTION_BLINK,
  ACTION_THERMOSTAT_HANDLE,
  ACTION_HYGROSTAT_HANDLE,
  ACTION_CO2_STAT_HANDLE,
  ACTION_PRINT,
  ACTION_SETPOINT,
  ACTION_STOP_COOL,
  ACTION_START_COOL,
  ACTION_STOP_HEAT,
  ACTION_START_HEAT,
  ACTION_STOP_WET,
  DEVICE_TYPE_DI_4_RSM,
  ACTION_PALETTE,
  ACTION_STOP_VENTILATION,
  ACTION_START_VENTILATION,
  ACTION_START_WET,
  ACTION_ON,
  ACTION_OFF,
  ACTION_INTENSITY,
  ACTION_ALED_BRIGHTNESS,
  ACTION_ALED_ON,
  ACTION_ALED_OFF,
  ACTION_ALED_CONFIG_GROUP,
  ACTION_ALED_COLOR_ANIMATION_PLAY,
  ACTION_ALED_MASK_ANIMATION_PLAY,
  ACTION_ALED_COLOR_ANIMATION_STOP,
  ACTION_ALED_MASK_ANIMATION_STOP,
  ACTION_ALED_CLIP,
  DEVICE_TYPE_SMART_TOP_A4T,
  DEVICE_TYPE_SMART_TOP_A6T,
  DEVICE_TYPE_SMART_TOP_G6,
  DEVICE_TYPE_SMART_TOP_G4,
  DEVICE_TYPE_SMART_TOP_G2,
  DEVICE_TYPE_SMART_TOP_A4P,
  DEVICE_TYPE_SMART_TOP_A4TD,
  DEVICE_TYPE_LANAMP,
  DEVICE_TYPE_SOUNDBOX,
  DEVICE_TYPE_SMART_TOP_A4TD_7S,
} = require("../constants");
const {
  get,
  set,
  add,
  count_on,
  count_off,
  offline,
  online,
  updateFirmware,
  initialize,
  initialized,
} = require("../actions");
const { device } = require("../sockets");
const { run } = require("./service");
const drivers = require("../drivers");
const mac = require("../mac");
const { int2ip, toAbsoluteHumidity, toKelvin, toRelativeHumidity } = require("../util");
const { image2char } = require("../drivers/display");
const { on } = require("events");

const onDI = [onOff, onOn, onHold, onClick];
const onDO = [onOff, onOn];
const count = [count_off, count_on];

let last_ip = IP_ADDRESS_POOL_START;

const hold = {};
const timestamp = {}

module.exports.manage = () => {
  const devices = (get(mac()) || {}).device || [];
  for (const id of devices) {
    offline(id);
  }

  const handleData = (data, { address }, { hub = null } = {}) => {
    try {
      const dev_mac = Array.from(data.slice(0, 6));
      const id = dev_mac.map((i) => `0${i.toString(16)}`.slice(-2)).join(":");
      const dev = get(id) || {};
      if (dev) {
        online(id, { ip: address, hub, type: dev.type });
      }
      const action = data[6];
      // if (hub && action !== ACTION_DISCOVERY && action !== ACTION_READY) {
      //   console.log('receive', data, address, hub);
      // }
      switch (action) {
        case DEVICE_TYPE_PLC: {
          for (let i = 1; i <= 36; i++) {
            const channel = `${id}/${DI}/${i}`;
            const chan = get(channel);
            const value = data[i + 6];
            if (chan && chan.value !== value) {
              set(channel, { value });
              const script = chan[onDI[value]];
              if (script) {
                run({ type: ACTION_SCRIPT_RUN, id: script });
              }
            }
          }
          for (let i = 1; i <= 24; i++) {
            const channel = `${id}/${DO}/${i}`;
            const chan = get(channel);
            const value = data[i + 42];
            set(channel, { value });
            if (chan) {
              const { bind } = chan;
              if (bind) {
                if (chan.value !== value) {
                  const script = chan[onDO[value]];
                  if (script) {
                    run({ type: ACTION_SCRIPT_RUN, id: script });
                  }
                  count[value](bind);
                }
              }
            }
          }
          break;
        }
        case ACTION_DI: {
          // console.log(data);
          const index = data[7];
          const value = data[8] ? 1 : 0;
          const channel = `${id}/${DI}/${index}`;
          const chan = get(channel) || {};
          if (chan && chan.value !== value) {
            set(channel, { value });
            const { timeout, count = 0 } = hold[channel] || {};
            if (value) {
              if (!count) {
                clearTimeout(timeout);
                hold[channel] = {
                  count: 0,
                  timestamp: Date.now(),
                }
              }
              const { onOnCount = 0 } = chan;
              set(channel, { onOnCount: onOnCount + 1 });
              handleOn(id, index, chan);
              hold[channel].count++;
              setTimeout(() => {
                switch (hold[channel].count) {
                  case 1: {
                    if (!chan.value) {
                      const { onClick1Count = 0 } = chan;
                      set(channel, { onClick1Count: onClick1Count + 1 });
                      handleClick1(id, index, chan);
                    }
                    break;
                  }
                  case 2: {
                    const { onClick2Count = 0 } = chan;
                    set(channel, { onClick2Count: onClick2Count + 1 });
                    handleClick2(id, index, chan);
                    break;
                  }
                  case 3: {
                    const { onClick3Count = 0 } = chan;
                    set(channel, { onClick3Count: onClick3Count + 1 });
                    handleClick3(id, index, chan);
                    break;
                  }
                }
                hold[channel] = { count: 0 };
              }, parseInt(chan.timeout || 1000) / 2);
              const handleHold_ = (start = false) => {
                if (!chan.value) return;
                if (start) {
                  const { onHoldCount = 0 } = chan;
                  set(channel, { onHoldCount: onHoldCount + 1 });
                }
                if (handleHold(id, index, chan)) {
                  hold[channel] = {
                    count: 0,
                    timeout: setTimeout(
                      handleHold_,
                      parseInt(chan.interval || 300)
                    )
                  };
                }
              };
              clearTimeout(hold[channel].timeout);
              hold[channel].timeout = setTimeout(handleHold_, parseInt(chan.timeout || 1000), true);
            } else {
              clearTimeout(timeout);
              const { onOffCount = 0 } = chan;
              set(channel, { onOffCount: onOffCount + 1 });
              handleOff(id, index, chan);
            }
          } else {
            set(channel, { value });
          }

          break;
        }
        case ACTION_DO: {
          const { type } = get(id) || {};
          if (
            type === DEVICE_TYPE_SMART_TOP_A6P ||
            type === DEVICE_TYPE_SMART_TOP_G4D ||
            type === DEVICE_TYPE_SMART_TOP_A4T ||
            type === DEVICE_TYPE_SMART_TOP_A6T ||
            type === DEVICE_TYPE_SMART_TOP_G6 ||
            type === DEVICE_TYPE_SMART_TOP_G4 ||
            type === DEVICE_TYPE_SMART_TOP_G2 ||
            type === DEVICE_TYPE_SMART_TOP_A4P ||
            type === DEVICE_TYPE_SMART_TOP_A4TD ||
            type === DEVICE_TYPE_SMART_TOP_A4TD_7S
          ) {
            set(id, { state: data[7] })
            return;
          }
          const index = data[7];
          const value = data[8];
          const cid = `${id}/${DO}/${index}`;
          const channel = get(cid);
          const gid = `${id}/${GROUP}/${((index - 1) >> 1) + 1}`;
          const group = get(gid);
          set(cid, { value });
          if (data.length === 13) {
            const timeout = data.readUInt32LE(9);
            set(cid, { timeout });
          } else if (data.length === 14) {
            const group = data.readUInt8(9);
            const timeout = data.readUInt32LE(10);
            set(cid, { group, timeout });
          }
          if (group && group.enabled) {
            if (value) {
              if (group === CLOSE_OPEN) {
                set(gid, { value: index % 2 === 1 });
              } else {
                set(gid, { value: index % 2 === 0 });
              }
            }
          } else if (channel) {
            const { bind } = channel;
            if (bind) {
              if (channel.value !== value) {
                const script = channel[onDO[value]];
                if (script) {
                  run({ type: ACTION_SCRIPT_RUN, id: script });
                }
                count[value](bind);
              }
            }
          }
          break;
        }
        case ACTION_GROUP: {
          const index = data[7];
          const enabled = data[8];
          const delay = data.readUInt32LE(9);
          const channel = `${id}/${GROUP}/${index}`;
          set(channel, { enabled, delay });
          break;
        }
        case ACTION_DI_RELAY_SYNC: {
          const index = data[7];
          const value = data.slice(8);
          const onOff = value.slice(0, value.length / 2);
          const onOn = value.slice(value.length / 2);
          const channel = `${id}/${DI}/${index}`;
          set(channel, { sync: [[...onOff], [...onOn]] });
          break;
        }
        case ACTION_ATS_MODE: {
          set(id, {
            mode: data[7],
            source: data[8],
            attempt: data[9],
            error: [data[10], data[11], data[12], data[13]]
          });
          break;
        }
        case ACTION_RS485_MODE: {
          const index = data[7];
          const is_rbus = data[8];
          const baud = data.readUInt32LE(9);
          const line_control = data[13];
          const channel = `${id}/${RS485}/${index}`;
          set(channel, { is_rbus, baud, line_control });
          break;
        }
        case ACTION_RS485_TRANSMIT: {
          const index = data[7];
          const channel = `${id}/${RS485}/${index}`;
          const { bind } = get(channel) || {};
          // console.log(
          //   "RS485",
          //   Array.from(data)
          //     .map((i) => i.toString(16).padStart(2, "0"))
          //     .join(" ")
          // );
          drivers.handle({ id: bind, data: data.slice(8) });
          break;
        }
        case ACTION_RBUS_TRANSMIT: {
          const buff = data.slice(7);
          const mac = buff.slice(0, 6);
          const did = Array.from(mac).map((i) => i.toString(16).padStart(2, '0')).join(':');
          const device = get(id) || {};
          set(did, {
            port: buff[6],
            address: buff[7],
            hub: id,
          });
          handleData(Buffer.concat([mac, buff.slice(8)]), { address }, { hub: id });
          break;

        }
        case ACTION_SMART_TOP: {
          const action = data[7];
          switch (action) {
            case ACTION_DISCOVERY: {
              const top_mac = Array.from(data.slice(8, 14));
              const top_id = top_mac.map((i) => `0${i.toString(16)}`.slice(-2)).join(":");
              const type = data[14];
              set(id, { top: top_id, topDetected: true });
              online(top_id, { type, bottom: id, version: `${data[15]}.${data[16]}`, ip: address, ready: true });
              switch (type) {
                case DEVICE_TYPE_SMART_TOP_G4D:
                case DEVICE_TYPE_SMART_TOP_A4TD:
                case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
                  const ts = timestamp[top_id] || 0;
                  const { timeout = 0, mode, defaultMode } = get(top_id) || {};
                  if (Date.now() - ts > (timeout || 10_000)) {
                    set(top_id, { configuring: 0, mode: defaultMode ? defaultMode - 1 : mode });
                    renderSmartTop(top_id);
                  }
                  break;
                }
              }
              break;
            }
            default: {
              const { top, hub } = get(id) || {};
              if (top) {
                const mac_ = Buffer.from(top.split(':').map(i => parseInt(i, 16)));
                handleData(Buffer.concat([mac_, data.slice(7)]), { address }, { hub });
              }
            }
          }
          break;
        }
        case ACTION_SMART_TOP_DETECT: {
          const topDetected = data[7];
          const { top } = get(id) || {};
          if (!topDetected) {
            offline(top);
          }
          set(id, { topDetected });
          break;
        }
        case ACTION_DIMMER: {
          const device = get(id) || {};
          switch (device.type) {
            case DEVICE_TYPE_DI_4_RSM:
            case DEVICE_TYPE_AO_4_DIN: {
              const [, , , , , , , index, value, velocity] = data;
              const channel = `${id}/${AO}/${index}`;
              const chan = get(channel);
              set(channel, {
                value,
                velocity,
                dimmable: true,
              });
              if (chan) {
                const { bind } = chan;
                if (bind) {
                  const v = value ? 1 : 0;
                  const v_ = chan.value ? 1 : 0;
                  if (v !== v_) {
                    const script = chan[onDO[v]];
                    if (script) {
                      run({ type: ACTION_SCRIPT_RUN, id: script });
                    }
                    count[v](bind);
                  }
                }
              }
              break;
            }
            case DEVICE_TYPE_DIM4:
            case DEVICE_TYPE_DIM8: {
              const [, , , , , , , index, type, value, velocity] = data;
              const channel = `${id}/${DIM}/${index}`;
              const chan = get(channel);
              set(channel, {
                type,
                value,
                velocity,
                dimmable:
                  type === DIM_TYPE_FALLING_EDGE ||
                  type === DIM_TYPE_RISING_EDGE ||
                  type === DIM_TYPE_PWM,
              });
              if (chan) {
                const { bind } = chan;
                if (bind) {
                  const v = value ? 1 : 0;
                  const v_ = chan.value ? 1 : 0;
                  if (v !== v_) {
                    const script = chan[onDO[v]];
                    if (script) {
                      run({ type: ACTION_SCRIPT_RUN, id: script });
                    }
                    count[v](bind);
                  }
                }
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
              set(id, { brightness: data[7] });
              break;
            }
            default: {
              const { version = "" } = get(id) || {};
              const major = parseInt(version.split(".")[0], 10);
              let index, group, type, value, velocity;
              if (major < 2) {
                [, , , , , , , index, type, value, velocity] = data;
                group = index;
              } else {
                [, , , , , , , index, group, type, value, velocity] = data;
              }
              const channel = `${id}/${DIM}/${index}`;
              const chan = get(channel);
              set(channel, {
                type,
                group,
                value,
                velocity,
                dimmable:
                  type === DIM_TYPE_FALLING_EDGE ||
                  type === DIM_TYPE_RISING_EDGE ||
                  type === DIM_TYPE_PWM,
              });
              if (chan) {
                const { bind } = chan;
                if (bind) {
                  const v = value ? 1 : 0;
                  const v_ = chan.value ? 1 : 0;
                  if (v !== v_) {
                    const script = chan[onDO[v]];
                    if (script) {
                      run({ type: ACTION_SCRIPT_RUN, id: script });
                    }
                    count[v](bind);
                  }
                }
              }
            }
          }
          break;
        }
        case ACTION_RGB: {
          const { type } = get(id) || {};
          switch (type) {
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
              let [, , , , , , , palette, index] = data;
              if (index === 0) {
                index = 1;
              }
              for (let i = 0; i < (data.length - 9) / 3; i++) {
                const chan = `${id}/rgb/${palette}.${index + i}`;
                const payload = {
                  r: data[i * 3 + 9],
                  g: data[i * 3 + 10],
                  b: data[i * 3 + 11],
                };
                set(chan, payload);
                if (palette === 1) {
                  set(`${id}/rgb/${index + i}`, payload); /// fucking hack
                }
              }
              break;
            }
            default:
              const [, , , , , , , index] = data;
              for (let i = 0; i < (data.length - 8) / 3; i++) {
                const chan = `${id}/rgb/${index + i}`;
                set(chan, {
                  r: data[i * 3 + 8],
                  g: data[i * 3 + 9],
                  b: data[i * 3 + 10],
                });
              }
          }
          break;
        }
        case ACTION_IMAGE: {
          const { type } = get(id) || {};
          switch (type) {
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
              const image = Array.from(data.slice(7, 15))
              set(id, { image });
              break;
            }
            default:
              const [, , , , , , , level, i2, i1] = data;
              const c2 = image2char[i2] || " ";
              const c1 = image2char[i1] || " ";
              set(id, { level, image: [i2, i1], text: c2 + c1 });
          }
          break;
        }
        case ACTION_BLINK: {
          const { type } = get(id) || {};
          switch (type) {
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
              const blink = Array.from(data.slice(7, 15))
              set(id, { blink });
              break;
            }
          }
          break;
        } case ACTION_TEMPERATURE_CORRECT: {
          const correct = data.readInt8(7) / 10;
          set(id, { correct });
          break;
        }
        case ACTION_VIBRO: {
          const vibro = data.readUInt8(7);
          set(id, { vibro });
          break;
        }
        case ACTION_TEMPERATURE: {
          const temperature_raw = data.readUInt16LE(7) / 100;
          const { onTemperature, site, display, temperature_correct = 0, humidity_absolute, humidity_correct, onHumidity } = get(id) || {};
          const temperature = temperature_raw + temperature_correct;
          set(id, { temperature, temperature_raw });
          if (site) calcTemperature(site);
          if (onTemperature) {
            run({ type: ACTION_SCRIPT_RUN, id: onTemperature });
          }
          if (humidity_absolute >= 0) {
            const humidity = toRelativeHumidity(humidity_absolute, toKelvin(temperature)) + humidity_correct;
            set(id, { humidity });
            if (site) calcHumidity(site);
            if (onHumidity) {
              run({ type: ACTION_SCRIPT_RUN, id: onHumidity });
            }
          }
          if (display) {
            const { lock } = get(display) || {};
            if (!lock) {
              run({
                type: ACTION_IMAGE,
                id: display,
                value: Math.round(temperature),
              });
            }
          }
          break;
        }
        case ACTION_TEMPERATURE_EXT_DEPRECATED:
        case ACTION_TEMPERATURE_EXT_OLD:
        case ACTION_TEMPERATURE_EXT: {
          if (data.length < 15) {
            return;
          }
          const dev_id =
            action === ACTION_TEMPERATURE_EXT || action === ACTION_TEMPERATURE_EXT_OLD
              ? Array.from(data)
                .slice(7, 15)
                .map((i) => i.toString(16).padStart(2, "0"))
                .join(":")
              : data
                .slice(7, 15)
                .map((i) => `0${i.toString(16)}`.slice(-2))
                .join(":");
          if (data.length < 17) {
            return;
          }
          const temperature_raw = data.readInt16LE(15) / 100;
          const { temperature_correct = 0 } = get(dev_id) || {};
          const temperature = temperature_raw + temperature_correct;
          online(dev_id, { temperature, temperature_raw, master: id, type: DEVICE_TYPE_TEMPERATURE_EXT, version: '1.0', ready: true });
          add(id, TEMPERATURE_EXT, dev_id);
          const { onTemperature: onTemperature, display, site } = get(dev_id);
          if (site) calcTemperature(site);
          if (onTemperature) {
            run({ type: ACTION_SCRIPT_RUN, id: onTemperature });
          }
          if (display) {
            const { lock } = get(display) || {};
            if (!lock) {
              run({
                type: ACTION_IMAGE,
                id: display,
                value: Math.round(temperature),
              });
            }
          }
          break;
        }
        case ACTION_HUMIDITY: {
          const humidity_raw = data.readUInt16LE(7) / 100;
          const { onHumidity, site, humidity_correct = 0, temperature, temperature_raw } = get(id) || {};
          if (temperature && temperature_raw) {
            const humidity_absolute = toAbsoluteHumidity(humidity_raw, toKelvin(temperature_raw));
            const humidity = toRelativeHumidity(humidity_absolute, toKelvin(temperature)) + humidity_correct;
            set(id, { humidity, humidity_absolute, humidity_raw });
          } else {
            const humidity = humidity_raw + humidity_correct;
            set(id, { humidity, humidity_raw });
          }
          if (site) calcHumidity(site);
          if (onHumidity) {
            run({ type: ACTION_SCRIPT_RUN, id: onHumidity });
          }
          break;
        }
        case ACTION_ILLUMINATION: {
          const illumination_raw = data.readUInt32LE(7) / 100;
          const { onIllumination, illumination_correct = 0, site } = get(id) || {};
          const illumination = illumination_raw + illumination_correct;
          set(id, { illumination, illumination_raw });
          if (site) calcIllumination(site);
          if (onIllumination) {
            run({ type: ACTION_SCRIPT_RUN, id: onIllumination });
          }
          break;
        }
        case ACTION_CO2: {
          const co2_raw = data.readUInt16LE(7);
          const { onCO2, co2_correct = 0, site } = get(id) || {};
          const co2 = co2_raw + co2_correct;
          set(id, { co2, co2_raw });
          if (site) calcCO2(site);
          if (onCO2) {
            run({ type: ACTION_SCRIPT_RUN, id: onCO2 });
          }
          break;
        }
        case ACTION_DOPPLER0: {
          const [, , , , , , , value, gain] = data;
          const { onDoppler } = get(id) || {};
          set(id, { value, gain });
          if (onDoppler) {
            run({ type: ACTION_SCRIPT_RUN, id: onDoppler });
          }
          break;
        }
        case ACTION_DOPPLER1: {
          const value = [...data.slice(7)];
          const { onDoppler } = get(id) || {};
          set(id, { value });
          if (onDoppler) {
            run({ type: ACTION_SCRIPT_RUN, id: onDoppler });
          }
          break;
        }
        case ACTION_DOPPLER_RAW: {
          set(id, { raw: [...data.slice(7)] });
          break;
        }
        case ACTION_IR: {
          const now = Date.now();
          const dev = get(id) || {};
          let value;
          if (now - dev.timestamp > 1000) {
            value = [];
          } else {
            value = [...dev.value];
          }
          const buff = data.slice(7);
          for (let i = 0; i < buff.length; i += 2) {
            const x = buff.readUInt16LE(i);
            value.push(x);
          }
          set(id, { value });
          break;
        }
        case ACTION_IR_CONFIG: {
          // console.log(data.slice(7));
          break;
        }
        case ACTION_LANAMP: {
          const index = data[7];
          const mode = data[8];
          const volume = [];
          const source = [];
          for (let i = 0; i < 2; i++) {
            volume[i] = data[i + 9];
            source[i] = [];
            for (let j = 0; j < 9; j++) {
              source[i][j] = {
                active: Boolean(data[i * 9 + j + 11]),
                volume: data[i * 9 + j + 11 + 9 * 2],
              };
            }
          }
          set(`${id}/lanamp/${index}`, { mode, volume });
          switch (mode) {
            case 0b01:
            case 0b10: {
              set(`${id}/stereo/${index}`, { source: source[0] });
              break;
            }
            case 0b11: {
              set(`${id}/mono/${2 * index - 1}`, { source: source[0] });
              set(`${id}/mono/${2 * index}`, { source: source[1] });
              break;
            }
          }
          break;
        }
        case ACTION_RTP: {
          const { type } = get(id) || {};
          switch (type) {
            case DEVICE_TYPE_LANAMP: {
              const index = data[7];
              const active = data[8];
              const group = int2ip(data.readUInt32BE(9));
              const port = data.readUInt16LE(13);
              const chan = `${id}/rtp/${index}`;
              set(chan, { active, group, port });
              break;
            }
            case DEVICE_TYPE_SOUNDBOX: {
              const index = data[7];
              const active = data[8];
              const group = int2ip(data.readUInt32BE(9));
              const port = data.readUInt16BE(13);
              const chan = `${id}/rtp/${index}`;
              set(chan, { active, group, port });
              break;
            }
          }
        }
        case ACTION_INITIALIZE: {
          initialize(id);
          break;
        }
        case ACTION_INITIALIZED: {
          initialized(id);
          break;
        }
        case ACTION_IP_ADDRESS: {
          const lookup = (get(POOL) || {})[id];
          if (lookup) {
            const buff = Buffer.alloc(15);
            buff.writeUInt8(ACTION_IP_ADDRESS, 0);
            Buffer.from(dev_mac).copy(buff, 1, 0, 6);
            buff.writeUInt32BE(lookup, 7);
            buff.writeUInt32BE(SUB_NET_MASK, 11);
            device.send(buff, DEVICE_GROUP);
          } else if (last_ip < IP_ADDRESS_POOL_END) {
            const buff = Buffer.alloc(15);
            buff.writeUInt8(ACTION_IP_ADDRESS, 0);
            Buffer.from(dev_mac).copy(buff, 1, 0, 6);
            const pool = Object.values(get(POOL) || {});
            while (last_ip < IP_ADDRESS_POOL_END) {
              if (!pool.includes(last_ip)) break;
              last_ip++;
            }
            set(POOL, { [id]: last_ip });
            buff.writeUInt32BE(last_ip, 7);
            buff.writeUInt32BE(SUB_NET_MASK, 11);
            device.send(buff, DEVICE_GROUP);
          }
          break;
        }
        case ACTION_MAC_ADDRESS: {
          crypto.randomBytes(7, (err, a) => {
            if (err) console.error(err);
            else {
              a[0] = ACTION_MAC_ADDRESS;
              a[1] &= 0b11111110;
              a[1] |= 0b00000010;
              device.send(a, address);
            }
          });
          break;
        }
        case ACTION_READY:
        case ACTION_DISCOVERY: {
          const type = data[7];
          const version = `${data[8]}.${data[9]}`;
          online(id, { type, version, ip: address, ready: true });
          add(mac(), DEVICE, id)
          break;
        }
        case ACTION_FIND_ME: {
          set(id, { finding: !!data[7] });
          break;
        }
        case ACTION_BOOTLOAD: {
          updateFirmware(id);
          break;
        }
        case ACTION_ALED_ON: {
          const index = data[7];
          const ch = `${id}/LA/${index}`;
          set(ch, { value: true });
          const { bind } = get(ch) || {};
          if (bind) {
            set(bind, { value: true });
          }
          break;
        }
        case ACTION_ALED_OFF: {
          const index = data[7];
          const ch = `${id}/LA/${index}`;
          set(ch, { value: false });
          const { bind } = get(ch) || {};
          if (bind) {
            set(bind, { value: false });
          }
          break;
        }
        case ACTION_ALED_BRIGHTNESS: {
          const index = data[7];
          const brightness = data[8];
          set(`${id}/LA/${index}`, { brightness });
          break;
        }
        // case ACTION_ALED_COLOR_ANIMATION_PLAY:
        // case ACTION_ALED_MASK_ANIMATION_PLAY:
        // case ACTION_ALED_COLOR_ANIMATION_STOP:
        // case ACTION_ALED_MASK_ANIMATION_STOP:
        // case ACTION_ALED_CLIP: {
        //   break;
        // }
        case ACTION_ALED_CONFIG_GROUP: {
          const index = data[7];
          const colors = data[8];
          const segments = Array(data[9]);
          for (let i = 0; i < segments.length; i++) {
            segments[i] = {
              direction: data[10 + i * 2],
              size: data[11 + i * 2],
            };
          }
          set(`${id}/LA/${index}`, { colors, segments });
          break;
        }
        case ACTION_ERROR: {
          const { type } = get(id) || {};
          switch (type) {
            case DEVICE_TYPE_SMART_TOP_G2: {
              const log = [];
              for (let i = 0; i < 2; i++) {
                log[i] = data.readInt16BE(8 + 2 * i);
              }
              set(id, { log });
              break;
            }
            case DEVICE_TYPE_SMART_TOP_G4:
            case DEVICE_TYPE_SMART_TOP_G4D:
            case DEVICE_TYPE_SMART_TOP_A4T:
            case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
              const log = [];
              for (let i = 0; i < 4; i++) {
                log[i] = data.readInt16BE(8 + 2 * i);
              }
              set(id, { log });
              break;
            }
            case DEVICE_TYPE_SMART_TOP_A6T:
            case DEVICE_TYPE_SMART_TOP_G6: {
              // console.log(data);
              const log = [];
              for (let i = 0; i < 6; i++) {
                log[i] = data.readInt16BE(8 + 2 * i);
              }
              // console.log(log);
              set(id, { log });
              break;
            }
            default: {
              const reason = data[7];
              switch (reason) {
                case ACTION_BOOTLOAD:
                  set(id, { pending: false, updating: false });
                  console.error(data);
                  break;
                default: {
                  console.error(data);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };
  device.handle(handleData);
};


const calcTemperature = site => {
  const { sensor = [], temperature_sensor = [], thermostat = [] } = get(site) || {};
  let temperature = 0;
  let n = 0;
  const s = temperature_sensor.length > 0 ? temperature_sensor : sensor;
  for (const id of s) {
    const dev = get(id) || {};
    if (dev.online && typeof dev.temperature === 'number') {
      temperature += dev.temperature;
      n++;
    }
  }
  if (n > 0) {
    temperature /= n;
    set(site, { temperature });
    for (const id of thermostat) {
      run({
        ...get(id),
        type: ACTION_THERMOSTAT_HANDLE,
        id
      });
    }
  }
}

const calcHumidity = site => {
  const { sensor = [], humidity_sensor = [], hygrostat = [] } = get(site) || {};
  let humidity = 0;
  let n = 0;
  const s = humidity_sensor.length > 0 ? humidity_sensor : sensor;
  for (const id of s) {
    const dev = get(id) || {};
    if (dev.online && typeof dev.humidity === 'number') {
      humidity += dev.humidity;
      n++;
    }
  }
  if (n > 0) {
    humidity /= n;
    set(site, { humidity });
    for (const id of hygrostat) {
      run({
        ...get(id),
        type: ACTION_HYGROSTAT_HANDLE,
        id
      });
    }
  }
}

const calcIllumination = site => {
  const { sensor = [], illumination_sensor = [] } = get(site) || {};
  let illumination = 0;
  let n = 0;
  const s = illumination_sensor.length > 0 ? illumination_sensor : sensor;
  for (const id of s) {
    const dev = get(id) || {};
    if (dev.online && typeof dev.illumination === 'number') {
      illumination += dev.illumination;
      n++;
    }
  }
  if (n > 0) {
    illumination /= n;
    set(site, { illumination });
  }
}

const calcCO2 = site => {
  const { sensor = [], co2_sensor = [], co2_stat = [] } = get(site) || {};
  let co2 = 0;
  let n = 0;
  const s = co2_sensor.length > 0 ? co2_sensor : sensor;
  for (const id of s) {
    const dev = get(id) || {};
    if (dev.online && typeof dev.co2 === 'number') {
      co2 += dev.co2;
      n++;
    }
  }
  if (n > 0) {
    co2 /= n;
    set(site, { co2 });
    for (const id of co2_stat) {
      run({
        ...get(id),
        type: ACTION_CO2_STAT_HANDLE,
        id
      });
    }
  }
}

const calcWarmFloorTemperature = site => {
  const { warm_floor = [] } = get(site) || {};
  let temperature = 0;
  let n = 0;
  for (const id of warm_floor) {
    const dev = get(id) || {};
    if (dev.sensor) {
      const sensor = get(dev.sensor) || {};
      if (sensor.online && typeof sensor.temperature === 'number') {
        temperature += sensor.temperature;
        n++;
      }
    }
  }
  if (n > 0) {
    return temperature /= n;
  }
}

const toArr = a => Array.isArray(a) ? a : a ? [a] : [];


const handleDefault = (action, actionCount) => (chan, btn) => {
  const actions = toArr(chan[action]);
  if (actions.length > 0) {
    const count = btn[actionCount] || 0;
    run({ type: ACTION_SCRIPT_RUN, id: actions[count % actions.length] });
  }
  return chan.repeat;
}

const handleDefaultOn = handleDefault('onOn', 'onOnCount');
const handleDefaultClick1 = handleDefault('onClick', 'onClick1Count');
const handleDefaultClick2 = handleDefault('onClick2', 'onClick2Count');
const handleDefaultClick3 = handleDefault('onClick3', 'onClick3Count');
const handleDefaultHold = handleDefault('onHold', 'onHoldCount');
const handleDefaultOff = handleDefault('onOff', 'onOffCount');


const handle = (handleSmartTop, handleDefault) => (id, index, chan) => {
  const dev = get(id) || {};
  switch (dev.type) {
    case DEVICE_TYPE_SMART_TOP_G4D:
    case DEVICE_TYPE_SMART_TOP_A4TD:
    case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
      const { mode = 0, modes = [] } = dev;
      if (modes.length > 0) {
        const cid = modes[mode % modes.length];
        const current = get(cid) || {};
        if (current.mode === 'MODE_SCENE' && chan.action !== 'menu') {
          return handleDefault(get(`${cid}/${DI}/${index}`), chan);
        }
        return handleSmartTop(id, dev, chan, current, mode);
      }
      return false;
    }
    default: {
      return handleDefault(chan, chan);
    }
  }
}

const handleSmartTop = () => false;

const handleSmartTopClick1 = (id, dev, chan, current, mode) => {
  if (dev.configuring) {
    const site = current.site || dev.site;
    if (site) {
      const { thermostat = [], hygrostat = [], co2_stat = [], warm_floor = [] } = get(site) || {};
      switch (current.mode) {
        case 'MODE_COOL': {
          const { setpoint = 24, cool = true, cool_intensity = 0 } = get(thermostat[0]) || {};
          switch (chan.action) {
            case 'plus': {
              switch (dev.configuring) {
                case 1: {
                  run({ type: ACTION_SETPOINT, id: site, temperature: setpoint + 0.5 });
                  renderSmartTop(id);
                  break;
                }
                case 2: {
                  run({ type: ACTION_INTENSITY, id: site, cool: cool_intensity + 1 });
                  renderSmartTop(id);
                  break;
                }
              }
              break;
            }
            case 'minus': {
              switch (dev.configuring) {
                case 1: {
                  run({ type: ACTION_SETPOINT, id: site, temperature: setpoint - 0.5 });
                  renderSmartTop(id);
                  break;
                }
                case 2: {
                  run({ type: ACTION_INTENSITY, id: site, cool: cool_intensity - 1 });
                  renderSmartTop(id);
                  break;
                }
              }
              break;
            }
            case 'power': {
              run({ type: cool ? ACTION_STOP_COOL : ACTION_START_COOL, id: site });
              renderSmartTop(id);
              break;
            }
            case 'menu': {
              const max = maxCoolIntensity(thermostat)
              if (max > 0) {
                set(id, { configuring: dev.configuring < 2 ? dev.configuring + 1 : 1 });
                renderSmartTop(id);
              }
              break;
            }
          }
          break;
        }
        case 'MODE_HEAT': {
          const { setpoint = 24, heat = true, heat_intensity = 0 } = get(thermostat[0]) || {};
          switch (chan.action) {
            case 'plus': {
              switch (dev.configuring) {
                case 1: {
                  run({ type: ACTION_SETPOINT, id: site, temperature: setpoint + 0.5 });
                  renderSmartTop(id);
                  break;
                }
                case 2: {
                  run({ type: ACTION_INTENSITY, id: site, heat: heat_intensity + 1 });
                  renderSmartTop(id);
                  break;
                }
              }
              break;
            }
            case 'minus': {
              switch (dev.configuring) {
                case 1: {
                  run({ type: ACTION_SETPOINT, id: site, temperature: setpoint - 0.5 });
                  renderSmartTop(id);
                  break;
                }
                case 2: {
                  run({ type: ACTION_INTENSITY, id: site, heat: heat_intensity - 1 });
                  renderSmartTop(id);
                  break;
                }
              }
              break;
            }
            case 'power': {
              run({ type: heat ? ACTION_STOP_HEAT : ACTION_START_HEAT, id: site });
              renderSmartTop(id);
              break;
            }
            case 'menu': {
              const max = maxHeatIntensity(thermostat)
              if (max > 0) {
                set(id, { configuring: dev.configuring < 2 ? dev.configuring + 1 : 1 });
                renderSmartTop(id);
              }
              break;
            }
          }
          break;
        }
        case 'MODE_WET': {
          const { setpoint = 50, wet = true } = get(hygrostat[0]) || {};
          switch (chan.action) {
            case 'plus': {
              run({ type: ACTION_SETPOINT, id: site, humidity: setpoint + 0.5 });
              renderSmartTop(id);
              break;
            }
            case 'minus': {
              run({ type: ACTION_SETPOINT, id: site, humidity: setpoint - 0.5 });
              renderSmartTop(id);
              break;
            }
            case 'power': {
              run({ type: wet ? ACTION_STOP_WET : ACTION_START_WET, id: site });
              renderSmartTop(id);
              break;
            }
            case 'menu': {
              // set(id, { configuring: dev.configuring + 1 })
              // renderSmartTop(id);
              break;
            }
          }
          break;
        }
        case 'MODE_VENTILATION': {
          const { setpoint = 400, ventilation = true, ventilation_intensity = 0 } = get(co2_stat[0]) || {};
          switch (chan.action) {
            case 'plus': {
              switch (dev.configuring) {
                case 1: {
                  run({ type: ACTION_SETPOINT, id: site, co2: setpoint + 10 });
                  renderSmartTop(id);
                  break;
                }
                case 2: {
                  run({ type: ACTION_INTENSITY, id: site, ventilation: ventilation_intensity + 1 });
                  renderSmartTop(id);
                  break;
                }
              }
              break;
            }
            case 'minus': {
              switch (dev.configuring) {
                case 1: {
                  run({ type: ACTION_SETPOINT, id: site, co2: setpoint - 10 });
                  renderSmartTop(id);
                  break;
                }
                case 2: {
                  run({ type: ACTION_INTENSITY, id: site, ventilation: ventilation_intensity - 1 });
                  renderSmartTop(id);
                  break;
                }
              }
              break;
            }
            case 'power': {
              run({ type: ventilation ? ACTION_STOP_VENTILATION : ACTION_START_VENTILATION, id: site });
              renderSmartTop(id);
              break;
            }
            case 'menu': {
              const max = maxVentilationIntensity(co2_stat)
              if (max > 0) {
                set(id, { configuring: dev.configuring < 2 ? dev.configuring + 1 : 1 });
                renderSmartTop(id);
              }
              break;
            }
          }
          break;
        }
        case 'MODE_WARM_FLOOR': {
          const { min = 5, max = 40 } = get(warm_floor[0]) || {};
          switch (chan.action) {
            case 'plus': {
              switch (dev.configuring) {
                case 1: {
                  const value = min + 0.5;
                  if (value < 40 && value > 5 && value < max) {
                    for (const id of warm_floor) {
                      set(id, { min: value });
                    }
                    renderSmartTop(id);
                  }
                  break;
                }
                case 2: {
                  const value = max + 0.5;
                  if (value < 40 && value > 5 && value > min) {
                    for (const id of warm_floor) {
                      set(id, { max: value });
                    }
                    renderSmartTop(id);
                  }
                  break;
                }
              }
              break;
            }
            case 'minus': {
              switch (dev.configuring) {
                case 1: {
                  const value = min - 0.5;
                  if (value < 40 && value > 5 && value < max) {
                    for (const id of warm_floor) {
                      set(id, { min: min - 0.5 });
                    }
                    renderSmartTop(id);
                  }
                  break;
                }
                case 2: {
                  const value = max - 0.5;
                  if (value < 40 && value > 5 && value > min) {
                    for (const id of warm_floor) {
                      set(id, { max: max - 0.5 });
                    }
                    renderSmartTop(id);
                  }
                  break;
                }
              }
              break;
            }
            case 'power': {
              const on = isWarmFloorOn(warm_floor);
              for (const id of warm_floor) {
                const { inverse } = get(id) || {};
                if (inverse) {
                  run({ type: on ? ACTION_ON : ACTION_OFF, id });
                } else {
                  run({ type: on ? ACTION_OFF : ACTION_ON, id });
                }
              }
              setTimeout(renderSmartTop, 300, id);
              break;
            }
            case 'menu': {
              set(id, { configuring: dev.configuring < 2 ? dev.configuring + 1 : 1 });
              renderSmartTop(id);
              break;
            }
          }
          break;
        }
      }
    }
  } else if (chan.action === 'menu') {
    set(id, { mode: mode + 1 });
    renderSmartTop(id);
  }
  return false;
}

const handleSmartTopHold = (id, dev, chan, current) => {
  if (chan.action === 'menu') {
    if (current.mode !== 'MODE_SCENE') {
      set(id, { configuring: dev.configuring ? 0 : 1 });
      renderSmartTop(id);
    }
  } else {
    const site = current.site || dev.site;
    if (site) {
      const { thermostat = [], hygrostat = [], co2_stat = [], warm_floor = [] } = get(site) || {};
      if (dev.configuring) {
        switch (current.mode) {
          case 'MODE_COOL': {
            const { setpoint = 24, cool_intensity = 0 } = get(thermostat[0]) || {};
            switch (chan.action) {
              case 'plus': {
                switch (dev.configuring) {
                  case 1: {
                    run({ type: ACTION_SETPOINT, id: site, temperature: setpoint + 0.5 });
                    renderSmartTop(id);
                    return true;
                  }
                  case 2: {
                    run({ type: ACTION_INTENSITY, id: site, cool: cool_intensity + 1 });
                    renderSmartTop(id);
                    return true;
                  }
                }
                break;
              }
              case 'minus': {
                switch (dev.configuring) {
                  case 1: {
                    run({ type: ACTION_SETPOINT, id: site, temperature: setpoint - 0.5 });
                    renderSmartTop(id);
                    return true;
                  }
                  case 2: {
                    run({ type: ACTION_INTENSITY, id: site, cool: cool_intensity - 1 });
                    renderSmartTop(id);
                    return true;
                  }
                }
                break;
              }
            }
            break;
          }
          case 'MODE_HEAT': {
            const { setpoint = 24, heat_intensity = 0 } = get(thermostat[0]) || {};
            switch (chan.action) {
              case 'plus': {
                switch (dev.configuring) {
                  case 1: {
                    run({ type: ACTION_SETPOINT, id: site, temperature: setpoint + 0.5 });
                    renderSmartTop(id);
                    return true;
                  }
                  case 2: {
                    run({ type: ACTION_INTENSITY, id: site, heat: heat_intensity + 1 });
                    renderSmartTop(id);
                    return true;
                  }
                }
                break;
              }
              case 'minus': {
                switch (dev.configuring) {
                  case 1: {
                    run({ type: ACTION_SETPOINT, id: site, temperature: setpoint - 0.5 });
                    renderSmartTop(id);
                    return true;
                  }
                  case 2: {
                    run({ type: ACTION_INTENSITY, id: site, heat: heat_intensity - 1 });
                    renderSmartTop(id);
                    return true;
                  }
                }
                break;
              }
            }
            break;
          }
          case 'MODE_WET': {
            const { setpoint = 50 } = get(hygrostat[0]) || {};
            switch (chan.action) {
              case 'plus': {
                run({ type: ACTION_SETPOINT, id: site, humidity: setpoint + 0.5 });
                renderSmartTop(id);
                return true;
              }
              case 'minus': {
                run({ type: ACTION_SETPOINT, id: site, humidity: setpoint - 0.5 });
                renderSmartTop(id);
                return true;
              }
            }
            break;
          }
          case 'MODE_VENTILATION': {
            const { setpoint = 400, ventilation_intensity = 0 } = get(co2_stat[0]) || {};
            switch (chan.action) {
              case 'plus': {
                switch (dev.configuring) {
                  case 1: {
                    run({ type: ACTION_SETPOINT, id: site, co2: setpoint + 10 });
                    renderSmartTop(id);
                    return true;
                  }
                  case 2: {
                    run({ type: ACTION_INTENSITY, id: site, ventilation: ventilation_intensity + 1 });
                    renderSmartTop(id);
                    return true;
                  }
                }
                break;
              }
              case 'minus': {
                switch (dev.configuring) {
                  case 1: {
                    run({ type: ACTION_SETPOINT, id: site, co2: setpoint - 10 });
                    renderSmartTop(id);
                    return true;
                  }
                  case 2: {
                    run({ type: ACTION_INTENSITY, id: site, ventilation: ventilation_intensity - 1 });
                    renderSmartTop(id);
                    return true;
                  }
                }
                break;
              }
            }
            break;
          }
          case 'MODE_WARM_FLOOR': {
            const { min = 5, max = 40 } = get(warm_floor[0]) || {};
            switch (chan.action) {
              case 'plus': {
                switch (dev.configuring) {
                  case 1: {
                    const value = min + 0.5;
                    if (value < 40 && value > 5 && value < max) {
                      for (const id of warm_floor) {
                        set(id, { min: value });
                      }
                      renderSmartTop(id);
                      return true;
                    }
                    break;
                  }
                  case 2: {
                    const value = max + 0.5;
                    if (value < 40 && value > 5 && value > min) {
                      for (const id of warm_floor) {
                        set(id, { max: value });
                      }
                      renderSmartTop(id);
                      return true;
                    }
                    break;
                  }
                }
                break;
              }
              case 'minus': {
                switch (dev.configuring) {
                  case 1: {
                    const value = min - 0.5;
                    if (value < 40 && value > 5 && value < max) {
                      for (const id of warm_floor) {
                        set(id, { min: min - 0.5 });
                      }
                      renderSmartTop(id);
                      return true;
                    }
                    break;
                  }
                  case 2: {
                    const value = max - 0.5;
                    if (value < 40 && value > 5 && value > min) {
                      for (const id of warm_floor) {
                        set(id, { max: max - 0.5 });
                      }
                      renderSmartTop(id);
                      return true;
                    }
                    break;
                  }
                }
                break;
              }
            }
            break;
          }
        }
      } else if (chan.action === 'power') {
        switch (current.mode) {
          case 'MODE_COOL': {
            const { cool = true } = get(thermostat[0]) || {};
            run({ type: cool ? ACTION_STOP_COOL : ACTION_START_COOL, id: site });
            renderSmartTop(id);
            break;
          }
          case 'MODE_HEAT': {
            const { heat = true } = get(thermostat[0]) || {};
            run({ type: heat ? ACTION_STOP_HEAT : ACTION_START_HEAT, id: site });
            renderSmartTop(id);
            break;
          }
          case 'MODE_WET': {
            const { wet = true } = get(hygrostat[0]) || {};
            run({ type: wet ? ACTION_STOP_WET : ACTION_START_WET, id: site });
            renderSmartTop(id);
            break;
          }
          case 'MODE_VENTILATION': {
            const { ventilation = true } = get(co2_stat[0]) || {};
            run({ type: ventilation ? ACTION_STOP_VENTILATION : ACTION_START_VENTILATION, id: site });
            renderSmartTop(id);
            break;
          }
          case 'MODE_WARM_FLOOR': {
            let on = false;
            for (const id of warm_floor) {
              const { bind, inverse } = get(id) || {};
              const { value } = get(bind) || {};
              on ||= inverse ? !value : value;
            }
            for (const id of warm_floor) {
              const { inverse } = get(id) || {};
              if (inverse) {
                run({ type: on ? ACTION_ON : ACTION_OFF, id });
              } else {
                run({ type: on ? ACTION_OFF : ACTION_ON, id });
              }
            }
            setTimeout(renderSmartTop, 300, id);
            break;
          }
        }
      }
    }
  }
  return false;
}

const handleOn = handle(handleSmartTop, handleDefaultOn);
const handleClick1 = handle(handleSmartTopClick1, handleDefaultClick1);
const handleClick2 = handle(handleSmartTop, handleDefaultClick2);
const handleClick3 = handle(handleSmartTop, handleDefaultClick3);
const handleHold = handle(handleSmartTopHold, handleDefaultHold);
const handleOff = handle(handleSmartTop, handleDefaultOff);



const renderSmartTop = (id) => {
  timestamp[id] = Date.now();

  const dev = get(id) || {};

  const { mode = 0, modes = [], configuring } = dev;
  const image = [...(dev.image || [0, 0, 0, 0, 0, 0, 0, 0])];
  const blink = [...(dev.blink || [0, 0, 0, 0, 0, 0, 0, 0])];
  const current = get(modes[mode % modes.length]) || {};
  switch (dev.type) {
    case DEVICE_TYPE_SMART_TOP_G4D: {
      image[1] &= 0b0000_1111;
      image[2] &= 0b1111_1100;
      blink[1] &= 0b0000_1111;
      blink[2] &= 0b1111_1100;
      if (current.indicator > 0 && current.indicator <= 4) {
        image[1] |= 1 << (current.indicator + 3);
        if (configuring) {
          blink[1] |= 1 << (current.indicator + 3);
        }
      } else if (current.indicator <= 6) {
        image[2] |= 1 << (current.indicator - 5);
        if (configuring) {
          blink[2] |= 1 << (current.indicator - 5);
        }
      }
      break;
    }
    case DEVICE_TYPE_SMART_TOP_A4TD:
    case DEVICE_TYPE_SMART_TOP_A4TD_7S: {
      image[1] &= 0b0000_0011;
      blink[1] &= 0b0000_0011;
      if (current.indicator > 0 && current.indicator <= 6) {
        image[1] |= 1 << (current.indicator + 1);
        if (configuring) {
          blink[1] |= 1 << (current.indicator + 1);
        }
      }
      break;
    }
  }
  const site = current.site || dev.site;
  if (site) {
    const { temperature, humidity, co2, thermostat = [], hygrostat = [], co2_stat = [], warm_floor = [] } = get(site) || {};
    switch (current.mode) {
      case 'MODE_COOL': {
        const max = maxCoolIntensity(thermostat);
        const { setpoint = 24, cool = true, cool_intensity = 0 } = get(thermostat[0]) || {};
        if (configuring) {
          switch (configuring) {
            case 1: {
              printf(id, setpoint, -99.9, 199.9, 1, cool, cool_intensity, max, image);
              break;
            }
            case 2: {
              printf(id, cool_intensity, 0, 1999, 0, cool, cool_intensity, max, image);
              break;
            }
          }
        } else {
          printf(id, temperature, -99.9, 199.9, 1, cool, cool_intensity, max, image);
        }
        break;
      }
      case 'MODE_HEAT': {
        const max = maxHeatIntensity(thermostat);
        const { setpoint = 24, heat = true, heat_intensity = 0 } = get(thermostat[0]) || {};
        if (configuring) {
          switch (configuring) {
            case 1: {
              printf(id, setpoint, -99.9, 199.9, 1, heat, heat_intensity, max, image);
              break;
            }
            case 2: {
              printf(id, heat_intensity, 0, 1999, 0, heat, heat_intensity, max, image);
              break;
            }
          }
        } else {
          printf(id, temperature, -99.9, 199.9, 1, heat, heat_intensity, max, image);
        }
        break;
      }
      case 'MODE_WARM_FLOOR': {
        const on = isWarmFloorOn(warm_floor);
        if (configuring) {
          const { min = 5, max = 40 } = get(warm_floor[0]) || {};
          switch (configuring) {
            case 1: {
              printf(id, min, -99.9, 199.9, 1, on, 0, 0, image);
              break;
            }
            case 2: {
              printf(id, max, -99.9, 199.9, 1, on, 0, 0, image);
              break;
            }
          }
        } else {
          const temperature = calcWarmFloorTemperature(site);
          printf(id, temperature, -99.9, 100, 1, on, 0, 0, image);
        }
        break;
      }
      case 'MODE_WET': {
        const { setpoint = 50, wet = true } = get(hygrostat[0]) || {};
        if (configuring) {
          printf(id, setpoint, 0, 100, 1, wet, 0, 0, image);
        } else {
          printf(id, humidity, 0, 100, 1, wet, 0, 0, image);
        }
        break;
      }
      case 'MODE_VENTILATION': {
        const max = maxVentilationIntensity(co2_stat);
        const { setpoint = 400, ventilation = true, ventilation_intensity = 0 } = get(co2_stat[0]) || {};
        if (configuring) {
          switch (configuring) {
            case 1: {
              printf(id, setpoint, 0, 1999, 0, ventilation, ventilation_intensity, max, image);
              break;
            }
            case 2: {
              printf(id, ventilation_intensity, 0, 1999, 0, ventilation, ventilation_intensity, max, image);
              break;
            }
          }
        } else {
          printf(id, co2, 0, 1999, 0, ventilation, ventilation_intensity, max, image);
        }
        break;
      }
      default:
        print(id, "", false, 0, image)
    }
  } else {
    run({ type: ACTION_IMAGE, id, value: image })
  }
  run({ type: ACTION_BLINK, id, value: blink })
  if (configuring) {
    switch (current.mode) {
      case 'MODE_COOL':
      case 'MODE_HEAT':
      case 'MODE_WET':
      case 'MODE_VENTILATION': {
        switch (configuring) {
          case 1: {
            run({ type: ACTION_PALETTE, id, value: current.palette_setpoint })
            break;
          }
          case 2: {
            run({ type: ACTION_PALETTE, id, value: current.palette_intensity })
            break;
          }
        }
      }
      case 'MODE_WARM_FLOOR': {
        switch (configuring) {
          case 1: {
            run({ type: ACTION_PALETTE, id, value: current.palette_setpoint_min })
            break;
          }
          case 2: {
            run({ type: ACTION_PALETTE, id, value: current.palette_setpoint_max })
            break;
          }
        }
        break;
      }
    }
  } else {
    if (current.palette > 0 && current.palette <= 12) {
      run({ type: ACTION_PALETTE, id, value: current.palette })
    }
  }
}

const print = (id, value, power, intensity, image) =>
  run({ type: ACTION_PRINT, id, value, power, intensity, image })

printf = (id, value, min, max, fixed, power, intensity, max_intensity, image) =>
  print(id, format(value, min, max, fixed), power, max_intensity > 0 ? intensity / max_intensity : 0, image)

const format = (value, min, max, fixed) =>
  typeof value === 'number' ? Math.max(Math.min(value, max), min).toFixed(fixed) : ""

const isWarmFloorOn = (warm_floor = []) => {
  let on = false;
  for (const id of warm_floor) {
    const { bind, inverse } = get(id) || {};
    const { value } = get(bind) || {};
    on ||= inverse ? !value : value;
  }
  return on;
}

const maxCoolIntensity = (thermostat = []) => {
  let max = 0;
  for (const id of thermostat) {
    const { onCoolIntensity = [] } = get(id) || {};
    max = Math.max(max, onCoolIntensity.length - 1);
  }
  return max;
}

const maxHeatIntensity = (thermostat = []) => {
  let max = 0;
  for (const id of thermostat) {
    const { onHeatIntensity = [] } = get(id) || {};
    max = Math.max(max, onHeatIntensity.length - 1);
  }
  return max;
}

const maxVentilationIntensity = (co2_stat = []) => {
  let max = 0;
  for (const id of co2_stat) {
    const { onVentilationIntensity = [] } = get(id) || {};
    max = Math.max(max, onVentilationIntensity.length - 1);
  }
  return max;
}
