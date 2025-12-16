# Локальный мониторинг сервера через PM2

## Установка PM2

PM2 уже установлен глобально. Если нужно переустановить:

```bash
npm install -g pm2
```

## Запуск сервера через PM2

### Вариант 1: Через ecosystem.config.js (рекомендуется)

```bash
# Запуск демона
pm2 start ecosystem.config.js

# Или запуск конкретного процесса
pm2 start ecosystem.config.js --only reacthome-daemon
```

### Вариант 2: Прямой запуск

```bash
pm2 start daemon.js --name reacthome-daemon
```

## Мониторинг через pm2 monit

После запуска сервера через PM2, используйте команду для визуального мониторинга:

```bash
pm2 monit
```

### Что показывает pm2 monit:

- **CPU usage** — использование процессора каждым процессом
- **Memory usage** — использование памяти (heap, RSS)
- **Logs** — логи в реальном времени (stdout/stderr)
- **Restart count** — количество перезапусков
- **Uptime** — время работы процесса

### Управление в pm2 monit:

- `Ctrl+C` — выход из мониторинга
- Логи обновляются автоматически в реальном времени

## Полезные команды PM2

```bash
# Список всех процессов
pm2 list

# Детальная информация о процессе
pm2 describe reacthome-daemon

# Логи процесса
pm2 logs reacthome-daemon

# Логи последних 100 строк
pm2 logs reacthome-daemon --lines 100

# Перезапуск процесса
pm2 restart reacthome-daemon

# Остановка процесса
pm2 stop reacthome-daemon

# Удаление процесса из PM2
pm2 delete reacthome-daemon

# Сохранение текущей конфигурации
pm2 save

# Автозапуск при перезагрузке системы (macOS)
pm2 startup
pm2 save
```

## Структура логов

Логи сохраняются в:
- `./logs/daemon-out.log` — стандартный вывод
- `./logs/daemon-error.log` — ошибки
- `./logs/daemon-combined.log` — объединённый лог (если включён merge_logs)

Убедитесь, что папка `./logs/` существует. PM2 создаст её автоматически при первом запуске.

## Пример использования

```bash
# 1. Запустить сервер
pm2 start ecosystem.config.js

# 2. Открыть мониторинг
pm2 monit

# 3. В другом терминале можно смотреть логи
pm2 logs reacthome-daemon --lines 50
```

## Конфигурация ecosystem.config.js

Файл `ecosystem.config.js` содержит настройки для PM2:

- **name** — имя процесса (reacthome-daemon)
- **script** — точка входа (./daemon.js)
- **instances** — количество экземпляров (1)
- **exec_mode** — режим выполнения (fork)
- **max_memory_restart** — автоматический перезапуск при превышении памяти (500M)
- **error_file/out_file** — пути к файлам логов
- **autorestart** — автоматический перезапуск при сбоях
- **max_restarts** — максимальное количество перезапусков (10)
- **min_uptime** — минимальное время работы для успешного старта (10s)
- **restart_delay** — задержка перед перезапуском (4000ms)

## Отличия от малинки

На Raspberry Pi процессы управляются через PM2 удаленно. Локально `pm2 monit` покажет только процессы, запущенные на вашем Mac через PM2.

Для мониторинга процессов на малинке используйте SSH:

```bash
ssh pi@<IP_МАЛИНКИ> "pm2 monit"
```

