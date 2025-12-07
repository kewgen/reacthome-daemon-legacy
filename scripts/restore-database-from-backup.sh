#!/bin/bash

# Скрипт для восстановления БД из бэкапа
# Использование: ./restore-db-from-backup.sh

BACKUP_FILE="/tmp/db-backup-20251206_231611.tar.gz"
DB_DIR="/home/pi/reacthome-daemon/var/db"
CURRENT_BACKUP="/tmp/db-current-$(date +%Y%m%d_%H%M%S).tar.gz"

echo "🔄 Начало восстановления БД из бэкапа..."
echo ""

# Проверка наличия бэкапа
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Ошибка: бэкап не найден: $BACKUP_FILE"
    echo "   Убедитесь, что бэкап скопирован на малинку"
    exit 1
fi

echo "✅ Бэкап найден: $BACKUP_FILE"
echo ""

# 1. Остановить демон
echo "1. Остановка демона..."
pm2 stop daemon
if [ $? -ne 0 ]; then
    echo "❌ Ошибка при остановке демона"
    exit 1
fi
echo "   ✅ Демон остановлен"
echo ""

# 2. Создать бэкап текущей БД
echo "2. Создание бэкапа текущей БД..."
if [ -d "$DB_DIR" ]; then
    tar -czf "$CURRENT_BACKUP" "$DB_DIR"
    if [ $? -eq 0 ]; then
        echo "   ✅ Текущая БД сохранена в: $CURRENT_BACKUP"
    else
        echo "   ⚠️  Не удалось создать бэкап текущей БД (продолжаем)"
    fi
else
    echo "   ⚠️  Директория БД не найдена (пропускаем бэкап)"
fi
echo ""

# 3. Удалить текущую БД
echo "3. Удаление текущей БД..."
rm -rf "$DB_DIR"/*
if [ $? -eq 0 ]; then
    echo "   ✅ Текущая БД удалена"
else
    echo "   ❌ Ошибка при удалении текущей БД"
    exit 1
fi
echo ""

# 4. Распаковать бэкап
echo "4. Распаковка бэкапа..."
cd /home/pi/reacthome-daemon
tar -xzf "$BACKUP_FILE" --strip-components=1
if [ $? -eq 0 ]; then
    echo "   ✅ Бэкап распакован"
else
    echo "   ❌ Ошибка при распаковке бэкапа"
    exit 1
fi
echo ""

# 5. Проверить права доступа
echo "5. Проверка прав доступа..."
chown -R pi:pi "$DB_DIR"
if [ $? -eq 0 ]; then
    echo "   ✅ Права доступа установлены"
else
    echo "   ⚠️  Не удалось установить права (продолжаем)"
fi
echo ""

# 6. Проверить содержимое восстановленной БД
echo "6. Проверка содержимого БД..."
DB_SIZE=$(du -sh "$DB_DIR" | cut -f1)
FILE_COUNT=$(ls -1 "$DB_DIR" | wc -l)
echo "   Размер БД: $DB_SIZE"
echo "   Файлов: $FILE_COUNT"
echo ""

# 7. Перезапустить демон
echo "7. Перезапуск демона..."
pm2 restart daemon
if [ $? -ne 0 ]; then
    echo "❌ Ошибка при перезапуске демона"
    exit 1
fi
echo "   ✅ Демон перезапущен"
echo ""

# 8. Проверить статус
echo "✅ Восстановление завершено!"
echo ""
echo "Проверка статуса через 5 секунд..."
sleep 5

echo ""
echo "=== Статус PM2 ==="
pm2 list | grep daemon

echo ""
echo "=== Логи демона (последние 30 строк) ==="
pm2 logs daemon --lines 30 --nostream | tail -35

echo ""
echo "=== Проверка загрузки БД ==="
echo "Ищем сообщение о загрузке записей..."
pm2 logs daemon --lines 100 --nostream | grep -E "(Загружено записей|state.init)" | tail -5

echo ""
echo "✅ Готово!"
echo ""
echo "Если в логах есть '[DAEMON] ✅ Загружено записей из LevelDB: 1987'"
echo "то восстановление прошло успешно!"
echo ""
echo "Если есть проблемы, текущая БД сохранена в: $CURRENT_BACKUP"
