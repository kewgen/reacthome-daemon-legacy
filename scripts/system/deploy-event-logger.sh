#!/bin/bash
# Скрипт развертывания event-logger на Raspberry Pi
# Копирует файлы напрямую через SCP (не через git)
# Использование: ./scripts/system/deploy-event-logger.sh

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

# Определяем локальный путь к проекту (может быть worktree)
if [ -f /Users/evgen/.cursor/worktrees/reacthome-daemon-legacy-main/iha/event-logger.js ]; then
    LOCAL_PROJECT_DIR="/Users/evgen/.cursor/worktrees/reacthome-daemon-legacy-main/iha"
elif [ -f "$PROJECT_ROOT/event-logger.js" ]; then
    LOCAL_PROJECT_DIR="$PROJECT_ROOT"
else
    echo "❌ Ошибка: не найден event-logger.js"
    echo "   Проверьте, что вы в ветке websocket-logger"
    exit 1
fi

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "=== Развертывание event-logger на Raspberry Pi ==="
echo "Хост: ${USER}@${HOST}"
echo "Локальный путь: ${LOCAL_PROJECT_DIR}"
echo "Удалённый путь: ${PROJECT_DIR}"
echo ""

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

spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -r "$src" "$user@$host:$dst"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_SCP_EXPECT"

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
echo "Шаг 0: Проверка локальных файлов"
echo "=========================================="
echo ""
cd "$LOCAL_PROJECT_DIR"
echo "Рабочая директория: $(pwd)"
echo ""
echo "Проверяю наличие файлов для копирования:"
test -f event-logger.js && echo "✅ event-logger.js" || echo "❌ event-logger.js отсутствует"
test -f ecosystem.config.js && echo "✅ ecosystem.config.js" || echo "❌ ecosystem.config.js отсутствует"
test -d src/logging && echo "✅ src/logging/" || echo "❌ src/logging/ отсутствует"
test -f src/logging/event-log.js && echo "✅ src/logging/event-log.js" || echo "❌ src/logging/event-log.js отсутствует"
test -f src/logging/filters.js && echo "✅ src/logging/filters.js" || echo "❌ src/logging/filters.js отсутствует"
test -f src/logging/opensearch.js && echo "✅ src/logging/opensearch.js" || echo "❌ src/logging/opensearch.js отсутствует"
test -f src/logging/context.js && echo "✅ src/logging/context.js" || echo "❌ src/logging/context.js отсутствует"
test -f src/assist/lang/ru.js && echo "✅ src/assist/lang/ru.js" || echo "❌ src/assist/lang/ru.js отсутствует"
echo ""

echo "=========================================="
echo "Шаг 1: Копирование файлов на Raspberry Pi"
echo "=========================================="
echo ""

# Копируем основные файлы
echo "Копирую event-logger.js..."
copy_to_pi "$LOCAL_PROJECT_DIR/event-logger.js" "$PROJECT_DIR/"
echo "✅ Скопирован"

echo "Копирую ecosystem.config.js..."
copy_to_pi "$LOCAL_PROJECT_DIR/ecosystem.config.js" "$PROJECT_DIR/"
echo "✅ Скопирован"

# Создаём директорию src/logging на Pi если её нет
echo "Создаю директорию src/logging на Pi..."
run_on_pi "cd $PROJECT_DIR && mkdir -p src/logging"
echo "✅ Директория создана"

# Копируем модули логирования
echo "Копирую модули логирования..."
copy_to_pi "$LOCAL_PROJECT_DIR/src/logging/context.js" "$PROJECT_DIR/src/logging/"
echo "✅ context.js скопирован"
copy_to_pi "$LOCAL_PROJECT_DIR/src/logging/event-log.js" "$PROJECT_DIR/src/logging/"
echo "✅ event-log.js скопирован"
copy_to_pi "$LOCAL_PROJECT_DIR/src/logging/filters.js" "$PROJECT_DIR/src/logging/"
echo "✅ filters.js скопирован"
copy_to_pi "$LOCAL_PROJECT_DIR/src/logging/opensearch.js" "$PROJECT_DIR/src/logging/"
echo "✅ opensearch.js скопирован"
echo ""

# Копируем исправленный ru.js
echo "Копирую исправленный src/assist/lang/ru.js..."
run_on_pi "cd $PROJECT_DIR && mkdir -p src/assist/lang"
copy_to_pi "$LOCAL_PROJECT_DIR/src/assist/lang/ru.js" "$PROJECT_DIR/src/assist/lang/"
echo "✅ ru.js скопирован"
echo ""

echo "=========================================="
echo "Шаг 2: Проверка скопированных файлов"
echo "=========================================="
echo ""
run_on_pi "cd $PROJECT_DIR && test -f event-logger.js && echo '✅ event-logger.js' || echo '❌ event-logger.js отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -f ecosystem.config.js && echo '✅ ecosystem.config.js' || echo '❌ ecosystem.config.js отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -d src/logging && echo '✅ src/logging/' || echo '❌ src/logging/ отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -f src/logging/event-log.js && echo '✅ src/logging/event-log.js' || echo '❌ src/logging/event-log.js отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -f src/logging/filters.js && echo '✅ src/logging/filters.js' || echo '❌ src/logging/filters.js отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -f src/logging/opensearch.js && echo '✅ src/logging/opensearch.js' || echo '❌ src/logging/opensearch.js отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -f src/logging/context.js && echo '✅ src/logging/context.js' || echo '❌ src/logging/context.js отсутствует'"
run_on_pi "cd $PROJECT_DIR && test -f src/assist/lang/ru.js && echo '✅ src/assist/lang/ru.js' || echo '❌ src/assist/lang/ru.js отсутствует'"
echo ""

echo "=========================================="
echo "Шаг 2.5: Переключение ветки на websocket-logger"
echo "=========================================="
echo ""
echo "🔴 КРИТИЧЕСКИ ВАЖНО: Переключаю ветку на websocket-logger..."
BRANCH_SWITCH=$(run_on_pi "cd $PROJECT_DIR && if git show-ref --verify --quiet refs/heads/websocket-logger; then git checkout websocket-logger 2>&1; else git checkout -b websocket-logger 2>&1; fi")
echo "$BRANCH_SWITCH"
echo ""

FINAL_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
if echo "$FINAL_BRANCH" | grep -q "websocket-logger"; then
    echo "✅ Ветка websocket-logger активна"
else
    echo "⚠️  ВНИМАНИЕ: Ветка не websocket-logger, текущая: $FINAL_BRANCH"
    echo "   Файлы находятся в неправильной ветке!"
fi
echo ""

echo "=========================================="
echo "Шаг 3: Установка зависимостей"
echo "=========================================="
echo ""
INSTALL_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && if [ -f package.json ]; then npm install 2>&1 | tail -20; else echo '⚠️  package.json не найден'; fi")
echo "$INSTALL_OUTPUT"
echo ""

echo "=========================================="
echo "Шаг 4: Проверка переменных окружения"
echo "=========================================="
echo ""
echo "Проверяю настройки OpenSearch в .env файле:"
OPENSEARCH_CONFIG=$(run_on_pi "cd $PROJECT_DIR && cat .env 2>/dev/null | grep OPENSEARCH || echo '.env файл не найден или не содержит OPENSEARCH переменных'")
echo "$OPENSEARCH_CONFIG"
echo ""

if echo "$OPENSEARCH_CONFIG" | grep -q "OPENSEARCH_URL=" && ! echo "$OPENSEARCH_CONFIG" | grep -q "OPENSEARCH_URL=$"; then
    echo "✅ Переменные OpenSearch найдены"
else
    echo "⚠️  ВНИМАНИЕ: Переменные OpenSearch не настроены!"
    echo "   Убедитесь, что в .env файле на Pi настроены:"
    echo "   - OPENSEARCH_URL"
    echo "   - OPENSEARCH_USER"
    echo "   - OPENSEARCH_PASSWORD"
    echo "   - OPENSEARCH_CA_CERT (если требуется)"
fi
echo ""

rm -f "$TMP_SSH_EXPECT" "$TMP_SCP_EXPECT"

echo "=========================================="
echo "✅ Развертывание завершено!"
echo "=========================================="
echo ""
echo "Следующие шаги:"
echo "1. Если переменные OpenSearch не настроены, настройте их в .env файле на Pi"
echo "2. Запустите event-logger в тестовом режиме:"
echo "   ssh ${USER}@${HOST}"
echo "   cd ${PROJECT_DIR}"
echo "   pm2 start ecosystem.config.js --only reacthome-event-logger"
echo "3. Проверьте логи:"
echo "   pm2 logs reacthome-event-logger --lines 50"
echo "4. Проверьте статус:"
echo "   pm2 status"
echo ""
