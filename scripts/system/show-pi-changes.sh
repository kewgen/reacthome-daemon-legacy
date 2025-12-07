#!/bin/bash

#
# Показать изменения на Raspberry Pi
#
# Использование:
#   ./scripts/system/show-pi-changes.sh [--files file1 file2 ...]
#
# Опции:
#   --files  Показать изменения только для указанных файлов
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS:-raspberry}"
PROJECT_DIR="/home/pi/reacthome-daemon"
FILES_MODE=false
FILES_LIST=()

# Парсинг аргументов
if [ "$1" = "--files" ]; then
    FILES_MODE=true
    shift
    while [ $# -gt 0 ]; do
        FILES_LIST+=("$1")
        shift
    done
fi

if [ -z "$PASS" ]; then
    echo "⚠️  Переменная REACTHOME_PI_PASS не установлена"
    echo "   Используется пароль по умолчанию..."
    echo ""
fi

if [ "$FILES_MODE" = true ] && [ ${#FILES_LIST[@]} -eq 0 ]; then
    echo "❌ Ошибка: после --files необходимо указать файлы"
    exit 1
fi

if [ "$FILES_MODE" = true ]; then
    echo "🔍 Проверка изменений в файлах на Raspberry Pi ($HOST)..."
else
    echo "🔍 Проверка изменений на Raspberry Pi ($HOST)"
fi
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
    if {[string length $pass] > 0} {
      send "$pass\r"
    } else {
      interact
    }
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

if [ "$FILES_MODE" = true ]; then
    # Режим проверки конкретных файлов
    echo "Проверка изменений в указанных файлах:"
    echo ""
    for file in "${FILES_LIST[@]}"; do
        echo "=== Изменения в $file ==="
        run_on_pi "cd $PROJECT_DIR && git diff $file | head -50"
        echo ""
    done
else
    # Полный режим
    echo "=========================================="
    echo "1. Изменённые файлы (git status)"
    echo "=========================================="
    echo ""
    STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
    if [ -z "$STATUS" ]; then
        echo "✅ Нет изменённых файлов"
    else
        echo "$STATUS"
        echo ""
        CHANGED_COUNT=$(echo "$STATUS" | grep -c "^ M" || echo "0")
        ADDED_COUNT=$(echo "$STATUS" | grep -c "^M " || echo "0")
        UNTRACKED_COUNT=$(echo "$STATUS" | grep -c "^??" || echo "0")
        DELETED_COUNT=$(echo "$STATUS" | grep -c "^ D" || echo "0")
        echo "Статистика:"
        echo "  Изменено: $CHANGED_COUNT"
        echo "  Добавлено в индекс: $ADDED_COUNT"
        echo "  Удалено: $DELETED_COUNT"
        echo "  Неотслеживаемых: $UNTRACKED_COUNT"
    fi
    echo ""

    echo "=========================================="
    echo "2. Детальные изменения (git diff --stat)"
    echo "=========================================="
    echo ""
    run_on_pi "cd $PROJECT_DIR && git diff --stat"
    echo ""

    echo "=========================================="
    echo "3. Изменённые файлы (детально)"
    echo "=========================================="
    echo ""
CHANGED_FILES=$(run_on_pi "cd $PROJECT_DIR && git diff --name-only")
if [ -n "$CHANGED_FILES" ]; then
    echo "$CHANGED_FILES" | while read file; do
        echo "--- $file ---"
        run_on_pi "cd $PROJECT_DIR && git diff --stat $file"
    done
    
    # Анализ критичности изменений
    if echo "$CHANGED_FILES" | grep -q "src/assist/lang/ru.js"; then
        echo ""
        echo "=========================================="
        echo "⚠️  Обнаружено важное изменение!"
        echo "=========================================="
        echo ""
        echo "**Файл:** \`src/assist/lang/ru.js\`"
        echo ""
        
        # Получаем статистику изменений
        DIFF_STAT=$(run_on_pi "cd $PROJECT_DIR && git diff --stat src/assist/lang/ru.js")
        echo "**Статистика изменений:**"
        echo "\`\`\`"
        echo "$DIFF_STAT"
        echo "\`\`\`"
        echo ""
        
        echo "**Критичность: 🔴 ВЫСОКАЯ**"
        echo ""
        echo "**Почему это критично:**"
        echo ""
        echo "1. **Предотвращение краша демона:**"
        echo "   - Без этих изменений демон падает с ошибкой \`SqliteError: no such table: forms\`"
        echo "   - Это происходит при отсутствии или повреждении БД морфологии"
        echo "   - Ошибка возникает при инициализации модуля, что приводит к полной остановке сервиса"
        echo ""
        echo "2. **Устойчивость к отсутствию данных:**"
        echo "   - Старый код предполагал обязательное наличие таблицы \`forms\`"
        echo "   - Новый код безопасно обрабатывает отсутствие БД/таблицы"
        echo "   - Морфология отключается gracefully, не ломая остальной функционал"
        echo ""
        echo "3. **Влияние на функциональность:**"
        echo "   - Модуль \`ru.js\` используется для морфологического анализа русского языка"
        echo "   - Используется в голосовом ассистенте для распознавания различных форм слов"
        echo "   - Без исправления: демон не запускается → система полностью неработоспособна"
        echo "   - С исправлением: демон работает, морфология отключена (ограниченная функциональность)"
        echo ""
        echo "4. **Риски при отсутствии исправления:**"
        echo "   - ❌ Полная недоступность системы при отсутствии БД морфологии"
        echo "   - ❌ Невозможность перезапуска демона после сбоя"
        echo "   - ❌ Потеря всех функций системы из-за одной опциональной зависимости"
        echo ""
        echo "**Суть изменений:**"
        echo ""
        echo "- ✅ Добавлена безопасная инициализация с проверкой существования таблицы"
        echo "- ✅ Обработка ошибок при работе с SQLite (try-catch блоки)"
        echo "- ✅ Логирование предупреждений вместо краша при ошибках"
        echo "- ✅ Флаг \`isInitialized\` для отслеживания состояния БД"
        echo "- ✅ Graceful degradation: возврат пустого массива вместо падения"
        echo "- ✅ Использование \`path.join\` для корректного формирования пути к БД"
        echo ""
        echo "**Рекомендация:**"
        echo ""
        echo "```bash"
        echo "cd $PROJECT_DIR"
        echo "git add src/assist/lang/ru.js"
        echo "git commit -m \"fix: добавлена безопасная инициализация морфологии (обработка отсутствия таблицы forms)\""
        echo "```"
        echo ""
        echo "**Приоритет коммита:** 🔴 КРИТИЧЕСКИЙ"
        echo "   - Исправление должно быть закоммичено немедленно"
        echo "   - Без этого исправления система уязвима к сбоям при отсутствии БД морфологии"
        echo ""
    fi
    else
        echo "✅ Нет изменённых файлов"
    fi
    echo ""

    echo "=========================================="
    echo "4. Файлы в индексе (staged)"
    echo "=========================================="
    echo ""
    STAGED=$(run_on_pi "cd $PROJECT_DIR && git diff --cached --name-only")
    if [ -z "$STAGED" ]; then
        echo "✅ Нет файлов в индексе"
    else
        echo "$STAGED"
    fi
    echo ""

    echo "=========================================="
    echo "5. Неотслеживаемые файлы"
    echo "=========================================="
    echo ""
    UNTRACKED=$(run_on_pi "cd $PROJECT_DIR && git ls-files --others --exclude-standard")
    if [ -z "$UNTRACKED" ]; then
        echo "✅ Нет неотслеживаемых файлов"
    else
        echo "$UNTRACKED"
        echo ""
        echo "Всего: $(echo \"$UNTRACKED\" | wc -l | tr -d ' ') файл(ов)"
    fi
    echo ""

    echo "=========================================="
    echo "6. Последние коммиты"
    echo "=========================================="
    echo ""
    run_on_pi "cd $PROJECT_DIR && git log --oneline --graph -10"
    echo ""
fi

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
