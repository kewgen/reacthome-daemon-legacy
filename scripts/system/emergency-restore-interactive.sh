#!/bin/bash

#
# Обёртка для запуска экстренного восстановления с запросом пароля
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "🔐 Экстренное восстановление сервера"
echo ""
echo "Введите пароль для доступа к Raspberry Pi:"
read -s REACTHOME_PI_PASS
export REACTHOME_PI_PASS

echo ""
echo "Путь к бэкапу (Enter для использования по умолчанию /tmp/db-backup-20251206_231611.tar.gz):"
read BACKUP_PATH

if [ -z "$BACKUP_PATH" ]; then
    BACKUP_PATH="/tmp/db-backup-20251206_231611.tar.gz"
fi

echo ""
echo "🚀 Запуск восстановления..."
echo ""

cd "$PROJECT_DIR"
"$SCRIPT_DIR/emergency-restore-server.sh" "$BACKUP_PATH"
