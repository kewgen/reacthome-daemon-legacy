#!/bin/bash
# Зачем: Скрипт для копирования monitor.js на Raspberry Pi
# Использование:
#   ./scripts/system/upload-monitor-to-pi.sh
#   PI_HOST="pi@192.168.1.100" PI_PATH="/home/pi/myproject/src" ./scripts/system/upload-monitor-to-pi.sh

# Зачем: Используем переменные окружения для универсальности на разных малинках
PI_HOST="${PI_HOST:-pi@192.168.88.4}"  # Можно переопределить: PI_HOST="pi@192.168.1.100"
PI_PATH="${PI_PATH:-/home/pi/reacthome-daemon/src}"  # Можно переопределить: PI_PATH="/home/pi/myproject/src"
LOCAL_FILE="monitoring/scripts/monitor.js"
REMOTE_FILE="${PI_PATH}/monitor.js"

echo "Копирование monitor.js на Raspberry Pi..."
echo "Хост: ${PI_HOST}"
echo "Локальный файл: ${LOCAL_FILE}"
echo "Путь на Pi: ${REMOTE_FILE}"
echo ""
echo "Для использования на другой малинке задайте переменные:"
echo "  PI_HOST=\"pi@<IP_АДРЕС>\" PI_PATH=\"/path/to/project/src\" $0"

# Зачем: Создаём директорию на малинке, если её нет
ssh ${PI_HOST} "mkdir -p ${PI_PATH}"

# Зачем: Копируем файл
scp ${LOCAL_FILE} ${PI_HOST}:${REMOTE_FILE}

# Зачем: Проверяем, что файл скопирован
if [ $? -eq 0 ]; then
  echo "✅ Файл успешно скопирован"
  ssh ${PI_HOST} "ls -lh ${REMOTE_FILE}"
  echo ""
  echo "Для запуска на малинке выполните:"
  echo "  ssh ${PI_HOST}"
  echo "  cd $(dirname ${PI_PATH})"
  echo "  node src/monitor.js"
else
  echo "❌ Ошибка при копировании файла"
  exit 1
fi

