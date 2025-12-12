#!/bin/bash

# Скрипт для очистки лишних файлов на Raspberry Pi
# ВНИМАНИЕ: Выполнять только после проверки!

HOST="192.168.88.4"
USER="pi"
PASS="${REACTHOME_PI_PASS:-raspberry}"
PROJECT_DIR="/home/pi/reacthome-daemon"

echo "🧹 Очистка лишних файлов на Raspberry Pi..."
echo "⚠️  ВНИМАНИЕ: Этот скрипт удалит неотслеживаемые файлы!"
echo ""
read -p "Продолжить? (yes/no): " -r
if [[ ! $REPLY == "yes" ]]; then
    echo "Отменено"
    exit 1
fi

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no $USER@$HOST "cd $PROJECT_DIR && echo '=== Удаление дубликатов ===' && rm -f event-log.js filters.js opensearch.js service.js src/create.js src/event-log.js && echo '✅ Дубликаты удалены' && echo '' && echo '=== Удаление служебных файлов macOS ===' && find . -name '._*' -type f -delete && echo '✅ Служебные файлы удалены' && echo '' && echo '=== Удаление временных скриптов ===' && rm -f check-opensearch-events.js collect_site_names.js update_opensearch_mapping.js && echo '✅ Временные скрипты удалены' && echo '' && echo '=== Удаление файлов миграции (если не применяется) ===' && echo '⚠️  Пропущено (требуется ручная проверка)' && echo '' && echo '=== Финальный статус ===' && git status --short"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

echo ""
echo "✅ Очистка завершена"



