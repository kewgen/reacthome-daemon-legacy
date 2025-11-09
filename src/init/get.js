const { get } = require('../actions');
const { send } = require('../websocket/peer');
const { ACTION_SET, ACTION_ASSET } = require('../constants');
const { asset, exists, readFile } = require('../fs');

module.exports = async ({ state = [], assets = [] }, session) => {
  for (const id of state) {
    send(session, { type: ACTION_SET, id, payload: get(id) });
  }
  for await (const name of assets) {
    try {
      if (typeof name !== 'string') continue;
      const file = asset(name);
      if (await exists(file)) {
        const data = await readFile(file);
        const payload = data.toString('base64');
        send(session, { type: ACTION_ASSET, name, payload });
      }
    } catch (e) {
      console.error(e);
    }
  }
};
