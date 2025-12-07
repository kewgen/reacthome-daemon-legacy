#!/bin/bash
# Скрипт для проверки WebSocket на Raspberry Pi

PI_USER="${PI_USER:-pi}"
PI_HOST="${PI_HOST:-192.168.1.100}"
PROJECT_DIR="${PROJECT_DIR:-/home/pi/reacthome-daemon}"

run_on_pi() {
    ssh "${PI_USER}@${PI_HOST}" "$1" 2>&1
}

echo "=========================================="
echo "Проверка WebSocket на Raspberry Pi"
echo "=========================================="
echo ""

echo "1. Статус демона"
echo "----------------------------------------"
run_on_pi "cd $PROJECT_DIR && pm2 status daemon"
echo ""

echo "2. Логи WebSocket (последние 100 строк)"
echo "----------------------------------------"
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 100 --nostream 2>&1 | grep -iE '(websocket|ws|3000|connection|error|start|gate)' | tail -30"
echo ""

echo "3. Проверка порта 3000"
echo "----------------------------------------"
run_on_pi "netstat -tuln 2>/dev/null | grep 3000 || ss -tuln 2>/dev/null | grep 3000 || echo 'Порт 3000 не найден'"
echo ""

echo "4. Процессы на порту 3000"
echo "----------------------------------------"
run_on_pi "lsof -i :3000 2>/dev/null || fuser 3000/tcp 2>/dev/null || echo 'Не удалось определить процесс'"
echo ""

echo "5. Ошибки в логах (последние 50 строк)"
echo "----------------------------------------"
run_on_pi "cd $PROJECT_DIR && pm2 logs daemon --lines 50 --nostream 2>&1 | grep -iE '(error|fatal|exception|failed)' | tail -20"
echo ""

echo "6. Проверка модуля ws"
echo "----------------------------------------"
run_on_pi "cd $PROJECT_DIR && npm list ws 2>&1 | head -5"
echo ""

echo "7. Попытка подключения к WebSocket (тест)"
echo "----------------------------------------"
run_on_pi "timeout 2 bash -c 'echo > /dev/tcp/localhost/3000' 2>&1 && echo 'Порт 3000 доступен' || echo 'Порт 3000 недоступен'"
echo ""

echo "=========================================="
echo "Проверка завершена"
echo "=========================================="
