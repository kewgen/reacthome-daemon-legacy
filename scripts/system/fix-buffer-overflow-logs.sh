#!/bin/bash

#
# Отключение избыточного логирования переполнения буфера
#
# Проблема: Каждое переполнение буфера создаёт лог-сообщение,
# что засоряет логи сотнями сообщений в минуту
#
# Решение: Заменить на менее частое логирование (раз в 100 событий)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "🔧 Исправление логирования переполнения буфера на Raspberry Pi ($HOST)"
echo ""

# Скачиваем файл
echo "=========================================="
echo "1. Скачивание event-logger.js"
echo "=========================================="
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null pi@192.168.88.4:/home/pi/reacthome-daemon/event-logger.js /tmp/event-logger-temp.js
expect {
  "*assword:" { send "$env(REACTHOME_PI_PASS)\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"
"$TMP_EXPECT" 2>&1 | grep -v "password:\|spawn\|Warning:" | tail -1
rm -f "$TMP_EXPECT"

if [ ! -f "/tmp/event-logger-temp.js" ]; then
    echo "❌ Ошибка скачивания файла"
    exit 1
fi

LINES=$(wc -l < /tmp/event-logger-temp.js)
echo "✅ Файл скачан: $LINES строк"
echo ""

# Исправляем файл локально
echo "=========================================="
echo "2. Исправление логирования"
echo "=========================================="

# Находим строку с console.log('Буфер переполнен...')
# и заменяем на менее частое логирование
sed -i.bak '/console\.log(`Буфер переполнен, удалено старое событие:/{
  s/.*/    \/\/ Логируем только каждое 100-е переполнение/
  a\    if (eventBuffer.length % 100 === 0) {\
      console.log(`⚠️ Буфер переполнен (${eventBuffer.length} событий в очереди), старые события удаляются`);\
    }
}' /tmp/event-logger-temp.js

echo "✅ Файл исправлен"
echo ""

# Проверяем синтаксис
echo "=========================================="
echo "3. Проверка синтаксиса"
echo "=========================================="
if node -c /tmp/event-logger-temp.js 2>&1; then
    echo "✅ Синтаксис корректен"
else
    echo "❌ Ошибка синтаксиса"
    rm -f /tmp/event-logger-temp.js /tmp/event-logger-temp.js.bak
    exit 1
fi
echo ""

# Загружаем обратно
echo "=========================================="
echo "4. Загрузка исправленного файла"
echo "=========================================="
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null /tmp/event-logger-temp.js pi@192.168.88.4:/home/pi/reacthome-daemon/event-logger.js
expect {
  "*assword:" { send "$env(REACTHOME_PI_PASS)\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"
"$TMP_EXPECT" 2>&1 | grep -v "password:\|spawn\|Warning:" | tail -1
rm -f "$TMP_EXPECT"
echo "✅ Файл загружен"
echo ""

# Перезапускаем
echo "=========================================="
echo "5. Перезапуск events"
echo "=========================================="
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null pi@192.168.88.4 "cd /home/pi/reacthome-daemon && pm2 restart events"
expect {
  "*assword:" { send "$env(REACTHOME_PI_PASS)\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"
"$TMP_EXPECT" 2>&1 | grep -v "password:\|spawn\|Warning:" | grep -E "Applying action|✓|status"
rm -f "$TMP_EXPECT"
echo "✅ Процесс перезапущен"
echo ""

# Проверяем логи
echo "=========================================="
echo "6. Проверка логов (через 5 секунд)"
echo "=========================================="
sleep 5
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null pi@192.168.88.4 "cd /home/pi/reacthome-daemon && pm2 logs events --lines 20 --nostream"
expect {
  "*assword:" { send "$env(REACTHOME_PI_PASS)\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"
"$TMP_EXPECT" 2>&1 | grep -v "password:\|spawn\|Warning:" | tail -20
rm -f "$TMP_EXPECT"
echo ""

# Очистка
rm -f /tmp/event-logger-temp.js /tmp/event-logger-temp.js.bak

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="
echo ""
echo "Теперь логи переполнения буфера будут появляться"
echo "только каждые 100 событий вместо каждого события."
echo ""
echo "Для полного решения проблемы необходимо:"
echo "1. Проверить доступность OpenSearch кластера"
echo "2. Обновить OPENSEARCH_URL если кластер изменился"
echo "3. Или увеличить BUFFER_MAX_SIZE в pi-event-logger.js"
echo ""
