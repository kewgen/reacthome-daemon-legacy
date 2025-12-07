#!/bin/bash

#
# План отката при неудачном восстановлении
# Восстанавливает систему из бэкапов, созданных перед восстановлением
#
# Использование:
#   ./scripts/system/emergency-rollback.sh [путь_к_директории_с_бэкапами]
#
# Пример:
#   ./scripts/system/emergency-rollback.sh ./backups/emergency-restore-20250128_120000
#

set -e

# Конфигурация
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
DB_DIR="$PROJECT_DIR/var/db"
BACKUP_DIR="${1:-}"

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_step() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
    echo ""
}

# Проверка аргументов
if [ -z "$BACKUP_DIR" ]; then
    log_error "Не указана директория с бэкапами"
    echo "Использование: $0 [путь_к_директории_с_бэкапами]"
    echo ""
    echo "Пример:"
    echo "  $0 ./backups/emergency-restore-20250128_120000"
    exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
    log_error "Директория с бэкапами не найдена: $BACKUP_DIR"
    exit 1
fi

# Проверка переменных окружения
if [ -z "$PASS" ]; then
    log_error "Переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

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
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

copy_to_pi() {
    local local_file="$1"
    local remote_file="$2"
    expect << EOF
set timeout 120
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$local_file" $USER@$HOST:"$remote_file"
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
EOF
}

cleanup() {
    rm -f "$TMP_EXPECT"
}
trap cleanup EXIT

echo ""
log_info "План отката системы"
echo "   Хост: $HOST"
echo "   Директория с бэкапами: $BACKUP_DIR"
echo ""

# Проверка наличия бэкапов
DB_BACKUP="$BACKUP_DIR/db-current.tar.gz"
if [ ! -f "$DB_BACKUP" ]; then
    log_error "Бэкап БД не найден: $DB_BACKUP"
    exit 1
fi
log_info "Бэкап БД найден: $DB_BACKUP"

# ==========================================
# ШАГ 1: Остановка демона
# ==========================================
log_step "ШАГ 1: Остановка демона"

log_info "Остановка демона..."
run_on_pi "cd $PROJECT_DIR && pm2 stop daemon 2>&1 || echo 'Демон уже остановлен'"
sleep 2
log_info "Демон остановлен"

# ==========================================
# ШАГ 2: Восстановление БД
# ==========================================
log_step "ШАГ 2: Восстановление БД из бэкапа"

log_info "Копирование бэкапа БД на малинку..."
REMOTE_DB_BACKUP="/tmp/db-rollback-$(date +%Y%m%d_%H%M%S).tar.gz"
copy_to_pi "$DB_BACKUP" "$REMOTE_DB_BACKUP"

log_info "Очистка текущей БД..."
run_on_pi "cd $PROJECT_DIR && rm -rf $DB_DIR/* 2>&1"

log_info "Восстановление БД..."
run_on_pi "cd $PROJECT_DIR && tar -xzf $REMOTE_DB_BACKUP -C var 2>&1"

log_info "Проверка прав доступа..."
run_on_pi "chown -R pi:pi $DB_DIR 2>&1"

log_info "Проверка восстановленной БД..."
DB_SIZE=$(run_on_pi "du -sh $DB_DIR 2>/dev/null | cut -f1")
DB_FILES=$(run_on_pi "ls -1 $DB_DIR 2>/dev/null | wc -l")
log_info "Размер БД: $DB_SIZE"
log_info "Файлов в БД: $DB_FILES"

# ==========================================
# ШАГ 3: Восстановление кода (если нужно)
# ==========================================
log_step "ШАГ 3: Проверка состояния кода"

log_info "Текущая ветка и коммит..."
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
CURRENT_COMMIT=$(run_on_pi "cd $PROJECT_DIR && git log -1 --oneline")
log_info "Ветка: $CURRENT_BRANCH"
log_info "Коммит: $CURRENT_COMMIT"

log_info "Если нужно вернуть код к предыдущему состоянию, выполните вручную:"
echo "   ssh $USER@$HOST 'cd $PROJECT_DIR && git reset --hard HEAD@{1}'"
echo "   или"
echo "   ssh $USER@$HOST 'cd $PROJECT_DIR && git reset --hard <commit_hash>'"

# ==========================================
# ШАГ 4: Восстановление логов (опционально)
# ==========================================
LOG_BACKUP="$BACKUP_DIR/logs-current.tar.gz"
if [ -f "$LOG_BACKUP" ]; then
    log_step "ШАГ 4: Восстановление логов (опционально)"
    log_info "Бэкап логов найден, но восстановление не выполняется"
    log_info "Логи будут перезаписаны при следующем запуске демона"
fi

# ==========================================
# ШАГ 5: Запуск демона
# ==========================================
log_step "ШАГ 5: Запуск демона"

log_info "Запуск демона..."
run_on_pi "cd $PROJECT_DIR && pm2 start daemon 2>&1 || pm2 restart daemon 2>&1"
sleep 5

log_info "Проверка статуса демона..."
DAEMON_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep daemon")
echo "$DAEMON_STATUS"

# ==========================================
# ШАГ 6: Проверка
# ==========================================
log_step "ШАГ 6: Проверка восстановления"

log_info "Ожидание инициализации (10 секунд)..."
sleep 10

log_info "Последние логи демона (30 строк):"
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 30 --nostream 2>&1 | tail -35")
echo "$DAEMON_LOGS"

log_info "Поиск ошибок..."
ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE '(error|Error|ERROR|exception|Exception|fatal|Fatal|FATAL)' | tail -10")
if [ -n "$ERRORS" ]; then
    log_warn "Найдены ошибки:"
    echo "$ERRORS"
else
    log_info "Критических ошибок не найдено"
fi

# Очистка временных файлов
run_on_pi "rm -f $REMOTE_DB_BACKUP 2>&1"

# ==========================================
# ИТОГИ
# ==========================================
log_step "ИТОГИ ОТКАТА"

if echo "$DAEMON_STATUS" | grep -q "online"; then
    log_info "✅ Откат выполнен успешно, демон работает"
else
    log_error "⚠️  Демон не работает после отката"
    echo ""
    echo "Проверьте логи для диагностики:"
    echo "   ssh $USER@$HOST 'cd $PROJECT_DIR && pm2 logs daemon --lines 200'"
fi

echo ""
log_info "Готово!"
