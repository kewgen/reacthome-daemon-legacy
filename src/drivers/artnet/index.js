
const { Worker } = require('worker_threads');
const { get, set, count_on, count_off } = require('../../actions');
const service = require('../../controllers/service');
const { ARTNET, ACTION_SCRIPT_RUN, ARTNET_TYPE_DIMMER } = require('../../constants');

module.exports = class {

  constructor(id) {
    this.id = id;
    this.start();
  }

  channel(index) {
    return `${this.id}/${ARTNET}/${1 + index}`;
  }

  start() {
    const workerData = { ...get(this.id), state: [], type: [], velocity: [] };
    for (let i = 0; i < workerData.size; i++) {
      const { value = 0, type = 0, velocity = 0 } = get(this.channel(i)) || {};
      workerData.type[i] = type;
      workerData.state[i] = value;
      workerData.velocity[i] = velocity;
    }
    this.worker = new Worker('./src/drivers/artnet/worker.js', { workerData });
    this.worker.on('message', ({ index, ...payload }) => {
      const channel = this.channel(index);
      const { bind, onOn, onOff, value } = get(channel) || {};
      const v = value ? 1 : 0;
      const v_ = payload.value ? 1 : 0;
      if (payload.type) {
        payload.dimmable = payload.type === ARTNET_TYPE_DIMMER;
      }
      set(channel, payload);
      if (v_) {
        count_on(bind);
      } else {
        count_off(bind);
      }
      if (v !== v_) {
        const script = v_ === 0 ? onOff : onOn;
        if (script) {
          service.run({ type: ACTION_SCRIPT_RUN, id: script });
        }
      }
    });
  }

  stop() {
    this.worker.terminate();
  }

  run(action) {
    action.index = action.index - 1;
    this.worker.postMessage(action);
  }

  handle() { }

}
