const { Server } = require("ws");
const uuid = require("uuid").v4;
const { deleteSession } = require("../notification");
const { peers } = require("./peer");
const handle = require("./handle");
const { terminals } = require("../terminal");

const port = 3000;

module.exports = () => {
  const server = new Server({ port });
  server.on('listening', () => console.log('[WS] listening on', port));
  server.on('error', (e) => console.error('[WS] error:', e.message || e));
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
      // Нужно, чтобы onGet (init/get.js) мог приостанавливать отдачу, когда
      // клиент не успевает читать. Без этого внутренняя очередь сокета пухнет;
      // если соединение оборвётся с непрочитанными сообщениями, они теряются
      // молча — клиент получает неполный снимок состояния и не может узнать
      // об этом.
      get bufferedAmount() { return socket.bufferedAmount; },
    });
  });
};
