#!/bin/bash

# Скрипт для перезапуска демона через SSH
# Использует expect для автоматизации ввода пароля

HOST="192.168.88.4"
USER="pi"
PASS="raspberry"

echo "🔄 Перезапуск демона на сервере $USER@$HOST..."

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no $USER@$HOST "pm2 restart daemon && sleep 2 && pm2 list | grep daemon"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

if [ $? -eq 0 ]; then
    echo "✅ Демон перезапущен успешно"
else
    echo "❌ Ошибка при перезапуске демона"
    exit 1
fi

