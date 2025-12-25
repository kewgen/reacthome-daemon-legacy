const fs = require('fs');
const PATH_CHAINS = 'reports/tmp-uw1/pid_19925_source_chains.json';
const PATH_HANDLES = 'reports/tmp-uw1/doppler_handles_enriched.json';
const OUT_MD = 'reports/pid-19925-doppler-debug-traces-2025-12-24.md';

function loadJson(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const chains = loadJson(PATH_CHAINS) || [];
const handles = loadJson(PATH_HANDLES) || [];
const handleBySensor = new Map();
for (const h of handles) {
  if (h.sensorId) handleBySensor.set(h.sensorId, h);
}

function formatChain(tid, events) {
  const first = events[0];
  const start = first.timestamp;
  const isoStart = new Date(start).toISOString();
  let header = `${isoStart} ${tid}`;
  if (events.length > 10) header += ' [⚠️ >10 шагов]';
  const hasConsumer = events.some(e => (e.device && e.device.consumer === true) || (e.endDevice && e.endDevice.consumer === true));
  if (!hasConsumer) header += ' [⚠️ не полная]';

  // If source is doppler (sensor id like mac), attach threshold info
  const src = first.extra && first.extra.signal_source;
  let prefix = '';
  if (src && src.description && src.description.toLowerCase().includes('doppler')) {
    const sensorId = src.device && src.device.id;
    const handle = handleBySensor.get(sensorId);
    if (handle) {
      const low = handle.low || 'unknown';
      const high = handle.high || 'unknown';
      const val = src.action && src.action.value !== undefined ? src.action.value : 'unknown';
      const cross = src.action && src.action.threshold_cross ? src.action.threshold_cross : null;
      const crossKind = cross && cross.kind ? cross.kind : 'unknown';
      const prev = cross && cross.prev !== undefined ? cross.prev : 'unknown';
      const next = cross && cross.next !== undefined ? cross.next : 'unknown';
      prefix = ` (threshold low=${low} high=${high} old=${prev} new=${next} cross=${crossKind} value=${val})`;
    } else {
      const val = src.action && src.action.value !== undefined ? src.action.value : 'unknown';
      prefix = ` (value=${val})`;
    }
  }

  const chain = events.map(e => {
    const offset = e.timestamp - start;
    let action = 'unknown';
    const isConsumer = (e.device && e.device.consumer === true) || (e.endDevice && e.endDevice.consumer === true);
    const ss = e.extra && e.extra.signal_source;
    if (isConsumer) action = 'consumer';
    else if (e.param === 'executed' || e.kind === 'script') action = 'script';
    else if (ss && ss.kind === 'manual') action = ss.action && ss.action.click_kind ? ss.action.click_kind : 'press';
    else if (ss && ss.description && ss.description.toLowerCase().includes('doppler')) {
      // Зачем: показываем "сработавший" триггер (matched) отдельно от списка привязок (candidates).
      const matched = Array.isArray(ss.linked && ss.linked.matched_trigger_scripts) ? ss.linked.matched_trigger_scripts : [];
      action = `doppler${prefix}${matched.length ? ` trigger=${matched[0].slice(0,8)}...` : ''}`;
    }
    else action = e.param || 'sensor';

    const name = (e.device && (e.device.title || e.device.human)) || e.id || '';
    const safeName = String(name).replace(/[*_]/g, '');
    return `${safeName} / ${action}(${offset}ms)`;
  }).join(' → ');

  return `${header}\n> ${chain}\n`;
}

let md = `# PID 19925 — допплеры (debug threshold/value)\\n\\n`;
md += `Дата: ${new Date().toLocaleString('ru-RU')}\\n\\n`;

chains.sort((a,b) => (a.events && a.events[0] && a.events[0].timestamp || 0) - (b.events && b.events[0] && b.events[0].timestamp || 0));
// filter out chains shorter than 2 events
const filtered = chains.filter(c => Array.isArray(c.events) && c.events.length >= 2);
for (const c of filtered) {
  md += formatChain(c.tid, c.events) + '\\n';
}

fs.writeFileSync(OUT_MD, md);
console.log('Wrote', OUT_MD, 'with', filtered.length, 'chains (doppler debug, length>=2)'); 


