#!/usr/bin/env node

/**
 * Получение UUID демона (Daemon ID) с Raspberry Pi
 * 
 * Использование:
 *   node scripts/get-daemon-uuid.js [путь_к_бд]
 * 
 * Переменные окружения:
 *   DB_PATH - путь к LevelDB (по умолчанию: /home/pi/reacthome-daemon/var/db)
 * 
 * Зачем: Получить UUID демона для подключения через gateway или идентификации сервера
 */

const { Level } = require('level');
const path = require('path');

const DB_PATH = process.env.DB_PATH || process.argv[2] || '/home/pi/reacthome-daemon/var/db';

async function getDaemonUUID() {
  try {
    console.log(`📂 Открываю БД: ${DB_PATH}\n`);
    
    const db = new Level(DB_PATH, { valueEncoding: 'json' });
    
    // Способ 1: Читаем ключ "mac"
    try {
      const mac = await db.get('mac');
      console.log('✅ UUID демона (ключ "mac"):');
      console.log(`   ${mac}\n`);
      
      // Проверяем, есть ли объект демона
      try {
        const daemon = await db.get(mac);
        if (daemon && daemon.type === 'daemon') {
          console.log('✅ Объект демона найден:');
          console.log(`   Тип: ${daemon.type}`);
          console.log(`   Токенов: ${daemon.token?.length || 0}`);
          if (daemon.temperature !== undefined) {
            console.log(`   Температура CPU: ${daemon.temperature}°C`);
          }
          console.log(`   Устройств: ${daemon.device?.length || 0}\n`);
        }
      } catch (e) {
        console.log('⚠️  Объект демона не найден в БД\n');
      }
      
      await db.close();
      process.exit(0);
    } catch (e) {
      if (e.code === 'LEVEL_NOT_FOUND') {
        console.error('❌ Ключ "mac" не найден в БД');
        console.error('   Демон ещё не был запущен или БД пуста\n');
      } else {
        throw e;
      }
    }
    
    await db.close();
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.code === 'ENOENT') {
      console.error(`   БД не найдена по пути: ${DB_PATH}`);
      console.error('   Проверьте путь к БД или запустите демон хотя бы один раз\n');
    }
    process.exit(1);
  }
}

getDaemonUUID();







