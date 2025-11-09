const { get } = require("../actions");
const mac = require("../mac");
const { peers } = require("../websocket/peer");
const service = require("./service");
const { tokens } = require("./token");

// const send = (action, message) => (token) => {
//   if (tokens.has(token)) {
//     const peer = tokens.get(token);
//     if (peer.state === 'active') {
//       peer.send(action, (err) => {
//         if (err) {
//           service.send(token, message(action));
//         }
//       });
//     } else {
//       service.send(token, message(action));
//     }
//   } else {
//     service.send(token, message(action));
//   }
// }

const broadcast = (message) => (action) => {
  const { token = [] } = get(mac()) || {};
  for ([session, peer] of peers.entries()) {
    if (peer.state === "active") {
      peer.send(action, (err) => {
        if (err) {
          if (tokens.has(session)) {
            service.send(tokens.get(session), message(action));
          }
        }
      });
    } else if (tokens.has(session)) {
      service.send(tokens.get(session), message(action));
    }
  }
  for (t of token) {
    if (!tokens.has(t)) {
      service.send(t, message(action));
    }
  }
};

module.exports.broadcastNotification = broadcast(service.notificationMessage);
module.exports.broadcastAction = broadcast(service.dataMessage);
