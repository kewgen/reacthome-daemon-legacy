#!/usr/bin/env node

/**
 * Поиск объектов, которые ссылаются на заданный UUID
 *
 * Использование:
 *   node scripts/ws-find-uuid-references.js <UUID>
 *
 * Зачем: Универсальный поиск ссылок на любой объект (скрипт, action, устройство и т.д.)
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
try {
  const envFile = path.join(PROJECT_DIR, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        const [k, ...v] = t.split('=');
        if (k) process.env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    });
  }
} catch (e) {}

const PI_HOST = process.env.REACTHOME_PI_HOST || '192.168.88.4';
const PI_WS_PORT = process.env.REACTHOME_PI_WS_PORT || '3000';
const WS_URI = process.env.REACTHOME_WS_URI || `ws://${PI_HOST}:${PI_WS_PORT}`;
const TARGET_ID = process.argv[2];

if (!TARGET_ID) {
  console.error('Использование: node scripts/ws-find-uuid-references.js <UUID>');
  process.exit(1);
}

function findAllUUIDs(obj, found = new Set(), depth = 0) {
  if (depth > 10) return found;
  if (obj == null) return found;
  if (typeof obj === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) found.add(obj);
    return found;
  }
  if (Array.isArray(obj)) { obj.forEach(i => findAllUUIDs(i, found, depth + 1)); return found; }
  if (typeof obj === 'object') { Object.values(obj).forEach(v => findAllUUIDs(v, found, depth + 1)); return found; }
  return found;
}

const ws = new WebSocket(WS_URI);
const allObjects = new Map();
const timeout = setTimeout(() => { ws.close(); process.exit(1); }, 25000);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'list' }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'get', state: Array.from(allObjects.keys()) }));
    setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      const target = allObjects.get(TARGET_ID);
      const refs = [];
      allObjects.forEach((obj, id) => {
        if (id === TARGET_ID) return;
        if (findAllUUIDs(obj.payload || obj).has(TARGET_ID)) {
          refs.push({ id, type: obj.type || 'unknown', payload: obj.payload });
        }
      });
      console.log(`\nОбъект: ${TARGET_ID}`);
      if (target) {
        console.log(`Тип: ${target.type || '?'}`);
        console.log(`Title: ${target.payload?.title || target.payload?.code || '—'}`);
      }
      console.log(`\nКто использует (${refs.length}):\n`);
      refs.forEach((r, i) => {
        const name = r.payload?.title || r.payload?.code || r.payload?.command || r.id?.slice(0, 8) + '...';
        console.log(`${i + 1}. [${r.type}] ${name} (${r.id})`);
      });
      process.exit(0);
    }, 8000);
  }, 2000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'list' && msg.state) msg.state.forEach(([id]) => allObjects.set(id, { id }));
    if (msg.type === 'ACTION_SET' && msg.payload) {
      const o = allObjects.get(msg.id) || { id: msg.id };
      o.type = msg.payload.type;
      o.payload = msg.payload;
      allObjects.set(msg.id, o);
    }
  } catch (e) {}
});

ws.on('error', (e) => { clearTimeout(timeout); console.error(e.message); process.exit(1); });
