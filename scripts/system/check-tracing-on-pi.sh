#!/bin/bash

# Скрипт для проверки развёртывания трассировки на Raspberry Pi

PI_HOST="${REACTHOME_PI_HOST:-192.168.1.100}"
PI_USER="${REACTHOME_PI_USER:-pi}"

echo "═══════════════════════════════════════════════════════"
echo "🔍 ПРОВЕРКА ТРАССИРОВКИ НА RASPBERRY PI"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "1️⃣ Проверка файлов:"
echo "───────────────────"
ssh ${PI_USER}@${PI_HOST} << 'EOF'
echo "📁 src/logging/context.js:"
if [ -f ~/reacthome-daemon/src/logging/context.js ]; then
  echo "  ✅ Найден"
  ls -lh ~/reacthome-daemon/src/logging/context.js
else
  echo "  ❌ НЕ НАЙДЕН"
fi

echo ""
echo "📁 src/websocket/broadcast-with-context.js:"
if [ -f ~/reacthome-daemon/src/websocket/broadcast-with-context.js ]; then
  echo "  ✅ Найден"
  ls -lh ~/reacthome-daemon/src/websocket/broadcast-with-context.js
else
  echo "  ❌ НЕ НАЙДЕН"
fi

echo ""
echo "📁 src/actions/create.js (изменения):"
if grep -q "broadcast-with-context" ~/reacthome-daemon/src/actions/create.js; then
  echo "  ✅ Изменён (использует wrapper)"
else
  echo "  ❌ НЕ ИЗМЕНЁН (использует старый broadcast)"
fi

echo ""
echo "📁 src/controllers/service.js (изменения):"
if grep -q "broadcast-with-context" ~/reacthome-daemon/src/controllers/service.js; then
  echo "  ✅ Изменён (использует wrapper)"
else
  echo "  ❌ НЕ ИЗМЕНЁН (использует старый broadcast)"
fi

echo ""
echo "📁 src/controllers/service.js (uuid):"
if grep -q 'require("uuid")' ~/reacthome-daemon/src/controllers/service.js; then
  echo "  ✅ uuid импортирован"
else
  echo "  ❌ uuid НЕ импортирован"
fi
EOF

echo ""
echo "2️⃣ Проверка статуса daemon:"
echo "───────────────────────────"
ssh ${PI_USER}@${PI_HOST} "pm2 status daemon"

echo ""
echo "3️⃣ Проверка логов daemon (последние 20 строк):"
echo "───────────────────────────────────────────────"
ssh ${PI_USER}@${PI_HOST} "pm2 logs daemon --lines 20 --nostream"

echo ""
echo "4️⃣ Проверка ошибок:"
echo "───────────────────"
ssh ${PI_USER}@${PI_HOST} "pm2 logs daemon --err --lines 10 --nostream"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ ПРОВЕРКА ЗАВЕРШЕНА"
echo "═══════════════════════════════════════════════════════"

