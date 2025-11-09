const { get, set } = require('../../actions');
const { DALI_GROUP, DALI_LIGHT } = require('../../constants');
const { writeRegister } = require('../modbus');
const { delay } = require('../../util');

const instance = new Map();

const sync = async (id, kind, modbus, address, r, n) => {
  for (let i = 0; i < n; i += 1) {
    const ch = `${id}/${kind}/${i}`
    const { synced, value } = get(ch) || {};
    if (!synced) {
      writeRegister(modbus, address, r + i * 5, value > 254 ? 254 : value);
      set(ch, { synced: true });
      await delay(50);
    }
  }
}

const loop = (id) => async () => {
  const dev = get(id) || {};
  const { bind, numberGroups = 16, numberLights = 64 } = dev;
  if (bind) {
    const [modbus, , address] = bind.split('/');
    await sync(id, DALI_GROUP, modbus, address, 2000, numberGroups);
    await sync(id, DALI_LIGHT, modbus, address, 3000, numberLights);
  }
  instance.set(id, setTimeout(loop(id), 50));
}

module.exports.run = (a) => {
  const { id, kind, index, value } = a;
  set(`${id}/${kind}/${index}`, { value, synced: false, dimmable: true })
}

module.exports.handle = (data) => {
  // console.log(data);
}


module.exports.clear = () => {
  for (const i of instance.values()) {
    clearTimeout(i);
  }
  instance.clear();
}

module.exports.add = (id) => {
  if (instance.has(id)) {
    clearTimeout(instance.get(id))
  }
  instance.set(id, setTimeout(loop(id), 50));
};
