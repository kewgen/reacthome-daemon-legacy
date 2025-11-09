
const { createSocket } = require('dgram');

module.exports = (discovery, interval, port, listen, multicast) => {

  const socket = createSocket('udp4');

  const send = (packet, ip) => {
    socket.send(packet, port, ip, (err) => {
      if (err) console.error(err);
    });
  };

  const startDiscovery = () => {
    try {
      socket.setMulticastInterface(multicast);
      setInterval(discovery(socket), interval);
    } catch (e) {
      // console.error(e);
      setTimeout(startDiscovery, 10_000);
    }
  };

  socket
    .on('error', console.error)
    .bind(listen, startDiscovery);

  const handle = (handler) => {
    socket.on('message', handler);
  };

  return { handle, send };
};
