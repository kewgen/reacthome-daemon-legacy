# Правила действий: Управление демоном умного дома

**Основан на:** INC-008-DAEMON-DOWN-2026-03-16  
**Применимо к:** Pi 192.168.88.4, reacthome-daemon, systemd

---

## Принципы (не нарушать)

1. **Демон управляется systemd, не PM2** — `reacthome-daemon.service` единственный способ старта.
2. **Никаких `pm2 start` из SSH** — запущенный вручную PM2 живёт только пока открыта сессия.
3. **Изменения вносить одной командой, сразу закрывать сессию** — длинные интерактивные SSH-сессии = нестабильность.
4. **Проверять состояние только через новую сессию** — иначе подтверждаешь себе артефакты.
5. **Логи — единственная истина** — `pm2 list` может врать (показывает spawning), `journalctl` — нет.

---

## Диагностика: демон не работает

### Шаг 1 — Быстрая проверка (30 секунд)

```bash
ssh pi@192.168.88.4 "systemctl is-active reacthome-daemon && \
  systemctl status reacthome-daemon --no-pager | grep -E 'Active|Main PID' && \
  ss -tlnp | grep 3000"
```

| Результат | Что означает |
|-----------|--------------|
| `active` + порт 3000 | ✅ Всё в порядке |
| `active` + нет порта | ⚠️ Демон стартует или зависает при инициализации |
| `activating` | 🔄 Systemd перезапускает (ждать 10 сек и проверить снова) |
| `inactive` / `failed` | 🔴 Демон упал, смотреть шаг 2 |

### Шаг 2 — Причина падения

```bash
# Последние события сервиса
ssh pi@192.168.88.4 "journalctl --no-pager -u reacthome-daemon -n 30"

# Ошибки приложения
ssh pi@192.168.88.4 "tail -30 /home/pi/.pm2/logs/daemon-error.log"

# Вывод приложения
ssh pi@192.168.88.4 "tail -30 /home/pi/.pm2/logs/daemon-out.log"
```

### Шаг 3 — Системный контекст (если причина неочевидна)

```bash
# Кто и когда убил процесс
ssh pi@192.168.88.4 "journalctl --no-pager --since '10 minutes ago' | \
  grep -E 'daemon|session|logind|SIGTERM|kill' | tail -40"

# В каком cgroup находится процесс (должен быть system.slice)
ssh pi@192.168.88.4 "PID=\$(systemctl show reacthome-daemon -p MainPID --value) && \
  cat /proc/\$PID/cgroup"

# Активные сессии пользователя pi
ssh pi@192.168.88.4 "loginctl list-sessions"
```

**Красный флаг:** если cgroup показывает `user-1000.slice` или `session-XXX.scope` — процесс был запущен из SSH, а не через systemd. Убить и перезапустить через сервис.

---

## Восстановление: демон упал

### Стандартный рестарт (99% случаев)

```bash
ssh pi@192.168.88.4 "sudo systemctl restart reacthome-daemon"
```

Проверить через 8 секунд:

```bash
ssh pi@192.168.88.4 "systemctl is-active reacthome-daemon && ss -tlnp | grep 3000"
```

### Если `failed` — принудительный сброс

```bash
ssh pi@192.168.88.4 "sudo systemctl reset-failed reacthome-daemon && \
  sudo systemctl start reacthome-daemon"
```

### Если порт 3000 занят после краша

```bash
ssh pi@192.168.88.4 "ss -tlnp | grep 3000"
# Если zombie-процесс держит порт:
ssh pi@192.168.88.4 "sudo kill -9 \$(ss -tlnp | grep 3000 | awk '{print \$6}' | grep -oP 'pid=\K[0-9]+')"
ssh pi@192.168.88.4 "sudo systemctl start reacthome-daemon"
```

---

## Изменение конфигурации

### Обновить код демона

```bash
# 1. Скопировать файлы на Pi
scp -r src/ pi@192.168.88.4:/home/pi/reacthome-daemon/src/

# 2. Перезапустить (одной командой)
ssh pi@192.168.88.4 "sudo systemctl restart reacthome-daemon"

# 3. Проверить через новую сессию (важно: новая, не та же)
ssh pi@192.168.88.4 "systemctl is-active reacthome-daemon && tail -5 /home/pi/.pm2/logs/daemon-out.log"
```

### Изменить параметры сервиса

```bash
# На Pi (редактировать с полного пути)
sudo nano /etc/systemd/system/reacthome-daemon.service

# Применить
sudo systemctl daemon-reload && sudo systemctl restart reacthome-daemon
```

---

## Автозапуск при перезагрузке Pi

Проверить что автозапуск включён:

```bash
ssh pi@192.168.88.4 "systemctl is-enabled reacthome-daemon"
# Ожидаемый ответ: enabled
```

Включить если нет:

```bash
ssh pi@192.168.88.4 "sudo systemctl enable reacthome-daemon"
```

---

## Мониторинг

| Инструмент | Команда |
|-----------|---------|
| Статус в реальном времени | `ssh pi@192.168.88.4 "journalctl -fu reacthome-daemon"` |
| Health-лог мониторинга | `./scripts/system/watch-daemon-health-log.sh` |
| Журнал системных событий | `ssh pi@192.168.88.4 "journalctl --no-pager -u reacthome-daemon --since today"` |
| Потребление памяти | `ssh pi@192.168.88.4 "ps aux | grep 'node.*daemon'"` |

> Health-монитор (`daemon-health-monitor.sh`) проверяет через `pm2 jlist` — **устарело**.  
> Нужно обновить: проверять `systemctl is-active reacthome-daemon`.

---

## Чего нельзя делать

| Запрещено | Почему |
|-----------|--------|
| `pm2 start daemon.js` из SSH | PM2 God Daemon живёт в сессионном scope, умирает при выходе |
| `pm2 kill` вручную | Убивает все управляемые процессы, не поднимает их обратно |
| `systemctl enable pm2-pi` | Конфликт с `reacthome-daemon.service` |
| Долгие интерактивные сессии с `pm2` | Создаёт side-PM2-daemon в сессионном scope |
| `systemctl restart pm2-pi` | pm2-pi.service отключён — ничего не произойдёт, но создаёт путаницу |

---

## Конфигурация сервиса (эталон)

**`/etc/systemd/system/reacthome-daemon.service`**

```ini
[Unit]
Description=ReactHome Daemon
After=network.target

[Service]
Type=simple
User=pi
Group=pi
WorkingDirectory=/home/pi/reacthome-daemon
Environment=NODE_ENV=production
Restart=always
RestartSec=5
ExecStart=/usr/bin/node /home/pi/reacthome-daemon/daemon.js
StandardOutput=append:/home/pi/.pm2/logs/daemon-out.log
StandardError=append:/home/pi/.pm2/logs/daemon-error.log

[Install]
WantedBy=multi-user.target
```

**Ключевые параметры:**
- `WorkingDirectory` — обязателен, иначе `sqlite('./var/lang/ru.db')` ищет файл в `/home/pi/`
- `Restart=always` — поднимает демон при любом падении
- `RestartSec=5` — пауза перед рестартом (даёт порту 2016 освободиться)
- логи пишутся в знакомое место `/home/pi/.pm2/logs/` для совместимости с мониторингом

---

## Известные ошибки (не критичные, не лечить)

| Ошибка | Причина | Влияние |
|--------|---------|---------|
| `ENETUNREACH 172.16.x.x:2017` | UDP в VPN-подсеть недостижима с Pi | Устройства в 172.16.x.x не видят rbus |
| `EAI_AGAIN gate.reacthome.net` | DNS не резолвит облако Janus | Нет облачного подключения |
| `SqliteError: no such table: forms` | Баг в `src/assist/lang/ru.js` | Assist-модуль не работает, WebSocket работает |
| `MaxListenersExceededWarning` | Утечка при нестабильном Janus | Незначительная утечка памяти |

---

*Обновлён: 17.03.2026 по результатам INC-008*
