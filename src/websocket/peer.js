
const peers = new Map();

module.exports.peers = peers;

module.exports.send = (session, message) => {
  if (peers.has(session)) {
    peers.get(session).send(message);
  }
};

module.exports.broadcast = (message, ignore) => {
  for (const [session, peer] of peers.entries()) {
    if (session !== ignore) {
      peer.send(message);
    }
  }
};
