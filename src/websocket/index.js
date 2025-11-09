
const startServer = require('./server');
const connectGate = require('./gate');

module.exports.start = (id) => {
  startServer();
  connectGate(id);
}