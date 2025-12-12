# Имя процесса event-logger в PM2

**Дата обновления:** 2025-12-08

## ⚠️ Важно

Процесс event-logger в PM2 называется **`events`** (сокращённое имя).

## Правильные команды

### Проверка статуса
```bash
pm2 status events
pm2 show events
```

### Управление процессом
```bash
# Перезапуск
pm2 restart events

# Остановка
pm2 stop events

# Запуск (если не запущен)
pm2 start event-logger.js --name events

# Удаление из PM2
pm2 delete events
```

### Просмотр логов
```bash
# Все логи
pm2 logs events

# Только ошибки
pm2 logs events --err

# Последние N строк
pm2 logs events --lines 50 --nostream
```

## Неправильные команды (старое имя)

❌ **НЕ используйте:**
```bash
pm2 restart events  # ❌ Неправильно
pm2 logs events     # ❌ Неправильно
```

## История переименования

- **Старое имя:** `reacthome-event-logger` (полное)
- **Новое имя:** `events` (сокращённое)
- **Причина:** Упрощение и стандартизация имён процессов

## Конфигурация PM2

Процесс настроен следующим образом:

```json
{
  "name": "events",
  "script": "/home/pi/reacthome-daemon/event-logger.js",
  "log_file": "/home/pi/reacthome-daemon/var/log/events-out.log",
  "error_file": "/home/pi/reacthome-daemon/var/log/events-error.log"
}
```

## Локальные скрипты

Все скрипты в `scripts/system/` обновлены для использования правильного имени `events`.

Для массового исправления используйте:
```bash
./scripts/system/fix-pm2-process-name.sh
```

## См. также

- `scripts/system/restart-event-logger-force.sh` - Принудительный перезапуск
- `scripts/system/check-event-logger-status-quick.sh` - Быстрая проверка статуса
- `scripts/system/start-event-logger-on-pi.sh` - Запуск event-logger
- `scripts/system/stop-event-logger-on-pi.sh` - Остановка event-logger
