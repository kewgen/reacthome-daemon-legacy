#!/bin/bash
# Копирование теста на Raspberry Pi через base64
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

TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << EXPECT_EOF
#!/usr/bin/expect -f
set timeout 120
set host [lindex \$argv 0]
set user [lindex \$argv 1]
set pass [lindex \$argv 2]
set cmd [lindex \$argv 3]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \$user@\$host "\$cmd"
expect {
    "*assword:" {
        send "\$pass\r"
        exp_continue
    }
    "yes/no" {
        send "yes\r"
        exp_continue
    }
    "*\$ " {
        exp_continue
    }
    eof {
        catch wait result
        exit [lindex \$result 3]
    }
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

run_on_pi() {
    local cmd="$1"
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$cmd" 2>&1 | grep -v "spawn" | grep -v "password:" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "📋 Копирование теста на Pi..."
run_on_pi "cd $PROJECT_DIR && mkdir -p tests/integration && rm -f tests/integration/test_event_logging_compatibility.js"

# Кодируем файл в base64 и передаём на Pi
TEST_B64=$(base64 -i "$PROJECT_ROOT/tests/integration/test_event_logging_compatibility.js")
run_on_pi "cd $PROJECT_DIR && echo '$TEST_B64' | base64 -d > tests/integration/test_event_logging_compatibility.js && chmod +x tests/integration/test_event_logging_compatibility.js && echo 'Test file copied successfully'"

# Проверка
TEST_EXISTS=$(run_on_pi "cd $PROJECT_DIR && test -f tests/integration/test_event_logging_compatibility.js && head -5 tests/integration/test_event_logging_compatibility.js | grep -q '#!/usr/bin/env node' && echo 'OK' || echo 'FAILED'")
if echo "$TEST_EXISTS" | grep -q "OK"; then
    echo "✅ Тест успешно скопирован"
else
    echo "❌ Ошибка копирования теста"
    exit 1
fi

rm -f "$TMP_EXPECT"
