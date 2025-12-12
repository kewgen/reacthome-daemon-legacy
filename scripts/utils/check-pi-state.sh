#!/bin/bash

# Скрипт для проверки состояния Raspberry Pi

HOST="192.168.88.4"
USER="pi"
PASS="${REACTHOME_PI_PASS:-raspberry}"
PROJECT_DIR="/home/pi/reacthome-daemon"

echo "🔍 Проверка состояния Raspberry Pi..."
echo ""

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no $USER@$HOST "cd $PROJECT_DIR && echo '=== Git Status ===' && git status --short && echo '' && echo '=== Current Branch ===' && git branch --show-current && echo '' && echo '=== Remote Tracking ===' && git branch -vv | grep '^\*' && echo '' && echo '=== Untracked Files ===' && git ls-files --others --exclude-standard | head -20 && echo '' && echo '=== Modified Files ===' && git diff --name-only && echo '' && echo '=== Last Commit ===' && git log --oneline -1"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

echo ""
echo "✅ Проверка завершена"



