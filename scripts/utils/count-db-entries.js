#!/usr/bin/env node

/**
 * Скрипт для подсчёта количества записей в LevelDB
 * Использование: node count-db-entries.js [путь_к_бд]
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || process.argv[2] || '/home/pi/reacthome-daemon/var/db';

async function countEntries() {
  try {
    console.error(`📊 Открываю БД: ${DB_PATH}`);
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    let count = 0;
    const startTime = Date.now();
    
    for await (const [key, value] of db.iterator()) {
      count++;
    }
    
    const duration = Date.now() - startTime;
    
    await db.close();
    
    console.log(JSON.stringify({
      path: DB_PATH,
      count: count,
      duration_ms: duration
    }, null, 2));
    
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

countEntries();



