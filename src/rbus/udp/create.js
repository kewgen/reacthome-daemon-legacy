const dgram = require('dgram');
const { DEVICE_PORT, DEVICE_SERVER_PORT, ACTION_READY, ACTION_DISCOVERY, ACTION_INITIALIZE, DEVICE_TYPE_SERVER } = require('../../constants');
const { handle } = require('./handle');

module.exports.createSocket = (rbus, host) => {
  const socket = dgram.createSocket('udp4');
  socket.bind(DEVICE_PORT, host);
  socket.on('message', handle(rbus));
  const send = (data) => {
    // console.log("UDP send", data)
    socket.send(
      data,
      DEVICE_SERVER_PORT,
      '127.0.0.1'
    )
  }
  rbus.socket = {
    host, send,
    close: socket.close
  }
  setInterval(() => {
    rbus.socket.send(Buffer.from([
      ...rbus.mac,
      rbus.ready ? ACTION_READY : ACTION_DISCOVERY,
      DEVICE_TYPE_SERVER,
      5, 0 // Version
    ]))
  }, 1_000)
  rbus.socket.send(Buffer.from([...rbus.mac, ACTION_INITIALIZE]));
}
