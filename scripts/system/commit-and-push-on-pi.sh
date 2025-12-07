#!/bin/bash
# Скрипт для создания коммита и push на Raspberry Pi
# Использование: ./scripts/system/commit-and-push-on-pi.sh

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
BRANCH="${1:-websocket-logger}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите в .env файле: REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

# Создаём временный expect скрипт для SSH
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
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

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed"
}

echo "=========================================="
echo "Создание коммита и push на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Ветка: ${BRANCH}"
echo ""

# Создаем сообщение коммита
COMMIT_MESSAGE="feat: развертывание event-logger через WebSocket

Развертывание системы логирования событий через отдельный сервис event-logger.

Добавленные компоненты:
- event-logger.js - основной сервис для логирования событий через WebSocket
- ecosystem.config.js - конфигурация PM2 для управления event-logger
- src/logging/context.js - модуль для управления контекстом через AsyncLocalStorage
- src/logging/event-log.js - функции форматирования событий (966 строк)
- src/logging/filters.js - система фильтрации событий (431 строка)
- src/logging/opensearch.js - модуль отправки событий в OpenSearch (480 строк)

Критические исправления:
- src/assist/lang/ru.js - исправлена безопасная инициализация SQLite:
  * Проверка существования директории var/lang перед открытием БД
  * Проверка существования файла ru.db перед открытием
  * Открытие БД в режиме readonly для предотвращения блокировок
  * Graceful shutdown для корректного закрытия соединения с БД
  * Обработка всех ошибок с возвратом пустого массива вместо падения

Особенности развертывания:
- Файлы скопированы через SCP напрямую (не через git pull)
- Ветка websocket-logger создана локально на Pi
- Все компоненты готовы к запуску в тестовом режиме

Следующие шаги:
- Настроить переменные OpenSearch в .env файле
- Запустить event-logger в тестовом режиме через PM2
- Проверить подключение к WebSocket (ws://localhost:3000)
- Начать мониторинг работы (параллельно с встроенным логированием)"

echo "=== Проверка статуса ==="
CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")
echo "Текущая ветка: $CURRENT_BRANCH"
echo ""

if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "⚠️  Текущая ветка не $BRANCH, переключаюсь..."
    run_on_pi "cd $PROJECT_DIR && git checkout -b $BRANCH 2>&1 || git checkout $BRANCH 2>&1"
    echo ""
fi

echo "=== Добавление файлов ==="
ADD_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git add event-logger.js ecosystem.config.js src/logging/ src/assist/lang/ru.js 2>&1")
echo "$ADD_OUTPUT"
echo ""

echo "=== Проверка статуса перед коммитом ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
echo "$STATUS"
echo ""

echo "=== Создание коммита ==="
# Создаем файл с сообщением коммита на Pi
echo "$COMMIT_MESSAGE" | run_on_pi "cd $PROJECT_DIR && cat > /tmp/commit-msg.txt"
COMMIT_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git commit -F /tmp/commit-msg.txt 2>&1")
echo "$COMMIT_OUTPUT"
echo ""

echo "=== Проверка созданного коммита ==="
COMMIT_HASH=$(run_on_pi "cd $PROJECT_DIR && git log --oneline -1")
echo "$COMMIT_HASH"
echo ""

echo "=== Push на remote ==="
PUSH_OUTPUT=$(run_on_pi "cd $PROJECT_DIR && git push -u origin $BRANCH 2>&1")
echo "$PUSH_OUTPUT"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Готово"
echo "=========================================="
