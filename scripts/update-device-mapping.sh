#!/bin/bash

###############################################################################
# Скрипт для обновления маппинга устройств (device-mapping.json)
# Скачивает свежую БД с малинки и экспортирует маппинг
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TMP_DB_DIR="/tmp/reacthome-db"
MAPPING_FILE="$PROJECT_DIR/device-mapping.json"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   Обновление маппинга устройств                              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Проверяем переменные окружения
if [ -z "$REACTHOME_PI_HOST" ] || [ -z "$REACTHOME_PI_USER" ]; then
  echo "❌ Ошибка: не заданы REACTHOME_PI_HOST или REACTHOME_PI_USER"
  echo "   Проверьте файл .env"
  exit 1
fi

echo "📊 Конфигурация:"
echo "   Pi Host: $REACTHOME_PI_HOST"
echo "   Pi User: $REACTHOME_PI_USER"
echo "   Временная БД: $TMP_DB_DIR"
echo "   Выходной файл: $MAPPING_FILE"
echo ""

# Удаляем старую копию БД
if [ -d "$TMP_DB_DIR" ]; then
  echo "🗑️  Удаляем старую копию БД..."
  rm -rf "$TMP_DB_DIR"
fi

# Скачиваем БД с малинки
echo "⬇️  Скачиваем БД с малинки..."
if [ -n "$REACTHOME_PI_PASS" ]; then
  # С паролем через expect
  TMP_EXPECT=$(mktemp)
  cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
spawn scp -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $env(REACTHOME_PI_USER)@$env(REACTHOME_PI_HOST):/home/pi/reacthome-daemon/var/db $env(TMP_DB_DIR)
expect {
  "*assword:" { send "$env(REACTHOME_PI_PASS)\r"; exp_continue }
  eof
}
EXPECT_EOF
  chmod +x "$TMP_EXPECT"
  export TMP_DB_DIR
  "$TMP_EXPECT" 2>&1 | grep -v "password:\|spawn\|Warning:" || true
  rm -f "$TMP_EXPECT"
else
  # Без пароля (SSH ключи)
  scp -r "$REACTHOME_PI_USER@$REACTHOME_PI_HOST:/home/pi/reacthome-daemon/var/db" "$TMP_DB_DIR"
fi

# Проверяем что БД скачана
if [ ! -d "$TMP_DB_DIR" ]; then
  echo "❌ Ошибка: не удалось скачать БД"
  exit 1
fi

echo "✅ БД скачана: $(du -sh "$TMP_DB_DIR" | cut -f1)"
echo ""

# Создаём backup старого маппинга
if [ -f "$MAPPING_FILE" ]; then
  BACKUP_FILE="${MAPPING_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
  echo "💾 Создаём backup: $(basename "$BACKUP_FILE")"
  cp "$MAPPING_FILE" "$BACKUP_FILE"
  echo ""
fi

# Экспортируем маппинг
echo "🔄 Экспортируем маппинг..."
cd "$PROJECT_DIR"
node scripts/export-device-mapping.js "$TMP_DB_DIR" "$MAPPING_FILE"

# Проверяем результат
if [ ! -f "$MAPPING_FILE" ]; then
  echo "❌ Ошибка: маппинг не создан"
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   ✅ Маппинг обновлён                                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📄 Файл: $MAPPING_FILE"
echo "📊 Размер: $(du -sh "$MAPPING_FILE" | cut -f1)"
echo ""

# Показываем статистику
if command -v jq &> /dev/null; then
  TOTAL=$(jq '. | length' "$MAPPING_FILE")
  WITH_NAMES=$(jq '[.[] | select(.human != null)] | length' "$MAPPING_FILE")
  echo "📈 Устройств: $TOTAL"
  echo "   С именами: $WITH_NAMES"
fi

echo ""
echo "💡 Для применения изменений перезапустите монитор:"
echo "   pkill -f monitor-device.js && node monitor-device.js &"
