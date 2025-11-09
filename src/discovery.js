
const { createSocket } = require("dgram");
const { get } = require("./actions");

const DISCOVERY = "discovery";
const CLIENT_GROUP = "224.0.0.2";
const CLIENT_PORT = 2021;

module.exports.start = (id) => {
  const socket = createSocket({ type: "udp4", reuseAddr: true, reusePort: true });
  socket.on("error", console.error);
  // socket.bind(() => {
  //   socket.setMulticastInterface("172.16.0.1")
  setInterval(() => {
    const discoveryMessage = JSON.stringify({
      id,
      type: DISCOVERY,
      payload: get(id),
    })
    socket.send(discoveryMessage, CLIENT_PORT, CLIENT_GROUP);
  }, 10_000)

  // })
};
