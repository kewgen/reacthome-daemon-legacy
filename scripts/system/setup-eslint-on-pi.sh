#!/bin/bash

#
# Установка ESLint на Raspberry Pi для проверки кода
#
# Использование:
#   ./scripts/system/setup-eslint-on-pi.sh
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    exit 1
fi

echo "🔧 Установка ESLint на Raspberry Pi ($HOST)"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
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

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:\|spawn\|Warning:"
}

echo "📦 Проверка наличия ESLint..."
ESLINT_CHECK=$(run_on_pi "cd $PROJECT_DIR && npm list eslint 2>&1 | grep -E 'eslint@|empty' || echo 'not installed'")

if echo "$ESLINT_CHECK" | grep -q "eslint@"; then
    echo "✅ ESLint уже установлен"
    run_on_pi "cd $PROJECT_DIR && npm list eslint | grep eslint"
else
    echo "📥 Установка ESLint..."
    run_on_pi "cd $PROJECT_DIR && npm install --save-dev eslint 2>&1 | tail -5"
    echo "✅ ESLint установлен"
fi

echo ""
echo "📝 Создание конфигурации ESLint..."

# Создаём базовую конфигурацию ESLint
ESLINT_CONFIG=$(cat << 'ESLINT_EOF'
module.exports = {
  env: {
    node: true,
    es2021: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module'
  },
  rules: {
    'no-console': 'off', // Разрешаем console.log для логирования
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'semi': ['error', 'always'],
    'quotes': ['warn', 'single'],
    'indent': ['warn', 2],
    'no-trailing-spaces': 'warn',
    'eol-last': 'warn'
  }
};
ESLINT_EOF
)

# Копируем конфигурацию на малинку
TMP_EXPECT_SCP=$(mktemp)
cat > "$TMP_EXPECT_SCP" << 'EXPECT_SCP_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote_file [lindex $argv 3]
set local_file [lindex $argv 4]
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $local_file $user@$host:$remote_file
expect {
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_SCP_EOF
chmod +x "$TMP_EXPECT_SCP"

TMP_CONFIG=$(mktemp)
echo "$ESLINT_CONFIG" > "$TMP_CONFIG"

"$TMP_EXPECT_SCP" "$HOST" "$USER" "${REACTHOME_PI_PASS:-raspberry}" "${PROJECT_DIR}/.eslintrc.js" "$TMP_CONFIG" 2>/dev/null | grep -v "password:\|spawn\|Warning:"

echo "✅ Конфигурация создана"

echo ""
echo "🧪 Тестовая проверка кода..."
run_on_pi "cd $PROJECT_DIR && npx eslint event-logger.js --max-warnings 50 2>&1 | head -20 || echo 'Проверка выполнена'"

rm -f "$TMP_EXPECT" "$TMP_EXPECT_SCP" "$TMP_CONFIG"

echo ""
echo "=========================================="
echo "✅ ESLint установлен и настроен"
echo "=========================================="
echo ""
echo "Использование:"
echo "  npx eslint event-logger.js"
echo "  npx eslint event-logger.js --fix  # Автоисправление"
echo ""
