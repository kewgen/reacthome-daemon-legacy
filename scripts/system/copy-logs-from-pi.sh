#!/bin/bash

#
# Копирование всех логов с Raspberry Pi
#
# Использование:
#   ./scripts/system/copy-logs-from-pi.sh
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
LOCAL_LOG_DIR="./backup/logs/pi-$(date +%Y%m%d-%H%M%S)"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "📦 Копирование всех логов с Raspberry Pi ($HOST)"
echo ""

# Создаём локальную директорию
mkdir -p "$LOCAL_LOG_DIR"
echo "📁 Локальная директория: $LOCAL_LOG_DIR"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

echo "=========================================="
echo "1. Копирование всех логов PM2"
echo "=========================================="
echo ""

echo "📦 Копирую всю директорию ~/.pm2/logs..."
mkdir -p "$LOCAL_LOG_DIR/pm2"

# Используем tar через SSH для надёжного копирования
run_on_pi "cd ~/.pm2 && tar -czf - logs/ 2>/dev/null" > "$LOCAL_LOG_DIR/pm2.tar.gz" 2>/dev/null

if [ -s "$LOCAL_LOG_DIR/pm2.tar.gz" ]; then
    cd "$LOCAL_LOG_DIR"
    tar -xzf pm2.tar.gz 2>/dev/null
    rm -f pm2.tar.gz
    cd - > /dev/null
    echo "✅ Логи PM2 скопированы"
    PM2_COUNT=$(find "$LOCAL_LOG_DIR/pm2" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "   Файлов: $PM2_COUNT"
else
    echo "⚠️  Логи PM2 не найдены или пусты"
fi
echo ""

echo "=========================================="
echo "2. Копирование системного лога PM2"
echo "=========================================="
echo ""

run_on_pi "cat ~/.pm2/pm2.log 2>/dev/null" > "$LOCAL_LOG_DIR/pm2-system.log"
if [ -s "$LOCAL_LOG_DIR/pm2-system.log" ]; then
    SIZE=$(stat -f%z "$LOCAL_LOG_DIR/pm2-system.log" 2>/dev/null || stat -c%s "$LOCAL_LOG_DIR/pm2-system.log" 2>/dev/null || echo "0")
    echo "✅ Системный лог PM2 скопирован ($SIZE байт)"
else
    echo "⚠️  Системный лог PM2 не найден или пуст"
    rm -f "$LOCAL_LOG_DIR/pm2-system.log"
fi
echo ""

echo "=========================================="
echo "3. Копирование логов приложения"
echo "=========================================="
echo ""

echo "📦 Копирую директорию var/log..."
mkdir -p "$LOCAL_LOG_DIR/app"

# Копируем через tar
run_on_pi "cd $PROJECT_DIR && tar -czf - var/log/ 2>/dev/null" > "$LOCAL_LOG_DIR/app.tar.gz" 2>/dev/null

if [ -s "$LOCAL_LOG_DIR/app.tar.gz" ]; then
    cd "$LOCAL_LOG_DIR"
    tar -xzf app.tar.gz 2>/dev/null
    rm -f app.tar.gz
    cd - > /dev/null
    echo "✅ Логи приложения скопированы"
    APP_COUNT=$(find "$LOCAL_LOG_DIR/app" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "   Файлов: $APP_COUNT"
else
    echo "⚠️  Логи приложения не найдены или пусты"
fi
echo ""

echo "=========================================="
echo "4. Копирование через PM2 logs"
echo "=========================================="
echo ""

echo "📦 Получаю последние логи демона (1000 строк)..."
mkdir -p "$LOCAL_LOG_DIR/pm2-live"

run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 1000 --nostream 2>&1" > "$LOCAL_LOG_DIR/pm2-live/daemon-latest.log" 2>/dev/null
run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 1000 --nostream 2>&1" > "$LOCAL_LOG_DIR/pm2-live/event-logger-latest.log" 2>/dev/null

LIVE_COUNT=$(find "$LOCAL_LOG_DIR/pm2-live" -type f -size +0 2>/dev/null | wc -l | tr -d ' ')
if [ "$LIVE_COUNT" -gt 0 ]; then
    echo "✅ Актуальные логи получены ($LIVE_COUNT файлов)"
else
    echo "⚠️  Актуальные логи не получены"
fi
echo ""

echo "=========================================="
echo "5. Статистика и создание архива"
echo "=========================================="
echo ""

TOTAL_FILES=$(find "$LOCAL_LOG_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$LOCAL_LOG_DIR" 2>/dev/null | cut -f1)

echo "Всего файлов: $TOTAL_FILES"
echo "Общий размер: $TOTAL_SIZE"
echo ""

if [ "$TOTAL_FILES" -gt 0 ]; then
    echo "📦 Создание архива..."
    ARCHIVE_NAME="pi-logs-$(date +%Y%m%d-%H%M%S).tar.gz"
    cd "$LOCAL_LOG_DIR/.."
    tar -czf "$ARCHIVE_NAME" "$(basename $LOCAL_LOG_DIR)" 2>/dev/null
    
    if [ -f "$ARCHIVE_NAME" ]; then
        ARCHIVE_SIZE=$(stat -f%z "$ARCHIVE_NAME" 2>/dev/null || stat -c%s "$ARCHIVE_NAME" 2>/dev/null || echo "0")
        ARCHIVE_SIZE_H=$(du -h "$ARCHIVE_NAME" 2>/dev/null | cut -f1)
        echo "✅ Архив создан: $ARCHIVE_NAME ($ARCHIVE_SIZE_H)"
    fi
else
    echo "⚠️  Нет файлов для архивации"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Копирование логов завершено"
echo "=========================================="
echo ""
echo "📁 Логи сохранены в:"
echo "   $(cd "$LOCAL_LOG_DIR" && pwd)"
echo ""

if [ "$TOTAL_FILES" -gt 0 ]; then
    echo "📊 Структура:"
    find "$LOCAL_LOG_DIR" -type f | head -20 | sed "s|$LOCAL_LOG_DIR/||" | sed 's/^/   /'
    if [ "$TOTAL_FILES" -gt 20 ]; then
        echo "   ... и ещё $(($TOTAL_FILES - 20)) файл(ов)"
    fi
    echo ""
fi

