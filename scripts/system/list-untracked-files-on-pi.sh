#!/bin/bash

#
# Список неотслеживаемых файлов на Raspberry Pi
#
# Использование:
#   ./scripts/system/list-untracked-files-on-pi.sh
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🔍 Список неотслеживаемых файлов на Raspberry Pi ($HOST)"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 30
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

echo "=========================================="
echo "1. Git статус (краткий формат)"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git status --porcelain | grep '^??'"
echo ""

echo "=========================================="
echo "2. Все неотслеживаемые файлы"
echo "=========================================="
echo ""
UNTRACKED=$(run_on_pi "cd $PROJECT_DIR && git ls-files --others --exclude-standard")
if [ -z "$UNTRACKED" ]; then
    echo "✅ Неотслеживаемых файлов нет"
else
    echo "$UNTRACKED"
    echo ""
    echo "---"
    echo "Всего неотслеживаемых файлов: $(echo \"$UNTRACKED\" | wc -l | tr -d ' ')"
fi
echo ""

echo "=========================================="
echo "3. Неотслеживаемые файлы по директориям"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git ls-files --others --exclude-standard | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20"
echo ""

echo "=========================================="
echo "4. Размер неотслеживаемых файлов"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git ls-files --others --exclude-standard | xargs -I {} du -h {} 2>/dev/null | sort -rh | head -20"
echo ""

echo "=========================================="
echo "5. Неотслеживаемые файлы по типам"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && git ls-files --others --exclude-standard | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -20"
echo ""

rm -f "$TMP_EXPECT"

echo "✅ Проверка завершена"
echo ""

