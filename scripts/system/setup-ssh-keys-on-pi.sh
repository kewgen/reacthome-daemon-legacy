#!/bin/bash

#
# Настройка SSH ключей на Raspberry Pi
#
# Использование:
#   ./scripts/system/setup-ssh-keys-on-pi.sh
#
# Зачем: Настраивает SSH ключи для работы с SourceCraft и GitHub на малинке
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"
PROJECT_DIR="/home/pi/reacthome-daemon"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "🔑 Настройка SSH ключей на Raspberry Pi ($HOST)"
echo ""

# Создаём временный expect скрипт
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 30
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

# Функция для выполнения команд на малинке
run_on_pi() {
    "$TMP_EXPECT" "$HOST" "$USER" "$PASS" "$1" 2>/dev/null | grep -v "password:" | grep -v "spawn" | grep -v "Warning: Permanently added"
}

echo "=========================================="
echo "1. Проверка существующих SSH ключей"
echo "=========================================="
echo ""
EXISTING_KEYS=$(run_on_pi "ls -la ~/.ssh/*.pub 2>/dev/null | wc -l")
echo "Найдено публичных ключей: $EXISTING_KEYS"
run_on_pi "ls -la ~/.ssh/*.pub 2>/dev/null | head -5"
echo ""

echo "=========================================="
echo "2. Создание директории .ssh (если нужно)"
echo "=========================================="
echo ""
run_on_pi "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
echo "✅ Директория .ssh готова"
echo ""

echo "=========================================="
echo "3. Настройка SSH config"
echo "=========================================="
echo ""

# Создаём SSH config для малинки
SSH_CONFIG=$(cat << 'SSH_CONFIG_EOF'
# SourceCraft SSH
Host ssh.sourcecraft.dev
    HostName ssh.sourcecraft.dev
    User git
    IdentityFile ~/.ssh/id_ed25519_sourcecraft
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new

# GitHub SSH
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_rsa_github
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
SSH_CONFIG_EOF
)

# Сохраняем config во временный файл
TMP_CONFIG=$(mktemp)
echo "$SSH_CONFIG" > "$TMP_CONFIG"

# Копируем config на малинку
echo "Копирование SSH config на малинку..."
scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$TMP_CONFIG" "$USER@$HOST:~/.ssh/config" <<< "$PASS" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ SSH config скопирован"
    run_on_pi "chmod 600 ~/.ssh/config"
else
    echo "⚠️  Не удалось скопировать через scp, попробуем через expect..."
    # Альтернативный способ через expect
    expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$TMP_CONFIG" $USER@$HOST:~/.ssh/config
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF
    run_on_pi "chmod 600 ~/.ssh/config"
fi

rm -f "$TMP_CONFIG"
echo ""

echo "=========================================="
echo "4. Инструкции по добавлению ключей"
echo "=========================================="
echo ""
echo "Для SourceCraft нужно:"
echo "1. Создать ключ на малинке:"
echo "   ssh pi@$HOST"
echo "   ssh-keygen -t ed25519 -C 'sourcecraft-pi' -f ~/.ssh/id_ed25519_sourcecraft -N ''"
echo ""
echo "2. Добавить публичный ключ в SourceCraft:"
echo "   cat ~/.ssh/id_ed25519_sourcecraft.pub"
echo "   # Скопировать и добавить на https://sourcecraft.dev/settings/ssh-keys"
echo ""
echo "3. Для GitHub:"
echo "   ssh-keygen -t rsa -b 4096 -C 'github-pi' -f ~/.ssh/id_rsa_github -N ''"
echo "   cat ~/.ssh/id_rsa_github.pub"
echo "   # Скопировать и добавить на https://github.com/settings/ssh/new"
echo ""

echo "=========================================="
echo "5. Проверка SSH config"
echo "=========================================="
echo ""
run_on_pi "cat ~/.ssh/config 2>/dev/null || echo 'Config не найден'"
echo ""

# Очистка
rm -f "$TMP_EXPECT"

echo "✅ Настройка SSH ключей завершена"
echo ""
echo "📝 Следующие шаги:"
echo "   1. Создайте SSH ключи на малинке (см. инструкции выше)"
echo "   2. Добавьте публичные ключи в SourceCraft и GitHub"
echo "   3. Используйте скрипт switch-remote-on-pi.sh для переключения remote"













