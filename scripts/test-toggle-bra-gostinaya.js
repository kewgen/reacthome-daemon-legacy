#!/usr/bin/env node

/**
 * Тест выполнения скрипта "toggle bra гостиная"
 * Выполняет скрипт дважды с интервалом 1 секунда
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const SCRIPT_NAME = process.env.REACTHOME_SCRIPT_NAME || process.argv[2] || 'toggle bra гостиная';
const SCRIPT_ID = process.env.REACTHOME_SCRIPT_ID;
const INTERVAL = 1000;

let scriptFound = null;
let scriptSearchComplete = false;
let responses = [];
let executionCount = 0;
let startTime = Date.now();
const scriptIdsToCheck = new Set();

const ws = new WebSocket(WS_URI);

ws.on('open', () => {
  if (SCRIPT_ID) {
    scriptFound = { id: SCRIPT_ID, name: SCRIPT_NAME };
    scriptSearchComplete = true;
    startExecution();
  } else {
    ws.send(JSON.stringify({ type: 'list' }));
    setTimeout(() => {
      if (scriptIdsToCheck.size > 0) {
        ws.send(JSON.stringify({ type: 'get', state: Array.from(scriptIdsToCheck) }));
      }
    }, 2000);
  }
});

function startExecution() {
  if (!scriptFound) return;
  
  const command = { type: 'ACTION_SCRIPT_RUN', id: scriptFound.id };
  console.log(`✅ Скрипт найден: ${scriptFound.id}`);
  console.log(`📤 Выполнение #1`);
  ws.send(JSON.stringify(command));
  executionCount++;
  startTime = Date.now();
  
  setTimeout(() => {
    console.log(`📤 Выполнение #2`);
    ws.send(JSON.stringify(command));
    executionCount++;
    setTimeout(() => {
      printSummary();
      ws.close();
      process.exit(0);
    }, 3000);
  }, INTERVAL);
}

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  if (!scriptSearchComplete) {
    if (msg.type === 'list' && msg.state) {
      msg.state.forEach(([id]) => scriptIdsToCheck.add(id));
    }
    if (msg.type === 'ACTION_SET' && msg.payload?.type === 'script') {
      const code = (msg.payload.code || '').toLowerCase();
      const title = (msg.payload.title || '').toLowerCase();
      const search = SCRIPT_NAME.toLowerCase();
      if (code === search || title === search || code.includes(search) || title.includes(search)) {
        scriptFound = { id: msg.id, name: SCRIPT_NAME, title: msg.payload.title, code: msg.payload.code };
        scriptSearchComplete = true;
        startExecution();
      }
    }
    return;
  }
  
  if (msg.type === 'ACTION_SET') {
    responses.push(msg);
  }
});

ws.on('error', (error) => {
  console.error(`❌ Ошибка: ${error.message}`);
  process.exit(1);
});

function printSummary() {
  const duration = Date.now() - startTime;
  const devices = new Set(responses.map(r => r.id));
  
  console.log(`\n=== ИТОГИ ===`);
  console.log(`✅ Выполнений: ${executionCount}`);
  console.log(`📊 Обновлений: ${responses.length}`);
  console.log(`📋 Устройств: ${devices.size}`);
  console.log(`⏱️  Время: ${(duration / 1000).toFixed(1)}с`);
  
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  
  const reportFile = path.join(reportDir, `toggle-bra-gostinaya-execution-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.md`);
  const report = `# Лог выполнения скрипта "${scriptFound?.name || SCRIPT_NAME}"

**Дата:** ${new Date().toLocaleString('ru-RU')}  
**UUID:** \`${scriptFound?.id || 'не найден'}\`  
**Выполнений:** ${executionCount}  
**Обновлений:** ${responses.length}  
**Устройств:** ${devices.size}  
**Время:** ${(duration / 1000).toFixed(1)}с
`;
  
  fs.writeFileSync(reportFile, report);
  console.log(`📄 Отчёт: ${reportFile}`);
}

setTimeout(() => {
  if (!scriptSearchComplete && !SCRIPT_ID) {
    console.error(`❌ Скрипт "${SCRIPT_NAME}" не найден`);
    process.exit(1);
  }
}, 5000);
