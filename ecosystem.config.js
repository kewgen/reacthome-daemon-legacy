// Зачем: Конфигурация PM2 для управления и мониторинга процессов демона локально
// Позволяет использовать pm2 monit для визуального мониторинга в реальном времени
module.exports = {
  apps: [
    {
      name: 'reacthome-daemon',
      script: 'daemon.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development'
      },
      // Зачем: Логи в отдельные файлы для удобного анализа
      error_file: './logs/daemon-error.log',
      out_file: './logs/daemon-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Зачем: Автоматический перезапуск при сбоях для повышения надежности
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      // Зачем: Мониторинг использования памяти для выявления утечек
      max_memory_restart: '500M'
    }
  ]
};















