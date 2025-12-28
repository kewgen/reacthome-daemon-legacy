// Зачем ? — лёгкий клиент без сборки: делает validate и apply через API
async function el(id){return document.getElementById(id);}
async function fetchJson(url, opts){ 
  const r = await fetch(url, opts);
  const json = await r.json();
  if (!r.ok && !json.ok) {
    json.ok = false;
    json.error = json.error || `HTTP ${r.status}: ${r.statusText}`;
  }
  return json;
}

// Система всплывающих уведомлений
function showToast(type, title, message, duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <div class="toast-close" onclick="this.parentElement.remove()">×</div>
  `;
  
  container.appendChild(toast);
  
  // Автоматическое скрытие
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  
  return toast;
}

// Показ компактного попапа с мета-параметрами устройства
function showDevicePopup(device, event) {
  // Удаляем существующий попап если есть
  const existing = document.getElementById('device-popup');
  if (existing) existing.remove();

  // Определяем порядок и важность параметров (только самые важные для компактности)
  const paramOrder = [
    { key: 'code', label: 'Code', class: 'code important', priority: 1 },
    { key: 'title', label: 'Title', class: 'important', priority: 2 },
    { key: 'expectedCode', label: 'Предлагаемый', class: 'code important', priority: 3 },
    { key: 'type', label: 'Тип', class: '', priority: 4 },
    { key: 'bind', label: 'Bind', class: 'code', priority: 5 },
    { key: 'room', label: 'Room', class: '', priority: 6 },
    { key: 'roomName', label: 'Помещение', class: 'important', priority: 7 },
    { key: 'act', label: 'ACT', class: '', priority: 8 },
    { key: 'kind', label: 'KIND', class: '', priority: 9 },
    { key: 'ch', label: 'CH', class: '', priority: 10 },
  ];

  // Фильтруем и сортируем параметры
  const params = paramOrder
    .filter(p => device[p.key] !== null && device[p.key] !== undefined && device[p.key] !== '')
    .sort((a, b) => a.priority - b.priority)
    .map(p => ({
      ...p,
      value: device[p.key],
      displayValue: typeof device[p.key] === 'boolean' ? (device[p.key] ? 'Да' : 'Нет') : String(device[p.key])
    }));

  // Создаём компактный попап
  const popup = document.createElement('div');
  popup.className = 'device-popup';
  popup.id = 'device-popup';

  popup.innerHTML = `
    <div class="popup-content">
      ${params.map(p => `
        <div class="meta-param">
          <div class="meta-param-label">${p.label}:</div>
          <div class="meta-param-value ${p.class}">${escapeHtml(p.displayValue)}</div>
        </div>
      `).join('')}
    </div>
  `;

  // Позиционируем попап рядом с курсором
  const x = event.clientX + 15;
  const y = event.clientY + 15;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;

  // Проверяем, не выходит ли попап за границы экрана
  document.body.appendChild(popup);
  const rect = popup.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    popup.style.left = `${event.clientX - rect.width - 15}px`;
  }
  if (rect.bottom > window.innerHeight) {
    popup.style.top = `${event.clientY - rect.height - 15}px`;
  }

  // Обработчики для попапа, чтобы он не исчезал при наведении на него
  popup.onmouseenter = () => clearTimeout(window.popupHideTimeout);
  popup.onmouseleave = () => {
    window.popupHideTimeout = setTimeout(() => hideDevicePopup(), 100);
  };

  document.body.appendChild(popup);
}

function hideDevicePopup() {
  const popup = document.getElementById('device-popup');
  if (popup) popup.remove();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

(async function init(){
  const daemonSel = await el('daemon');
  const gateEl = await el('gate');
  const validateBtn = await el('validate');
  const summary = await el('summary');
  const tbl = await el('tbl');
  const rowsEl = await el('rows');

  async function loadDaemons(){
    const res = await fetchJson('/api/daemons');
    if (!res.ok) { summary.textContent = 'Не удалось получить список демонов'; return; }
    daemonSel.innerHTML = '';
    res.daemons.forEach(d => {
      const o = document.createElement('option'); o.value = d.id; o.textContent = d.name || d.id; daemonSel.appendChild(o);
    });
  }
  await loadDaemons();

  validateBtn.addEventListener('click', async () => {
    const daemonId = daemonSel.value;
    const gate = gateEl.value;
    if (!daemonId) { summary.textContent = 'Выберите daemon'; return; }
    summary.textContent = 'Запрос валидации...';
    const res = await fetchJson('/api/validate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ daemonId, gateUrl: gate }) });
    if (!res.ok) { summary.textContent = 'Ошибка: ' + (res.error || 'unknown'); return; }
    const data = res.result;
    summary.textContent = `Найдено ${data.total || 0} потребителей — 🟢 ${data.stats.green} 🟡 ${data.stats.yellow} 🔴 ${data.stats.red}`;
    rowsEl.innerHTML = '';
    function normalizeText(v){ return String(v || '').replace(/\s+/g,' ').trim(); }

    function stripTitleClassification(title){
      // Зачем: Title(предлагаемое) заполняем текущим title без кода классификации в начале строки.
      const t = normalizeText(title);
      if (!t) return '';
      // Канон/легаси (пример: 3.D.LED.10, 5.R.C12, 1.LE.1, 1.BRA.1, 1.R2.C.2)
      const re = new RegExp(
        '^\\s*' +
        '(?:' +
          // ROOM.ACT.KIND.CH (ACT 1..2 символа, KIND 1..12)
          '\\\\d{1,3}\\\\.[A-Za-z]{1,2}\\\\.[A-Za-zА-Яа-я0-9]{1,12}\\\\.\\\\d{1,3}' + '|' +
          // ROOM.ACT.KINDCH (легаси слитый CH)
          '\\\\d{1,3}\\\\.[A-Za-z]{1,2}\\\\.[A-Za-zА-Яа-я0-9]{1,12}\\\\d{1,3}' + '|' +
          // ROOM.KIND.CH (сенсоры/легаси)
          '\\\\d{1,3}\\\\.[A-Za-zА-Яа-я0-9]{1,12}\\\\.\\\\d{1,3}' +
        ')' +
        '\\\\s*',
        'i'
      );
      const stripped = t.replace(re, '').trim();
      return stripped;
    }

    function buildProposedCode(row){
      // Зачем: Code предлагаемый формируем по шаблону: [expectedCode] [Название Помещения]
      const expectedCode = normalizeText(row.expectedCode || row.expectedPrefix || '');
      if (!expectedCode) return '';
      const roomName = normalizeText(row.roomName || '');
      if (!roomName) return expectedCode;
      
      // Извлекаем site из expectedCode (последняя часть после префикса)
      // Формат: ROOM.ACT.KIND.CH [site] или ROOM.KIND.CH [site]
      const specPrefixRe4 = /^\s*\d{1,3}\.[A-Z][A-Z0-9]{0,2}\.[A-Z0-9]{1,12}\.\d{1,3}\s+(.+)\s*$/;
      const specPrefixRe3 = /^\s*\d{1,3}\.[A-Z0-9]{1,12}\.\d{1,3}\s+(.+)\s*$/;
      const siteMatch = expectedCode.match(specPrefixRe4) || expectedCode.match(specPrefixRe3);
      const site = siteMatch ? normalizeText(siteMatch[1]) : '';
      
      // Если site уже есть в expectedCode и совпадает с roomName - не добавляем
      if (site && normalizeText(site) === roomName) {
        return expectedCode;
      }
      
      // Иначе добавляем roomName
      return `${expectedCode} ${roomName}`;
    }

    if (Array.isArray(data.rows) && data.rows.length) {
      tbl.hidden = false;
      data.rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = 'device-row';
        tr.dataset.level = r.level || 'unknown';
        let popupTimeout = null;
        tr.onmouseenter = (e) => {
          clearTimeout(popupTimeout);
          popupTimeout = setTimeout(() => showDevicePopup(r, e), 200); // Небольшая задержка для плавности
        };
        tr.onmouseleave = () => {
          clearTimeout(popupTimeout);
          window.popupHideTimeout = setTimeout(() => hideDevicePopup(), 100);
        };
        tr.onmousemove = (e) => {
          // Обновляем позицию попапа при движении мыши
          const popup = document.getElementById('device-popup');
          if (popup) {
            const x = e.clientX + 15;
            const y = e.clientY + 15;
            popup.style.left = `${x}px`;
            popup.style.top = `${y}px`;
            const rect = popup.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
              popup.style.left = `${e.clientX - rect.width - 15}px`;
            }
            if (rect.bottom > window.innerHeight) {
              popup.style.top = `${e.clientY - rect.height - 15}px`;
            }
          }
        };
        const statusTd = document.createElement('td');
        const dot = document.createElement('span');
        dot.className = 'status-dot';
        dot.title = (r.level==='red'?'🔴': r.level==='yellow'?'🟡':'🟢') + ' ' + (r.reason || '');
        dot.style.background = (r.level==='red') ? '#ef4444' : (r.level==='yellow') ? '#fbbf24' : '#10b981';
        statusTd.appendChild(dot);
        const combinedTd = document.createElement('td');
        combinedTd.className = 'stacked';
        const codeLine = document.createElement('div');
        codeLine.textContent = r.code || '—';
        const titleLine = document.createElement('div');
        titleLine.textContent = r.title || '—';
        titleLine.className = 'muted';
        combinedTd.appendChild(codeLine);
        combinedTd.appendChild(titleLine);

        const proposedTitleTd = document.createElement('td');
        proposedTitleTd.contentEditable = true;
        proposedTitleTd.style.background = 'transparent';
        proposedTitleTd.style.borderRadius = '4px';
        proposedTitleTd.style.padding = '4px';
        proposedTitleTd.title = 'Редактируемое: предложенный Title без кода классификации';
        proposedTitleTd.textContent = stripTitleClassification(r.title || '');
        proposedTitleTd.onmouseenter = (e) => e.stopPropagation(); // Предотвращаем открытие попапа при редактировании
        proposedTitleTd.onmouseleave = (e) => e.stopPropagation();

        const expectedTd = document.createElement('td');
        expectedTd.textContent = buildProposedCode(r) || '—';
        const actTd = document.createElement('td');
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Применить';
        applyBtn.style.padding = '6px 8px';
        applyBtn.style.fontSize = '13px';
        applyBtn.style.background = '#06b6d4';
        applyBtn.style.borderRadius = '6px';
        applyBtn.onmouseenter = (e) => e.stopPropagation(); // Предотвращаем открытие попапа при наведении на кнопку
        applyBtn.onmouseleave = (e) => e.stopPropagation();
        applyBtn.onclick = async (e) => {
          e.stopPropagation(); // Предотвращаем открытие попапа при клике на кнопку
          const proposed = buildProposedCode(r);
          const newTitleValRaw = proposedTitleTd.textContent && proposedTitleTd.textContent.trim() ? proposedTitleTd.textContent.trim() : '';
          const newTitleVal = newTitleValRaw !== '' ? newTitleValRaw : undefined;
          
          // Показываем spinner вместо кнопки
          const spinner = document.createElement('span');
          spinner.className = 'spinner';
          applyBtn.replaceWith(spinner);
          dot.style.background = '#60a5fa';
          
          try {
            // Apply
            const payload = { daemonId, gateUrl: gate, id: r.id };
            if (proposed) payload.newCode = proposed;
            if (newTitleVal !== undefined && newTitleVal !== (r.title || '')) payload.newTitle = newTitleVal;
            const ares = await fetchJson('/api/apply', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
            if (!ares.ok) {
              spinner.replaceWith(applyBtn);
              dot.style.background = '#ef4444';
              showToast('error', 'Ошибка применения', `Не удалось применить изменения: ${ares.error || 'unknown'}`);
              return;
            }
            
            // Ждём немного для применения изменений
            await new Promise((r) => setTimeout(r, 1500));
            
            // Verify через GET
            const verifyRes = await fetchJson('/api/verify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ daemonId, gateUrl: gate, id: r.id })});
            if (!verifyRes.ok) {
              spinner.replaceWith(applyBtn);
              dot.style.background = '#ef4444';
              showToast('error', 'Ошибка проверки', `Не удалось проверить изменения: ${verifyRes.error || 'unknown'}`);
              return;
            }
            
            const actualPayload = verifyRes.payload || {};
            const actualCode = actualPayload.code || '';
            const actualTitle = actualPayload.title || '';
            
            // Обновляем данные в объекте r для следующих операций
            r.code = actualCode || r.code;
            r.title = actualTitle || r.title;
            
            // Обновляем UI на основе реального состояния
            dot.style.background = '#10b981';
            combinedTd.style.opacity = '0.2';
            setTimeout(() => {
              if (actualCode) codeLine.textContent = actualCode;
              if (actualTitle) titleLine.textContent = actualTitle;
              combinedTd.style.opacity = '1';
            }, 220);
            
            // Возвращаем кнопку
            spinner.replaceWith(applyBtn);
            
            // Показываем успешное уведомление
            const changes = [];
            if (proposed && actualCode === proposed) changes.push(`Code: ${r.code} → ${actualCode}`);
            if (newTitleVal && actualTitle === newTitleVal) changes.push(`Title: ${r.title} → ${actualTitle}`);
            showToast('success', 'Изменения применены', changes.length > 0 ? changes.join(', ') : 'Устройство обновлено');
            
            // Проверяем соответствие ожидаемого и реального
            if (proposed && actualCode !== proposed) {
              console.warn(`Code mismatch: expected "${proposed}", got "${actualCode}"`);
              showToast('warning', 'Несоответствие кода', `Ожидалось: "${proposed}", получено: "${actualCode}"`, 7000);
            }
            if (newTitleVal && actualTitle !== newTitleVal) {
              console.warn(`Title mismatch: expected "${newTitleVal}", got "${actualTitle}"`);
              showToast('warning', 'Несоответствие заголовка', `Ожидалось: "${newTitleVal}", получено: "${actualTitle}"`, 7000);
            }
          } catch (e) {
            spinner.replaceWith(applyBtn);
            dot.style.background = '#ef4444';
            showToast('error', 'Ошибка', e.message || 'Неизвестная ошибка');
          }
        };
        actTd.appendChild(applyBtn);
        tr.appendChild(statusTd);
        tr.appendChild(combinedTd);
        tr.appendChild(expectedTd);
        tr.appendChild(proposedTitleTd);
        tr.appendChild(actTd);
        rowsEl.appendChild(tr);
      });
      // применяем текущий фильтр
      const filterEl = document.getElementById('filter');
      if (filterEl) {
        const f = filterEl.value;
        rowsEl.querySelectorAll('tr').forEach((row) => {
          if (f === 'all') { row.style.display = ''; return; }
          row.style.display = (row.dataset.level === f) ? '' : 'none';
        });
      }
    } else {
      tbl.hidden = true;
    }
  });
  // фильтр строк
  const filterEl = await el('filter');
  filterEl.addEventListener('change', () => {
    const v = filterEl.value;
    const trs = rowsEl.querySelectorAll('tr');
    trs.forEach(t => {
      if (v === 'all') { t.style.display = ''; return; }
      if (t.dataset.level === v) t.style.display = '';
      else t.style.display = 'none';
    });
  });
})(); 

