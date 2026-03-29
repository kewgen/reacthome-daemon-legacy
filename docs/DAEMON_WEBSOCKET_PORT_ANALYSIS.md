# Анализ: почему порт WebSocket 3000 не открыт

**Дата:** 2026-03-16

---

## Цепочка запуска демона

```
daemon.js
  └── load() [async]
       1. for await (db.iterator())     ← LevelDB, может выбросить LOCK/corruption
       2. init.mac, set(init.mac, d)
       3. assets.init()                 ← async, не await
       4. state.init(init)
       5. initAssist()
       6. eventLog.init()
       7. weather.manage(), device.manage(), drivers.manage(), cpu.manage()
       8. discovery.start(init.mac)
       9. websocket.start(init.mac)     ← ЗДЕСЬ открывается порт 3000
      10. janus.start(), sip.start()
      11. start(init.mac)
```

**Вывод:** порт 3000 открывается только после успешного прохождения шагов 1–8. Любая ошибка или зависание до шага 9 — порт не откроется.

---

## Где реализован WebSocket-сервер

| Файл | Роль |
|------|------|
| `src/websocket/index.js` | `start(id)` → `startServer()` + `connectGate(id)` |
| `src/websocket/server.js` | `new Server({ port: 3000 })` — создание сервера на порту 3000 |
| `src/websocket/gate.js` | Подключение к `wss://gate.reacthome.net/${id}` |

`server.js` создаёт `new Server({ port })` без обработки `listening` и `error`. При `EADDRINUSE` или другой ошибке bind процесс может завершиться.

---

## Возможные причины, почему порт не открыт

### 1. Ошибка до `websocket.start()` (наиболее вероятно)

- **LevelDB:** `db.iterator()` при LOCK, повреждении БД или отсутствии `var/db`
- **init/assist:** исключение в `state.init`, `initAssist`, `assets.init`
- **device/drivers:** падение в `device.manage()` или `drivers.manage()`

При любой ошибке `load()` не доходит до `websocket.start()`, порт не открывается.

### 2. Падение при создании WebSocket-сервера

- Порт 3000 уже занят → `EADDRINUSE` → необработанный `error` → выход процесса
- Нет прав на bind порта → `EACCES`

### 3. Зависание до `websocket.start()`

- Долгий `db.iterator()` на большой БД
- Блокирующая операция в `device.manage()` или `drivers.manage()`

---

## Проверки на Pi

```bash
# 1. Занят ли порт 3000
ss -tuln | grep 3000
lsof -i :3000

# 2. Состояние LevelDB
ls -la /home/pi/reacthome-daemon/var/db/
# LOCK файл = другой процесс держит БД

# 3. Логи демона (последние строки)
tail -100 /home/pi/.pm2/logs/daemon-out.log
tail -50 /home/pi/.pm2/logs/daemon-error.log

# 4. Есть ли сообщение init.mac (перед websocket.start)
grep -E "mac|DAEMON|websocket|3000" /home/pi/.pm2/logs/daemon-out.log
```

Если в логах есть `init.mac` (строка 123), но не видно `websocket` — порт, скорее всего, не успел открыться или процесс упал сразу после.

---

## Результаты диагностики на Pi (2026-03-16)

| Проверка | Результат |
|----------|-----------|
| daemon-out.log | UUID (fd6765f1...) — вероятно init.mac или session |
| daemon-error.log | EAI_AGAIN gate.reacthome.net, "Reconnecting to janus" |
| var/db | LOCK есть (норма при работе демона) |
| Порт 3000 | не слушается |
| PM2 daemon | **отсутствует** (процесс упал) |

**Вывод:** Ошибки gate/janus означают, что `websocket.start()` был вызван (connectGate и janus.start идут после startServer). Процесс затем падает — возможно из‑за необработанного `error` при bind порта (EADDRINUSE) или другой причины.

---

## Результат отладки (2026-03-16)

**Вывод:** Порт 3000 открывается корректно. Проблема «порт не слушается» возникала из‑за того, что демон не был запущен (PM2 не сохранял процессы после перезагрузки/сессии).

**Сделано:**
- Добавлено логирование `listening`/`error` в `src/websocket/server.js`
- Выполнено `pm2 save` на Pi для сохранения списка процессов

**Рекомендация:** Настроить автозапуск PM2 при загрузке Pi: `pm2 startup` (один раз с sudo), затем `pm2 save`.

---

## Рекомендации

1. ~~**Логирование**~~ — добавлено в `server.js`.
2. **pm2 startup** — настроить автозапуск PM2 при перезагрузке Pi.
3. **Обработка ошибок:** обернуть `load()` в `try/catch` и логировать ошибки (опционально).
