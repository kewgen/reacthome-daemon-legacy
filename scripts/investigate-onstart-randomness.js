#!/usr/bin/env node

/**
 * Скрипт для исследования проблемы выполнения разных сценариев при рестарте демона
 * 
 * Зачем: Демон при рестарте выполняет разные сценарии onStart, что указывает на:
 * 1. Изменение поля project у демона между рестартами
 * 2. Изменение поля onStart у проекта между рестартами
 * 3. Race condition при загрузке состояния из БД
 * 4. Множественные проекты с разными onStart
 */

const { Level } = require('level');
const path = require('path');

// Цвета для вывода (для наглядности)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(color + args.join(' ') + colors.reset);
}

async function investigate(dbPath) {
  log(colors.bright, '\n🔍 Исследование проблемы onStart при рестарте демона\n');
  log(colors.cyan, `📂 База данных: ${dbPath}\n`);

  const db = new Level(dbPath, { valueEncoding: 'json' });

  try {
    // Шаг 1: Найти MAC демона
    log(colors.yellow, '📌 Шаг 1: Поиск MAC демона');
    let macAddress = null;
    try {
      macAddress = await db.get('mac');
      log(colors.green, `✅ MAC найден: ${macAddress}`);
    } catch (e) {
      log(colors.red, '❌ Ключ "mac" не найден в БД');
      return;
    }

    // Шаг 2: Получить объект демона
    log(colors.yellow, '\n📌 Шаг 2: Получение объекта демона');
    let daemon = null;
    try {
      daemon = await db.get(macAddress);
      log(colors.green, `✅ Демон найден:`);
      console.log(JSON.stringify(daemon, null, 2));
    } catch (e) {
      log(colors.red, `❌ Объект демона не найден по ключу: ${macAddress}`);
      return;
    }

    // Шаг 3: Проверить поле project
    log(colors.yellow, '\n📌 Шаг 3: Проверка поля project');
    if (!daemon.project) {
      log(colors.red, '❌ Поле "project" отсутствует у демона');
      log(colors.yellow, '⚠️  Это означает, что onStart не будет выполнен');
      return;
    }
    log(colors.green, `✅ Поле project: ${daemon.project}`);

    // Шаг 4: Получить объект проекта
    log(colors.yellow, '\n📌 Шаг 4: Получение объекта проекта');
    let project = null;
    try {
      project = await db.get(daemon.project);
      log(colors.green, `✅ Проект найден:`);
      console.log(JSON.stringify(project, null, 2));
    } catch (e) {
      log(colors.red, `❌ Проект не найден по ID: ${daemon.project}`);
      return;
    }

    // Шаг 5: Проверить поле onStart
    log(colors.yellow, '\n📌 Шаг 5: Проверка поля onStart');
    if (!project.onStart) {
      log(colors.yellow, '⚠️  Поле "onStart" отсутствует у проекта');
      log(colors.cyan, 'ℹ️  Это нормально, если стартовый скрипт не настроен');
      return;
    }
    log(colors.green, `✅ Поле onStart: ${project.onStart}`);

    // Шаг 6: Получить скрипт onStart
    log(colors.yellow, '\n📌 Шаг 6: Получение скрипта onStart');
    let script = null;
    try {
      script = await db.get(project.onStart);
      log(colors.green, `✅ Скрипт найден:`);
      console.log(JSON.stringify(script, null, 2));
    } catch (e) {
      log(colors.red, `❌ Скрипт не найден по ID: ${project.onStart}`);
      return;
    }

    // Шаг 7: Поиск всех проектов в БД
    log(colors.yellow, '\n📌 Шаг 7: Поиск всех проектов в БД');
    const projects = [];
    for await (const [key, value] of db.iterator()) {
      if (value && value.type === 'project') {
        projects.push({ id: key, ...value });
      }
    }
    
    if (projects.length === 0) {
      log(colors.yellow, '⚠️  Проекты не найдены');
    } else if (projects.length === 1) {
      log(colors.green, `✅ Найден 1 проект: ${projects[0].title || projects[0].id}`);
    } else {
      log(colors.red, `⚠️  Найдено ${projects.length} проектов:`);
      projects.forEach((p, i) => {
        const isCurrent = p.id === daemon.project;
        const marker = isCurrent ? '👉' : '  ';
        log(isCurrent ? colors.green : colors.cyan, 
          `${marker} ${i + 1}. ${p.title || p.id} (ID: ${p.id})`);
        if (p.onStart) {
          log(colors.cyan, `     onStart: ${p.onStart}`);
        }
      });
    }

    // Шаг 8: Поиск всех демонов в БД
    log(colors.yellow, '\n📌 Шаг 8: Поиск всех демонов в БД');
    const daemons = [];
    for await (const [key, value] of db.iterator()) {
      if (value && value.type === 'daemon') {
        daemons.push({ id: key, ...value });
      }
    }
    
    if (daemons.length === 0) {
      log(colors.red, '❌ Демоны не найдены (это ошибка!)');
    } else if (daemons.length === 1) {
      log(colors.green, `✅ Найден 1 демон: ${daemons[0].id}`);
    } else {
      log(colors.red, `⚠️  Найдено ${daemons.length} демонов:`);
      daemons.forEach((d, i) => {
        const isCurrent = d.id === macAddress;
        const marker = isCurrent ? '👉' : '  ';
        log(isCurrent ? colors.green : colors.cyan, 
          `${marker} ${i + 1}. ${d.id}`);
        if (d.project) {
          log(colors.cyan, `     project: ${d.project}`);
        }
      });
    }

    // Шаг 9: Анализ проблемы
    log(colors.bright, '\n📊 АНАЛИЗ ПРОБЛЕМЫ\n');

    if (projects.length > 1) {
      log(colors.red, '🔴 ПРОБЛЕМА 1: Множественные проекты');
      log(colors.yellow, `   Найдено ${projects.length} проектов в БД`);
      log(colors.yellow, '   При каждом рестарте демон может выбирать разный проект');
      log(colors.cyan, '\n   💡 Решение:');
      log(colors.cyan, '   1. Удалить лишние проекты из БД');
      log(colors.cyan, '   2. Убедиться, что поле project у демона указывает на правильный проект');
      log(colors.cyan, '   3. Проверить, нет ли кода, который меняет поле project');
    }

    if (daemons.length > 1) {
      log(colors.red, '\n🔴 ПРОБЛЕМА 2: Множественные демоны');
      log(colors.yellow, `   Найдено ${daemons.length} демонов в БД`);
      log(colors.yellow, '   Ключ "mac" указывает на один, но в БД есть другие');
      log(colors.cyan, '\n   💡 Решение:');
      log(colors.cyan, '   1. Удалить лишние записи демонов');
      log(colors.cyan, '   2. Оставить только один демон');
      log(colors.cyan, '   3. Проверить логику создания демона в daemon.js');
    }

    // Шаг 10: Проверка истории изменений
    log(colors.yellow, '\n📌 Шаг 10: Проверка временных меток');
    
    const daemonTimestamp = daemon.timestamp || 0;
    const projectTimestamp = project.timestamp || 0;
    const scriptTimestamp = script.timestamp || 0;

    log(colors.cyan, `Демон:   ${new Date(daemonTimestamp).toISOString()} (${daemonTimestamp})`);
    log(colors.cyan, `Проект:  ${new Date(projectTimestamp).toISOString()} (${projectTimestamp})`);
    log(colors.cyan, `Скрипт:  ${new Date(scriptTimestamp).toISOString()} (${scriptTimestamp})`);

    // Шаг 11: Рекомендации
    log(colors.bright, '\n📝 РЕКОМЕНДАЦИИ\n');
    
    log(colors.cyan, '1. Добавить логирование в daemon.js при старте:');
    log(colors.yellow, '   console.log("[DAEMON] Starting with project:", project);');
    log(colors.yellow, '   console.log("[DAEMON] onStart script:", onStart);');
    
    log(colors.cyan, '\n2. Проверить логи при каждом рестарте:');
    log(colors.yellow, '   tail -f logs/daemon-out.log | grep "DAEMON"');
    
    log(colors.cyan, '\n3. Создать мониторинг изменений поля project:');
    log(colors.yellow, '   Добавить логирование в src/actions/create.js при set(daemon_id, { project: ... })');
    
    log(colors.cyan, '\n4. Проверить код на предмет изменения поля project:');
    log(colors.yellow, '   grep -r "project.*=" src/');
    
    log(colors.green, '\n✅ Исследование завершено\n');

  } catch (e) {
    log(colors.red, '\n❌ Ошибка:', e.message);
    console.error(e);
  } finally {
    await db.close();
  }
}

// Запуск
const dbPath = process.argv[2] || path.join(__dirname, '..', 'var', 'db');
investigate(dbPath).catch(console.error);
