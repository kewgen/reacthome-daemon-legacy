#!/bin/bash

###############################################################################
# Скрипт для создания бекапа БД с малинки с меткой CRASH
# Зачем: Создает архив базы данных на малинке с меткой CRASH, останавливая
#        демон перед бэкапом для избежания блокировок LevelDB
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Конфигурация
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
REMOTE_PROJECT_DIR="/home/pi/reacthome-daemon"
REMOTE_DB_DIR="$REMOTE_PROJECT_DIR/var/db"
LOCAL_BACKUP_DIR="$PROJECT_DIR/backups"

# Создаём директорию для бекапов если её нет
mkdir -p "$LOCAL_BACKUP_DIR"

# Генерируем timestamp для имени файла
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REMOTE_BACKUP_FILE="/tmp/db-backup-CRASH-$TIMESTAMP.tar.gz"
LOCAL_BACKUP_FILE="$LOCAL_BACKUP_DIR/db-backup-CRASH-$TIMESTAMP.tar.gz"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   Создание бекапа БД с малинки (CRASH)                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Проверяем переменные окружения
if [ -z "$HOST" ] || [ -z "$USER" ]; then
  echo "❌ Ошибка: не заданы REACTHOME_PI_HOST или REACTHOME_PI_USER"
  echo "   Проверьте файл .env"
  exit 1
fi

echo "📊 Конфигурация:"
echo "   Pi Host: $HOST"
echo "   Pi User: $USER"
echo "   Remote DB: $REMOTE_DB_DIR"
echo "   Local Backup: $LOCAL_BACKUP_FILE"
echo ""

# Создаём временный expect скрипт для SSH команд
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
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    if [ -n "$PASS" ]; then
        "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
    else
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$USER@$HOST" "$1"
    fi
}

# Функция для копирования файлов с малинки
copy_from_pi() {
    local remote_file="$1"
    local local_file="$2"
    if [ -n "$PASS" ]; then
        expect << EOF
set timeout 120
set remote_file "$remote_file"
set local_file "$local_file"
set user "$USER"
set host "$HOST"
set pass "$PASS"
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \$user@\$host:\$remote_file \$local_file
expect {
    "*assword:" {
        send "\$pass\r"
        exp_continue
    }
    eof
}
EOF
    else
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$USER@$HOST:$remote_file" "$local_file"
    fi
}

# Очистка временных файлов при выходе
cleanup() {
    rm -f "$TMP_EXPECT"
    # Очищаем временный файл на малинке
    if [ -n "$PASS" ]; then
        run_on_pi "rm -f $REMOTE_BACKUP_FILE" 2>/dev/null || true
    else
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$USER@$HOST" "rm -f $REMOTE_BACKUP_FILE" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Проверяем существование БД на малинке
echo "🔍 Проверка БД на малинке..."
DB_CHECK=$(run_on_pi "ls -d $REMOTE_DB_DIR 2>/dev/null && echo 'EXISTS'" | tail -1)
if [ "$DB_CHECK" != "EXISTS" ]; then
  echo "❌ Ошибка: директория БД не найдена на малинке: $REMOTE_DB_DIR"
  echo "   Попытка найти БД..."
  ALTERNATIVE_DB=$(run_on_pi "find /home/pi -type d -name 'db' -path '*/var/db' 2>/dev/null | head -1")
  if [ -n "$ALTERNATIVE_DB" ] && [ "$ALTERNATIVE_DB" != "" ]; then
    echo "   Найдена альтернативная директория: $ALTERNATIVE_DB"
    REMOTE_DB_DIR="$ALTERNATIVE_DB"
    REMOTE_PROJECT_DIR=$(dirname $(dirname "$ALTERNATIVE_DB"))
  else
    echo "   БД не найдена. Проверьте путь на малинке."
    exit 1
  fi
fi

# Проверяем что в БД есть файлы
DB_FILE_COUNT=$(run_on_pi "ls -1 $REMOTE_DB_DIR 2>/dev/null | wc -l" | tr -d ' ' | head -1)
if [ -z "$DB_FILE_COUNT" ] || [ "$DB_FILE_COUNT" = "0" ]; then
  echo "⚠️  Предупреждение: БД может быть пуста (файлов: ${DB_FILE_COUNT:-0})"
else
  echo "✅ БД найдена, файлов: $DB_FILE_COUNT"
fi
echo ""

# Останавливаем демон перед бэкапом (избегаем блокировок LevelDB)
echo "🛑 Остановка демона перед бэкапом..."
DAEMON_STATUS=$(run_on_pi "pm2 list | grep daemon || echo 'not_running'")
if echo "$DAEMON_STATUS" | grep -q "online\|stopped"; then
  run_on_pi "pm2 stop daemon" > /dev/null 2>&1 || true
  echo "✅ Демон остановлен"
  sleep 2
else
  echo "ℹ️  Демон не запущен, пропускаем остановку"
fi
echo ""

# Создаём бекап на малинке
echo "📦 Создание бекапа на малинке..."
BACKUP_RESULT=$(run_on_pi "cd $REMOTE_PROJECT_DIR && tar -czf $REMOTE_BACKUP_FILE -C var db 2>&1 && echo 'ok' || echo 'error'")
if echo "$BACKUP_RESULT" | grep -q "ok"; then
  echo "✅ Бекап создан на малинке: $REMOTE_BACKUP_FILE"
else
  echo "❌ Ошибка при создании бекапа на малинке"
  echo "$BACKUP_RESULT"
  # Перезапускаем демон в случае ошибки
  run_on_pi "pm2 restart daemon" > /dev/null 2>&1 || true
  exit 1
fi
echo ""

# Скачиваем бекап локально
echo "⬇️  Скачивание бекапа локально..."
copy_from_pi "$REMOTE_BACKUP_FILE" "$LOCAL_BACKUP_FILE"

# Проверяем что файл скачан
if [ ! -f "$LOCAL_BACKUP_FILE" ]; then
  echo "❌ Ошибка: бекап не скачан локально"
  # Перезапускаем демон в случае ошибки
  run_on_pi "pm2 restart daemon" > /dev/null 2>&1 || true
  exit 1
fi

BACKUP_SIZE=$(du -sh "$LOCAL_BACKUP_FILE" | cut -f1)
echo "✅ Бекап скачан: $BACKUP_SIZE"
echo ""

# Перезапускаем демон после бэкапа
echo "🔄 Перезапуск демона..."
run_on_pi "pm2 restart daemon" > /dev/null 2>&1 || true
sleep 2
DAEMON_STATUS=$(run_on_pi "pm2 list | grep daemon || echo 'not_running'")
if echo "$DAEMON_STATUS" | grep -q "online"; then
  echo "✅ Демон перезапущен"
else
  echo "⚠️  Предупреждение: демон не запустился автоматически"
fi
echo ""

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   ✅ Бекап БД (CRASH) создан успешно                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📄 Файл: $LOCAL_BACKUP_FILE"
echo "📊 Размер: $BACKUP_SIZE"
echo ""













