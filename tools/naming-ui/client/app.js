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

  // Зачем: функция нормализации текста (доступна везде в модуле)
  function normalizeText(v){ return String(v || '').replace(/\s+/g,' ').trim(); }

  // Зачем: функция пересчёта статуса строки на основе текущего code и expectedCode
  // Использует переданный объект row напрямую (UUID не меняется, обновляется только статус)
  function recalculateRowStatus(row, tr, dot) {
    const codeRaw = normalizeText(row.code || '');
    const titleRaw = normalizeText(row.title || '');
    const expectedCode = normalizeText(row.expectedCode || '');
    const expectedPrefix = normalizeText(row.expectedPrefix || '');
    
    let newLevel = 'red';
    let newReason = 'префикс не найден';
    
    // Зачем: главная проверка - если code и title полностью совпадают с предлагаемыми, статус зелёный
    if (expectedCode && codeRaw === expectedCode) {
      // Зачем: проверяем, что title не содержит код классификации
      const titleCodeRe = /^\s*\d{1,3}\.[A-Za-zА-Яа-я0-9]{1,2}\.[A-Za-zА-Яа-я0-9]{1,12}\.?\d{0,3}\s*/i;
      const titleWithoutCode = titleRaw.replace(titleCodeRe, '').trim();
      if (titleRaw === titleWithoutCode) {
        newLevel = 'green';
        newReason = 'code и title полностью совпадают с предлагаемыми';
      }
    } else if (expectedCode && (codeRaw === '' || codeRaw === '—')) {
      // Зачем: если code пустой, но expectedCode есть, проверяем title (как в серверной логике)
      const titleCodeRe = /^\s*\d{1,3}\.[A-Za-zА-Яа-я0-9]{1,2}\.[A-Za-zА-Яа-я0-9]{1,12}\.?\d{0,3}\s*/i;
      const titleWithoutCode = titleRaw.replace(titleCodeRe, '').trim();
      if (titleRaw === titleWithoutCode) {
        newLevel = 'yellow';
        newReason = 'code пустой, требуется применение предлагаемого кода';
      }
    } else if (expectedPrefix && codeRaw.startsWith(expectedPrefix)) {
      // Зачем: если code начинается с префикса, проверяем каноничность
      if (codeRaw.startsWith(expectedPrefix) && !/[А-Яа-я]/.test(codeRaw.slice(0, expectedPrefix.length + 2))) {
        newLevel = 'green';
        newReason = 'code начинается с префикса (канон)';
      } else {
        newLevel = 'yellow';
        newReason = 'префикс в начале, но не канон';
      }
    } else if (expectedPrefix && (codeRaw.includes(expectedPrefix) || titleRaw.includes(expectedPrefix))) {
      newLevel = 'yellow';
      newReason = 'префикс найден не в начале code или в title';
    }
    
    // Зачем: если expectedPrefix отсутствует, но expectedCode есть, проверяем совпадение с expectedCode
    if (!expectedPrefix && expectedCode) {
      const expectedCodeNormalized = normalizeText(expectedCode);
      if (codeRaw === expectedCodeNormalized) {
        newLevel = 'green';
        newReason = 'code совпадает с предлагаемым (префикс не вычислен)';
      } else if ((codeRaw === '' || codeRaw === '—') && expectedCodeNormalized) {
        // Зачем: если code пустой, но expectedCode есть, это жёлтый (требуется применение)
        const titleCodeRe = /^\s*\d{1,3}\.[A-Za-zА-Яа-я0-9]{1,2}\.[A-Za-zА-Яа-я0-9]{1,12}\.?\d{0,3}\s*/i;
        const titleWithoutCode = titleRaw.replace(titleCodeRe, '').trim();
        if (titleRaw === titleWithoutCode) {
          newLevel = 'yellow';
          newReason = 'code пустой, требуется применение предлагаемого кода';
        }
      }
    }
    
    // Обновляем статус строки
    tr.dataset.level = newLevel;
    dot.style.background = newLevel === 'red' ? '#ef4444' : newLevel === 'yellow' ? '#fbbf24' : '#10b981';
    dot.title = (newLevel === 'red' ? '🔴' : newLevel === 'yellow' ? '🟡' : '🟢') + ' ' + newReason;
    
    return newLevel;
  }

  // Зачем: функция пересчёта счётчика на основе видимых строк в таблице
  function updateSummary() {
    const trs = rowsEl.querySelectorAll('tr');
    let total = 0, green = 0, yellow = 0, red = 0;
    trs.forEach(tr => {
      const level = tr.dataset.level || 'unknown';
      // Зачем: проверяем видимость строки более надёжным способом
      const computedStyle = window.getComputedStyle(tr);
      const isVisible = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
      if (isVisible) {
        total++;
        // Зачем: учитываем только известные уровни, игнорируем 'unknown'
        if (level === 'green') green++;
        else if (level === 'yellow') yellow++;
        else if (level === 'red') red++;
      }
    });
    summary.textContent = `Найдено ${total} потребителей — 🟢 ${green} 🟡 ${yellow} 🔴 ${red}`;
  }

  validateBtn.addEventListener('click', async () => {
    const daemonId = daemonSel.value;
    const gate = gateEl.value;
    if (!daemonId) { summary.textContent = 'Выберите daemon'; return; }
    summary.textContent = 'Запрос валидации...';
    const res = await fetchJson('/api/validate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ daemonId, gateUrl: gate }) });
    if (!res.ok) { summary.textContent = 'Ошибка: ' + (res.error || 'unknown'); return; }
    const data = res.result;
    rowsEl.innerHTML = '';

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
      // Также проверяем нестандартные форматы (например "2.0/10.Valve.4 Старшая")
      const specPrefixRe4 = /^\s*\d{1,3}\.[A-Z][A-Z0-9]{0,2}\.[A-Z0-9]{1,12}\.\d{1,3}\s+(.+)\s*$/;
      const specPrefixRe3 = /^\s*\d{1,3}\.[A-Z0-9]{1,12}\.\d{1,3}\s+(.+)\s*$/;
      const nonStandardRe = /^\s*\d+[^\s]*\s+(.+)\s*$/;
      const siteMatch = expectedCode.match(specPrefixRe4) || expectedCode.match(specPrefixRe3) || expectedCode.match(nonStandardRe);
      const site = siteMatch ? normalizeText(siteMatch[1]) : '';
      
      if (site) {
        // Зачем: проверяем, содержит ли site roomName (после удаления префиксов типа "mr", "vn" и т.д.)
        // Если site содержит roomName, используем нормализованный roomName вместо site
        const siteWithoutPrefix = normalizeText(site.replace(/^(mr|vn|led|rgb|l|s220|wf|ao|bra|d|r|c|p|k|hfu|c\/a)\s+/i, ''));
        const roomNameLower = roomName.toLowerCase();
        const siteLower = siteWithoutPrefix.toLowerCase();
        
        // Если site содержит roomName или roomName содержится в site - используем roomName
        if (siteLower.includes(roomNameLower) || roomNameLower.includes(siteLower)) {
          // Заменяем site на roomName в expectedCode
          const prefix = expectedCode.replace(/\s+.*$/, '');
          return `${prefix} ${roomName}`;
        }
        
        // Иначе оставляем site как есть
        return expectedCode;
      }
      
      // Иначе добавляем roomName только если site нет в expectedCode
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
        expectedTd.style.textAlign = 'right'; // Зачем: выравнивание по правому краю для лучшей читаемости кодов
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
            // Зачем: Apply использует UUID устройства (r.id) напрямую, без резолвинга по имени/code
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
            await new Promise((resolve) => setTimeout(resolve, 1500));
            
            // Зачем: Verify через GET использует UUID устройства (r.id) напрямую, без резолвинга по имени
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
            
            // Зачем: обновляем данные в объекте r (UUID остаётся неизменным, обновляются только code и title)
            // Используем явную проверку на undefined, чтобы пустая строка сохранялась
            if (actualCode !== undefined) r.code = actualCode;
            if (actualTitle !== undefined) r.title = actualTitle;
            
            // Обновляем UI на основе реального состояния
            combinedTd.style.opacity = '0.2';
            setTimeout(() => {
              if (actualCode) codeLine.textContent = actualCode;
              if (actualTitle) titleLine.textContent = actualTitle;
              combinedTd.style.opacity = '1';
            }, 220);
            
            // Зачем: пересчитываем статус строки на основе нового code и обновляем счётчики
            recalculateRowStatus(r, tr, dot);
            updateSummary();
            
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
      // Зачем: обновляем счётчик на основе видимых строк после того, как DOM обновится
      // Используем requestAnimationFrame для гарантии, что все строки добавлены в DOM
      requestAnimationFrame(() => {
        updateSummary();
      });
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
    // Зачем: обновляем счётчик на основе видимых строк после применения фильтра
    updateSummary();
  });
})(); 

