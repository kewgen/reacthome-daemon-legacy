
const { parentPort, workerData } = require('worker_threads');

const { createSocket } = require('dgram');
const Artnet = require('./player');
const { set, dim } = require('./scripts');

const {
  ID,
  ARTNET,
  ACTION_DO,
  ACTION_ARTNET,
  OFF,
  ON,
  ARTNET_OFF,
  ARTNET_ON,
  ARTNET_SET,
  ARTNET_FADE,
  ARTNET_TYPE,
  ARTNET_TYPE_DIMMER,
  ARTNET_TYPE_RELAY
} = require('../../constants');

const N = 512;

const config = {
  net: 0, subnet: 0, universe: 0,
  host: '',
  port: 0x1936,
  size: 0,
  rate: 40,
  state: [],
  type: [],
  ...workerData
};

const fade = dim(5);

const artnet = new Artnet(config);

const socket = createSocket('udp4');

const send = (action, ip) => {
  parentPort.postMessage(action);
}

const run = (action) => {
  switch (action.type) {
    case ACTION_DO: {
      const { index, value } = action;
      if (!config.type[index]) return;
      config.state[index] = value ? 255 : 0;
      send({ index, value: config.state[index] });
      artnet.play(index, set(config.state[index]));
      break;
    }
    default: {
      switch (action.action) {
        case ARTNET_TYPE: {
          const { index, value: type } = action;
          config.type[index] = type;
          config.state[index] = 0;
          send({ index, type, value: config.state[index] });
          artnet.play(index, set(0));
          break;
        }
        case ARTNET_SET: {
          const { index, value } = action;
          if (!config.type[index]) return;
          config.state[index] = value;
          send({ index, value });
          artnet.play(index, set(value));
          break;
        }
        case ARTNET_FADE: {
          const { index, value } = action;
          if (config.type[index] !== ARTNET_TYPE_DIMMER) return;
          config.state[index] = value;
          send({ index, value });
          artnet.play(index, fade(value));
          break;
        }
        case ARTNET_ON: {
          const { index } = action;
          if (!config.type[index]) return;
          config.state[index] = 255;
          send({ index, value: 255 });
          artnet.play(index, set(255));
          break;
        }
        case ARTNET_OFF: {
          const { index } = action;
          if (!config.type[index]) return;
          config.state[index] = 0;
          send({ index, value: 0 });
          artnet.play(index, set(0));
          break;
        }
      }
      break;
    }
  }
};

parentPort.on('message', run);
