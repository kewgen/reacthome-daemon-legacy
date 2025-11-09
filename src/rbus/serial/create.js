const { SerialPort } = require('serialport');
const { addCRC } = require('../crc');
const { handle } = require('./handle');

const createPort = (rbus, path) => {
  const port = new SerialPort(
    { path, baudRate: 1_000_000, dataBits: 8, stopBits: 1, parity: 'none' },
    (err) => {
      if (err) console.error(err)
    }
  )
  port.on('data', handle(rbus));
  const send = (data) => {
    const buff = Buffer.from(data);
    port.write(buff)
  }
  rbus.port = {
    path,
    send: (data) => send(addCRC(data)),
    close: port.close,
    reCreate: () => {
      port.close();
      createPort(rbus, path);
    }
  };
}

module.exports.createPort = createPort;
