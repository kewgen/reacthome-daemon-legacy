
const { createSocket } = require('dgram');

module.exports = (discovery, interval, port, listen, multicast) => {

  // reuseAddr позволяет повторно биндить порт при быстром рестарте (без EADDRINUSE)
  const socket = createSocket({ type: 'udp4', reuseAddr: true });

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
