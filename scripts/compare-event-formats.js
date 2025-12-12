#!/usr/bin/env node

/**
 * Сравнение форматов событий из двух индексов OpenSearch
 * 
 * Использование:
 *   node scripts/compare-event-formats.js
 *   node scripts/compare-event-formats.js --date 2025-11-28
 *   node scripts/compare-event-formats.js --main-index reacthome-events --test-index reacthome-events-test
 */

const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Парсинг аргументов
const args = process.argv.slice(2);
const getArg = (name, defaultValue = null) => {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
};

const DATE = getArg('--date', new Date().toISOString().split('T')[0]);
const MAIN_INDEX_PREFIX = getArg('--main-index', 'reacthome-events');
const TEST_INDEX_PREFIX = getArg('--test-index', 'reacthome-events-test');

// Конфигурация OpenSearch
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || '';
const OPENSEARCH_USER = process.env.OPENSEARCH_USER || '';
const OPENSEARCH_PASSWORD = process.env.OPENSEARCH_PASSWORD || '';
const OPENSEARCH_CA_CERT = process.env.OPENSEARCH_CA_CERT || path.join(os.homedir(), '.opensearch', 'root.crt');

// HTTPS Agent
let httpsAgent = null;
const getHttpsAgent = () => {
  if (httpsAgent) return httpsAgent;
  
  if (fs.existsSync(OPENSEARCH_CA_CERT)) {
    const ca = fs.readFileSync(OPENSEARCH_CA_CERT);
    httpsAgent = new https.Agent({ ca: ca, rejectUnauthorized: true });
  } else {
    httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return httpsAgent;
};

// Получение событий
const getEvents = async (indexPrefix, date) => {
  const indexName = `${indexPrefix}-${date}`;
  const query = {
    query: { match_all: {} },
    size: 1000,
    sort: [{ timestamp: { order: 'asc' } }]
  };

  const url = `${OPENSEARCH_URL}/${indexName}/_search`;
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
    if (response.status === 404) {
      return [];
    }
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.hits.hits.map(hit => hit._source);
};

// Анализ структуры события
const analyzeEventStructure = (events) => {
  const structure = {
    fields: new Set(),
    types: {},
    examples: {}
  };

  for (const event of events) {
    const analyzeObject = (obj, prefix = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        structure.fields.add(fullKey);
        
        const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        if (!structure.types[fullKey]) {
          structure.types[fullKey] = new Set();
        }
        structure.types[fullKey].add(type);
        
        if (!structure.examples[fullKey] && events.indexOf(event) < 5) {
          structure.examples[fullKey] = value;
        }
      }
    };

    analyzeObject(event);
    if (event.device) analyzeObject(event.device, 'device');
    if (event.trigger) analyzeObject(event.trigger, 'trigger');
    if (event.value) analyzeObject(event.value, 'value');
    if (event.extra) analyzeObject(event.extra, 'extra');
  }

  return structure;
};

// Сравнение структур
const compareStructures = (mainStruct, testStruct) => {
  const differences = {
    missingInTest: [],
    missingInMain: [],
    typeMismatches: []
  };

  // Поля, отсутствующие в тестовом
  for (const field of mainStruct.fields) {
    if (!testStruct.fields.has(field)) {
      differences.missingInTest.push(field);
    }
  }

  // Поля, отсутствующие в основном
  for (const field of testStruct.fields) {
    if (!mainStruct.fields.has(field)) {
      differences.missingInMain.push(field);
    }
  }

  // Несовпадения типов
  for (const field of mainStruct.fields) {
    if (testStruct.fields.has(field)) {
      const mainTypes = Array.from(mainStruct.types[field] || []);
      const testTypes = Array.from(testStruct.types[field] || []);
      if (mainTypes.sort().join(',') !== testTypes.sort().join(',')) {
        differences.typeMismatches.push({
          field,
          main: mainTypes,
          test: testTypes
        });
      }
    }
  }

  return differences;
};

// Основная функция
const main = async () => {
  console.log('🔍 Сравнение форматов событий\n');
  console.log(`📅 Дата: ${DATE}`);
  console.log(`📊 Основной индекс: ${MAIN_INDEX_PREFIX}-${DATE}`);
  console.log(`📊 Тестовый индекс: ${TEST_INDEX_PREFIX}-${DATE}\n`);

  try {
    // Получение событий
    console.log('📥 Получение событий...');
    const mainEvents = await getEvents(MAIN_INDEX_PREFIX, DATE);
    const testEvents = await getEvents(TEST_INDEX_PREFIX, DATE);
    
    console.log(`   Основной индекс: ${mainEvents.length} событий`);
    console.log(`   Тестовый индекс: ${testEvents.length} событий\n`);

    if (mainEvents.length === 0 && testEvents.length === 0) {
      console.log('⚠️  События не найдены для указанной даты\n');
      return;
    }

    // Анализ структур
    console.log('🔬 Анализ структуры событий...');
    const mainStruct = analyzeEventStructure(mainEvents);
    const testStruct = analyzeEventStructure(testEvents);

    // Сравнение
    const differences = compareStructures(mainStruct, testStruct);

    // Вывод результатов
    console.log('\n📊 Результаты сравнения:\n');

    // Поля
    console.log(`   Поля в основном индексе: ${mainStruct.fields.size}`);
    console.log(`   Поля в тестовом индексе: ${testStruct.fields.size}`);

    if (differences.missingInTest.length > 0) {
      console.log(`\n   ❌ Поля, отсутствующие в тестовом индексе (${differences.missingInTest.length}):`);
      for (const field of differences.missingInTest.slice(0, 10)) {
        console.log(`      - ${field}`);
      }
      if (differences.missingInTest.length > 10) {
        console.log(`      ... и ещё ${differences.missingInTest.length - 10}`);
      }
    }

    if (differences.missingInMain.length > 0) {
      console.log(`\n   ⚠️  Поля, присутствующие только в тестовом индексе (${differences.missingInMain.length}):`);
      for (const field of differences.missingInMain.slice(0, 10)) {
        console.log(`      - ${field}`);
      }
      if (differences.missingInMain.length > 10) {
        console.log(`      ... и ещё ${differences.missingInMain.length - 10}`);
      }
    }

    if (differences.typeMismatches.length > 0) {
      console.log(`\n   ⚠️  Несовпадения типов (${differences.typeMismatches.length}):`);
      for (const { field, main, test } of differences.typeMismatches.slice(0, 10)) {
        console.log(`      - ${field}: основной=[${main.join(', ')}], тестовый=[${test.join(', ')}]`);
      }
      if (differences.typeMismatches.length > 10) {
        console.log(`      ... и ещё ${differences.typeMismatches.length - 10}`);
      }
    }

    // Примеры полей
    console.log('\n📋 Примеры полей (основной индекс):');
    const sortedFields = Array.from(mainStruct.fields).sort();
    for (const field of sortedFields.slice(0, 20)) {
      const types = Array.from(mainStruct.types[field] || []).join(', ');
      const example = mainStruct.examples[field];
      const exampleStr = example !== undefined 
        ? (typeof example === 'object' ? JSON.stringify(example).slice(0, 50) : String(example).slice(0, 50))
        : 'N/A';
      console.log(`   - ${field}: [${types}] = ${exampleStr}`);
    }

    // Итог
    const hasDifferences = 
      differences.missingInTest.length > 0 ||
      differences.missingInMain.length > 0 ||
      differences.typeMismatches.length > 0;

    console.log('\n' + '='.repeat(60));
    if (!hasDifferences) {
      console.log('✅ Форматы событий идентичны\n');
    } else {
      console.log('⚠️  Обнаружены различия в форматах\n');
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
};

main();

