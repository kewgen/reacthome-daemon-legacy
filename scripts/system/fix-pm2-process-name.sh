#!/bin/bash

###############################################################################
# Массовая замена reacthome-event-logger на events во всех скриптах
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   Исправление имени процесса PM2 в скриптах                 ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

cd "$PROJECT_ROOT"

# Находим все скрипты с reacthome-event-logger
FILES=$(find scripts -name "*.sh" -type f -exec grep events" {} \;)

if [ -z "$FILES" ]; then
    echo "✅ Файлы с reacthome-event-logger не найдены"
    exit 0
fi

echo "📋 Найдено файлов для исправления:"
echo "$FILES" | wc -l | xargs echo
echo ""

# Создаём backup
BACKUP_DIR="$PROJECT_ROOT/scripts-backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "💾 Создаю backup в: $BACKUP_DIR"

for file in $FILES; do
    cp "$file" "$BACKUP_DIR/$(basename $file)"
done

echo ""

# Заменяем reacthome-event-logger на events
echo "🔄 Замена reacthome-event-logger → events..."
COUNT=0

for file in $FILES; do
    # Заменяем только в контексте PM2 команд
    sed -i.bak \
        -e 's/pm2 restart events/pm2 restart events/g' \
        -e 's/pm2 start event-logger\.js --name reacthome-event-logger/pm2 start event-logger.js --name events/g' \
        -e 's/pm2 stop events/pm2 stop events/g' \
        -e 's/pm2 delete events/pm2 delete events/g' \
        -e 's/pm2 status events/pm2 status events/g' \
        -e 's/pm2 logs events/pm2 logs events/g' \
        -e 's/pm2 show events/pm2 show events/g' \
        -e 's/pm2 list | grep events/pm2 list | grep events/g' \
        -e 's/grep events/grep events/g' \
        "$file"
    
    # Удаляем .bak файлы
    rm -f "$file.bak"
    
    COUNT=$((COUNT + 1))
    echo "  ✅ $file"
done

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   ✅ Исправлено файлов: $COUNT                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "💾 Backup сохранён в: $BACKUP_DIR"
echo ""
echo "📝 Проверьте изменения:"
echo "   git diff scripts/"
echo ""
