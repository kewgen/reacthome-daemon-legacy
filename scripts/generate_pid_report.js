const fs = require('fs');
const pid = 3896;
const data = JSON.parse(fs.readFileSync('reports/tmp-uw1/pid_3896_source_chains.json', 'utf8'));
const interesting = data.filter(c => c.events.some(e => e.consumer) || c.length > 1);

let md = `# Отчёт по цепочкам трассировки (PID ${pid})\n\n`;
md += `Дата: ${new Date().toLocaleString('ru-RU')}\n\n`;

md += `## 1) Общая статистика\n\n`;
md += `- Всего цепочек с источниками: ${data.length}\n`;
md += `- Из них технических (heartbeat, 1 событие): ${data.length - interesting.length}\n`;
md += `- Из них активных (логика/исполнители): ${interesting.length}\n\n`;

md += `## 2) Активные цепочки\n\n`;

interesting.forEach((c, idx) => {
  md += `### Цепочка ${idx + 1}: ${c.source.device?.human || c.source.device?.id}\n`;
  md += `- **Trace ID:** \`${c.tid}\`\n`;
  md += `- **Источник:** ${c.source.description} (value: ${c.source.action.value})\n`;
  // Зачем: trigger_scripts — это привязки/кандидаты, а matched_trigger_scripts — фактически сработавшие (для допплера по old→new).
  const matched = Array.isArray(c.source.linked?.matched_trigger_scripts) ? c.source.linked.matched_trigger_scripts : [];
  const candidates = c.source.linked?.trigger_scripts?.onClick || [];
  md += `- **Сработавший триггер:** ${matched.length ? matched.join(', ') : 'не определён'}\n`;
  md += `- **Кандидаты (привязки):** ${Array.isArray(candidates) && candidates.length ? candidates.join(', ') : 'нет'}\n\n`;

  md += `| Время | Устройство | Параметр | Значение | Тип |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  c.events.forEach(e => {
    const time = new Date(e.ts).toLocaleTimeString('ru-RU');
    const typeLabel = e.consumer ? '**CONSUMER**' : (e.kind === 'script' || e.param === 'executed' ? '*SCRIPT*' : 'sensor');
    md += `| ${time} | ${e.title} | ${e.param} | ${e.val} | ${typeLabel} |\n`;
  });

  md += `\n---\n\n`;
});

fs.writeFileSync('reports/pid-3896-source-chains-2025-12-24.md', md);
console.log('Report generated: reports/pid-3896-source-chains-2025-12-24.md');

