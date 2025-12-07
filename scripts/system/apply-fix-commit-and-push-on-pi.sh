#!/bin/bash
# Скрипт для применения исправления ACTION_SCRIPT_RUN, создания коммита и пуша на Raspberry Pi
# Использование: ./scripts/system/apply-fix-and-commit-on-pi.sh

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
  "*yes/no" {
    send "yes\r"
    exp_continue
  }
  eof
}
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на Raspberry Pi
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added" | grep -v "Connection closed" | grep -v "Connection to.*closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "Применение исправления ACTION_SCRIPT_RUN на Raspberry Pi"
echo "=========================================="
echo "Хост: ${USER}@${HOST}"
echo "Директория: $PROJECT_DIR"
echo ""

# Проверяем ветку
echo "=== 1. Проверка ветки ==="
BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d '\r\n ' | xargs)
echo "Текущая ветка: '$BRANCH'"

if [ "$BRANCH" != "websocket-logger" ]; then
    echo "⚠️  Переключение на ветку websocket-logger..."
    run_on_pi "cd $PROJECT_DIR && git checkout websocket-logger 2>&1"
    BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current" | head -1 | tr -d '\r\n ' | xargs)
    echo "Текущая ветка: '$BRANCH'"
fi

if [ "$BRANCH" != "websocket-logger" ]; then
    echo "❌ Не удалось переключиться на ветку websocket-logger (текущая: '$BRANCH')"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Ветка корректна"
echo ""

# Проверяем, применено ли уже исправление
echo "=== 2. Проверка текущего состояния ==="
HAS_FIX=$(run_on_pi "cd $PROJECT_DIR && grep -A 20 'case ACTION_SCRIPT_RUN:' src/controllers/service.js | grep -q 'contextStore.run' && echo 'yes' || echo 'no'")

if [ "$HAS_FIX" = "yes" ]; then
    echo "✅ Исправление уже применено"
    rm -f "$TMP_EXPECT"
    exit 0
fi

echo "⚠️  Исправление не применено, применяем..."
echo ""

# Применяем исправление через Node.js скрипт
echo "=== 3. Применение исправления ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const serviceFile = 'src/controllers/service.js';
let content = fs.readFileSync(serviceFile, 'utf8');

// Ищем case ACTION_SCRIPT_RUN
const pattern = /(case ACTION_SCRIPT_RUN: \{[\s\S]*?if \(script\.disabled\) return;)([\s\S]*?for \(const i of script\.action\) \{[\s\S]*?const \{ type, payload, delay \} = get\(i\);[\s\S]*?const a = \{ action: i, type, \.\.\.payload \};[\s\S]*?if \(delay > 0\) \{[\s\S]*?setTimeout\(run, delay, a\);[\s\S]*?\} else \{[\s\S]*?run\(a\);[\s\S]*?\})([\s\S]*?\}[\s\S]*?break;[\s\S]*?\})/;

const match = content.match(pattern);

if (!match) {
    console.error('❌ Не удалось найти паттерн для замены');
    process.exit(1);
}

const before = match[1];
const middle = match[2];
const after = match[3];

// Проверяем, есть ли уже contextStore
if (before.includes('contextStore') || middle.includes('contextStore')) {
    console.log('✅ Исправление уже применено');
    process.exit(0);
}

// Создаём исправленный код
const fixedBefore = before + '\n          const contextStore = require(\'../logging/context\');\n          const currentContext = contextStore.getStore() || {};\n          const scriptContext = {\n            ...currentContext,\n            type: currentContext.type || \'script\',\n            ref: id\n          };\n';

const fixedMiddle = middle
    .replace(
        /if \(delay > 0\) \{[\s\S]*?setTimeout\(run, delay, a\);[\s\S]*?\} else \{[\s\S]*?run\(a\);[\s\S]*?\}/,
        \`if (delay > 0) {\n              setTimeout(() => {\n                contextStore.run(scriptContext, () => {\n                  run(a);\n                });\n              }, delay);\n            } else {\n              contextStore.run(scriptContext, () => {\n                run(a);\n              });\n            }\`
    );

const newContent = content.replace(match[0], fixedBefore + fixedMiddle + after);

fs.writeFileSync(serviceFile, newContent, 'utf8');
console.log('✅ Исправление применено');
NODE_SCRIPT
"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка при применении исправления"
    rm -f "$TMP_EXPECT"
    exit 1
fi

echo "✅ Исправление применено"
echo ""

# Проверяем изменения
echo "=== 4. Проверка изменений ==="
CHANGES=$(run_on_pi "cd $PROJECT_DIR && git diff src/controllers/service.js | head -50")
if [ -n "$CHANGES" ]; then
    echo "Изменения:"
    echo "$CHANGES" | head -30
    echo "..."
else
    echo "⚠️  Изменения не обнаружены"
fi
echo ""

# Создаём коммит
echo "=== 5. Создание коммита ==="
COMMIT_MSG="fix: сохранение контекста для ACTION_SCRIPT_RUN с setTimeout

Критическое исправление для корректного логирования событий скриптов с задержкой.

Проблема:
- При выполнении скриптов с задержкой (delay > 0) контекст терялся
- Это приводило к неправильному логированию событий (trigger.type = 'unknown')
- События скриптов не имели корректной информации о триггере

Решение:
- Добавлено сохранение контекста через contextStore.run()
- Контекст создаётся перед выполнением скрипта
- Контекст сохраняется для всех действий скрипта, включая отложенные (setTimeout)
- Тип контекста устанавливается в 'script', ref указывает на ID скрипта

Изменения:
- Добавлен импорт contextStore из '../logging/context'
- Создание scriptContext с типом 'script' и ref = id скрипта
- Обёртка выполнения действий в contextStore.run() для сохранения контекста
- Исправлен setTimeout для сохранения контекста в асинхронных операциях

Влияние:
- ✅ События скриптов теперь имеют корректный trigger.type = 'script'
- ✅ События скриптов имеют trigger.ref = ID скрипта
- ✅ Контекст сохраняется для всех действий, включая отложенные
- ✅ Улучшена трассировка цепочек событий

Связано с:
- docs/websocket/WEBSOCKET_EVENT_LOGGING_MIGRATION_PLAN.md (раздел 'Критическое исправление: setTimeout в ACTION_SCRIPT_RUN')
- reports/migration/migration-status-assessment-2025-12-07.md"

run_on_pi "cd $PROJECT_DIR && git add src/controllers/service.js"

COMMIT_RESULT=$(run_on_pi "cd $PROJECT_DIR && git commit -m \"$COMMIT_MSG\" 2>&1")

if echo "$COMMIT_RESULT" | grep -q "nothing to commit"; then
    echo "⚠️  Нет изменений для коммита"
elif echo "$COMMIT_RESULT" | grep -q "error\|Error\|ERROR"; then
    echo "❌ Ошибка при создании коммита:"
    echo "$COMMIT_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Коммит создан:"
    echo "$COMMIT_RESULT" | head -5
fi
echo ""

# Пушим изменения
echo "=== 6. Отправка изменений (push) ==="
PUSH_RESULT=$(run_on_pi "cd $PROJECT_DIR && git push origin websocket-logger 2>&1")

if echo "$PUSH_RESULT" | grep -q "error\|Error\|ERROR\|fatal"; then
    echo "❌ Ошибка при отправке изменений:"
    echo "$PUSH_RESULT"
    rm -f "$TMP_EXPECT"
    exit 1
else
    echo "✅ Изменения отправлены:"
    echo "$PUSH_RESULT" | head -10
fi
echo ""

# Показываем последний коммит
echo "=== 7. Последний коммит ==="
LAST_COMMIT=$(run_on_pi "cd $PROJECT_DIR && git log -1 --pretty=format:'%h - %s (%an, %ar)'")
echo "$LAST_COMMIT"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление применено, закоммичено и отправлено"
echo "=========================================="
