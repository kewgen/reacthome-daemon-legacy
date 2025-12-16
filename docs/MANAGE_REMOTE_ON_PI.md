# Управление Git Remote и SSH ключами на Raspberry Pi

**Дата создания:** 2025-01-28  
**Версия:** 1.0

## 📋 Содержание

1. [Обзор](#обзор)
2. [Быстрый старт](#быстрый-старт)
3. [Настройка SSH ключей](#настройка-ssh-ключей)
4. [Переключение Remote](#переключение-remote)
5. [Управление Remote](#управление-remote)
6. [Примеры использования](#примеры-использования)
7. [Устранение проблем](#устранение-проблем)

---

## Обзор

Набор скриптов для управления git remote репозиториями и SSH ключами на Raspberry Pi. Позволяет легко переключаться между SourceCraft и GitHub как основными remote.

### Доступные скрипты:

1. **`setup-ssh-keys-on-pi.sh`** - Настройка SSH config на малинке
2. **`copy-ssh-keys-to-pi.sh`** - Копирование SSH ключей с локальной машины
3. **`switch-remote-on-pi.sh`** - Переключение origin между SourceCraft и GitHub
4. **`manage-remote-on-pi.sh`** - Универсальная утилита для управления remote

---

## Быстрый старт

### Шаг 1: Настройка переменных окружения

```bash
export REACTHOME_PI_HOST="192.168.88.4"
export REACTHOME_PI_USER="pi"
export REACTHOME_PI_PASS="ваш_пароль"
```

Или добавьте в `.env` файл:
```bash
REACTHOME_PI_HOST=192.168.88.4
REACTHOME_PI_USER=pi
REACTHOME_PI_PASS=ваш_пароль
```

### Шаг 2: Копирование SSH ключей (опционально)

Если у вас уже есть SSH ключи на локальной машине:

```bash
./scripts/system/copy-ssh-keys-to-pi.sh
```

### Шаг 3: Настройка SSH config на малинке

```bash
./scripts/system/setup-ssh-keys-on-pi.sh
```

### Шаг 4: Переключение remote

```bash
# Переключить на SourceCraft
./scripts/system/switch-remote-on-pi.sh sourcecraft

# Переключить на GitHub
./scripts/system/switch-remote-on-pi.sh github
```

---

## Настройка SSH ключей

### Вариант 1: Копирование с локальной машины

Если у вас уже есть SSH ключи на локальной машине:

```bash
./scripts/system/copy-ssh-keys-to-pi.sh
```

Скрипт:
- Копирует ключ SourceCraft (`~/.ssh/id_ed25519_sourcecraft`)
- Копирует ключ GitHub (`~/.ssh/id_rsa_git` → `id_rsa_github` на малинке)
- Устанавливает правильные права доступа

### Вариант 2: Создание ключей на малинке

Если нужно создать новые ключи:

```bash
# Подключиться к малинке
ssh pi@192.168.88.4

# Создать ключ для SourceCraft
ssh-keygen -t ed25519 -C "sourcecraft-pi" -f ~/.ssh/id_ed25519_sourcecraft -N ""

# Создать ключ для GitHub
ssh-keygen -t rsa -b 4096 -C "github-pi" -f ~/.ssh/id_rsa_github -N ""

# Показать публичные ключи
cat ~/.ssh/id_ed25519_sourcecraft.pub
cat ~/.ssh/id_rsa_github.pub
```

Затем добавьте публичные ключи:
- SourceCraft: https://sourcecraft.dev/settings/ssh-keys
- GitHub: https://github.com/settings/ssh/new

### Настройка SSH config

```bash
./scripts/system/setup-ssh-keys-on-pi.sh
```

Скрипт создаст `~/.ssh/config` на малинке с настройками для SourceCraft и GitHub.

---

## Переключение Remote

### Использование скрипта switch-remote-on-pi.sh

```bash
# Переключить origin на SourceCraft
./scripts/system/switch-remote-on-pi.sh sourcecraft

# Переключить origin на GitHub
./scripts/system/switch-remote-on-pi.sh github
```

### Что делает скрипт:

1. Проверяет существующие remote
2. Добавляет недостающие remote (sourcecraft, github)
3. Переключает `origin` на выбранный remote
4. Обновляет отслеживание веток

### После переключения:

```bash
# Push в новый origin
git push origin <branch>

# Pull из нового origin
git pull origin <branch>

# Fetch из другого remote
git fetch sourcecraft  # или github
```

---

## Управление Remote

### Универсальная утилита manage-remote-on-pi.sh

#### Показать статус:

```bash
./scripts/system/manage-remote-on-pi.sh status
```

Показывает:
- Все remote репозитории
- Текущую ветку
- Отслеживание веток
- Последний коммит
- Статус рабочей директории

#### Переключить origin:

```bash
./scripts/system/manage-remote-on-pi.sh switch sourcecraft
./scripts/system/manage-remote-on-pi.sh switch github
```

#### Добавить remote:

```bash
./scripts/system/manage-remote-on-pi.sh add sourcecraft ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git
./scripts/system/manage-remote-on-pi.sh add github git@github.com:gev/reacthome-daemon-legacy.git
```

#### Удалить remote:

```bash
./scripts/system/manage-remote-on-pi.sh remove sourcecraft
```

#### Протестировать подключение:

```bash
./scripts/system/manage-remote-on-pi.sh test origin
./scripts/system/manage-remote-on-pi.sh test sourcecraft
./scripts/system/manage-remote-on-pi.sh test github
```

---

## Примеры использования

### Пример 1: Первоначальная настройка

```bash
# 1. Настроить переменные окружения
export REACTHOME_PI_PASS="raspberry"

# 2. Скопировать SSH ключи
./scripts/system/copy-ssh-keys-to-pi.sh

# 3. Настроить SSH config
./scripts/system/setup-ssh-keys-on-pi.sh

# 4. Переключить на SourceCraft
./scripts/system/switch-remote-on-pi.sh sourcecraft

# 5. Проверить статус
./scripts/system/manage-remote-on-pi.sh status
```

### Пример 2: Переключение между remote

```bash
# Работа с SourceCraft
./scripts/system/switch-remote-on-pi.sh sourcecraft
git push origin main

# Переключение на GitHub
./scripts/system/switch-remote-on-pi.sh github
git push origin main
```

### Пример 3: Работа с несколькими remote

```bash
# Добавить оба remote
./scripts/system/manage-remote-on-pi.sh add sourcecraft ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git
./scripts/system/manage-remote-on-pi.sh add github git@github.com:gev/reacthome-daemon-legacy.git

# Установить origin на SourceCraft
./scripts/system/manage-remote-on-pi.sh switch sourcecraft

# Fetch из обоих remote
git fetch sourcecraft
git fetch github

# Push в оба remote
git push sourcecraft main
git push github main
```

### Пример 4: Проверка подключения

```bash
# Проверить подключение к origin
./scripts/system/manage-remote-on-pi.sh test origin

# Проверить подключение к SourceCraft
./scripts/system/manage-remote-on-pi.sh test sourcecraft

# Проверить подключение к GitHub
./scripts/system/manage-remote-on-pi.sh test github
```

---

## Устранение проблем

### Проблема: "Permission denied (publickey)"

**Причина:** SSH ключ не добавлен в SourceCraft/GitHub или неправильно настроен.

**Решение:**
1. Проверить наличие ключа на малинке:
   ```bash
   ssh pi@192.168.88.4 "cat ~/.ssh/id_ed25519_sourcecraft.pub"
   ```

2. Добавить публичный ключ в SourceCraft/GitHub

3. Проверить SSH config:
   ```bash
   ssh pi@192.168.88.4 "cat ~/.ssh/config"
   ```

4. Протестировать подключение:
   ```bash
   ssh pi@192.168.88.4 "ssh -T git@ssh.sourcecraft.dev"
   ```

### Проблема: "Host key verification failed"

**Причина:** Host key не добавлен в known_hosts.

**Решение:**
```bash
ssh pi@192.168.88.4 "ssh-keyscan -t ed25519 ssh.sourcecraft.dev >> ~/.ssh/known_hosts"
```

### Проблема: Remote не переключается

**Причина:** Remote уже существует с другим URL.

**Решение:**
```bash
# Удалить старый remote
./scripts/system/manage-remote-on-pi.sh remove origin

# Добавить новый
./scripts/system/manage-remote-on-pi.sh add origin <новый_url>

# Или использовать switch
./scripts/system/switch-remote-on-pi.sh sourcecraft
```

### Проблема: "unsupported ssh command"

**Примечание:** Это нормально! Сообщение `unsupported ssh command: :` означает успешное подключение к git серверу.

### Проблема: Ключи не копируются

**Причина:** Отсутствует `expect` или неправильный пароль.

**Решение:**
1. Установить expect:
   ```bash
   # На macOS
   brew install expect
   
   # На Linux
   sudo apt-get install expect
   ```

2. Проверить пароль:
   ```bash
   export REACTHOME_PI_PASS="правильный_пароль"
   ```

---

## Структура SSH config на малинке

После настройки `~/.ssh/config` на малинке будет содержать:

```ssh-config
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
```

---

## Рекомендации

1. **Используйте разные ключи для разных сервисов** - это безопаснее
2. **Храните пароли в .env файле** - не коммитьте их в git
3. **Регулярно проверяйте статус** - используйте `manage-remote-on-pi.sh status`
4. **Тестируйте подключение** - перед push/pull проверяйте `test` командой

---

## См. также

- [docs/setup_sourcecraft.md](./setup_sourcecraft.md) - Настройка SourceCraft
- [scripts/system/check-git-remote-on-pi.sh](../scripts/system/check-git-remote-on-pi.sh) - Проверка remote
- [reports/git-remote-check-report.md](../reports/git-remote-check-report.md) - Отчёт о проверке remote

---

**Зачем:** Организация переключения remote и SSH ключей упрощает работу с несколькими git репозиториями и обеспечивает гибкость в выборе основного remote для работы.













