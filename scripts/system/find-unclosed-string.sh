#!/bin/bash
# Поиск незакрытой строки в event-logger.js
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
  "*assword:" { send "$pass\r"; exp_continue }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning" | sed 's/Connection to.*closed\.//' | tr -d '\r' || true
}

echo "Поиск незакрытой строки..."

run_on_pi "cd $PROJECT_DIR && node << 'EOF'
const fs = require('fs');
const file = 'event-logger.js';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\\n');

let inString = false;
let stringChar = '';
let stringStartLine = -1;

// Проверяем каждую строку до 670
for (let i = 0; i < 670; i++) {
  if (lines[i]) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j-1] : '';
      
      if (!inString) {
        // Начало строки
        if ((char === '\"' || char === '\\'' || char === '\`') && prevChar !== '\\\\') {
          inString = true;
          stringChar = char;
          stringStartLine = i + 1;
          console.log(\`Начало строки на строке \${i+1}, колонка \${j+1}, символ: \${char}\`);
        }
      } else {
        // Конец строки
        if (char === stringChar && prevChar !== '\\\\') {
          inString = false;
          stringChar = '';
          console.log(\`Конец строки на строке \${i+1}, колонка \${j+1}\`);
          stringStartLine = -1;
        }
      }
    }
    
    // Если строка не закончилась на этой строке, проверяем следующую
    if (inString && i < 669) {
      // Продолжаем проверку на следующей строке
    }
  }
}

if (inString) {
  console.log(\`\\n❌ НАЙДЕНА НЕЗАКРЫТАЯ СТРОКА!\\n\`);
  console.log(\`Началась на строке: \${stringStartLine}\`);
  console.log(\`Тип кавычек: \${stringChar}\`);
  console.log(\`\\nКонтекст (строки \${stringStartLine-2} - \${stringStartLine+5}):\`);
  for (let i = Math.max(0, stringStartLine-3); i < Math.min(stringStartLine+5, lines.length); i++) {
    console.log(\`\${i+1}: \${lines[i]}\`);
  }
} else {
  console.log('\\n✅ Все строки закрыты до строки 670');
}

EOF
"

rm -f "$TMP_EXPECT"
