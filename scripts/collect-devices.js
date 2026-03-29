#!/usr/bin/env node
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URL = process.env.WS_URL || 'ws://192.168.88.4:3000';
const DURATION_MS = parseInt(process.env.DURATION_MS || '600000', 10); // 10 минут
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, '../reports');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const rawFile = path.join(OUT_DIR, `ws-full-snapshot-raw-${ts}.log`);
const reportFile = path.join(OUT_DIR, `devices-report-${ts}.md`);

console.log(`[START] ${new Date().toISOString()} Подключение к ${WS_URL}...`);
console.log(`[CONFIG] Длительность: ${DURATION_MS / 1000}с, выход: ${reportFile}`);

const ws = new WebSocket(WS_URL);
const messages = [];
let startTime = Date.now();

ws.on('open', () => {
  console.log(`[OPEN] Соединение установлено, отправка LIST...`);
  ws.send(JSON.stringify({ type: 'list' }));
  console.log(`[COLLECT] Сбор данных на ${DURATION_MS / 1000} секунд...`);
});

ws.on('message', (data) => {
  const line = data.toString();
  messages.push(line);
  fs.appendFileSync(rawFile, line + '\n');
  
  if (messages.length % 100 === 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[PROGRESS] Собрано ${messages.length} сообщений за ${elapsed.toFixed(1)}с`);
  }
});

ws.on('error', (err) => {
  console.error(`[ERROR] ${err.message}`);
});

ws.on('close', () => {
  console.log(`[CLOSE] Соединение закрыто`);
});

// Таймер завершения
setTimeout(() => {
  console.log(`[STOP] Завершение сбора, собрано ${messages.length} сообщений`);
  ws.close();
  
  // Обработка данных
  console.log(`[PROCESS] Построение отчёта...`);
  const byId = new Map();
  let total = 0;
  
  for (const line of messages) {
    let o;
    try {
      o = JSON.parse(line);
    } catch (e) {
      continue;
    }
    
    if (o.type !== 'ACTION_SET' || !o.id) continue;
    
    total++;
    const prev = byId.get(o.id) || {
      payload: {},
      count: 0,
      first: o.timestamp || Date.now(),
      last: 0
    };
    
    const p = o.payload || {};
    prev.payload = Object.assign(prev.payload, p);
    prev.count++;
    prev.last = Math.max(prev.last, p.timestamp || o.timestamp || Date.now());
    byId.set(o.id, prev);
  }
  
  // Генерация Markdown
  const md = [];
  md.push('## Отчёт по устройствам/каналам (снимок LIST, 10 минут)\n');
  md.push(`Дата: ${new Date().toISOString()}\n`);
  md.push(`Всего сообщений ACTION_SET: ${total}\n`);
  md.push(`Уникальных id: ${byId.size}\n`);
  
  // Сортировка по количеству событий
  const sorted = Array.from(byId.entries()).sort((a, b) => b[1].count - a[1].count);
  
  for (const [id, info] of sorted) {
    const keys = Object.keys(info.payload).sort();
    md.push(`### ${id}`);
    md.push(`- events: ${info.count}`);
    if (info.first || info.last) {
      md.push(`- ts_first: ${info.first}`);
      md.push(`- ts_last: ${info.last}`);
    }
    md.push(`- keys: ${keys.length ? keys.join(', ') : '-'}`);
    md.push('Payload:');
    md.push('```json');
    md.push(JSON.stringify(info.payload, null, 2));
    md.push('```\n');
  }
  
  fs.writeFileSync(reportFile, md.join('\n'));
  console.log(`[DONE] Отчёт сохранён: ${reportFile}`);
  console.log(`[STATS] Уникальных устройств: ${byId.size}, всего событий: ${total}`);
  process.exit(0);
}, DURATION_MS);

