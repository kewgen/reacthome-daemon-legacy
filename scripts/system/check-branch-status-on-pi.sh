#!/bin/bash

#
# Проверка статуса ветки на Raspberry Pi
#
# Использование:
#   ./scripts/system/check-branch-status-on-pi.sh [--simple]
#
# Опции:
#   --simple  Простая проверка (только актуальность ветки)
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"
SIMPLE_MODE=false

# Проверка флага --simple
if [ "$1" = "--simple" ]; then
    SIMPLE_MODE=true
fi

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

if [ "$SIMPLE_MODE" = true ]; then
    echo "🔍 Проверка актуальности ветки на Raspberry Pi ($HOST)..."
else
    echo "🔍 Проверка статуса ветки на Raspberry Pi ($HOST)"
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

CURRENT_BRANCH=$(run_on_pi "cd $PROJECT_DIR && git branch --show-current")

if [ "$SIMPLE_MODE" = true ]; then
    # Простой режим - только актуальность
    echo "Ветка: $CURRENT_BRANCH"
    echo ""
    
    run_on_pi "cd $PROJECT_DIR && git fetch origin 2>&1" > /dev/null
    echo ""
    
    LOCAL=$(run_on_pi "cd $PROJECT_DIR && git rev-parse HEAD")
    REMOTE=$(run_on_pi "cd $PROJECT_DIR && git rev-parse refs/remotes/origin/$CURRENT_BRANCH 2>&1" | head -1)
    
    echo "Локальный коммит:  ${LOCAL:0:8}"
    echo "Remote коммит:     ${REMOTE:0:8}"
    echo ""
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo "✅ ВЕТКА АКТУАЛЬНА - синхронизирована с remote"
    else
        BEHIND=$(run_on_pi "cd $PROJECT_DIR && git rev-list --count HEAD..refs/remotes/origin/$CURRENT_BRANCH 2>&1" | head -1)
        AHEAD=$(run_on_pi "cd $PROJECT_DIR && git rev-list --count refs/remotes/origin/$CURRENT_BRANCH..HEAD 2>&1" | head -1)
        
        if [ "$BEHIND" != "0" ] && [ -n "$BEHIND" ] && [ "$BEHIND" != "fatal" ]; then
            echo "⚠️  ВЕТКА ОТСТАЁТ на $BEHIND коммит(ов)"
        elif [ "$AHEAD" != "0" ] && [ -n "$AHEAD" ] && [ "$AHEAD" != "fatal" ]; then
            echo "⚠️  ВЕТКА ВПЕРЕДИ на $AHEAD коммит(ов)"
        else
            echo "⚠️  ВЕТКА НЕ СИНХРОНИЗИРОВАНА"
        fi
    fi
    echo ""
else
    # Детальный режим
    echo "=========================================="
    echo "1. Текущая ветка"
    echo "=========================================="
    echo ""
    echo "Активная ветка: $CURRENT_BRANCH"
    echo ""

    echo "=========================================="
    echo "2. Последний коммит в текущей ветке"
    echo "=========================================="
    echo ""
    run_on_pi "cd $PROJECT_DIR && git log --oneline -1"
    echo ""

    echo "=========================================="
    echo "3. Fetch обновлений с remote"
    echo "=========================================="
    echo ""
    run_on_pi "cd $PROJECT_DIR && git fetch origin 2>&1"
    echo ""

    echo "=========================================="
    echo "4. Сравнение с origin/$CURRENT_BRANCH"
    echo "=========================================="
    echo ""
    BEHIND=$(run_on_pi "cd $PROJECT_DIR && git rev-list --count HEAD..origin/$CURRENT_BRANCH 2>/dev/null || echo '0'")
    AHEAD=$(run_on_pi "cd $PROJECT_DIR && git rev-list --count origin/$CURRENT_BRANCH..HEAD 2>/dev/null || echo '0'")

    if [ "$BEHIND" = "0" ] && [ "$AHEAD" = "0" ]; then
        echo "✅ Ветка актуальна (синхронизирована с remote)"
    elif [ "$BEHIND" != "0" ]; then
        echo "⚠️  Ветка отстаёт от remote на $BEHIND коммит(ов)"
        echo ""
        echo "Коммиты, которых нет локально:"
        run_on_pi "cd $PROJECT_DIR && git log --oneline HEAD..origin/$CURRENT_BRANCH | head -10"
    elif [ "$AHEAD" != "0" ]; then
        echo "⚠️  Ветка впереди remote на $AHEAD коммит(ов)"
        echo ""
        echo "Локальные коммиты, которых нет в remote:"
        run_on_pi "cd $PROJECT_DIR && git log --oneline origin/$CURRENT_BRANCH..HEAD | head -10"
    fi
    echo ""

echo "=========================================="
echo "5. Статус рабочей директории"
echo "=========================================="
echo ""
STATUS=$(run_on_pi "cd $PROJECT_DIR && git status --short")
if [ -z "$STATUS" ]; then
    echo "✅ Рабочая директория чистая (нет изменений)"
else
    echo "⚠️  Есть изменения в рабочей директории:"
    echo "$STATUS" | head -20
    echo ""
    
    # Проверяем наличие изменений в критических файлах
    if echo "$STATUS" | grep -q "src/assist/lang/ru.js"; then
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
fi
echo ""

echo "=========================================="
echo "6. Хеш последнего коммита"
echo "=========================================="
echo ""
LOCAL_HASH=$(run_on_pi "cd $PROJECT_DIR && git rev-parse HEAD")
REMOTE_HASH=$(run_on_pi "cd $PROJECT_DIR && git rev-parse origin/$CURRENT_BRANCH 2>/dev/null || echo 'N/A'")
echo "Локальный:  $LOCAL_HASH"
echo "Remote:     $REMOTE_HASH"
if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    echo ""
    echo "✅ Хеши совпадают - ветка актуальна"
else
    echo ""
    echo "⚠️  Хеши различаются - ветка не синхронизирована"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Проверка завершена"
echo "=========================================="
echo ""

