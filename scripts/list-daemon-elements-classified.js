#!/usr/bin/env node

/**
 * Получение всех элементов демона и классификация по типу с количественными характеристиками
 *
 * Использование:
 *   node scripts/list-daemon-elements-classified.js
 *   REACTHOME_WS_URI="wss://gate.reacthome.net/fd6765f1-..." node scripts/list-daemon-elements-classified.js
 *   node scripts/list-daemon-elements-classified.js --json reports/daemon-elements.json
 *
 * Зачем: Получает все объекты state через WebSocket, классифицирует по payload.type и выводит сводку с количественными показателями
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
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Зачем: Типы устройств для подразбивки device (из list-physical-devices-ws.js)
const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x22, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0];
const SHIELD_CONTROL_TYPES = [0x25];
const ENDPOINT_DEVICE_TYPES = [0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b];

// Зачем: Строковые типы потребителей (thermostat, light_220 и т.д.)
const CONSUMER_TYPES = ['thermostat', 'light_220', 'light_led', 'light_rgb', 'fan', 'socket_220', 'valve_water', 'valve_heating', 'warm_floor', 'boiler', 'pump', 'ac', 'curtains', 'reed', 'button'];

function classifyDeviceType(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'device_actuator';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'device_sensor';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'device_panel';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'device_endpoint';
  return 'device_other';
}

function classify(payload, id) {
  const t = payload?.type;
  if (id.includes('/')) return 'channel';
  const ts = (t || '').toString();
  const tLower = ts.toLowerCase();
  if (t === 'daemon' || tLower === 'project') return 'infrastructure';
  if (tLower === 'site') return 'site';
  if (tLower === 'script') return 'script';
  if (tLower === 'shell') return 'shell';
  if (['timer', 'clock', 'schedule'].includes(tLower)) return 'timer';
  if (tLower === 'scene') return 'scene';
  if (tLower === 'driver') return 'driver';
  if (ts.startsWith('ACTION_')) return 'action';
  if (typeof t === 'number') return classifyDeviceType(t);
  if (CONSUMER_TYPES.includes(tLower)) return 'consumer';
  if (t) return 'other';
  return 'unknown';
}

async function listDaemonElementsClassified() {
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] || `reports/daemon-elements-${new Date().toISOString().slice(0, 10)}.json` : null;

  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  const allIds = [];
  const objects = new Map();

  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    ws.close();
    process.exit(1);
  }, 60000);

  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    console.log('[STEP] Запрашиваем список всех объектов...');
    ws.send(JSON.stringify({ type: 'list' }));

    setTimeout(() => {
      const channelIds = allIds.filter(id => id.includes('/'));
      const mainIds = allIds.filter(id => !id.includes('/'));

      if (mainIds.length === 0) {
        console.log('[WARNING] Объекты не найдены в LIST ответе');
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }

      console.log(`[STEP] Запрашиваем данные ${mainIds.length} объектов...`);
      const BATCH_SIZE = 100;
      for (let i = 0; i < mainIds.length; i += BATCH_SIZE) {
        const batch = mainIds.slice(i, i + BATCH_SIZE);
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'get', state: batch }));
        }, (i / BATCH_SIZE) * 500);
      }

      setTimeout(() => {
        clearTimeout(timeout);
        processResults(allIds, channelIds.length, objects, jsonOut);
        ws.close();
        process.exit(0);
      }, 5000 + Math.ceil(mainIds.length / BATCH_SIZE) * 1000);
    }, 2000);
  });

  ws.on('message', (data) => {
    try {
      let dataStr = data.toString();
      if (isGateway && dataStr.length >= 36) {
        const prefix = dataStr.substring(0, 36);
        if (uuidRegex.test(prefix)) {
          dataStr = dataStr.substring(36);
        }
      }

      const message = JSON.parse(dataStr);

      if (message.type === 'list' && message.state) {
        message.state.forEach(([id]) => allIds.push(id));
      }

      if (message.type === 'ACTION_SET' && message.id && message.payload) {
        const prev = objects.get(message.id) || { id: message.id, payload: {} };
        prev.payload = Object.assign(prev.payload, message.payload);
        objects.set(message.id, prev);
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
  });

  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });

  function processResults(allIds, channelCount, objects, jsonOutPath) {
    const total = allIds.length;
    const uuidCount = total - channelCount;

    const byCategory = {};
    const categoryLabels = {
      channel: 'Каналы',
      infrastructure: 'Инфраструктура',
      site: 'Помещения',
      script: 'Скрипты',
      shell: 'Shell',
      timer: 'Таймеры',
      scene: 'Сцены',
      driver: 'Драйверы',
      action: 'Action',
      device_actuator: 'Устройства (актуаторы)',
      device_sensor: 'Устройства (сенсоры)',
      device_panel: 'Устройства (панели)',
      device_endpoint: 'Устройства (конечные)',
      device_other: 'Устройства (другое)',
      consumer: 'Потребители',
      other: 'Другое',
      unknown: 'Без типа'
    };

    for (const cat of Object.keys(categoryLabels)) {
      byCategory[cat] = { count: 0, percent: 0, ids: [] };
    }

    for (const id of allIds) {
      if (id.includes('/')) {
        byCategory.channel.count++;
        if (byCategory.channel.ids.length < 5) byCategory.channel.ids.push(id);
      } else {
        const obj = objects.get(id);
        const payload = obj?.payload || {};
        const cat = classify(payload, id);
        if (!byCategory[cat]) byCategory[cat] = { count: 0, percent: 0, ids: [] };
        byCategory[cat].count++;
        if (byCategory[cat].ids.length < 5) byCategory[cat].ids.push(id);
      }
    }

    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].percent = total > 0 ? ((byCategory[cat].count / total) * 100).toFixed(1) : '0';
    }

    // Зачем: Дополнительные количественные показатели для script
    let scriptWithActions = 0;
    let scriptDisabled = 0;
    for (const [objId, obj] of objects) {
      const p = obj.payload || {};
      if ((p.type || '').toString().toLowerCase() === 'script') {
        if (Array.isArray(p.action) && p.action.length > 0) scriptWithActions++;
        if (p.disabled === true || (typeof p.disabled === 'object' && p.disabled !== null)) scriptDisabled++;
      }
    }

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║ КЛАССИФИКАЦИЯ ЭЛЕМЕНТОВ ДЕМОНА                                 ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    console.log('Количественные показатели:');
    console.log(`  Всего объектов: ${total}`);
    console.log(`  UUID-объекты:   ${uuidCount}`);
    console.log(`  Каналы:         ${channelCount}\n`);

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('Сводная таблица по категориям');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    const sortedCats = Object.keys(byCategory).filter(c => byCategory[c].count > 0).sort((a, b) => byCategory[b].count - byCategory[a].count);

    console.log('| Категория            | Кол-во | % от общего | Примеры ID');
    console.log('|----------------------|--------|-------------|------------');

    for (const cat of sortedCats) {
      const d = byCategory[cat];
      const label = categoryLabels[cat] || cat;
      const examples = d.ids.slice(0, 3).map(id => id.length > 20 ? id.slice(0, 17) + '...' : id).join(', ') || '—';
      console.log(`| ${label.padEnd(20)} | ${String(d.count).padStart(6)} | ${String(d.percent + '%').padStart(10)} | ${examples}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('Дополнительно: Script');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log(`  С действиями (action.length > 0): ${scriptWithActions}`);
    console.log(`  Отключённых (disabled):          ${scriptDisabled}\n`);

    const deviceCats = ['device_actuator', 'device_sensor', 'device_panel', 'device_endpoint', 'device_other'];
    const deviceTotal = deviceCats.reduce((s, c) => s + (byCategory[c]?.count || 0), 0);
    if (deviceTotal > 0) {
      console.log('═══════════════════════════════════════════════════════════════════');
      console.log('Дополнительно: Устройства (подразбивка)');
      console.log('═══════════════════════════════════════════════════════════════════\n');
      for (const c of deviceCats) {
        if (byCategory[c]?.count > 0) {
          console.log(`  ${categoryLabels[c]}: ${byCategory[c].count}`);
        }
      }
      console.log('');
    }

    const summaryParts = sortedCats.map(c => `${categoryLabels[c] || c}: ${byCategory[c].count} (${byCategory[c].percent}%)`);
    console.log('Итоговая сводка:');
    console.log(`  Всего: ${total} | UUID: ${uuidCount} | Каналы: ${channelCount}`);
    console.log(`  ${summaryParts.join(' | ')}\n`);

    if (jsonOutPath) {
      const reportDir = path.dirname(jsonOutPath);
      if (reportDir && !fs.existsSync(path.join(PROJECT_DIR, reportDir))) {
        fs.mkdirSync(path.join(PROJECT_DIR, reportDir), { recursive: true });
      }
      const outPath = path.isAbsolute(jsonOutPath) ? jsonOutPath : path.join(PROJECT_DIR, jsonOutPath);
      const report = {
        total,
        uuidCount,
        channelCount,
        byCategory: {},
        script: { withActions: scriptWithActions, disabled: scriptDisabled }
      };
      for (const c of Object.keys(byCategory)) {
        report.byCategory[c] = {
          label: categoryLabels[c] || c,
          count: byCategory[c].count,
          percent: byCategory[c].percent,
          ids: byCategory[c].ids
        };
      }
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`JSON отчёт сохранён: ${outPath}\n`);
    }
  }
}

listDaemonElementsClassified().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
