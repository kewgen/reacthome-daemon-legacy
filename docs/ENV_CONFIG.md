# Конфигурация через переменные окружения

## Зачем
Безопасное хранение секретов (UUID демонов, пароли OpenSearch) вне кода репозитория.

## Быстрый старт

1. **Создайте файл `.env`** на основе `.env.example`:
   ```bash
   cp .env.example .env
   ```

2. **Заполните реальными значениями** в файле `.env`:
   ```bash
   # Обязательные переменные
   DAEMON_UUID_POCHTOVAYA=your-uuid-here
   DAEMON_UUID_LUCHISTOE=your-uuid-here
   
   # OpenSearch (если используется)
   OPENSEARCH_URL=https://your-opensearch-url:9200
   OPENSEARCH_USER=your-user
   OPENSEARCH_PASSWORD=your-password
   ```

3. **Запустите логгеры**:
   ```bash
   pm2 start scripts/ecosystem.config.js
   ```

## Переменные окружения

### UUID демонов (обязательные)
- `DAEMON_UUID_POCHTOVAYA` - UUID демона "Почтовая"
- `DAEMON_UUID_LUCHISTOE` - UUID демона "Лучистое" (Миндальный)

### WebSocket подключения
- `DAEMON_WS_URL` - URL локального демона (по умолчанию: `ws://192.168.88.4:3000`)
- `GATE_URL` - URL внешнего WebSocket шлюза (по умолчанию: `wss://gate.reacthome.net`)

### OpenSearch
- `OPENSEARCH_ENABLED` - Включить/выключить интеграцию (по умолчанию: `true`)
- `OPENSEARCH_URL` - URL OpenSearch кластера
- `OPENSEARCH_USER` - Имя пользователя OpenSearch
- `OPENSEARCH_PASSWORD` - Пароль OpenSearch
- `OPENSEARCH_INDEX_PREFIX` - Префикс индексов (по умолчанию: `reacthome-events`)
- `OPENSEARCH_CA_CERT` - Путь к CA сертификату (по умолчанию: `~/.opensearch/root.crt`)

### Отладка
- `DURATION_DEBUG` - Включить логирование duration (по умолчанию: `true`)

## Безопасность

⚠️ **ВАЖНО:**
- Файл `.env` находится в `.gitignore` и **не попадает в репозиторий**
- Никогда не коммитьте реальные секреты в код
- Используйте `.env.example` как шаблон (без реальных значений)
- Для разных окружений (dev/staging/prod) используйте отдельные `.env` файлы

## Как это работает

`scripts/ecosystem.config.js` автоматически загружает переменные из `.env` файла при запуске PM2. Если обязательные переменные не заданы, скрипт выдаст ошибку и остановится.

## Пример использования

```bash
# Установка переменных через .env (рекомендуется)
echo "DAEMON_UUID_LUCHISTOE=your-uuid" >> .env
pm2 restart logger-mindalny

# Или через переменные окружения напрямую
DAEMON_UUID_LUCHISTOE=your-uuid pm2 restart logger-mindalny --update-env
```

