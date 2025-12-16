#!/bin/bash

#
# Копирование SSH ключей на Raspberry Pi
#
# Использование:
#   ./scripts/system/copy-ssh-keys-to-pi.sh
#
# Зачем: Копирует SSH ключи с локальной машины на малинку для работы с SourceCraft и GitHub
#

HOST="${REACTHOME_PI_HOST:-192.168.88.4}"
USER="${REACTHOME_PI_USER:-pi}"
PASS="${REACTHOME_PI_PASS}"

if [ -z "$PASS" ]; then
    echo "❌ Ошибка: переменная REACTHOME_PI_PASS не установлена"
    echo "   Установите: export REACTHOME_PI_PASS='ваш_пароль'"
    exit 1
fi

echo "📋 Копирование SSH ключей на Raspberry Pi ($HOST)"
echo ""

# Проверяем наличие ключей локально
LOCAL_SOURCECRAFT_KEY="$HOME/.ssh/id_ed25519_sourcecraft"
LOCAL_GITHUB_KEY="$HOME/.ssh/id_rsa_git"

if [ ! -f "$LOCAL_SOURCECRAFT_KEY" ]; then
    echo "⚠️  Локальный ключ SourceCraft не найден: $LOCAL_SOURCECRAFT_KEY"
    echo "   Пропускаем копирование ключа SourceCraft"
    SOURCECRAFT_KEY_EXISTS=false
else
    SOURCECRAFT_KEY_EXISTS=true
    echo "✅ Найден ключ SourceCraft: $LOCAL_SOURCECRAFT_KEY"
fi

if [ ! -f "$LOCAL_GITHUB_KEY" ]; then
    echo "⚠️  Локальный ключ GitHub не найден: $LOCAL_GITHUB_KEY"
    echo "   Пропускаем копирование ключа GitHub"
    GITHUB_KEY_EXISTS=false
else
    GITHUB_KEY_EXISTS=true
    echo "✅ Найден ключ GitHub: $LOCAL_GITHUB_KEY"
fi

if [ "$SOURCECRAFT_KEY_EXISTS" = false ] && [ "$GITHUB_KEY_EXISTS" = false ]; then
    echo "❌ Не найдено ни одного SSH ключа для копирования"
    exit 1
fi

echo ""

# Функция для копирования ключа
copy_key() {
    local LOCAL_KEY="$1"
    local REMOTE_KEY_NAME="$2"
    local KEY_TYPE="$3"
    
    echo "=========================================="
    echo "Копирование $KEY_TYPE ключа"
    echo "=========================================="
    echo ""
    
    # Копируем приватный ключ
    echo "Копирование приватного ключа..."
    expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$LOCAL_KEY" $USER@$HOST:~/.ssh/$REMOTE_KEY_NAME
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF
    
    if [ $? -eq 0 ]; then
        echo "✅ Приватный ключ скопирован"
    else
        echo "❌ Ошибка при копировании приватного ключа"
        return 1
    fi
    
    # Копируем публичный ключ
    echo "Копирование публичного ключа..."
    expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${LOCAL_KEY}.pub" $USER@$HOST:~/.ssh/${REMOTE_KEY_NAME}.pub
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF
    
    if [ $? -eq 0 ]; then
        echo "✅ Публичный ключ скопирован"
    else
        echo "❌ Ошибка при копировании публичного ключа"
        return 1
    fi
    
    # Устанавливаем правильные права
    echo "Установка прав доступа..."
    expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "chmod 600 ~/.ssh/$REMOTE_KEY_NAME && chmod 644 ~/.ssh/${REMOTE_KEY_NAME}.pub"
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF
    
    echo "✅ Права доступа установлены"
    echo ""
}

# Копируем ключи
if [ "$SOURCECRAFT_KEY_EXISTS" = true ]; then
    copy_key "$LOCAL_SOURCECRAFT_KEY" "id_ed25519_sourcecraft" "SourceCraft"
fi

if [ "$GITHUB_KEY_EXISTS" = true ]; then
    # Для GitHub используем имя id_rsa_github на малинке
    copy_key "$LOCAL_GITHUB_KEY" "id_rsa_github" "GitHub"
fi

echo "=========================================="
echo "Проверка скопированных ключей"
echo "=========================================="
echo ""

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "ls -la ~/.ssh/*.pub 2>/dev/null | grep -E '(sourcecraft|github)'"
expect {
    "*assword:" {
        send "$PASS\r"
        exp_continue
    }
    eof
}
expect eof
EOF

echo ""
echo "✅ Копирование SSH ключей завершено"
echo ""
echo "📝 Следующие шаги:"
echo "   1. Добавьте публичные ключи в SourceCraft и GitHub (если ещё не добавлены)"
echo "   2. Используйте скрипт setup-ssh-keys-on-pi.sh для настройки SSH config"
echo "   3. Используйте скрипт switch-remote-on-pi.sh для переключения remote"













