
const { get } = require('../controllers/state');
const {
  DISCOVERY_INTERVAL,
  ACTION_DISCOVERY,
  DEVICE_GROUP,
  DEVICE_PORT,
  DEVICE_SERVER_PORT,
  IP_ADDRESS,
  ACTION_RBUS_TRANSMIT,
  ACTION_SMART_TOP,
} = require('../constants');
const socket = require('./socket');

queue = [];

const device = socket((socket) => {
  const data = Buffer.alloc(7);
  data.writeUInt8(ACTION_DISCOVERY, 0);
  data.writeUInt32BE(IP_ADDRESS, 1);
  data.writeUInt16BE(socket.address().port, 5);
  return () => {
    push(() => {
      // console.log("send discovery", data);
      device.send(data, DEVICE_GROUP);
    });
  };
}, DISCOVERY_INTERVAL, DEVICE_PORT, DEVICE_SERVER_PORT, '172.16.0.1');


device.sendRBUS = (data, id) => {
  push(() => {
    const mac = id.split(":").map((i) => parseInt(i, 16));
    const header = [ACTION_RBUS_TRANSMIT, ...mac];
    const dev = get(id);
    let buf;
    if (dev) {
      if (dev.hub) {
        buff = Buffer.from([...header, dev.port, dev.address, ...data]);
        // console.log("send rbus via hub", buff);
      } else {
        buff = Buffer.from([...header, ...data]);
      }
      device.send(buff, dev.ip);
    }
  });
}


device.sendTOP = (data, id) => {
  push(() => {
    const { bottom } = get(id) || {};
    if (bottom) {
      // console.log("send top", data);
      device.sendRBUS([ACTION_SMART_TOP, ...data], bottom);
    }
  });
}

let timeout;

setInterval(() => {
  const run = queue.shift();
  if (run) {
    run();
  }
}, 3)

const push = (run) => {
  queue.push(run);
}

module.exports = device;
