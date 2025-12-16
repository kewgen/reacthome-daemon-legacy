#!/bin/bash
# Зачем: Скрипт для проверки расположения monitor.js на Raspberry Pi

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
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

# Зачем: Создаём временный expect скрипт для SSH подключения
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 10
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

# Зачем: Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

echo "═══════════════════════════════════════════════════════"
echo "🔍 ПРОВЕРКА РАСПОЛОЖЕНИЯ monitor.js НА RASPBERRY PI"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Хост: ${USER}@${HOST}"
echo ""

# Зачем: Проверяем возможные места расположения файла
echo "1️⃣ Проверка файлов:"
echo "───────────────────"

# Место 1: /home/pi/reacthome-daemon/src/monitor.js (согласно upload-monitor-to-pi.sh)
echo ""
echo "📁 ${PROJECT_DIR}/src/monitor.js:"
FILE1_EXISTS=$(run_on_pi "test -f ${PROJECT_DIR}/src/monitor.js && echo 'exists' || echo 'not found'")
if [ "$FILE1_EXISTS" = "exists" ]; then
    echo "  ✅ Найден"
    FILE1_INFO=$(run_on_pi "ls -lh ${PROJECT_DIR}/src/monitor.js")
    echo "  $FILE1_INFO"
else
    echo "  ❌ НЕ НАЙДЕН"
fi

# Место 2: /home/pi/reacthome-daemon/monitoring/scripts/monitor.js (возможное альтернативное расположение)
echo ""
echo "📁 ${PROJECT_DIR}/monitoring/scripts/monitor.js:"
FILE2_EXISTS=$(run_on_pi "test -f ${PROJECT_DIR}/monitoring/scripts/monitor.js && echo 'exists' || echo 'not found'")
if [ "$FILE2_EXISTS" = "exists" ]; then
    echo "  ✅ Найден"
    FILE2_INFO=$(run_on_pi "ls -lh ${PROJECT_DIR}/monitoring/scripts/monitor.js")
    echo "  $FILE2_INFO"
else
    echo "  ❌ НЕ НАЙДЕН"
fi

# Место 3: Поиск всех файлов monitor.js на малинке
echo ""
echo "2️⃣ Поиск всех файлов monitor.js:"
echo "─────────────────────────────────"
ALL_MONITORS=$(run_on_pi "find ${PROJECT_DIR} -name 'monitor.js' -type f 2>/dev/null")
if [ -n "$ALL_MONITORS" ]; then
    echo "$ALL_MONITORS" | while read -r line; do
        echo "  📄 $line"
        FILE_INFO=$(run_on_pi "ls -lh \"$line\"")
        echo "     $FILE_INFO"
    done
else
    echo "  ❌ Файлы monitor.js не найдены"
fi

# Зачем: Проверяем зависимости (terminal-kit, ws)
echo ""
echo "3️⃣ Проверка зависимостей:"
echo "─────────────────────────"
DEPS_CHECK=$(run_on_pi "cd ${PROJECT_DIR} && npm list terminal-kit ws 2>/dev/null | grep -E 'terminal-kit|ws' | head -5 || echo 'Зависимости не установлены'")
echo "$DEPS_CHECK"

# Зачем: Проверяем, запущен ли процесс monitor.js
echo ""
echo "4️⃣ Проверка запущенных процессов:"
echo "───────────────────────────────────"
PROCESS_PIDS=$(run_on_pi "pgrep -f 'monitor.js' || echo ''")
if [ -n "$PROCESS_PIDS" ]; then
    echo "  ✅ Процесс(ы) запущен(ы)"
    echo ""
    for PID in $PROCESS_PIDS; do
        echo "  🔹 PID: $PID"
        
        # Зачем: Получаем полную командную строку процесса
        CMDLINE=$(run_on_pi "cat /proc/$PID/cmdline 2>/dev/null | tr '\\0' ' ' || echo ''")
        if [ -n "$CMDLINE" ]; then
            echo "     💻 Командная строка: $CMDLINE"
            
            # Зачем: Извлекаем путь к файлу monitor.js из командной строки
            FILE_PATH=$(echo "$CMDLINE" | grep -oE '[^ ]*monitor\.js[^ ]*' | head -1 | sed 's/[[:space:]]*$//')
            if [ -n "$FILE_PATH" ]; then
                # Зачем: Проверяем, является ли путь абсолютным или относительным
                if [[ "$FILE_PATH" == /* ]]; then
                    ABS_PATH="$FILE_PATH"
                else
                    # Зачем: Если путь относительный, получаем рабочую директорию
                    CWD=$(run_on_pi "readlink -f /proc/$PID/cwd 2>/dev/null || echo ''")
                    if [ -n "$CWD" ]; then
                        ABS_PATH="$CWD/$FILE_PATH"
                    else
                        ABS_PATH="$FILE_PATH"
                    fi
                fi
                echo "     📍 Путь к файлу: $ABS_PATH"
                
                # Зачем: Проверяем существование файла
                FILE_EXISTS=$(run_on_pi "test -f \"$ABS_PATH\" && echo 'exists' || echo 'not found'")
                if [ "$FILE_EXISTS" = "exists" ]; then
                    FILE_INFO=$(run_on_pi "ls -lh \"$ABS_PATH\"")
                    echo "     ✅ Файл существует:"
                    echo "        $FILE_INFO"
                else
                    echo "     ⚠️  Файл не найден по пути: $ABS_PATH"
                fi
            fi
        fi
        
        # Зачем: Получаем рабочую директорию процесса
        CWD=$(run_on_pi "readlink -f /proc/$PID/cwd 2>/dev/null || echo ''")
        if [ -n "$CWD" ]; then
            echo "     📂 Рабочая директория: $CWD"
        fi
        
        # Зачем: Получаем открытые файлы процесса (может показать monitor.js)
        OPEN_FILES=$(run_on_pi "lsof -p $PID 2>/dev/null | grep monitor.js | head -3 || echo ''")
        if [ -n "$OPEN_FILES" ]; then
            echo "     📄 Открытые файлы monitor.js:"
            echo "$OPEN_FILES" | while read -r line; do
                echo "        $line"
            done
        fi
        echo ""
    done
else
    echo "  ❌ Процесс не запущен"
fi

echo ""
echo "═══════════════════════════════════════════════════════"

# Зачем: Очищаем временный файл
rm -f "$TMP_EXPECT"







