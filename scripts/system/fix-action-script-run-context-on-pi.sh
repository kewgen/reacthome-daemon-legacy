#!/bin/bash
# Скрипт для исправления ACTION_SCRIPT_RUN с сохранением контекста
# Использование: ./scripts/system/fix-action-script-run-context.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Проверяем текущую ветку
CURRENT_BRANCH=$(git branch --show-current)
echo "Текущая ветка: $CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "websocket-logger" ]; then
    echo "⚠️  Внимание: вы не в ветке websocket-logger"
    echo "   Переключитесь на ветку websocket-logger перед применением исправления"
    echo "   git checkout websocket-logger"
    exit 1
fi

SERVICE_FILE="src/controllers/service.js"

if [ ! -f "$SERVICE_FILE" ]; then
    echo "❌ Файл $SERVICE_FILE не найден"
    exit 1
fi

# Проверяем, есть ли уже исправление
if grep -q "contextStore.run(scriptContext" "$SERVICE_FILE"; then
    echo "✅ Исправление уже применено в $SERVICE_FILE"
    exit 0
fi

# Находим строку с case ACTION_SCRIPT_RUN
LINE_NUM=$(grep -n "case ACTION_SCRIPT_RUN:" "$SERVICE_FILE" | head -1 | cut -d: -f1)

if [ -z "$LINE_NUM" ]; then
    echo "❌ Не найдено case ACTION_SCRIPT_RUN в $SERVICE_FILE"
    exit 1
fi

echo "Найдено case ACTION_SCRIPT_RUN на строке $LINE_NUM"

# Создаём резервную копию
cp "$SERVICE_FILE" "${SERVICE_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
echo "✅ Создана резервная копия: ${SERVICE_FILE}.backup.*"

# Используем Node.js для точного редактирования
node << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const serviceFile = process.argv[2];
const content = fs.readFileSync(serviceFile, 'utf8');

// Паттерн для поиска case ACTION_SCRIPT_RUN
const pattern = /(case ACTION_SCRIPT_RUN: \{[\s\S]*?)(if \(delay > 0\) \{[\s\S]*?setTimeout\(run, delay, a\);[\s\S]*?\} else \{[\s\S]*?run\(a\);[\s\S]*?\})([\s\S]*?break;[\s\S]*?\})/;

const match = content.match(pattern);

if (!match) {
    console.error('❌ Не удалось найти паттерн для замены');
    process.exit(1);
}

const before = match[1];
const delayBlock = match[2];
const after = match[3];

// Проверяем, есть ли уже contextStore
if (before.includes('contextStore')) {
    console.log('✅ Исправление уже применено');
    process.exit(0);
}

// Создаём исправленный код
const fixedCode = before.replace(
    /if \(script\.disabled\) return;/,
    `if (script.disabled) return;
    const contextStore = require('../logging/context');
    const currentContext = contextStore.getStore() || {};
    const scriptContext = {
      ...currentContext,
      type: currentContext.type || 'script',
      ref: id
    };`
).replace(
    /if \(delay > 0\) \{[\s\S]*?setTimeout\(run, delay, a\);[\s\S]*?\} else \{[\s\S]*?run\(a\);[\s\S]*?\}/,
    `if (delay > 0) {
          setTimeout(() => {
            contextStore.run(scriptContext, () => {
              run(a);
            });
          }, delay);
        } else {
          contextStore.run(scriptContext, () => {
            run(a);
          });
        }`
) + after;

const newContent = content.replace(match[0], fixedCode);

fs.writeFileSync(serviceFile, newContent, 'utf8');
console.log('✅ Исправление применено');
NODE_SCRIPT
"$SERVICE_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Исправление успешно применено!"
    echo ""
    echo "Проверьте изменения:"
    echo "  git diff $SERVICE_FILE"
    echo ""
    echo "Если всё корректно, закоммитьте:"
    echo "  git add $SERVICE_FILE"
    echo "  git commit -m 'fix: сохранение контекста для ACTION_SCRIPT_RUN с setTimeout'"
else
    echo "❌ Ошибка при применении исправления"
    exit 1
fi
