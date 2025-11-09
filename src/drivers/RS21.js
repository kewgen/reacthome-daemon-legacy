
var net = require('net');
const { get, set } = require('../actions');
const service = require('../controllers/service');
const { ACTION_SCRIPT_RUN } = require('../constants');
module.exports = class {

  constructor(id) {
    this.id = id;
    this.start();
  }

  start() {
    this.timer = setInterval(() => {
      const { ip, onTemperature, site } = get(this.id) || {};
      const client = new net.Socket();
      client.on('error', () => {
        set(this.id, { online: false });
      })
      client.on('data', (data) => {
        client.destroy();
        const lines = String(data).split('\r\n');
        const temperature = parseFloat(lines[lines.length - 1]);
        if (site) set(site, { temperature });
        set(this.id, { online: true, temperature });
        if (onTemperature) {
          service.run({type: ACTION_SCRIPT_RUN, id: onTemperature});
        }
      });
      client.connect(80, ip, () => {
        client.write('GET /sensors HTTP/1.1\r\n\r\n');
      });
    }, 10000);
  }

  stop() {
    clearInterval(this.timer);
  }

}
