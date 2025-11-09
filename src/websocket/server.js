const { Server } = require("ws");
const uuid = require("uuid").v4;
const { deleteSession } = require("../notification");
const { peers } = require("./peer");
const handle = require("./handle");
const { terminals } = require("../terminal");

const port = 3000;

module.exports = () => {
  const server = new Server({ port });
  server.on("connection", (socket) => {
    const session = uuid();
    socket.on("message", (message) => {
      handle(session, message);
    });
    socket.on("error", console.error);
    peers.set(session, {
      session,
      online: true,
      state: "active",
      timestamp: Date.now(),
      send(message, cb) {
        socket.send(JSON.stringify(message), cb);
      },
    });
  });
};
