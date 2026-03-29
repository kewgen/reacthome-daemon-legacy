#!/usr/bin/env node
// Проверка обновлённых shell команд
const WebSocket = require('ws');
const ws = new WebSocket('ws://192.168.88.4:3000');

const SHELLS = [
  { id: 'f6b66699', desc: 'Спальная ON chocolate' },
  { id: 'e5c6c5b8', desc: 'Спальная ON detskoe' },
  { id: 'ab6f9273', desc: 'Спальная OFF' },
  { id: 'da26ddd3-91ef-457c-a818-7a18b1f5bd26', desc: 'Ванная OFF' },
  { id: 'c96ecc21-adef-4707-a169-635dfe4c30c6', desc: 'Душ OFF' }
];

let checked = 0;

ws.on('open', () => {
  SHELLS.forEach((shell, idx) => {
    setTimeout(() => {
      ws.send(JSON.stringify({type: 'GET', id: idx + 1, id: shell.id}));
    }, idx * 500);
  });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'ACTION_SET' && msg.payload && msg.payload.command) {
    const shell = SHELLS.find(s => s.id === msg.id);
    console.log(`✓ ${shell.desc}:`);
    console.log(`  ${msg.payload.command}\n`);
    checked++;
    if (checked === SHELLS.length) {
      ws.close();
      process.exit(0);
    }
  }
});

setTimeout(() => {
  console.log('Timeout');
  ws.close();
  process.exit(1);
}, 10000);
