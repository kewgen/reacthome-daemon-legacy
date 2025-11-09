
const { list, assets } = require('../controllers/state');
const { send } = require('../websocket/peer');
const { LIST } = require('./constants');

module.exports = async (session) => {
  send(session, { type: LIST,  state: list(), assets: assets() });
};
