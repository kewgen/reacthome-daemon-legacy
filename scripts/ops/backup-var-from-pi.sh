#!/bin/bash

# Скрипт для бэкапа папки var с Raspberry Pi
# Зачем: создание резервной копии папки var с малинки для восстановления в случае необходимости

# Параметры подключения к малинке (можно переопределить через переменные окружения)
PI_HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
PI_USER="${REACTHOME_PI_USER:-pi}"
PI_PASS="${REACTHOME_PI_PASS:-raspberry}"
REMOTE_PROJECT_DIR="${REACTHOME_PI_PROJECT_DIR:-/home/pi/reacthome-daemon}"
PI_VAR_PATH="${PI_VAR_PATH:-${REMOTE_PROJECT_DIR}/var}"

# Локальная директория для бэкапов
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="var-backup-${TIMESTAMP}.tar.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Создаём директорию для бэкапов, если её нет
mkdir -p "${BACKUP_DIR}"

echo "Начинаю бэкап папки var с малинки..."
echo "Хост: ${PI_USER}@${PI_HOST}"
echo "Путь на малинке: ${PI_VAR_PATH}"
echo "Локальный путь: ${BACKUP_PATH}"

# Создаём временный expect скрипт для SSH подключения
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 60
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd [lindex $argv 3]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host "$cmd"
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF
chmod +x "$TMP_EXPECT"

# Функция для выполнения команд на малинке через expect
run_on_pi() {
    "$TMP_EXPECT" "$PI_HOST" "$PI_USER" "$PI_PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

# Проверяем существование папки на малинке
echo "Проверяю существование папки на малинке..."
CHECK_RESULT=$(run_on_pi "[ -d '${PI_VAR_PATH}' ] && echo 'EXISTS' || echo 'NOT_EXISTS'")
if echo "$CHECK_RESULT" | grep -q "NOT_EXISTS\|^$"; then
    echo "Ошибка: Папка ${PI_VAR_PATH} не существует на малинке!"
    echo "Проверьте путь или установите переменную PI_VAR_PATH"
    rm -f "$TMP_EXPECT"
    exit 1
fi

# Создаём архив на малинке и копируем его локально
echo "Создаю архив на малинке..."
VAR_DIR=$(dirname "${PI_VAR_PATH}")
VAR_NAME=$(basename "${PI_VAR_PATH}")

# Создаём временный файл на малинке для архива
TMP_ARCHIVE="/tmp/var-backup-${TIMESTAMP}.tar.gz"
run_on_pi "cd ${VAR_DIR} && tar -czf ${TMP_ARCHIVE} ${VAR_NAME}" > /dev/null 2>&1

# Копируем архив с малинки через expect и scp
echo "Копирую архив с малинки..."
TMP_SCP_EXPECT=$(mktemp)
cat > "$TMP_SCP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 120
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set remote [lindex $argv 3]
set local [lindex $argv 4]

spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host:$remote $local
expect {
  "*assword:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
EXPECT_EOF
chmod +x "$TMP_SCP_EXPECT"

"$TMP_SCP_EXPECT" "$PI_HOST" "$PI_USER" "$PI_PASS" "$TMP_ARCHIVE" "$BACKUP_PATH" > /dev/null 2>&1

# Удаляем временный архив с малинки
run_on_pi "rm -f ${TMP_ARCHIVE}" > /dev/null 2>&1

# Удаляем временные expect скрипты
rm -f "$TMP_EXPECT" "$TMP_SCP_EXPECT"

# Проверяем успешность операции
if [ $? -eq 0 ] && [ -f "${BACKUP_PATH}" ] && [ -s "${BACKUP_PATH}" ]; then
    BACKUP_SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
    echo "✓ Бэкап успешно создан!"
    echo "  Размер: ${BACKUP_SIZE}"
    echo "  Путь: ${BACKUP_PATH}"
    
    # Создаём симлинк на последний бэкап для удобства
    LATEST_LINK="${BACKUP_DIR}/var-backup-latest.tar.gz"
    ln -sf "${BACKUP_NAME}" "${LATEST_LINK}"
    echo "  Создан симлинк: ${LATEST_LINK}"
else
    echo "✗ Ошибка при создании бэкапа!"
    [ -f "${BACKUP_PATH}" ] && rm -f "${BACKUP_PATH}"
    exit 1
fi

