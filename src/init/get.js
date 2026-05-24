const { get } = require('../actions');
const { send, peers } = require('../websocket/peer');
const { ACTION_SET, ACTION_ASSET } = require('../constants');
const { asset, exists, readFile } = require('../fs');

module.exports = async ({ state = [], assets = [] }, session) => {
  // Отдаём состояние порциями по 100 сообщений с короткой паузой между ними.
  //
  // Если этого не делать, за один проход в сокет улетают тысячи ACTION_SET.
  // Когда клиент медленный или их несколько одновременно (типично сразу
  // после рестарта демона — все клиенты переподключаются разом), внутренняя
  // очередь сокета пухнет. Если такое соединение обрывается до того, как
  // клиент дочитал — все накопленные сообщения теряются.
  //
  // Клиент при этом получит меньше ACTION_SET, чем было ID в его LIST,
  // и НЕ УЗНАЕТ об этом: его state молча станет огрызком. Дальше он будет
  // работать с этим огрызком до следующего реконнекта (часы → сутки).
  //
  // Пауза между порциями: даём клиенту время прочитать, а очереди сдренить.
  // Если очередь всё равно растёт выше 1 МБ — ждём, пока опустеет, чтобы
  // не копить в памяти и не повторять ту же ловушку.
  const peer = peers.get(session);
  for (let i = 0; i < state.length; i++) {
    send(session, { type: ACTION_SET, id: state[i], payload: get(state[i]) });
    if ((i + 1) % 100 === 0) {
      await new Promise((r) => setImmediate(r));
      while (peer && peer.bufferedAmount > 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  }
  for await (const name of assets) {
    try {
      if (typeof name !== 'string') continue;
      const file = asset(name);
      if (await exists(file)) {
        const data = await readFile(file);
        const payload = data.toString('base64');
        send(session, { type: ACTION_ASSET, name, payload });
      }
    } catch (e) {
      console.error(e);
    }
  }
};
