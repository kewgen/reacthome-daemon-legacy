#!/bin/bash
# Исправление синтаксической ошибки в event-logger.js на Raspberry Pi
# Использование: ./scripts/system/fix-event-logger-syntax-on-pi.sh

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
echo "🔧 Исправление синтаксической ошибки в event-logger.js"
echo "=========================================="
echo ""

# 1. Находим все объявления isInitialStateReceived
echo "=== 1. Поиск дублирующихся объявлений ==="
DUPLICATES=$(run_on_pi "cd $PROJECT_DIR && grep -n 'let isInitialStateReceived\|const isInitialStateReceived\|var isInitialStateReceived' event-logger.js")
echo "$DUPLICATES"
echo ""

# 2. Создаём резервную копию
echo "=== 2. Создание резервной копии ==="
BACKUP_FILE="event-logger.js.backup.$(date +%Y%m%d_%H%M%S)"
run_on_pi "cd $PROJECT_DIR && cp event-logger.js $BACKUP_FILE && echo 'Backup: $BACKUP_FILE'"
echo ""

# 3. Исправляем ошибку
echo "=== 3. Исправление дублирующегося объявления ==="
run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');

// Находим все объявления isInitialStateReceived
const lines = content.split('\\n');
let declarations = [];
let firstDeclarationLine = -1;
let secondDeclarationLine = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.match(/let\\s+isInitialStateReceived|const\\s+isInitialStateReceived|var\\s+isInitialStateReceived/)) {
    declarations.push({ line: i + 1, content: line });
    if (firstDeclarationLine === -1) {
      firstDeclarationLine = i;
    } else if (secondDeclarationLine === -1) {
      secondDeclarationLine = i;
    }
  }
}

console.log('Найдено объявлений:', declarations.length);
declarations.forEach(d => console.log('  Строка', d.line + ':', d.content.substring(0, 80)));

if (declarations.length > 1 && secondDeclarationLine !== -1) {
  // Удаляем второе объявление (оставляем первое)
  console.log('Удаляем дублирующееся объявление на строке', secondDeclarationLine + 1);
  lines.splice(secondDeclarationLine, 1);
  content = lines.join('\\n');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Исправлено');
} else {
  console.log('⚠️  Дублирующихся объявлений не найдено или уже исправлено');
}
NODE_SCRIPT
"
echo ""

# 4. Проверяем синтаксис
echo "=== 4. Проверка синтаксиса ==="
SYNTAX_CHECK=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1" || echo "Ошибка синтаксиса")
if echo "$SYNTAX_CHECK" | grep -q "SyntaxError"; then
    echo "❌ Синтаксическая ошибка:"
    echo "$SYNTAX_CHECK"
    echo ""
    echo "Попробуем другой подход..."
    
    # Альтернативный подход: удаляем все объявления кроме первого
    run_on_pi "cd $PROJECT_DIR && node << 'NODE_SCRIPT'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');

// Находим первое объявление
const firstMatch = content.match(/(let|const|var)\\s+isInitialStateReceived[^;]*;/);
if (firstMatch) {
  console.log('Первое объявление найдено');
  
  // Удаляем все последующие объявления
  const regex = new RegExp('(let|const|var)\\s+isInitialStateReceived[^;]*;', 'g');
  let matches = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match);
  }
  
  if (matches.length > 1) {
    // Заменяем все кроме первого на пустую строку
    for (let i = 1; i < matches.length; i++) {
      content = content.replace(matches[i][0], '');
    }
    fs.writeFileSync(file, content, 'utf8');
    console.log('✅ Удалено', matches.length - 1, 'дублирующихся объявлений');
  }
}
NODE_SCRIPT
"
    
    # Проверяем снова
    SYNTAX_CHECK2=$(run_on_pi "cd $PROJECT_DIR && node -c event-logger.js 2>&1" || echo "Ошибка")
    if echo "$SYNTAX_CHECK2" | grep -q "SyntaxError"; then
        echo "❌ Ошибка осталась:"
        echo "$SYNTAX_CHECK2"
    else
        echo "✅ Синтаксис исправлен"
    fi
else
    echo "✅ Синтаксис корректен"
fi
echo ""

# 5. Перезапускаем event-logger
echo "=== 5. Перезапуск event-logger ==="
run_on_pi "cd $PROJECT_DIR && pm2 restart reacthome-event-logger 2>&1" | head -10
echo ""

# 6. Проверяем статус
echo "=== 6. Статус event-logger ==="
STATUS=$(run_on_pi "cd $PROJECT_DIR && pm2 status reacthome-event-logger 2>&1")
echo "$STATUS"
echo ""

# 7. Проверяем логи
echo "=== 7. Последние логи event-logger (10 строк) ==="
LOGS=$(run_on_pi "cd $PROJECT_DIR && pm2 logs reacthome-event-logger --lines 10 --nostream 2>&1 | tail -10")
if [ -n "$LOGS" ]; then
    echo "$LOGS"
else
    echo "⚠️  Нет логов"
fi
echo ""

rm -f "$TMP_EXPECT"

echo "=========================================="
echo "✅ Исправление завершено"
echo "=========================================="
