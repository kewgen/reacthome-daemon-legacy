#!/bin/bash
# Исправление синтаксической ошибки на строке 670 в event-logger.js
# Использование: ./scripts/system/fix-event-logger-syntax-670-on-pi.sh

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

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | grep -v "Connection closed" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "=========================================="
echo "🔧 Исправление синтаксической ошибки на строке 670"
echo "=========================================="
echo ""

# 1. Показываем проблемную строку и контекст
echo "=== 1. Проблемная строка и контекст ==="
CONTEXT=$(run_on_pi "cd $PROJECT_DIR && sed -n '665,675p' event-logger.js")
echo "$CONTEXT"
echo ""

# 2. Исправляем ошибку
echo "=== 2. Исправление ошибки ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Ищем проблемную строку 670 (индекс 669)
const problemLine = 669; // 670 - 1 (индекс с 0)
if (lines[problemLine]) {
  console.log('Строка 670 (до исправления):', lines[problemLine]);
  
  // Проблема: возможно неправильные кавычки или шаблонная строка
  // Проверяем, есть ли проблема с шаблонной строкой
  if (lines[problemLine].includes('log(\`') && !lines[problemLine].includes('\`);')) {
    // Возможно, закрывающая кавычка на другой строке или проблема с экранированием
    console.log('Найдена проблема с шаблонной строкой');
    
    // Ищем следующую строку с закрывающей кавычкой
    for (let i = problemLine; i < Math.min(problemLine + 5, lines.length); i++) {
      if (lines[i].includes('\`);') || lines[i].includes('\`);')) {
        console.log('Закрывающая кавычка найдена на строке', i + 1);
        break;
      }
    }
  }
  
  // Исправляем: заменяем проблемную строку
  // Если это log с шаблонной строкой, проверяем правильность
  const fixedLine = lines[problemLine]
    .replace(/log\(`([^`]*)`\)/g, 'log(\`$1\`)')  // Исправляем экранирование
    .replace(/log\(`([^`]*)\$\{/g, 'log(\`$1\${')  // Исправляем шаблонные строки
    .replace(/[^\x20-\x7E]/g, ''); // Удаляем невидимые символы если есть
  
  // Если строка содержит проблему с кириллицей в шаблонной строке, исправляем
  if (lines[problemLine].includes('Подключение к демону')) {
    // Проверяем, правильно ли экранирована шаблонная строка
    const match = lines[problemLine].match(/log\(([^)]+)\)/);
    if (match) {
      const logContent = match[1];
      // Если это не шаблонная строка, но должна быть - исправляем
      if (!logContent.startsWith('\`') && logContent.includes('${')) {
        lines[problemLine] = lines[problemLine].replace(/log\(([^)]+)\)/, 'log(\`$1\`)');
        console.log('Исправлено: добавлены обратные кавычки');
      } else if (logContent.startsWith('\`') && !logContent.endsWith('\`')) {
        // Шаблонная строка не закрыта
        console.log('Шаблонная строка не закрыта, ищем закрывающую кавычку');
      } else {
        // Возможно проблема в другом месте - просто заменяем проблемные символы
        lines[problemLine] = lines[problemLine]
          .replace(/[^\x20-\x7E\u0400-\u04FF]/g, '') // Оставляем только видимые символы
          .replace(/\`/g, '\`'); // Убеждаемся что обратные кавычки правильные
        console.log('Очищена строка от невидимых символов');
      }
    }
  }
  
  // Альтернативный подход: просто переписываем проблемную строку правильно
  if (lines[problemLine].includes('log(\`Подключение к демону: \${DAEMON_WS_URL}\`);')) {
    // Строка уже правильная, возможно проблема в предыдущих строках
    console.log('Строка выглядит правильно, проверяем предыдущие строки');
  } else if (lines[problemLine].includes('Подключение к демону')) {
    // Переписываем строку правильно
    lines[problemLine] = '  log(\`Подключение к демону: \${DAEMON_WS_URL}\`);';
    console.log('Строка переписана');
  }
  
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Файл обновлён');
} else {
  console.log('⚠️  Строка 670 не найдена');
}
NODE_SCRIPT
"
echo ""

# 3. Проверяем синтаксис
echo "=== 3. Проверка синтаксиса ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
if echo "$SYNTAX_CHECK" | grep -q "SyntaxError"; then
    echo "❌ Ошибка осталась:"
    echo "$SYNTAX_CHECK"
    echo ""
    echo "Пробуем более радикальный подход..."
    
    # Показываем больше контекста
    echo "Контекст (строки 660-680):"
    run_on_pi "cd $PROJECT_DIR && sed -n '660,680p' event-logger.js"
    echo ""
    
    # Пробуем исправить вручную
    run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

// Ищем все проблемные строки с log и шаблонными строками
for (let i = 665; i < 675; i++) {
  if (lines[i] && lines[i].includes('log') && lines[i].includes('Подключение')) {
    console.log('Найдена проблемная строка', i + 1, ':', lines[i]);
    // Переписываем правильно
    lines[i] = '  log(\`Подключение к демону: \${DAEMON_WS_URL}\`);';
    console.log('Исправлено на:', lines[i]);
  }
}

content = lines.join('\\n');
fs.writeFileSync(file, content, 'utf8');
console.log('✅ Файл обновлён');
NODE_SCRIPT
"
    
    # Проверяем снова
    SYNTAX_CHECK2=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1")
    if echo "$SYNTAX_CHECK2" | grep -q "SyntaxError"; then
        echo "❌ Ошибка всё ещё осталась:"
        echo "$SYNTAX_CHECK2"
    else
        echo "✅ Синтаксис исправлен!"
    fi
else
    echo "✅ Синтаксис корректен!"
fi
echo ""

# 4. Перезапускаем event-logger
echo "=== 4. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart events 2>&1" | head -5
echo ""

# 5. Проверяем статус
echo "=== 5. Статус event-logger ==="
sleep 2
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status events 2>&1 | grep events")
echo "$STATUS"
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="

