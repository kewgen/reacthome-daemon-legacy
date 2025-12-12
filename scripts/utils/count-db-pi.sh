#!/bin/bash

# Скрипт для подсчёта записей в БД на Raspberry Pi через SSH

HOST="192.168.88.4"
USER="pi"
PASS="${REACTHOME_PI_PASS:-raspberry}"
DB_PATH="/home/pi/reacthome-daemon/var/db"

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no $USER@$HOST "cd /home/pi/reacthome-daemon && node -e \"const {Level}=require('level');(async()=>{try{const db=new Level('var/db',{valueEncoding:'json'});let c=0;for await(const _ of db.iterator())c++;await db.close();console.log(JSON.stringify({path:'$DB_PATH',count:c}));}catch(e){console.error('ERROR:',e.message);process.exit(1);}})();\""
expect {
    "password:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF



