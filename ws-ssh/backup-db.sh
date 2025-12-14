#!/bin/bash

# Скрипт для создания бэкапа БД через WebSocket SSH
# Зачем: Создаёт архив БД на удалённом демоне и передаёт его локально через base64

set -e

DAEMON_ID="${1:-}"
# Зачем: используем проекную папку backups по умолчанию, которая находится на уровень выше ws-ssh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_BACKUPS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/backups"
OUTPUT_DIR="${2:-$PROJECT_BACKUPS_DIR}"

if [ -z "$DAEMON_ID" ]; then
  echo "Использование: $0 <daemon-id> [output-dir]"
  echo ""
  echo "Примеры:"
  echo "  $0 d31775ae-19e8-40c9-81df-d6d672379563"
  echo "  $0 d31775ae-19e8-40c9-81df-d6d672379563 ./my-backups"
  exit 1
fi

# Создаём директорию для бэкапов
mkdir -p "$OUTPUT_DIR"

# Генерируем имя файла с timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$OUTPUT_DIR/db-backup-${DAEMON_ID:0:8}-${TIMESTAMP}.tar.gz"
TEMP_OUTPUT="/tmp/backup-output-$$.txt"

echo "=================================================================================="
echo "Создание бэкапа БД через WebSocket SSH"
echo "=================================================================================="
echo "Daemon ID: $DAEMON_ID"
echo "Файл будет сохранён: $BACKUP_FILE"
echo ""

# Выполняем команды через ws-ssh для создания архива и получения через base64
echo "Подключение к демону и создание архива..."
node index.js "$DAEMON_ID" \
  --cmd "cd ~/reacthome-daemon 2>/dev/null || cd /home/pi/reacthome-daemon 2>/dev/null || pwd" \
  --cmd "tar -czf /tmp/db-backup-$$.tar.gz var/db/ 2>&1 && echo 'BACKUP_READY'" \
  --cmd "base64 -w 0 /tmp/db-backup-$$.tar.gz 2>/dev/null || base64 /tmp/db-backup-$$.tar.gz" \
  --cmd "rm -f /tmp/db-backup-$$.tar.gz" \
  --wait-ms 5000 \
  > "$TEMP_OUTPUT" 2>&1

# Извлекаем base64 данные из вывода
# Ищем длинную строку base64 (без пробелов и переносов, > 1000 символов)
# Игнорируем строки с промптами терминала и ANSI escape-последовательностями
BASE64_DATA=$(grep -vE '^\$|^#|^\[|^✅|^Подключение|^WebSocket|^Терминал|^Введите|^BACKUP_READY|^pi@|^root@|^\[' "$TEMP_OUTPUT" | \
  sed 's/\x1b\[[0-9;]*m//g' | \
  grep -E '^[A-Za-z0-9+/]{1000,}={0,2}$' | head -1)

if [ -z "$BASE64_DATA" ]; then
  echo "Ошибка: не удалось извлечь данные бэкапа из вывода"
  echo ""
  echo "Последние строки вывода:"
  tail -30 "$TEMP_OUTPUT"
  echo ""
  echo "Полный вывод сохранён в: $TEMP_OUTPUT"
  exit 1
fi

# Декодируем base64 и сохраняем
echo "Декодирование и сохранение бэкапа..."
echo "$BASE64_DATA" | base64 -d > "$BACKUP_FILE" 2>/dev/null || {
  echo "Ошибка декодирования base64"
  exit 1
}

# Проверяем, что файл создан и не пустой
if [ ! -s "$BACKUP_FILE" ]; then
  echo "Ошибка: созданный файл пуст или повреждён"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Проверяем, что это валидный tar.gz
if ! tar -tzf "$BACKUP_FILE" > /dev/null 2>&1; then
  echo "Предупреждение: файл может быть повреждён (не удалось проверить как tar.gz)"
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo ""
echo "✅ Бэкап успешно создан!"
echo "   Файл: $BACKUP_FILE"
echo "   Размер: $SIZE"
echo ""

# Очистка
rm -f "$TEMP_OUTPUT"
