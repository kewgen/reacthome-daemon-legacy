#!/bin/bash
# Тестирование event-logger локально
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================="
echo "🧪 Тестирование event-logger локально"
echo "=========================================="
echo ""

# 1. Получаем файл с Pi через существующий скрипт
echo "📥 Шаг 1: Получение event-logger.js с Raspberry Pi..."
echo "   Используем существующий скрипт для получения содержимого..."
echo ""

# 2. Создаём тестовый WebSocket сервер
echo "🚀 Шаг 2: Запуск тестового WebSocket сервера..."
cat > "$PROJECT_ROOT/test-ws-server.js" << 'SERVER'
const WebSocket = require('ws');
const port = 3000;

console.log(`🔌 Запуск тестового WebSocket сервера на порту ${port}...`);
const server = new WebSocket.Server({ port });

server.on('listening', () => {
  console.log(`✅ WebSocket сервер запущен на ws://localhost:${port}`);
  console.log(`   Готов к подключению event-logger`);
});

server.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress || 'unknown';
  console.log(`📥 Новое подключение от ${clientIP}`);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`📨 Получено сообщение: ${data.type || 'unknown'}`);
      
      // Отправляем тестовый ответ
      if (data.type === 'list') {
        ws.send(JSON.stringify({ type: 'list', state: [], assets: [] }));
      }
    } catch (e) {
      console.log(`📨 Получено сообщение (не JSON): ${message.toString().substring(0, 50)}`);
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 Соединение закрыто`);
  });
  
  ws.on('error', (error) => {
    console.error(`❌ Ошибка WebSocket: ${error.message}`);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 Остановка сервера...');
  server.close();
  process.exit(0);
});
SERVER

echo "✅ Тестовый сервер создан: test-ws-server.js"
echo ""

# 3. Инструкции
echo "📋 ИНСТРУКЦИИ ДЛЯ ТЕСТИРОВАНИЯ:"
echo "─".repeat(80)
echo ""
echo "1️⃣  Получите event-logger.js с Pi:"
echo "   ./scripts/system/get-event-logger-for-local-fix.sh"
echo ""
echo "2️⃣  Исправьте синтаксис:"
echo "   node fix-syntax.js event-logger-from-pi.js"
echo ""
echo "3️⃣  Запустите тестовый WebSocket сервер (в отдельном терминале):"
echo "   node test-ws-server.js"
echo ""
echo "4️⃣  Запустите event-logger (в другом терминале):"
echo "   DAEMON_WS_URL=ws://localhost:3000 node event-logger-from-pi.js"
echo ""
echo "5️⃣  Проверьте подключение и работу"
echo ""
echo "─".repeat(80)

