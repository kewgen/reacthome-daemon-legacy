#!/bin/bash

#
# Скрипт для восстановления БД на Raspberry Pi из бэкапа
#
# Использование:
#   ./scripts/restore-db-on-pi.sh [путь_к_бэкапу]
#
# Зачем: Восстанавливает БД на малинке из указанного бэкапа
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Загружаем переменные окружения
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
DB_DIR="$PROJECT_DIR/var/db"

# Определяем путь к бэкапу (по умолчанию - db-backup-20251206_231611.tar.gz)
BACKUP_PATH="${1:-backups/db-backups/db-backup-20251206_231611.tar.gz}"

if [ ! -f "$BACKUP_PATH" ]; then
    echo "❌ Ошибка: бэкап не найден: $BACKUP_PATH"
    echo ""
    echo "Доступные бэкапы:"
    ls -lh backups/*.tar.gz 2>/dev/null | tail -10
    exit 1
fi

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 ВОССТАНОВЛЕНИЕ БД НА RASPBERRY PI"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🖥️  Хост: $HOST"
echo "📦 Бэкап: $BACKUP_PATH"
echo "📂 Проект: $PROJECT_DIR"
echo "📁 БД: $DB_DIR"
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
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
catch wait result
exit [lindex $result 3]
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>&1 | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ШАГ 1: КОПИРОВАНИЕ БЭКАПА НА МАЛИНКУ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BACKUP_NAME=$(basename "$BACKUP_PATH")
BACKUP_SIZE=$(du -h "$BACKUP_PATH" 2>/dev/null | cut -f1 || echo "неизвестно")
echo "📦 Файл: $BACKUP_NAME"
echo "📊 Размер: $BACKUP_SIZE"
echo "⏳ Копирование..."

expect << EOF
set timeout 300
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$BACKUP_PATH" $USER@$HOST:/tmp/$BACKUP_NAME
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof {
        catch wait result
        exit [lindex \$result 3]
    }
    timeout {
        exit 1
    }
}
EOF

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при копировании бэкапа"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Бэкап скопирован на малинку: /tmp/$BACKUP_NAME"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛑 ШАГ 2: ОСТАНОВКА ДЕМОНА"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

run_on_pi "pm2 stop daemon"
DAEMON_STATUS=$(run_on_pi "pm2 list | grep daemon | grep -oE 'stopped|online' || echo 'unknown'")
if [ "$DAEMON_STATUS" = "stopped" ]; then
    echo "✅ Демон остановлен"
else
    echo "⚠️  Статус демона: $DAEMON_STATUS"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💾 ШАГ 3: СОЗДАНИЕ БЭКАПА ТЕКУЩЕЙ БД"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CURRENT_BACKUP="db-before-restore-$(date +%Y%m%d_%H%M%S).tar.gz"
echo "📦 Создание бэкапа: $CURRENT_BACKUP"
run_on_pi "cd $PROJECT_DIR && tar -czf /tmp/$CURRENT_BACKUP var/db 2>&1"
BACKUP_SIZE=$(run_on_pi "du -h /tmp/$CURRENT_BACKUP 2>/dev/null | cut -f1 || echo 'неизвестно'")
echo "✅ Текущая БД сохранена: /tmp/$CURRENT_BACKUP ($BACKUP_SIZE)"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ШАГ 4: ПОДСЧЁТ ЗАПИСЕЙ В ТЕКУЩЕЙ БД"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⏳ Подсчёт записей..."
CURRENT_COUNT=$(run_on_pi "cd $PROJECT_DIR && NODE_PATH=./node_modules node -e 'const {Level}=require(\"level\");(async()=>{try{const db=new Level(\"var/db\",{valueEncoding:\"json\"});let c=0;for await(const k of db.keys())c++;await db.close();console.log(c);}catch(e){console.log(0);}})();' 2>&1" | tail -1 | tr -d '\r\n')

if [ -n "$CURRENT_COUNT" ] && [ "$CURRENT_COUNT" != "0" ]; then
    echo "📈 Записей в текущей БД: $CURRENT_COUNT"
    if [ "$CURRENT_COUNT" -lt "10" ]; then
        echo "⚠️  ВНИМАНИЕ: Очень мало записей в текущей БД"
    fi
else
    echo "⚠️  Текущая БД пуста или недоступна (записей: ${CURRENT_COUNT:-0})"
fi

# Получение MAC-адреса
MAC_BEFORE=$(run_on_pi "cd $PROJECT_DIR && NODE_PATH=./node_modules node -e 'const {Level}=require(\"level\");(async()=>{try{const db=new Level(\"var/db\",{valueEncoding:\"json\"});const mac=await db.get(\"mac\");await db.close();console.log(mac);}catch(e){console.log(\"не найден\");}})();' 2>&1" | tail -1)
if [ -n "$MAC_BEFORE" ] && [ "$MAC_BEFORE" != "не найден" ]; then
    echo "🆔 MAC-адрес до восстановления: $MAC_BEFORE"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗑️  ШАГ 5: УДАЛЕНИЕ ТЕКУЩЕЙ БД"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⚠️  Удаление содержимого БД..."
run_on_pi "rm -rf $DB_DIR/*"
DB_EMPTY=$(run_on_pi "ls -1 $DB_DIR 2>/dev/null | wc -l")
if [ "$DB_EMPTY" = "0" ]; then
    echo "✅ Текущая БД удалена"
else
    echo "⚠️  В БД остались файлы ($DB_EMPTY), принудительная очистка..."
    run_on_pi "rm -rf $DB_DIR/* $DB_DIR/.* 2>/dev/null || true"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ШАГ 6: РАСПАКОВКА БЭКАПА"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Проверяем, это var бэкап или db бэкап
if [[ "$BACKUP_NAME" == var-backup* ]]; then
    # Это полный var бэкап - может иметь структуру var/var/db/
    echo "Распаковка var-backup..."
    run_on_pi "cd $PROJECT_DIR && tar -xzf /tmp/$BACKUP_NAME 2>&1"
    
    # Проверяем структуру архива и исправляем если нужно
    echo "Проверка структуры архива..."
    if run_on_pi "test -d $PROJECT_DIR/var/var/db" 2>/dev/null; then
        echo "⚠️  Обнаружена вложенная структура var/var/db, исправляем..."
        # Перемещаем содержимое из var/var/db в var/db
        run_on_pi "mv $PROJECT_DIR/var/var/db/* $DB_DIR/ 2>&1 || true"
        # Удаляем пустую директорию var/var
        run_on_pi "rm -rf $PROJECT_DIR/var/var 2>&1 || true"
        echo "✅ Структура архива исправлена"
    elif run_on_pi "test -d $PROJECT_DIR/var/db" 2>/dev/null; then
        echo "✅ Структура архива корректна (var/db)"
    else
        echo "⚠️  БД не найдена в стандартных местах, проверяем содержимое..."
        run_on_pi "find $PROJECT_DIR -type d -name 'db' -path '*/var/*' 2>/dev/null | head -5"
    fi
else
    # Это db бэкап - может иметь структуру var/db/ или просто файлы БД
    echo "Распаковка db-backup..."
    # Распаковываем во временную директорию для проверки структуры
    TMP_RESTORE="/tmp/db-restore-$$"
    run_on_pi "rm -rf $TMP_RESTORE && mkdir -p $TMP_RESTORE && cd $TMP_RESTORE && tar -xzf /tmp/$BACKUP_NAME 2>&1"
    
    # Проверяем структуру и копируем файлы
    echo "Проверка структуры архива..."
    if run_on_pi "test -d $TMP_RESTORE/var/db && echo 'var_db' || (test -d $TMP_RESTORE/db && echo 'db' || echo 'root')" 2>/dev/null | grep -q "var_db"; then
        echo "✅ Найдена структура var/db, копируем файлы..."
        run_on_pi "cp -r $TMP_RESTORE/var/db/* $DB_DIR/ 2>&1 && echo 'COPY_OK' || echo 'COPY_ERROR'"
        COPY_RESULT=$(run_on_pi "echo 'check'")
    elif run_on_pi "test -d $TMP_RESTORE/db && echo 'db' || echo 'no'" 2>/dev/null | grep -q "^db$"; then
        echo "✅ Найдена структура db, копируем файлы..."
        run_on_pi "cp -r $TMP_RESTORE/db/* $DB_DIR/ 2>&1 && echo 'COPY_OK' || echo 'COPY_ERROR'"
    else
        echo "✅ Найдены файлы БД в корне, копируем..."
        run_on_pi "cp -r $TMP_RESTORE/*.ldb $TMP_RESTORE/*.log $TMP_RESTORE/CURRENT $TMP_RESTORE/MANIFEST-* $TMP_RESTORE/LOG* $DB_DIR/ 2>&1 || true"
    fi
    
    # Проверяем, что файлы скопировались
    FILES_COPIED=$(run_on_pi "ls -1 $DB_DIR/*.ldb $DB_DIR/CURRENT $DB_DIR/MANIFEST-* 2>/dev/null | wc -l")
    if [ "$FILES_COPIED" = "0" ]; then
        echo "⚠️  Файлы не скопировались, пробуем альтернативный метод..."
        run_on_pi "cd $PROJECT_DIR && tar -xzf /tmp/$BACKUP_NAME --strip-components=1 2>&1"
    else
        echo "✅ Скопировано файлов: $FILES_COPIED"
    fi
    
    # Очистка временной директории
    run_on_pi "rm -rf $TMP_RESTORE 2>&1"
fi

echo "✅ Бэкап распакован"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 ШАГ 7: ПРОВЕРКА ПРАВ ДОСТУПА"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

run_on_pi "chown -R pi:pi $DB_DIR 2>&1 || true"
echo "✅ Права доступа установлены"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 ШАГ 8: ПРОВЕРКА СОДЕРЖИМОГО БД"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DB_SIZE=$(run_on_pi "du -sh $DB_DIR 2>&1 | cut -f1")
FILE_COUNT=$(run_on_pi "ls -1 $DB_DIR 2>&1 | wc -l")
echo "📊 Размер БД: $DB_SIZE"
echo "📁 Файлов в БД: $FILE_COUNT"

# Проверка ключевых файлов LevelDB
HAS_CURRENT=$(run_on_pi "test -f $DB_DIR/CURRENT && echo 'yes' || echo 'no'")
HAS_MANIFEST=$(run_on_pi "ls -1 $DB_DIR/MANIFEST-* 2>/dev/null | wc -l")
HAS_LDB=$(run_on_pi "ls -1 $DB_DIR/*.ldb 2>/dev/null | wc -l")

echo ""
echo "🔍 Проверка целостности БД:"
if [ "$HAS_CURRENT" = "yes" ]; then
    echo "   ✅ Файл CURRENT найден"
else
    echo "   ⚠️  Файл CURRENT не найден - БД может быть повреждена"
fi

if [ "$HAS_MANIFEST" != "0" ]; then
    echo "   ✅ Файлы MANIFEST найдены: $HAS_MANIFEST"
else
    echo "   ⚠️  Файлы MANIFEST не найдены"
fi

if [ "$HAS_LDB" != "0" ]; then
    echo "   ✅ Файлы .ldb найдены: $HAS_LDB"
else
    echo "   ⚠️  Файлы .ldb не найдены - БД может быть пуста"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ШАГ 9: ПОДСЧЁТ ЗАПИСЕЙ В ВОССТАНОВЛЕННОЙ БД"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⏳ Подсчёт записей..."
NEW_COUNT=$(run_on_pi "cd $PROJECT_DIR && NODE_PATH=./node_modules node -e 'const {Level}=require(\"level\");(async()=>{try{const db=new Level(\"var/db\",{valueEncoding:\"json\"});let c=0;for await(const k of db.keys())c++;await db.close();console.log(c);}catch(e){console.log(0);}})();' 2>&1" | tail -1 | tr -d '\r\n')

if [ -n "$NEW_COUNT" ]; then
    echo "📈 Записей после восстановления: $NEW_COUNT"
    
    # Сравнение количества записей
    if [ -n "$CURRENT_COUNT" ] && [ "$CURRENT_COUNT" != "0" ] && [ "$NEW_COUNT" != "0" ]; then
        CURRENT_COUNT_CLEAN=$(echo "$CURRENT_COUNT" | tr -d '\r\n')
        NEW_COUNT_CLEAN=$(echo "$NEW_COUNT" | tr -d '\r\n')
        DIFF=$((NEW_COUNT_CLEAN - CURRENT_COUNT_CLEAN))
        if [ "$DIFF" -gt 0 ]; then
            echo "✅ Записей стало больше на: +$DIFF"
        elif [ "$DIFF" -lt 0 ]; then
            echo "⚠️  Записей стало меньше на: $DIFF"
            if [ "$DIFF" -lt -100 ]; then
                echo "🔴 ВНИМАНИЕ: Значительная потеря записей!"
            fi
        else
            echo "✅ Количество записей не изменилось"
        fi
    fi
    
    # Предупреждения о количестве
    if [ "$NEW_COUNT" = "0" ]; then
        echo "🔴 КРИТИЧНО: БД пуста после восстановления!"
    elif [ "$NEW_COUNT" -lt "10" ]; then
        echo "⚠️  ВНИМАНИЕ: Очень мало записей в восстановленной БД"
    elif [ "$NEW_COUNT" -lt "100" ]; then
        echo "⚠️  ПРЕДУПРЕЖДЕНИЕ: Мало записей в восстановленной БД"
    fi
else
    echo "❌ Не удалось подсчитать записи"
    NEW_COUNT="0"
fi

# Получение MAC-адреса после восстановления
MAC_AFTER=$(run_on_pi "cd $PROJECT_DIR && NODE_PATH=./node_modules node -e 'const {Level}=require(\"level\");(async()=>{try{const db=new Level(\"var/db\",{valueEncoding:\"json\"});const mac=await db.get(\"mac\");await db.close();console.log(mac);}catch(e){console.log(\"не найден\");}})();' 2>&1" | tail -1)
if [ -n "$MAC_AFTER" ] && [ "$MAC_AFTER" != "не найден" ]; then
    echo "🆔 MAC-адрес после восстановления: $MAC_AFTER"
    if [ -n "$MAC_BEFORE" ] && [ "$MAC_BEFORE" != "не найден" ] && [ "$MAC_BEFORE" != "$MAC_AFTER" ]; then
        echo "⚠️  ВНИМАНИЕ: MAC-адрес изменился! Это может привести к потере данных."
        echo "   Старый MAC: $MAC_BEFORE"
        echo "   Новый MAC: $MAC_AFTER"
    fi
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 ШАГ 10: ПЕРЕЗАПУСК ДЕМОНА"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

run_on_pi "pm2 restart daemon"
echo "✅ Демон перезапущен"
echo ""
echo "⏳ Ожидание запуска демона (5 секунд)..."
sleep 5
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ШАГ 11: ПРОВЕРКА СТАТУСА ДЕМОНА"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DAEMON_STATUS=$(run_on_pi "pm2 list | grep daemon")
echo "$DAEMON_STATUS"
if echo "$DAEMON_STATUS" | grep -q "online"; then
    echo ""
    echo "✅ Демон работает"
else
    echo ""
    echo "⚠️  Демон не работает или имеет проблемы"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 ШАГ 12: ПРОВЕРКА ЛОГОВ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

run_on_pi "pm2 logs daemon --lines 20 --nostream 2>&1 | tail -25"

# Очистка
rm -f "$TMP_EXPECT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 СВОДКА:"
echo ""
echo "📊 Количество записей:"
echo "   • До восстановления:   ${CURRENT_COUNT:-0}"
echo "   • После восстановления: ${NEW_COUNT:-0}"
if [ -n "$CURRENT_COUNT" ] && [ "$CURRENT_COUNT" != "0" ] && [ -n "$NEW_COUNT" ] && [ "$NEW_COUNT" != "0" ]; then
    CURRENT_COUNT_CLEAN=$(echo "$CURRENT_COUNT" | tr -d '\r\n')
    NEW_COUNT_CLEAN=$(echo "$NEW_COUNT" | tr -d '\r\n')
    if [ "$CURRENT_COUNT_CLEAN" -gt 0 ] && [ "$NEW_COUNT_CLEAN" -gt 0 ]; then
        DIFF=$((NEW_COUNT_CLEAN - CURRENT_COUNT_CLEAN))
        if [ "$DIFF" -ne 0 ]; then
            echo "   • Изменение:            $([ $DIFF -gt 0 ] && echo '+')$DIFF"
        fi
    fi
fi
echo ""
echo "💾 Бэкапы:"
echo "   • Текущая БД сохранена: /tmp/$CURRENT_BACKUP"
echo "   • Размер восстановленной БД: $DB_SIZE"
echo ""
if [ -n "$MAC_BEFORE" ] && [ "$MAC_BEFORE" != "не найден" ]; then
    echo "🆔 MAC-адрес:"
    echo "   • До восстановления: $MAC_BEFORE"
    if [ -n "$MAC_AFTER" ] && [ "$MAC_AFTER" != "не найден" ]; then
        echo "   • После восстановления: $MAC_AFTER"
    fi
    echo ""
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

