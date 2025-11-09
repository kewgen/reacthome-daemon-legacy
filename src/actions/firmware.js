
const path = require('path');
const { createReadStream } = require('fs');
const { createInterface } = require('readline');
const { get, set } = require('./create');
const {
  ACTION_BOOTLOAD,
  BOOTLOAD_WRITE,
  BOOTLOAD_FINISH,
  DEVICE_PORT,
  FIRMWARE,
} = require('../constants');
const { device } = require('../sockets');

const firmwareQueue = {};

module.exports.updateFirmware = (id) => {
  const dev = get(id);
  const queue = firmwareQueue[id];
  if (queue && queue.length > 0) {
    const length = queue.length
    set(id, { pending: false, updating: true, length });
    // device.sendConfirm(queue.shift(), dev.ip, () => {
    //   const dev = get(id);
    //   return !(dev && dev.length === length);
    // });
  } else {
    set(id, { pending: false, updating: false });
    // device.sendConfirm(Buffer.from([ACTION_BOOTLOAD, BOOTLOAD_FINISH]), dev.ip, () => {
    //   const dev = get(id);
    //   return !(dev && dev.online);
    // });
  }
};

module.exports.pendingFirmware = (id, firmware) => {
  const queue = [];
  const file = path.normalize(path.join(FIRMWARE, `${firmware}.hex`));
  const lineReader = createInterface({ input: createReadStream(file) });
  let packet;
  let stop = false;

  lineReader.on('line', (line) => {
    switch (line[8]) {
      case '0': {
        if (!stop) {
          try {
            const size = parseInt(line.slice(1, 3), 16);
            const address = parseInt(line.slice(3, 7), 16);
            let rowAddress = address - (address % 0x40);
            let offset = address - rowAddress;
            for (let i = 0; i < size; i++) {
              const j = (9 + (2 * i));
              let index = offset + i;
              if ((index % 0x40) === 0) {
                rowAddress += index;
                packet = Buffer.alloc(70);
                packet.fill(0xff);
                packet.writeUInt8(ACTION_BOOTLOAD, 0);
                packet.writeUInt8(BOOTLOAD_WRITE, 1);
                packet.writeUInt32BE(rowAddress, 2);
                queue.push(packet);
                offset -= index;
                index = 0;
              }
              packet.writeUInt8(parseInt(line.slice(j, j + 2), 16), 6 + index);
            }
          } catch (err) {
            console.error(err);
          }
        }
        break;
      }
      case '1': {
        firmwareQueue[id] = queue;
        set(id, { pendingFirmware: firmware, pending: true, updating: false });
        break;
      }
      case '4':
        stop = true;
        break;
      default:
        console.error(line);
    }
  });
};
