// ВАЖНО: НЕ ЗАПУСКАТЬ ЛОКАЛЬНЫЙ DAEMON ИЗ ЭТОГО РЕПОЗИТОРИЯ.
// Зачем: в инфраструктуре есть основной демон, этот репозиторий нужен для log/event-logger и инструментов.
// Позволяет использовать pm2 monit для визуального мониторинга в реальном времени
const path = require('path');
const fs = require('fs');
const rootDir = path.resolve(__dirname, '..');

// Загрузка переменных окружения из .env файла
// Зачем: безопасное хранение секретов (UUID демонов, пароли) вне кода
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Убираем кавычки
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
}

// UUID демонов из переменных окружения (обязательные, без fallback)
// Зачем: секретные идентификаторы не должны быть в коде
const DAEMON_UUID_POCHTOVAYA = process.env.DAEMON_UUID_POCHTOVAYA;
const DAEMON_UUID_LUCHISTOE = process.env.DAEMON_UUID_LUCHISTOE;
const GATE_URL = process.env.GATE_URL || 'wss://gate.reacthome.net';

// Проверка обязательных переменных
if (!DAEMON_UUID_POCHTOVAYA || !DAEMON_UUID_LUCHISTOE) {
  console.error('❌ Ошибка: не заданы обязательные переменные окружения!');
  console.error('Создайте файл .env на основе .env.example и заполните:');
  console.error('  - DAEMON_UUID_POCHTOVAYA');
  console.error('  - DAEMON_UUID_LUCHISTOE');
  process.exit(1);
}

module.exports = {
  apps: [
    {
      name: 'logger',
      script: './src/logging/event-logger.js',
      cwd: rootDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        DAEMON_WS_URL: process.env.DAEMON_WS_URL || 'ws://192.168.88.4:3000', // Зачем: подключение к малинке вместо localhost
        PROJECT_DEFAULT: process.env.PROJECT_DEFAULT || 'pochta', // Зачем: дефолтный project для событий (Почтовая)
        OPENSEARCH_ENABLED: process.env.OPENSEARCH_ENABLED || 'true',
        OPENSEARCH_URL: process.env.OPENSEARCH_URL || '',
        OPENSEARCH_USER: process.env.OPENSEARCH_USER || '',
        OPENSEARCH_PASSWORD: process.env.OPENSEARCH_PASSWORD || '',
        OPENSEARCH_INDEX_PREFIX: 'reacthome-events',
        OPENSEARCH_CA_CERT: '~/.opensearch/root.crt',
        DURATION_DEBUG: 'true' // Зачем: диагностика расчёта duration (пишем в logs/event-logger-duration-*.jsonl)
      },
      // Зачем: Логи в отдельные файлы для удобного анализа
      // Зачем: PM2-логи складываем в logs/logger/pm2 для единообразия (WS и events тоже в logs/logger)
      error_file: './logs/logger/pm2/logger/error.log',
      out_file: './logs/logger/pm2/logger/out.log',
      log_file: './logs/logger/pm2/logger/combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      // Зачем: Автоматический перезапуск при сбоях для повышения надежности
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false
    },
    {
      name: 'logger-mindalny',
      script: './src/logging/event-logger.js',
      cwd: rootDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        DAEMON_WS_URL: `${GATE_URL}/${DAEMON_UUID_LUCHISTOE}`, // Зачем: подключение к Миндальному (Лучистое) через внешний шлюз
        PROJECT_DEFAULT: 'luchik', // Зачем: дефолтный project для событий Миндального (Лучистое)
        OPENSEARCH_ENABLED: process.env.OPENSEARCH_ENABLED || 'true',
        OPENSEARCH_URL: process.env.OPENSEARCH_URL || '',
        OPENSEARCH_USER: process.env.OPENSEARCH_USER || '',
        OPENSEARCH_PASSWORD: process.env.OPENSEARCH_PASSWORD || '',
        OPENSEARCH_INDEX_PREFIX: 'reacthome-events-mindalny',
        OPENSEARCH_CA_CERT: '~/.opensearch/root.crt',
        DURATION_DEBUG: 'true'
      },
      // Зачем: Логи в отдельные файлы для удобного анализа (отдельная папка для Миндального)
      error_file: './logs/logger/pm2/logger-mindalny/error.log',
      out_file: './logs/logger/pm2/logger-mindalny/out.log',
      log_file: './logs/logger/pm2/logger-mindalny/combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false
    }
  ]
};

