#!/bin/bash
# Скрипт для копирования monitor.js на Raspberry Pi через SCP с автоматическим вводом пароля
# Использование: 
#   ./scripts/system/copy-monitor-to-pi.sh           - копировать без изменения версии
#   ./scripts/system/copy-monitor-to-pi.sh patch     - поднять patch версию (1.0.0 -> 1.0.1)
#   ./scripts/system/copy-monitor-to-pi.sh minor     - поднять minor версию (1.0.0 -> 1.1.0)
#   ./scripts/system/copy-monitor-to-pi.sh major     - поднять major версию (1.0.0 -> 2.0.0)

set -e

# Загружаем переменные из .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
VERSION_BUMP="${1:-none}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

LOCAL_FILE="$PROJECT_ROOT/src/monitor.js"
REMOTE_FILE="$PROJECT_DIR/src/monitor.js"

if [ ! -f "$LOCAL_FILE" ]; then
    echo "❌ Ошибка: файл $LOCAL_FILE не найден"
    exit 1
fi

# Функция для повышения версии
bump_version() {
    local bump_type="$1"
    local current_version=$(grep "const VERSION = " "$LOCAL_FILE" | sed -E "s/.*VERSION = '([0-9.]+)'.*/\1/")
    
    if [ -z "$current_version" ]; then
        echo "❌ Ошибка: не удалось найти версию в файле"
        exit 1
    fi
    
    IFS='.' read -r major minor patch <<< "$current_version"
    
    case "$bump_type" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            echo "Текущая версия: $current_version (без изменений)"
            return
            ;;
    esac
    
    local new_version="${major}.${minor}.${patch}"
    
    # Обновляем версию в файле
    sed -i.bak "s/const VERSION = '${current_version}'/const VERSION = '${new_version}'/" "$LOCAL_FILE"
    rm -f "${LOCAL_FILE}.bak"
    
    echo "✅ Версия обновлена: $current_version -> $new_version"
}

# Повышаем версию если указан параметр
if [ "$VERSION_BUMP" != "none" ]; then
    echo "=========================================="
    echo "Обновление версии"
    echo "=========================================="
    echo ""
    bump_version "$VERSION_BUMP"
    echo ""
fi

echo "=== Копирование monitor.js на Raspberry Pi ==="
echo "Хост: ${USER}@${HOST}"
echo "Локальный файл: ${LOCAL_FILE}"
echo "Удалённый файл: ${REMOTE_FILE}"
echo ""

# Создаём временный expect скрипт для SCP
TMP_SCP_EXPECT=$(mktemp)
cat > "$TMP_SCP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set src [lindex $argv 3]
set dst [lindex $argv 4]

spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$src" "$user@$host:$dst"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_SCP_EXPECT"

# Создаём временный expect скрипт для SSH
TMP_SSH_EXPECT=$(mktemp)
cat > "$TMP_SSH_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -t -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_SSH_EXPECT"

# Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_SSH_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

# Функция для копирования файлов через SCP
copy_to_pi() {
    local src="$1"
    local dst="$2"
    "$TMP_SCP_EXPECT" "$HOST" "$USER" "$PASS" "$src" "$dst" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning"
}

echo "=========================================="
echo "Шаг 1: Проверка локального файла"
echo "=========================================="
echo ""
echo "Проверяю наличие файла для копирования:"
test -f "$LOCAL_FILE" && echo "✅ $(basename $LOCAL_FILE)" || echo "❌ $(basename $LOCAL_FILE) отсутствует"
echo ""

echo "=========================================="
echo "Шаг 2: Создание директории на Pi"
echo "=========================================="
echo ""
echo "Создаю директорию src на Pi если её нет..."
run_on_pi "cd $PROJECT_DIR && mkdir -p src"
echo "✅ Директория создана"
echo ""

echo "=========================================="
echo "Шаг 3: Копирование monitor.js на Pi"
echo "=========================================="
echo ""
echo "Копирую monitor.js..."
copy_to_pi "$LOCAL_FILE" "$REMOTE_FILE"
echo "✅ Файл скопирован"
echo ""

echo "=========================================="
echo "Шаг 4: Проверка скопированного файла"
echo "=========================================="
echo ""
FILE_CHECK=$(run_on_pi "cd $PROJECT_DIR && ls -lh src/monitor.js 2>&1")
if echo "$FILE_CHECK" | grep -q "monitor.js"; then
    echo "✅ monitor.js успешно скопирован на Pi"
    FILE_SIZE=$(echo "$FILE_CHECK" | awk '{print $5}')
    echo "   Размер файла: $FILE_SIZE"
    echo "   Полная информация: $FILE_CHECK"
else
    echo "⚠️  Проверка через ls не удалась, но файл был скопирован (видно по прогрессу)"
    echo "   Попробуем проверить другим способом..."
    FILE_CHECK2=$(run_on_pi "cd $PROJECT_DIR/src && [ -f monitor.js ] && echo 'EXISTS' || echo 'NOT_FOUND'")
    if echo "$FILE_CHECK2" | grep -q "EXISTS"; then
        echo "✅ Файл подтверждён через альтернативную проверку"
    else
        echo "❌ Ошибка: файл не найден на Pi"
        rm -f "$TMP_SSH_EXPECT" "$TMP_SCP_EXPECT"
        exit 1
    fi
fi
echo ""

rm -f "$TMP_SSH_EXPECT" "$TMP_SCP_EXPECT"

echo "=========================================="
echo "✅ Копирование завершено!"
echo "=========================================="
echo ""
echo "Файл monitor.js скопирован на Raspberry Pi"
echo ""
echo "Для запуска на малинке выполните:"
echo "  ssh ${USER}@${HOST}"
echo "  cd ${PROJECT_DIR}"
echo "  node src/monitor.js"
echo ""
echo "Или с указанием WebSocket URI:"
echo "  REACTHOME_WS_URI=ws://localhost:3000 node src/monitor.js"
echo ""

