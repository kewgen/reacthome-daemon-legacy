let instances = {};


module.exports.get = (id) => instances[id];

module.exports.add = (id, instance) => instances[id] = instance;

module.exports.clear = () => {
    for (const instance of Object.values(instances)) {
        if (instance.stop) instance.stop();
    }
    instances = {};
}
