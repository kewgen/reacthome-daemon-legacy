let state = {};

module.exports.init = (s) => (state = s);

module.exports.get = (id) => state[id];

module.exports.set = (id, payload) => {
  if (state[id] === undefined) {
    state[id] = payload;
  } else {
    const toDelete = payload.__delete;
    if (Array.isArray(toDelete)) {
      for (const k of toDelete) delete state[id][k];
      delete payload.__delete;
    }
    Object.assign(state[id], payload);
  }
};

module.exports.state = () => state;

module.exports.list = () =>
  Object.entries(state)
    .filter(
      ([id, payload]) =>
        !(payload instanceof Array) &&
        payload instanceof Object &&
        payload.timestamp
    )
    .map(([id, { timestamp }]) => [id, timestamp]);

module.exports.assets = () =>
  Object.values(state).reduce((assets, { image }) => {
    if (image && !assets.includes(image)) {
      assets.push(image);
    }
    return assets;
  }, []);
