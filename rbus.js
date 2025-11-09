const os = require('os');
const { rbus } = require("./src/rbus");


setTimeout(() => {
  const ifaces = os.networkInterfaces();
  const mac = (ifaces.eth0 || ifaces.eth1)[0]
    .mac.split(':').map(i => parseInt(i, 16));
  rbus(mac, '127.0.1.1', '/dev/ttyAMA0')
}, 10_000)
