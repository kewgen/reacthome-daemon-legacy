const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { writeKnownDaemons } = require('./known-daemons-parser');

// Зачем ? — небольшой backend для UI: даём список демонов, запускаем валидатор и применяем правки live
const PORT = process.env.PORT || 3005;
const LOG_PATH = path.resolve(__dirname, '..', '..', 'logs', 'naming-ui.log');
const KNOWN_DAEMONS_PATH = path.resolve(__dirname, 'known-daemons.json');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, line, 'utf8');
  console.log(...args);
}

// При старте генерируем конфиг демонов из ws-ssh
try {
  writeKnownDaemons(KNOWN_DAEMONS_PATH);
} catch (e) {
  log('Ошибка при генерации known-daemons:', e.message);
}

function isGateAllowed(url) {
  if (process.env.ALLOW_LOCAL_WS_FOR_TESTS === '1') return true;
  return /^wss:\/\//i.test(url) && !/localhost|127\.0\.0\.1|::1/i.test(url);
}

function createApp({ logPath = LOG_PATH, knownDaemonsPath = KNOWN_DAEMONS_PATH } = {}) {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json({ limit: '5mb' }));

  // GET /api/daemons
  app.get('/api/daemons', (req, res) => {
  try {
    if (!fs.existsSync(KNOWN_DAEMONS_PATH)) {
      writeKnownDaemons(knownDaemonsPath);
    }
      const raw = fs.readFileSync(knownDaemonsPath, 'utf8');
      const arr = JSON.parse(raw || '[]');
      res.json({ ok: true, daemons: arr });
  } catch (e) {
      log('GET /api/daemons error', e.message);
      res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/validate', async (req, res) => {
  const { daemonId, gateUrl } = req.body;
  if (!daemonId) return res.status(400).json({ ok: false, error: 'daemonId required' });
  const gate = gateUrl || process.env.GATE_URL || 'wss://gate.reacthome.net';
  log('validate start', daemonId, gate);
    // Безопасность: разрешён только внешний wss:// gate (не localhost, не ws://)
    if (!isGateAllowed(gate)) {
      log('validate rejected invalid gate', gate);
      return res.status(400).json({ ok: false, error: 'Gate URL must be wss:// external host (no localhost allowed)' });
    }
  try {
    // Запускаем валидатор скриптом и собираем stdout
    const args = [path.resolve(__dirname, '..', '..', 'scripts', 'validate-consumer-naming.js'), '--daemon', daemonId, '--gate', gate, '--json'];
    const node = spawn(process.execPath, args, { cwd: path.resolve(__dirname, '..', '..') });
    let out = '';
    let err = '';
    node.stdout.on('data', (b) => { out += b.toString(); });
    node.stderr.on('data', (b) => { err += b.toString(); });
    node.on('close', (code) => {
      if (code !== 0 && !out) {
        log('validator failed', daemonId, code, err.slice(0, 400));
        return res.status(500).json({ ok: false, error: err || `exit ${code}` });
      }
      try {
        const json = JSON.parse(out);
        res.json({ ok: true, result: json });
      } catch (e) {
        log('validator parse error', e.message);
        res.status(500).json({ ok: false, error: 'Invalid JSON from validator', raw: out.slice(0, 2000) });
      }
    });
  } catch (e) {
    log('validate exception', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

  app.post('/api/apply', async (req, res) => {
  const { daemonId, gateUrl, id, newCode, newTitle } = req.body;
  if (!daemonId || !id) return res.status(400).json({ ok: false, error: 'daemonId and id required' });
  const gate = (gateUrl || process.env.GATE_URL || 'wss://gate.reacthome.net').replace(/\/$/, '');
    // Безопасность: разрешён только внешний wss:// gate (не localhost, не ws://)
    if (!isGateAllowed(gate)) {
      log('apply rejected invalid gate', gate);
      return res.status(400).json({ ok: false, error: 'Gate URL must be wss:// external host (no localhost allowed)' });
    }
  const wsUrl = `${gate}/${daemonId}`;
  log('apply start', id, '->', newCode, newTitle, 'to', daemonId);
  try {
      const ws = new WebSocket(wsUrl, 'listen');
    const done = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout connect')), 10000);
      ws.once('open', () => {
        clearTimeout(t);
        const msg = {
            type: 'ACTION_SET', // используем верхний регистр, как в бою
          id,
            payload: { timestamp: Date.now() }
        };
        if (newCode !== undefined) msg.payload.code = newCode;
        if (newTitle !== undefined) msg.payload.title = newTitle;
        try {
            ws.send(JSON.stringify(msg), (err) => {
              if (err) return reject(err);
              // Ждём подтверждение закрытием сокета или таймаут
              const closeTimer = setTimeout(() => {
                try { ws.terminate(); } catch (_) {}
                resolve({ ok: true, note: 'sent_no_close' });
              }, 400);
              ws.once('close', () => { clearTimeout(closeTimer); resolve({ ok: true }); });
            });
        } catch (e) {
          reject(e);
        }
      });
      ws.once('error', (e) => reject(e));
      ws.once('close', () => {});
    });
    const r = await done;
    log('apply result', id, r.ok ? 'ok' : 'fail');
    res.json({ ok: true, status: 'sent' });
  } catch (e) {
    log('apply error', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

  // Зачем: GET валидация устройства после apply для проверки реального состояния
  app.post('/api/verify', async (req, res) => {
    const { daemonId, gateUrl, id } = req.body;
    if (!daemonId || !id) return res.status(400).json({ ok: false, error: 'daemonId and id required' });
    const gate = (gateUrl || process.env.GATE_URL || 'wss://gate.reacthome.net').replace(/\/$/, '');
    if (!isGateAllowed(gate)) {
      return res.status(400).json({ ok: false, error: 'Gate URL must be wss:// external host' });
    }
    const wsUrl = `${gate}/${daemonId}`;
    log('verify start', id, 'to', daemonId);
    try {
      const ws = new WebSocket(wsUrl, 'listen');
      const done = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout connect')), 10000);
        ws.once('open', () => {
          clearTimeout(t);
          ws.send(JSON.stringify({ type: 'get', state: [id] }));
        });
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ACTION_SET' && msg.id === id && msg.payload) {
            ws.close();
            const code = msg.payload.code || '';
            const title = msg.payload.title || '';
            log('verify result', id, `code="${code}"`, `title="${title}"`);
            resolve(msg.payload);
          }
        });
        ws.once('error', (e) => reject(e));
        setTimeout(() => {
          ws.close();
          reject(new Error('timeout waiting for state'));
        }, 8000);
      });
      const payload = await done;
      res.json({ ok: true, payload });
    } catch (e) {
      log('verify error', id, e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Статика клиента (после API роутов, чтобы API имели приоритет)
  app.use('/', express.static(path.resolve(__dirname, 'client')));

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    log('naming-ui server started on', PORT);
    console.log(`Naming UI available: http://localhost:${PORT}/`);
  });
}

module.exports = { createApp, log, writeKnownDaemons };


