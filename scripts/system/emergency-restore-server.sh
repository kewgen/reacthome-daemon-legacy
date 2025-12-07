#!/bin/bash

#
# Экстренное восстановление сервера демона
# Выполняет полное восстановление из бэкапа БД и приведение кода к начальному состоянию
#
# Использование:
#   ./scripts/system/emergency-restore-server.sh [путь_к_бэкапу]
#
# Пример:
#   ./scripts/system/emergency-restore-server.sh /tmp/db-backup-20251206_231611.tar.gz
#

set -e  # Остановка при ошибке

# Конфигурация
HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
DB_DIR="$PROJECT_DIR/var/db"
BACKUP_FILE="${1:-/tmp/db-backup-20251206_231611.tar.gz}"

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для вывода сообщений
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

# Проверка переменных окружения
if [ -z "$PASS" ]; then
    log_error "Переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

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
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

# Функция для копирования файлов на малинку
copy_to_pi() {
    local local_file="$1"
    local remote_file="$2"
    expect << EOF
set timeout 120
set local_file "$local_file"
set remote_file "$remote_file"
set user "$USER"
set host "$HOST"
set pass "$PASS"
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \$local_file \$user@\$host:\$remote_file
expect {
    "*assword:" {
        send "\$pass\r"
        exp_continue
    }
    eof
}
EOF
}

# Функция для копирования файлов с малинки
copy_from_pi() {
    local remote_file="$1"
    local local_file="$2"
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
}

# Очистка временных файлов при выходе
cleanup() {
    rm -f "$TMP_EXPECT"
}
trap cleanup EXIT

echo ""
log_info "Экстренное восстановление сервера демона"
echo "   Хост: $HOST"
echo "   Проект: $PROJECT_DIR"
echo "   Бэкап: $BACKUP_FILE"
echo ""

# ==========================================
# ШАГ 0: Подготовка
# ==========================================
log_step "ШАГ 0: Подготовка и проверки"

# Проверка наличия бэкапа локально
if [ ! -f "$BACKUP_FILE" ]; then
    log_warn "Бэкап не найден локально: $BACKUP_FILE"
    log_info "Проверяю наличие бэкапа на малинке..."
    BACKUP_EXISTS=$(run_on_pi "test -f $BACKUP_FILE && echo 'yes' || echo 'no'")
    if [ "$BACKUP_EXISTS" != "yes" ]; then
        log_error "Бэкап не найден ни локально, ни на малинке: $BACKUP_FILE"
        echo "   Убедитесь, что бэкап скопирован на малинку или укажите правильный путь"
        exit 1
    fi
    log_info "Бэкап найден на малинке"
else
    log_info "Бэкап найден локально, копирую на малинку..."
    copy_to_pi "$BACKUP_FILE" "/tmp/$(basename $BACKUP_FILE)"
    BACKUP_FILE="/tmp/$(basename $BACKUP_FILE)"
    log_info "Бэкап скопирован на малинку: $BACKUP_FILE"
fi

# Проверка целостности архива
log_info "Проверка целостности архива..."
ARCHIVE_CHECK=$(run_on_pi "tar -tzf $BACKUP_FILE > /dev/null 2>&1 && echo 'ARCHIVE_OK' || echo 'ARCHIVE_ERROR'")
if ! echo "$ARCHIVE_CHECK" | grep -q "ARCHIVE_OK"; then
    log_error "Архив повреждён или не является валидным tar.gz файлом"
    exit 1
fi
log_info "Архив валиден"

# Проверка структуры архива
log_info "Проверка структуры архива..."
ARCHIVE_CONTENT=$(run_on_pi "tar -tzf $BACKUP_FILE | head -5")
if ! echo "$ARCHIVE_CONTENT" | grep -q "var/db"; then
    log_warn "Архив может иметь неожиданную структуру"
    log_info "Первые файлы в архиве:"
    echo "$ARCHIVE_CONTENT"
fi

# Создание директории для бэкапов текущего состояния
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups/emergency-restore-$TIMESTAMP"
mkdir -p "$BACKUP_DIR"
log_info "Директория для бэкапов: $BACKUP_DIR"

# ==========================================
# ШАГ 1: Остановка демона
# ==========================================
log_step "ШАГ 1: Остановка демона"

log_info "Проверка статуса демона перед остановкой..."
DAEMON_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep daemon || echo 'not_running'")
echo "$DAEMON_STATUS"

log_info "Остановка демона..."
run_on_pi "cd $PROJECT_DIR && pm2 stop daemon 2>&1 || echo 'Демон уже остановлен'"
sleep 2

log_info "Проверка остановки..."
DAEMON_STATUS_AFTER=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep daemon || echo 'stopped'")
if echo "$DAEMON_STATUS_AFTER" | grep -q "online\|errored"; then
    log_warn "Демон всё ещё работает, принудительная остановка..."
    run_on_pi "cd $PROJECT_DIR && pm2 stop daemon --force 2>&1"
    sleep 2
fi
log_info "Демон остановлен"

# ==========================================
# ШАГ 2: Создание бэкапа текущего состояния
# ==========================================
log_step "ШАГ 2: Создание бэкапа текущего состояния"

# Бэкап БД
log_info "Создание бэкапа текущей БД..."
CURRENT_DB_BACKUP="/tmp/db-current-$TIMESTAMP.tar.gz"
DB_BACKUP_RESULT=$(run_on_pi "cd $PROJECT_DIR && tar -czf $CURRENT_DB_BACKUP -C var db 2>&1 && echo 'ok' || echo 'error'")
if [ "$DB_BACKUP_RESULT" = "ok" ]; then
    log_info "Бэкап БД создан: $CURRENT_DB_BACKUP"
    # Копируем бэкап локально
    copy_from_pi "$CURRENT_DB_BACKUP" "$BACKUP_DIR/db-current.tar.gz"
    log_info "Бэкап БД скопирован локально"
else
    log_warn "Не удалось создать бэкап БД (возможно, БД пуста или повреждена)"
fi

# Бэкап логов
log_info "Создание бэкапа логов..."
LOG_BACKUP_RESULT=$(run_on_pi "cd ~ && tar -czf /tmp/logs-current-$TIMESTAMP.tar.gz .pm2/logs .pm2/pm2.log 2>/dev/null && echo 'ok' || echo 'error'")
if [ "$LOG_BACKUP_RESULT" = "ok" ]; then
    log_info "Бэкап логов создан"
    copy_from_pi "/tmp/logs-current-$TIMESTAMP.tar.gz" "$BACKUP_DIR/logs-current.tar.gz"
    log_info "Бэкап логов скопирован локально"
else
    log_warn "Не удалось создать бэкап логов"
fi

# Бэкап event логов (если есть)
log_info "Проверка event логов..."
EVENT_LOGS=$(run_on_pi "cd $PROJECT_DIR && find var/log -name 'events-*.jsonl' 2>/dev/null | head -5")
if [ -n "$EVENT_LOGS" ]; then
    log_info "Найдены event логи, создаю бэкап..."
    run_on_pi "cd $PROJECT_DIR && tar -czf /tmp/event-logs-current-$TIMESTAMP.tar.gz -C var log 2>/dev/null && echo 'ok' || echo 'error'"
    copy_from_pi "/tmp/event-logs-current-$TIMESTAMP.tar.gz" "$BACKUP_DIR/event-logs-current.tar.gz" 2>/dev/null || true
fi

# ==========================================
# ШАГ 3: Удаление всех логов
# ==========================================
log_step "ШАГ 3: Удаление всех логов"

log_info "Удаление логов PM2..."
run_on_pi "rm -f ~/.pm2/logs/daemon-*.log ~/.pm2/pm2.log 2>/dev/null && echo 'Логи PM2 удалены' || echo 'Логи PM2 не найдены'"

log_info "Удаление event логов..."
run_on_pi "cd $PROJECT_DIR && rm -f var/log/events-*.jsonl 2>/dev/null && echo 'Event логи удалены' || echo 'Event логи не найдены'"

log_info "Удаление логов LevelDB..."
run_on_pi "cd $PROJECT_DIR && rm -f var/db/LOG 2>/dev/null && echo 'Логи LevelDB удалены' || echo 'Логи LevelDB не найдены'"

log_info "Логи удалены"

# ==========================================
# ШАГ 4: Очистка БД
# ==========================================
log_step "ШАГ 4: Очистка базы данных"

log_info "Удаление содержимого БД..."
run_on_pi "cd $PROJECT_DIR && rm -rf $DB_DIR/* 2>&1"
log_info "БД очищена"

# Проверка очистки
DB_EMPTY=$(run_on_pi "cd $PROJECT_DIR && ls -1 $DB_DIR 2>/dev/null | wc -l")
if [ "$DB_EMPTY" != "0" ]; then
    log_warn "В БД остались файлы, принудительная очистка..."
    run_on_pi "cd $PROJECT_DIR && rm -rf $DB_DIR/* $DB_DIR/.* 2>/dev/null || true"
fi
log_info "БД полностью очищена"

# ==========================================
# ШАГ 5: Восстановление БД из бэкапа
# ==========================================
log_step "ШАГ 5: Восстановление БД из бэкапа"

log_info "Использование надёжного метода распаковки через временную директорию..."
TMP_RESTORE_DIR="/tmp/db-restore-tmp-$$"

# Создание временной директории и распаковка
log_info "Создание временной директории..."
run_on_pi "rm -rf $TMP_RESTORE_DIR && mkdir -p $TMP_RESTORE_DIR 2>&1"

log_info "Распаковка бэкапа во временную директорию..."
RESTORE_UNPACK=$(run_on_pi "cd $TMP_RESTORE_DIR && tar -xzf $BACKUP_FILE 2>&1 && echo 'ARCHIVE_OK' || echo 'ARCHIVE_ERROR'")
if ! echo "$RESTORE_UNPACK" | grep -q "ARCHIVE_OK"; then
    log_error "Ошибка при распаковке бэкапа"
    run_on_pi "rm -rf $TMP_RESTORE_DIR 2>&1"
    exit 1
fi

# Проверка наличия файлов в распакованном архиве
log_info "Проверка содержимого распакованного архива..."
UNPACKED_FILES=$(run_on_pi "ls -1 $TMP_RESTORE_DIR/var/db/ 2>/dev/null | wc -l")
if [ "$UNPACKED_FILES" = "0" ]; then
    log_error "Архив распакован, но файлы БД не найдены!"
    log_info "Проверка структуры архива..."
    run_on_pi "find $TMP_RESTORE_DIR -type f | head -10"
    run_on_pi "rm -rf $TMP_RESTORE_DIR 2>&1"
    exit 1
fi
log_info "Найдено файлов в архиве: $UNPACKED_FILES"

# Копирование файлов БД
log_info "Копирование файлов БД в целевую директорию..."
run_on_pi "cd $PROJECT_DIR && cp -r $TMP_RESTORE_DIR/var/db/* $DB_DIR/ 2>&1"

# Очистка временной директории
log_info "Очистка временной директории..."
run_on_pi "rm -rf $TMP_RESTORE_DIR 2>&1"

# Проверка прав доступа
log_info "Проверка прав доступа..."
run_on_pi "chown -R pi:pi $DB_DIR 2>&1"

# Проверка восстановленной БД
log_info "Проверка восстановленной БД..."
DB_SIZE=$(run_on_pi "du -sh $DB_DIR 2>/dev/null | cut -f1")
DB_FILES=$(run_on_pi "ls -1 $DB_DIR 2>/dev/null | wc -l")
log_info "Размер БД: $DB_SIZE"
log_info "Файлов в БД: $DB_FILES"

if [ "$DB_FILES" = "0" ]; then
    log_error "БД пуста после восстановления!"
    exit 1
fi

# Проверка наличия ключевых файлов LevelDB
log_info "Проверка ключевых файлов LevelDB..."
HAS_CURRENT=$(run_on_pi "test -f $DB_DIR/CURRENT && echo 'yes' || echo 'no'")
HAS_MANIFEST=$(run_on_pi "ls -1 $DB_DIR/MANIFEST-* 2>/dev/null | wc -l")
HAS_LDB=$(run_on_pi "ls -1 $DB_DIR/*.ldb 2>/dev/null | wc -l")

if [ "$HAS_CURRENT" != "yes" ]; then
    log_warn "Файл CURRENT не найден - БД может быть повреждена"
fi
if [ "$HAS_MANIFEST" = "0" ]; then
    log_warn "Файлы MANIFEST не найдены - БД может быть повреждена"
fi
if [ "$HAS_LDB" = "0" ]; then
    log_warn "Файлы .ldb не найдены - БД может быть пуста"
fi

# Подсчёт записей в БД
log_info "Подсчёт записей в БД..."
DB_COUNT=$(run_on_pi "cd $PROJECT_DIR && node -e \"const {Level}=require('level');(async()=>{try{const db=new Level('var/db',{valueEncoding:'json'});let c=0;for await(const _ of db.iterator())c++;await db.close();console.log(c);}catch(e){console.error('ERROR:',e.message);process.exit(1);}})();\" 2>&1")
if [ -n "$DB_COUNT" ] && [ "$DB_COUNT" != "ERROR" ] && [ "$DB_COUNT" != "0" ]; then
    log_info "✅ Записей в БД: $DB_COUNT"
    if [ "$DB_COUNT" -lt "100" ]; then
        log_warn "Мало записей в БД ($DB_COUNT) - возможно, восстановление неполное"
    fi
else
    log_warn "Не удалось подсчитать записи в БД или БД пуста"
fi

log_info "БД восстановлена успешно"

# ==========================================
# ШАГ 6: Приведение кода к начальному состоянию
# ==========================================
log_step "ШАГ 6: Приведение кода к начальному состоянию (main)"

log_info "Проверка текущей ветки..."
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
log_info "Текущая ветка: $CURRENT_BRANCH"

log_info "Проверка статуса git..."
GIT_STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short | head -10")
if [ -n "$GIT_STATUS" ]; then
    log_info "Найдены изменения:"
    echo "$GIT_STATUS"
fi

log_info "Получение последних изменений из репозитория..."
run_on_pi "cd $PROJECT_DIR && git fetch origin 2>&1"

log_info "Жёсткий сброс к origin/main..."
run_on_pi "cd $PROJECT_DIR && git reset --hard origin/main 2>&1"

log_info "Очистка неотслеживаемых файлов..."
run_on_pi "cd $PROJECT_DIR && git clean -fd 2>&1"

log_info "Проверка финального состояния..."
FINAL_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
FINAL_COMMIT=$(run_on_pi "cd $PROJECT_DIR && git log -1 --oneline")
log_info "Ветка: $FINAL_BRANCH"
log_info "Коммит: $FINAL_COMMIT"

log_info "Код приведён к состоянию main"

# ==========================================
# ШАГ 7: Запуск демона
# ==========================================
log_step "ШАГ 7: Запуск демона"

log_info "Запуск демона..."
START_RESULT=$(run_on_pi "cd $PROJECT_DIR && pm2 start daemon.js --name daemon 2>&1")
echo "$START_RESULT"

sleep 5

log_info "Проверка статуса демона..."
DAEMON_FINAL_STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 list | grep daemon")
echo "$DAEMON_FINAL_STATUS"

if echo "$DAEMON_FINAL_STATUS" | grep -q "errored\|stopped"; then
    log_error "Демон не запустился или упал!"
    log_info "Попытка перезапуска..."
    run_on_pi "cd $PROJECT_DIR && pm2 restart daemon 2>&1"
    sleep 3
fi

# ==========================================
# ШАГ 8: Анализ логов
# ==========================================
log_step "ШАГ 8: Анализ логов"

log_info "Ожидание инициализации демона (10 секунд)..."
sleep 10

log_info "Статус PM2:"
run_on_pi "cd $PROJECT_DIR && pm2 list | grep daemon"

log_info "Последние логи демона (50 строк):"
DAEMON_LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | tail -55")
echo "$DAEMON_LOGS"

log_info "Поиск сообщений о загрузке БД..."
LOAD_MESSAGES=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -E '(Загружено записей|state.init|LevelDB)' | tail -10")
if [ -n "$LOAD_MESSAGES" ]; then
    echo "$LOAD_MESSAGES"
else
    log_warn "Сообщения о загрузке БД не найдены"
fi

log_info "Поиск ошибок..."
ERRORS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 200 --nostream 2>&1 | grep -iE '(error|Error|ERROR|exception|Exception|fatal|Fatal|FATAL|crash|Crash|CRASH)' | tail -15")
if [ -n "$ERRORS" ]; then
    log_warn "Найдены ошибки в логах:"
    echo "$ERRORS"
    
    # Проверка на некритичные ошибки SQLite
    SQLITE_ERRORS=$(echo "$ERRORS" | grep -i "SQLITE_ERROR\|no such table: forms" | wc -l)
    if [ "$SQLITE_ERRORS" -gt "0" ]; then
        log_info "⚠️  Обнаружены ошибки SQLite (не критично для LevelDB):"
        echo "$ERRORS" | grep -i "SQLITE_ERROR\|no such table: forms" | head -3
        log_info "Эти ошибки не влияют на работу LevelDB и основного функционала демона"
    fi
else
    log_info "Критических ошибок не найдено"
fi

# Проверка количества записей в БД после запуска
log_info "Проверка количества записей в БД после запуска демона..."
DB_COUNT_AFTER=$(run_on_pi "cd $PROJECT_DIR && node -e \"const {Level}=require('level');(async()=>{try{const db=new Level('var/db',{valueEncoding:'json'});let c=0;for await(const _ of db.iterator())c++;await db.close();console.log(c);}catch(e){console.error('ERROR:',e.message);process.exit(1);}})();\" 2>&1")
if [ -n "$DB_COUNT_AFTER" ] && [ "$DB_COUNT_AFTER" != "ERROR" ]; then
    log_info "✅ Записей в БД: $DB_COUNT_AFTER"
    if [ "$DB_COUNT_AFTER" -lt "100" ]; then
        log_warn "⚠️  Мало записей в БД ($DB_COUNT_AFTER) - возможно, восстановление неполное"
    elif [ "$DB_COUNT_AFTER" -gt "0" ]; then
        log_info "✅ БД содержит данные, восстановление успешно"
    fi
else
    log_warn "⚠️  Не удалось подсчитать записи в БД"
fi

# ==========================================
# ИТОГИ
# ==========================================
log_step "ИТОГИ ВОССТАНОВЛЕНИЯ"

log_info "Восстановление завершено!"
echo ""
echo "📋 Информация:"
echo "   • Бэкапы текущего состояния сохранены в: $BACKUP_DIR"
echo "   • БД восстановлена из: $BACKUP_FILE"
echo "   • Код приведён к ветке: main"
echo "   • Демон: $(echo "$DAEMON_FINAL_STATUS" | grep -oE 'online|errored|stopped' || echo 'unknown')"
echo ""

if echo "$DAEMON_FINAL_STATUS" | grep -q "online"; then
    log_info "✅ Демон работает"
    echo ""
    echo "Проверьте логи для подтверждения успешной загрузки:"
    echo "   ssh $USER@$HOST 'cd $PROJECT_DIR && pm2 logs daemon --lines 100'"
else
    log_error "⚠️  Демон не работает или упал"
    echo ""
    echo "Проверьте логи для диагностики:"
    echo "   ssh $USER@$HOST 'cd $PROJECT_DIR && pm2 logs daemon --lines 200'"
    echo ""
    echo "Для отката используйте бэкапы в: $BACKUP_DIR"
fi

echo ""
log_info "Готово!"
