// Скрипт для форматирования последних 10 цепочек трассировки
// Зачем: Вывод цепочек событий в соответствии со стандартом TRACE_REPORT_FORMAT.md

const fs = require('fs');
const path = require('path');

const eventsFile = 'temp_trace_events.jsonl';

/**
 * Читает JSONL события.
 * Зачем: поддерживаем два режима — ручной дамп (temp_trace_events.jsonl) и fallback на боевой лог за сегодня.
 */
function readJsonl(filePath, { maxLines = 6000 } = {}) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const slice = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  const out = [];
  for (const line of slice) {
    try { out.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return out;
}

let events = [];
let detectedPid = null;

if (fs.existsSync(eventsFile)) {
  events = readJsonl(eventsFile, { maxLines: 20000 });
} else {
  // Fallback: берём события из logs/logger/events за сегодня.
  // Зачем: репорт нужен "здесь и сейчас", даже если temp_trace_events.jsonl не подготовлен вручную.
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join('logs', 'logger', 'events', `events-${today}.jsonl`);
  const all = readJsonl(logPath, { maxLines: 12000 });

  // Если указан LOGGER_PID, фильтруем по нему; иначе берём наиболее частый pid в хвосте файла.
  const pidFromEnv = process.env.LOGGER_PID ? Number(process.env.LOGGER_PID) : null;
  if (Number.isFinite(pidFromEnv)) {
    detectedPid = pidFromEnv;
    events = all.filter((e) => e && e.logger_pid === pidFromEnv);
  } else {
    // Зачем: после рестартов в файле есть несколько logger_pid, а "актуальный" — тот, что у последних событий.
    let lastPid = null;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const p = all[i] && all[i].logger_pid;
      if (Number.isFinite(p)) { lastPid = p; break; }
    }
    detectedPid = lastPid;
    events = lastPid != null ? all.filter((e) => e && e.logger_pid === lastPid) : all;
  }
}

events = events.filter((e) => e && e.trace_id);

// Группируем по trace_id
const traces = {};
events.forEach(event => {
  if (!traces[event.trace_id]) traces[event.trace_id] = [];
  traces[event.trace_id].push(event);
});

// Форматируем и собираем в отчет
const reportLines = [
  '# Общий отчёт по цепочкам трассировки',
  `Дата генерации: ${new Date().toISOString()}`,
  detectedPid ? `🆔 PID: ${detectedPid}` : '',
  '',
  '---',
  ''
];

// Зачем: выводим последние 10 trace_id по времени старта, иначе отчёт раздувается и становится нечитаемым.
const sortedTraceIds = Object.keys(traces)
  .map((traceId) => {
    const arr = traces[traceId] || [];
    const minTs = arr.length ? Math.min(...arr.map((e) => e.timestamp || 0)) : 0;
    return { traceId, minTs };
  })
    .sort((a, b) => b.minTs - a.minTs)
    .slice(0, 50)
    .map((x) => x.traceId);

sortedTraceIds.forEach(traceId => {
  const traceEvents = (traces[traceId] || []).sort((a, b) => a.timestamp - b.timestamp);
  const startTime = traceEvents[0].timestamp;
  const isoTime = new Date(startTime).toISOString();
  
  const steps = traceEvents.map(event => {
    // Зачем: для цепочек, где конечным шагом является потребитель (например, шторы),
    // используем endDevice.human, иначе в отчёте остаётся только "R1 / group/4" и создаётся впечатление, что потребителя нет.
    const hasConsumerEndDevice = Boolean(event.endDevice && event.endDevice.consumer === true);
    const humanName = hasConsumerEndDevice
      ? (event.endDevice?.human || event.endDevice?.code || event.endDevice?.id || event.id)
      : (event.device?.human || event.device?.code || event.id);
    let actionType = event.param;
    
    // Зачем: Переводим техническое 'value' в понятные 'on'/'off' для актуаторов
    if (event.param === 'value') {
        actionType = (event.new === 1 || event.new === true || (typeof event.new === 'number' && event.new > 0)) ? 'on' : 'off';
    }

    // Улучшение имен для допплера и скриптов
    if (event.extra?.action_type) {
        actionType = event.extra.action_type.replace('ACTION_', '').toLowerCase();
    }

    // Зачем: для допплера показываем выбранный триггер (matched) и тип пересечения порога, чтобы цепочки не вводили в заблуждение.
    const ss = event.extra?.signal_source;
    if (ss?.description && String(ss.description).toLowerCase().includes('doppler')) {
      const crossKind = ss.action?.threshold_cross?.kind;
      const matched = Array.isArray(ss.linked?.matched_trigger_scripts) ? ss.linked.matched_trigger_scripts : [];
      const trig = matched.length ? matched[0].slice(0, 8) : null;
      actionType = `doppler${crossKind ? `_${crossKind}` : ''}${trig ? `:${trig}` : ''}`;
    }
    
    // Зачем: если событие описывает потребителя через endDevice (consumer:true), помечаем шаг как consumer.
    // Это упрощает поиск "штор" в трассах и делает цепочку более читаемой.
    if (hasConsumerEndDevice) {
      actionType = 'consumer';
    }

    const offset = event.timestamp - startTime;
    return `${humanName} / ${actionType} (${offset}ms)`;
  });

  const warningCount = traceEvents.length > 10 ? ' [⚠️ >10 шагов]' : '';
  
  reportLines.push(`${isoTime} ${traceId}${warningCount}`);
  reportLines.push(`> ${steps.join(' → ')}`);
  reportLines.push('');
});

const reportPath = 'reports/traces-common-report-2025-12-25.md';
fs.writeFileSync(reportPath, reportLines.join('\n'));
console.log(`Отчёт сохранён в ${reportPath}`);
