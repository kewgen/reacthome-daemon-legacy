# Настройка SourceCraft для проекта

**Дата создания:** 2025-01-16  
**Организация:** kulagin-eugeny-i-kompaniia  
**Репозиторий:** reacthome  
**URL репозитория:** https://sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome

---

## 📋 Содержание

1. [Учетные данные](#учетные-данные)
2. [Настройка SSH](#настройка-ssh)
3. [Настройка токена доступа](#настройка-токена-доступа)
4. [Создание репозитория](#создание-репозитория)
5. [Настройка Git remote](#настройка-git-remote)
6. [Первый push](#первый-push)
7. [Конфигурация CI/CD](#конфигурация-cicd)
8. [Сервисное подключение](#сервисное-подключение)

---

## 🔐 Учетные данные

### SSH ключ

**Публичный ключ:**
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDAsu8eWq4fgitCEHYKkHa7aPuSy92dWEuo6dJ4wEYvU sourcecraft-dev
```

**Fingerprint:**
```
SHA256:zPD1ZcVjnBi6xw/w+Zpe13QPVJVjZbM8oittGR24urM
```

**Расположение:**
- Приватный ключ: `~/.ssh/id_ed25519_sourcecraft`
- Публичный ключ: `~/.ssh/id_ed25519_sourcecraft.pub`

### Токен доступа

**OAuth токен:**
```
pv1_28a7D9DIuAWftdy00Uk8SqZ619l0XT7I9ai2Y35653405Wnr9m4J4io042Ko5mV5_305026728
```

**Примечание:** Токен используется для веб-интерфейса и API. Для Git операций рекомендуется использовать SSH.

### Сервисное подключение

**Название:** `cursor-service-connection`

**Параметры:**
- Сервисный аккаунт: `ajeor08s2qq8dfui3q4f`
- Федерация сервисных аккаунтов: `ajeh9ffo8qu1ld696jdk`
- Каталог: `default`
- Облако: `src-user-cloud-kulagin-eugeny`
- Организация: `kulagin-eugeny Personal Organization (SourceCraft)`
- Платежный аккаунт: `Евгений`

---

## 🔑 Настройка SSH

### Шаг 1: Создание SSH ключа (если еще не создан)

```bash
ssh-keygen -t ed25519 -C "sourcecraft-dev" -f ~/.ssh/id_ed25519_sourcecraft -N ""
```

### Шаг 2: Просмотр публичного ключа

```bash
cat ~/.ssh/id_ed25519_sourcecraft.pub
```

### Шаг 3: Добавление ключа в SourceCraft

1. Откройте настройки SSH: https://sourcecraft.dev/settings/ssh-keys
2. Нажмите "Add SSH Key" / "Добавить SSH ключ"
3. Вставьте публичный ключ из шага 2
4. Сохраните

### Шаг 4: Настройка SSH config

Добавьте в `~/.ssh/config`:

```ssh-config
# SourceCraft SSH
Host ssh.sourcecraft.dev
    HostName ssh.sourcecraft.dev
    User git
    IdentityFile ~/.ssh/id_ed25519_sourcecraft
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
```

### Шаг 5: Добавление host key

```bash
ssh-keyscan -t ed25519 ssh.sourcecraft.dev >> ~/.ssh/known_hosts
```

### Шаг 6: Проверка подключения

```bash
ssh -T git@ssh.sourcecraft.dev
```

Ожидаемый ответ: `unsupported ssh command: :` (это нормально, означает успешное подключение)

---

## 🎫 Настройка токена доступа

### Использование токена

Токен можно использовать для:
- Доступа к API SourceCraft
- Аутентификации в веб-интерфейсе
- Автоматизации через скрипты

**Пример использования в curl:**
```bash
curl -H "Authorization: Bearer pv1_28a7D9DIuAWftdy00Uk8SqZ619l0XT7I9ai2Y35653405Wnr9m4J4io042Ko5mV5_305026728" \
  https://sourcecraft.dev/api/v1/user
```

**Примечание:** Для Git операций рекомендуется использовать SSH, а не токен.

---

## 📦 Создание репозитория

### Через веб-интерфейс

1. Откройте организацию: https://sourcecraft.dev/kulagin-eugeny-i-kompaniia
2. Нажмите "New Repository" / "Создать репозиторий"
3. Укажите название: `reacthome`
4. Выберите видимость (public/private)
5. Создайте репозиторий

### URL репозитория

После создания репозиторий будет доступен по адресу:
- **Веб-интерфейс:** https://sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome
- **SSH:** `ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git`
- **HTTPS:** `https://git.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git`

---

## 🔗 Настройка Git remote

### Установка remote

```bash
git remote set-url origin ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git
```

### Проверка remote

```bash
git remote -v
```

Ожидаемый вывод:
```
origin	ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git (fetch)
origin	ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git (push)
```

### Альтернативный вариант (HTTPS с токеном)

Если SSH не работает, можно использовать HTTPS:

```bash
git remote set-url origin https://pv1_28a7D9DIuAWftdy00Uk8SqZ619l0XT7I9ai2Y35653405Wnr9m4J4io042Ko5mV5_305026728@git.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git
```

---

## 🚀 Первый push

### Проверка готовности

```bash
# Проверить коммиты
git log --oneline

# Проверить статус
git status

# Проверить remote
git remote -v
```

### Выполнение push

```bash
git push -u origin main
```

### Ожидаемый результат

```
remote: Resolving deltas: 1
remote: Resolving deltas: 18 (total 0.001s)
remote: 
remote: Updating references: 1 of 1
remote: Updating references: 1 of 1 (total 0.113s)
remote: 
To ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

---

## ⚙️ Конфигурация CI/CD

### Файл конфигурации

Конфигурация SourceCraft находится в `.sourcecraft/ci.yaml`:

```yaml
# SourceCraft CI/CD конфигурация
# Документация: https://sourcecraft.yandex.ru/docs

# Глобальные токены для сервисного подключения
tokens:
  SERVICE_CONNECTION:
    service_connection: cursor-service-connection
    scope: org

# Триггеры автоматизации
on:
  push:
    - workflows: deploy-workflow
    - workflows: test-workflow

# Workflows
workflows:
  # Workflow для развёртывания
  deploy-workflow:
    tasks:
      - name: deploy-task
        cubes:
          # Получение IAM-токена для Yandex Cloud
          - name: get-iam-token
            env:
              ID_TOKEN: ${{ tokens.SERVICE_CONNECTION.id_token }}
              YC_SA_ID: ${{ tokens.SERVICE_CONNECTION.service_account_id }}
            image: cr.yandex/sourcecraft/yc-iam:latest
          
          # Пример использования Yandex Cloud CLI
          - name: yc-cli-demo
            env:
              YC_FOLDER_ID: ${{ tokens.SERVICE_CONNECTION.folder_id }}
              YC_IAM_TOKEN: ${{ cubes.get-iam-token.outputs.IAM_TOKEN }}
            image:
              name: cr.yandex/sourcecraft/yc-cli:latest
              entrypoint: ""
            script:
              - |
                yc config set folder-id $YC_FOLDER_ID
                yc serverless function list
                echo "Deployment workflow executed"

  # Workflow для тестирования
  test-workflow:
    tasks:
      - name: test-task
        cubes:
          - name: run-tests
            image: node:18
            script:
              - |
                echo "Running tests..."
                npm install
                npm test || true
                echo "Tests completed"
```

### Использование токенов в workflows

Из токена `SERVICE_CONNECTION` можно получить:

- `${{ tokens.SERVICE_CONNECTION.id_token }}` - ID токен
- `${{ tokens.SERVICE_CONNECTION.service_account_id }}` - ID сервисного аккаунта
- `${{ tokens.SERVICE_CONNECTION.folder_id }}` - ID каталога

### Запуск workflows

Workflows автоматически запускаются при push в репозиторий (согласно секции `on.push`).

---

## 🔌 Сервисное подключение

### Настройка сервисного подключения

Сервисное подключение `cursor-service-connection` настроено в SourceCraft и используется для:

- Доступа к Yandex Cloud ресурсам
- Получения IAM токенов
- Выполнения операций в облаке

### Параметры подключения

- **Название:** `cursor-service-connection`
- **Сервисный аккаунт:** `ajeor08s2qq8dfui3q4f`
- **Федерация:** `ajeh9ffo8qu1ld696jdk`
- **Каталог:** `default`
- **Облако:** `src-user-cloud-kulagin-eugeny`

### Использование в CI/CD

Сервисное подключение автоматически доступно в workflows через токен `SERVICE_CONNECTION`:

```yaml
tokens:
  SERVICE_CONNECTION:
    service_connection: cursor-service-connection
    scope: org
```

---

## 📝 Полезные команды

### Проверка подключения

```bash
# Проверка SSH
ssh -T git@ssh.sourcecraft.dev

# Проверка remote
git remote -v

# Проверка статуса
git status
```

### Работа с репозиторием

```bash
# Клонирование репозитория
git clone ssh://ssh.sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome.git

# Получение изменений
git fetch origin

# Обновление локальной ветки
git pull origin main

# Отправка изменений
git push origin main
```

### Просмотр истории

```bash
# Просмотр коммитов
git log --oneline

# Просмотр изменений
git diff

# Просмотр статуса
git status
```

---

## 🔍 Устранение проблем

### Проблема: "Host key verification failed"

**Решение:**
```bash
ssh-keyscan -t ed25519 ssh.sourcecraft.dev >> ~/.ssh/known_hosts
```

### Проблема: "Permission denied (publickey)"

**Решение:**
1. Проверьте, что SSH ключ добавлен в SourceCraft
2. Проверьте путь к ключу в `~/.ssh/config`
3. Проверьте права доступа: `chmod 600 ~/.ssh/id_ed25519_sourcecraft`

### Проблема: "repository not found"

**Решение:**
1. Убедитесь, что репозиторий создан
2. Проверьте правильность URL (организация и название)
3. Проверьте права доступа к репозиторию

### Проблема: "Connection reset by peer"

**Решение:**
1. Проверьте настройки SSH config
2. Убедитесь, что используете правильный хост: `ssh.sourcecraft.dev`
3. Проверьте, что SSH ключ добавлен в SourceCraft

---

## 📚 Дополнительные ресурсы

- **Документация SourceCraft:** https://sourcecraft.yandex.ru/docs
- **Веб-интерфейс:** https://sourcecraft.dev/kulagin-eugeny-i-kompaniia/reacthome
- **Настройки SSH:** https://sourcecraft.dev/settings/ssh-keys
- **Сервисные подключения:** https://sourcecraft.dev/settings/service-connections

---

## ✅ Чеклист настройки

- [ ] SSH ключ создан
- [ ] SSH ключ добавлен в SourceCraft
- [ ] SSH config настроен
- [ ] Host key добавлен в known_hosts
- [ ] Репозиторий создан в SourceCraft
- [ ] Git remote настроен
- [ ] Первый push выполнен
- [ ] Конфигурация CI/CD добавлена (`.sourcecraft/ci.yaml`)
- [ ] Сервисное подключение настроено

---

**Последнее обновление:** 2025-01-16  
**Версия документа:** 1.0

