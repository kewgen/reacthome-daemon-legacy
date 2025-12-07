#!/bin/bash

HOST="192.168.88.4"
USER="pi"
PASS="raspberry"
LOG_DIR="./logs"

mkdir -p "$LOG_DIR/db"

echo "📥 Выгрузка логов с сервера..."

# Используем expect для автоматизации scp
expect << EOF
set timeout 60
spawn scp -o StrictHostKeyChecking=no $USER@$HOST:/home/pi/.pm2/logs/daemon-out.log "$LOG_DIR/daemon-out.log"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

expect << EOF
set timeout 60
spawn scp -o StrictHostKeyChecking=no $USER@$HOST:/home/pi/.pm2/logs/daemon-error.log "$LOG_DIR/daemon-error.log"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

expect << EOF
set timeout 60
spawn scp -o StrictHostKeyChecking=no $USER@$HOST:/home/pi/.pm2/pm2.log "$LOG_DIR/pm2.log"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

expect << EOF
set timeout 60
spawn scp -o StrictHostKeyChecking=no $USER@$HOST:/home/pi/reacthome-daemon/var/db/LOG "$LOG_DIR/db/LOG"
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

echo "✅ Логи выгружены в $LOG_DIR/"
ls -lh "$LOG_DIR"/*.log 2>/dev/null
ls -lh "$LOG_DIR/db/" 2>/dev/null


