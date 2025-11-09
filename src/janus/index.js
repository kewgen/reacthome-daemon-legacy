
const WebSocket = require('ws');
const uuid = require('uuid').v4;
const peer = require('../websocket/peer');
const { streams } = require('../camera/streams');
const { CREATE, ATTACH, MESSAGE, TRICKLE, CANDIDATE, KEEPALIVE } = require('./constants');

const TIMEOUT_RECONNECT = 10000;
const TIMEOUT_TRANSACTION = 30000;
const TIMEOUT_TRICKLE = 60000;

const callbacks = new Map();
const handlers = new Map();

let socket;

const connect = () => {
  socket = new WebSocket('ws://localhost:8188', 'janus-protocol');
  socket.on('message', (message) => {
    try {
      const action = JSON.parse(message);
      if (action.transaction) {
        if (callbacks.has(action.transaction)) {
          const callback = callbacks.get(action.transaction);
          callback(action);
        }
      } else if (action.janus === TRICKLE) {
        const { session_id, sender: handle_id, candidate } = action;
        const session = handlers.get(handle_id);
        peer.send(session, { type: CANDIDATE, session_id, handle_id, candidate });
      }
    } catch (e) {
      console.error(e);
    }
  });
  socket.on('error', () => {
    console.error('Error. Reconnecting to janus');
  });
  socket.on('close', () => {
    console.log('Disconnect. Reconnecting to janus');
    setTimeout(connect, TIMEOUT_RECONNECT);
  });
  callbacks.clear();
  streams.clear();
};

const send = (action, callback) => {
  if (!socket) return;
  try {
    const transaction = uuid();
    if (callback) {
      callbacks.set(transaction, callback);
      setTimeout(() => {
        // callbacks.delete(transaction)
      }, TIMEOUT_TRANSACTION);
    }
    socket.send(JSON.stringify({ ...action, transaction }));
  } catch (e) {
    console.error(e);
  }
};

module.exports.bind = (handle_id, session) => {
  handlers.set(handle_id, session);
  setTimeout(() => {
    // handlers.delete(handle_id);
  }, TIMEOUT_TRICKLE)
};

module.exports.createSession = (callback) => {
  send({ janus: CREATE }, ({ data }) => {
    callback(data.id);
  });
};

module.exports.attachPlugin = (session_id, plugin, callback) => {
  send({ janus: ATTACH, session_id, plugin }, ({ data }) => {
    callback(data.id);
  });
};

module.exports.send = (session_id, handle_id, body, jsep, callback) => {
  if (callback === undefined) {
    if (jsep instanceof Function) {
      callback = jsep;
      jsep = undefined;
    }
  }
  send({ janus: MESSAGE, session_id, handle_id, body, jsep }, callback);
};

module.exports.trickle = ({ session_id, handle_id, candidate }, callback) => {
  send({ janus: TRICKLE, session_id, handle_id, candidate }, callback);
};

module.exports.keepalive = ({ session_id }) => {
  send({ janus: KEEPALIVE, session_id });
};

module.exports.start = connect;
