#!/usr/bin/env node

/**
 * Критический тест совместимости событий между встроенным логированием и event-logger
 * 
 * Цель: Гарантировать полную проверку совместимости старого и нового решения.
 * 
 * Использование:
 *   node tests/integration/test_event_logging_compatibility.js
 *   node tests/integration/test_event_logging_compatibility.js --date 2025-11-28
 *   node tests/integration/test_event_logging_compatibility.js --from 2025-11-25 --to 2025-11-28
 *   node tests/integration/test_event_logging_compatibility.js --verbose
 */

// Используем встроенный fetch для Node.js 18+ или node-fetch для старых версий
let fetch;
const https = require('https');
try {
  // Пробуем использовать встроенный fetch (Node.js 18+)
  if (globalThis.fetch) {
    // Встроенный fetch не поддерживает agent напрямую, используем обертку
    fetch = async (url, options = {}) => {
      if (options.agent) {
        // Если нужен agent, используем https напрямую
        return new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const req = https.request({
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            agent: options.agent
          }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: res.statusMessage,
                json: async () => JSON.parse(data),
                text: async () => data
              });
            });
          });
          req.on('error', reject);
          if (options.body) {
            req.write(options.body);
          }
          req.end();
        });
      } else {
        // Если agent не нужен, используем встроенный fetch
        return globalThis.fetch(url, options);
      }
    };
  } else {
    fetch = require('node-fetch');
  }
} catch (e) {
  // Если встроенный fetch недоступен и node-fetch не установлен, используем https
  fetch = async (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request({
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        agent: options.agent
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            json: async () => JSON.parse(data),
            text: async () => data
          });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  };
}
const fs = require('fs');
const path = require('path');
const os = require('os');

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const getArg = (name, defaultValue = null) => {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
};
const hasFlag = (name) => args.includes(name);

const VERBOSE = hasFlag('--verbose');
const DATE = getArg('--date');
const FROM = getArg('--from');
const TO = getArg('--to');

// Конфигурация OpenSearch
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const OPENSEARCH_INDEX_PREFIX_MAIN = 'reacthome-events';
const OPENSEARCH_INDEX_PREFIX_TEST = 'reacthome-events-test';

const OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT || path.join(os.homedir(), '.opensearch', 'root.crt');

// HTTPS Agent
let httpsAgent = null;
const getHttpsAgent = () => {
  if (httpsAgent) return httpsAgent;
  
  if (fs.existsSync(OPENSEARCH_CA_CERT)) {
    const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
    httpsAgent = new https.Agent({
      ca: ca,
      rejectUnauthorized: true
    });
  } else {
    httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });
    console.warn(`⚠️ CA сертификат не найден: ${OPENSEARCH_CA_CERT}, используется insecure режим`);
  }
  
  return httpsAgent;
};

// Получение событий из OpenSearch
const getEvents = async (indexPrefix, fromDate, toDate) => {
  if (!OPENSEARCH_URL) {
    throw new Error('OPENSEARCH_URL не задан');
  }

  const indices = [];
  const currentDate = new Date(fromDate);
  const endDate = new Date(toDate);
  
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    indices.push(`${indexPrefix}-${dateStr}`);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const query = {
    query: {
      range: {
        timestamp: {
          gte: new Date(fromDate).getTime(),
          lte: new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1
        }
      }
    },
    size: 10000,
    sort: [{ timestamp: { order: 'asc' } }]
  };

  const url = `${OPENSEARCH_URL}/${indices.join(',')}/_search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64')}`
    },
    body: JSON.stringify(query),
    agent: getHttpsAgent()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.hits.hits.map(hit => hit._source);
};

// Создание уникального ключа события
const getEventKey = (event) => {
  return `${event.id}_${event.timestamp}_${event.param}`;
};

// Сравнение значений с учётом округления
const valuesEqual = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    // Округление до десятых
    return Math.round(a * 10) / 10 === Math.round(b * 10) / 10;
  }
  return false;
};

// Сравнение событий
const compareEvents = (mainEvent, testEvent) => {
  const differences = [];

  // Базовые поля
  const fields = ['id', 'param', 'timestamp'];
  for (const field of fields) {
    if (mainEvent[field] !== testEvent[field]) {
      differences.push(`${field}: ${mainEvent[field]} !== ${testEvent[field]}`);
    }
  }

  // old и new
  if (!valuesEqual(mainEvent.old, testEvent.old)) {
    differences.push(`old: ${mainEvent.old} !== ${testEvent.old}`);
  }
  if (!valuesEqual(mainEvent.new, testEvent.new)) {
    differences.push(`new: ${mainEvent.new} !== ${testEvent.new}`);
  }

  // value (только для числовых параметров)
  if (mainEvent.value && testEvent.value) {
    if (!valuesEqual(mainEvent.value.old, testEvent.value.old)) {
      differences.push(`value.old: ${mainEvent.value.old} !== ${testEvent.value.old}`);
    }
    if (!valuesEqual(mainEvent.value.new, testEvent.value.new)) {
      differences.push(`value.new: ${mainEvent.value.new} !== ${testEvent.value.new}`);
    }
  } else if (mainEvent.value !== testEvent.value) {
    // Один есть, другого нет
    differences.push(`value: присутствует только в одном из событий`);
  }

  // device
  if (mainEvent.device?.type !== testEvent.device?.type) {
    differences.push(`device.type: ${mainEvent.device?.type} !== ${testEvent.device?.type}`);
  }
  if (mainEvent.device?.name !== testEvent.device?.name) {
    differences.push(`device.name: ${mainEvent.device?.name} !== ${testEvent.device?.name}`);
  }

  // trigger
  if (mainEvent.trigger?.type !== testEvent.trigger?.type) {
    differences.push(`trigger.type: ${mainEvent.trigger?.type} !== ${testEvent.trigger?.type}`);
  }
  if (mainEvent.trigger?.ref !== testEvent.trigger?.ref) {
    differences.push(`trigger.ref: ${mainEvent.trigger?.ref} !== ${testEvent.trigger?.ref}`);
  }
  // trigger.id может быть null в event-logger (ограничение WebSocket)
  if (mainEvent.trigger?.id !== testEvent.trigger?.id && testEvent.trigger?.id !== null) {
    differences.push(`trigger.id: ${mainEvent.trigger?.id} !== ${testEvent.trigger?.id}`);
  }

  // site и project
  if (mainEvent.site !== testEvent.site) {
    differences.push(`site: ${mainEvent.site} !== ${testEvent.site}`);
  }
  if (mainEvent.project !== testEvent.project) {
    differences.push(`project: ${mainEvent.project} !== ${testEvent.project}`);
  }

  // Новые поля (trace_id, extra.actuator_off) - опциональны, не сравниваем

  return differences;
};

// Основная функция
const main = async () => {
  console.log('🔍 Критический тест совместимости событий\n');

  // Определение периода
  let fromDate, toDate;
  if (DATE) {
    fromDate = new Date(DATE);
    toDate = new Date(DATE);
    toDate.setHours(23, 59, 59, 999);
  } else if (FROM && TO) {
    fromDate = new Date(FROM);
    toDate = new Date(TO);
    toDate.setHours(23, 59, 59, 999);
  } else {
    // По умолчанию: последние 24 часа
    toDate = new Date();
    fromDate = new Date(toDate);
    fromDate.setHours(fromDate.getHours() - 24);
  }

  console.log(`📅 Период: ${fromDate.toISOString()} - ${toDate.toISOString()}\n`);

  try {
    // Получение событий
    console.log('📥 Получение событий из основного индекса...');
    const mainEvents = await getEvents(OPENSEARCH_INDEX_PREFIX_MAIN, fromDate, toDate);
    console.log(`   ✅ Получено ${mainEvents.length} событий\n`);

    console.log('📥 Получение событий из тестового индекса...');
    const testEvents = await getEvents(OPENSEARCH_INDEX_PREFIX_TEST, fromDate, toDate);
    console.log(`   ✅ Получено ${testEvents.length} событий\n`);

    // Создание маппинга событий
    const mainEventsMap = new Map();
    for (const event of mainEvents) {
      const key = getEventKey(event);
      // Допускается разница в timestamp до 5 секунд
      if (!mainEventsMap.has(key)) {
        mainEventsMap.set(key, event);
      } else {
        // Если есть несколько событий с одинаковым ключом, берём первое
      }
    }

    const testEventsMap = new Map();
    for (const event of testEvents) {
      const key = getEventKey(event);
      if (!testEventsMap.has(key)) {
        testEventsMap.set(key, event);
      }
    }

    // Сопоставление событий
    const matched = [];
    const mainOnly = [];
    const testOnly = [];
    const different = [];

    for (const [key, mainEvent] of mainEventsMap) {
      const testEvent = testEventsMap.get(key);
      if (testEvent) {
        const differences = compareEvents(mainEvent, testEvent);
        if (differences.length === 0) {
          matched.push({ main: mainEvent, test: testEvent });
        } else {
          different.push({ main: mainEvent, test: testEvent, differences });
        }
      } else {
        mainOnly.push(mainEvent);
      }
    }

    for (const [key, testEvent] of testEventsMap) {
      if (!mainEventsMap.has(key)) {
        testOnly.push(testEvent);
      }
    }

    // Статистика
    console.log('📊 Результаты сравнения:\n');
    console.log(`   ✅ Совпадающих событий: ${matched.length}`);
    console.log(`   ⚠️  Различающихся событий: ${different.length}`);
    console.log(`   ❌ Только в основном индексе: ${mainOnly.length}`);
    console.log(`   ❌ Только в тестовом индексе: ${testOnly.length}\n`);

    // Статистика по типам триггеров
    const triggerStats = {
      main: {},
      test: {}
    };
    for (const event of mainEvents) {
      const type = event.trigger?.type || 'unknown';
      triggerStats.main[type] = (triggerStats.main[type] || 0) + 1;
    }
    for (const event of testEvents) {
      const type = event.trigger?.type || 'unknown';
      triggerStats.test[type] = (triggerStats.test[type] || 0) + 1;
    }

    console.log('📈 Статистика по типам триггеров:\n');
    const allTriggerTypes = new Set([...Object.keys(triggerStats.main), ...Object.keys(triggerStats.test)]);
    for (const type of allTriggerTypes) {
      const mainCount = triggerStats.main[type] || 0;
      const testCount = triggerStats.test[type] || 0;
      const diff = mainCount - testCount;
      const status = diff === 0 ? '✅' : '⚠️';
      console.log(`   ${status} ${type}: основной=${mainCount}, тестовый=${testCount}${diff !== 0 ? ` (разница: ${diff})` : ''}`);
    }
    console.log('');

    // Статистика по параметрам
    const paramStats = {
      main: {},
      test: {}
    };
    for (const event of mainEvents) {
      paramStats.main[event.param] = (paramStats.main[event.param] || 0) + 1;
    }
    for (const event of testEvents) {
      paramStats.test[event.param] = (paramStats.test[event.param] || 0) + 1;
    }

    console.log('📈 Статистика по параметрам (топ-10):\n');
    const allParams = new Set([...Object.keys(paramStats.main), ...Object.keys(paramStats.test)]);
    const sortedParams = Array.from(allParams).sort((a, b) => {
      const totalA = (paramStats.main[a] || 0) + (paramStats.test[a] || 0);
      const totalB = (paramStats.main[b] || 0) + (paramStats.test[b] || 0);
      return totalB - totalA;
    });
    for (const param of sortedParams.slice(0, 10)) {
      const mainCount = paramStats.main[param] || 0;
      const testCount = paramStats.test[param] || 0;
      const diff = mainCount - testCount;
      const status = diff === 0 ? '✅' : '⚠️';
      console.log(`   ${status} ${param}: основной=${mainCount}, тестовый=${testCount}${diff !== 0 ? ` (разница: ${diff})` : ''}`);
    }
    console.log('');

    // Специальная статистика: executed/last_execution
    const executedMain = mainEvents.filter(e => e.param === 'executed' || e.param === 'last_execution');
    const executedTest = testEvents.filter(e => e.param === 'executed' || e.param === 'last_execution');
    console.log('📈 События executed/last_execution:\n');
    console.log(`   Основной индекс: ${executedMain.length}`);
    console.log(`   Тестовый индекс: ${executedTest.length}`);
    console.log(`   Разница: ${executedMain.length - executedTest.length}\n`);

    // Детальный отчёт о различиях
    if (different.length > 0) {
      console.log('⚠️  Детальный отчёт о различиях (первые 10):\n');
      for (const { main, test, differences } of different.slice(0, 10)) {
        console.log(`   Событие: ${main.id} / ${main.param} / ${new Date(main.timestamp).toISOString()}`);
        for (const diff of differences) {
          console.log(`     - ${diff}`);
        }
        console.log('');
      }
      if (different.length > 10) {
        console.log(`   ... и ещё ${different.length - 10} различий\n`);
      }
    }

    // Критерии успеха
    const totalMain = mainEvents.length;
    const totalTest = testEvents.length;
    const matchRate = totalMain > 0 ? (matched.length / totalMain) * 100 : 0;
    const countDiff = Math.abs(totalMain - totalTest);
    const countDiffPercent = totalMain > 0 ? (countDiff / totalMain) * 100 : 0;

    console.log('🎯 Критерии успеха:\n');
    console.log(`   ✅ Количество событий совпадает (±1%): ${countDiffPercent.toFixed(2)}% разницы ${countDiffPercent <= 1 ? '✅' : '❌'}`);
    console.log(`   ✅ Формат всех событий идентичен: ${different.length === 0 ? '✅' : '❌'}`);
    console.log(`   ✅ Процент совпадений: ${matchRate.toFixed(2)}% ${matchRate >= 99 ? '✅' : '❌'}`);
    console.log(`   ✅ Нет пропусков в логировании: ${mainOnly.length === 0 ? '✅' : '❌'}\n`);

    // Итоговый статус
    const success = 
      countDiffPercent <= 1 &&
      different.length === 0 &&
      matchRate >= 99 &&
      mainOnly.length === 0;

    if (success) {
      console.log('✅ Тест пройден успешно!\n');
      process.exit(0);
    } else {
      console.log('❌ Тест не пройден. Обнаружены различия.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Ошибка выполнения теста:', error.message);
    if (VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
};

main();

