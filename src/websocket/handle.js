
const { GET, LIST } = require('../init/constants');
const { ACK, BYE, INFO } = require('../sip/constants');
const { START, STOP, WATCH, PAUSE } = require('../camera/constants');
const { run } = require('../controllers/service');
const { onWatch, onStart, onStop, onPause } = require('../camera');
const { TOKEN } = require('../notification/constants');
const { addToken } = require('../notification');
const { broadcast, peers } = require('./peer');
const onGet = require('../init/get');
const onList = require('../init/list');
const onAck = require('../sip/ack');
const onBye = require('../sip/bye');
const onInfo = require('../sip/info');
const { PTY } = require('../terminal/constants');
const onPTY = require('../terminal');
const janus = require('../janus');
const { CANDIDATE, KEEPALIVE } = require('../janus/constants');
const { ACTION_ASSIST, ACTION_SET, POOL, ACTION_ADD, ACTION_MAKE_BIND, ACTION_ADD_BIND, ACTION_ASSET, ACTION_DEL } = require('../constants');
const { handleAssist, initAssistDelayed } = require('../assist');
const { set, add, makeBind, addBind, del } = require('../actions');
const { writeFile, asset } = require('../fs');

module.exports = (session, message) => {
  try {
    const peer = peers.get(session);
    peer.timestamp = Date.now();
    const action = JSON.parse(message);
    switch (action.type) {
      case ACTION_SET: {
        const { id, payload = {} } = action;
        if (payload.title || payload.code) {
          initAssistDelayed()
        }
        if (id !== POOL) {
          set(id, payload);
        }
        break;
      }
      case ACTION_ADD: {
        const { id, ref, value } = action;
        add(id, ref, value);
        break;
      }
      case ACTION_DEL: {
        const { id, ref, value } = action;
        del(id, ref, value);
        break;
      }
      case ACTION_MAKE_BIND: {
        const { id, ref, value, bind } = action;
        makeBind(id, ref, value, bind);
        break;
      }
      case ACTION_ADD_BIND: {
        const { id, ref, value, bind } = action;
        addBind(id, ref, value, bind);
        break;
      }
      case ACTION_ASSET: {
        const { name, payload } = action;
        writeFile(asset(name), Buffer.from(payload, "base64"))
          .then(() => {
            broadcast({ type: LIST, assets: [name] });
          })
          .catch(console.error);
        break;
      }
      case LIST: {
        onList(session);
        break;
      }
      case TOKEN: {
        addToken(action, session);
        break;
      }
      case GET: {
        onGet(action, session);
        break;
      }
      case ACK: {
        if (action.call_id) {
          onAck(action, session);
        } else {
          broadcast(action, session);
        }
        break;
      }
      case BYE: {
        if (action.call_id) {
          onBye(action, session);
        } else {
          broadcast(action, session);
        }
        break;
      }
      case INFO: {
        onInfo(action);
        break;
      }
      case WATCH: {
        onWatch(action, session);
        break;
      }
      case START: {
        onStart(action);
        break;
      }
      case STOP: {
        onStop(action);
        break;
      }
      case PAUSE: {
        onPause(action);
        break;
      }
      case KEEPALIVE: {
        janus.keepalive(action);
        break;
      }
      case CANDIDATE: {
        janus.trickle(action);
        break;
      }
      case PTY: {
        onPTY(action, session);
        break;
      }
      case 'navigate': {
        broadcast(action);
        break;
      }
      case 'state': {
        peer.state = action.value;
        break;
      }
      case ACTION_ASSIST: {
        peer.send(handleAssist(action))
        break;
      }
      default: {
        run(action);
      }
    }
  } catch (e) {
    console.error(e);
  }
};
