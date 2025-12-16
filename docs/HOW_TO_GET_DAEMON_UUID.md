# Как узнать UUID демона на Raspberry Pi

**Дата:** 2025-12-12  
**Версия:** 1.0

---

## Оглавление

1. [Способ 1: Из логов демона](#способ-1-из-логов-демона)
2. [Способ 2: Из LevelDB (скрипт)](#способ-2-из-leveldb-скрипт)
3. [Способ 3: Из LevelDB (вручную)](#способ-3-из-leveldb-вручную)
4. [Способ 4: Через WebSocket](#способ-4-через-websocket)
5. [Способ 5: Через PM2 логи](#способ-5-через-pm2-логи)
6. [Способ 6: Через SSH команду](#способ-6-через-ssh-команду)

---

## Способ 1: Из логов демона

**Самый простой способ** — UUID выводится в консоль при запуске демона.

### Локально (если демон запущен в терминале):

```bash
# UUID будет в выводе при старте
cd /home/pi/reacthome-daemon
node daemon.js
# Вы увидите: fd6765f1-ed61-4ae4-8d72-9a078a9f4316
```

### Через PM2 логи:

```bash
# Последние логи
pm2 logs daemon --lines 50 | grep -E "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Или просто посмотреть последние строки
pm2 logs daemon --lines 10
# UUID будет в одной из первых строк после запуска
```

**Код:** `daemon.js:124` — `console.log(init.mac);`

---

## Способ 2: Из LevelDB (скрипт)

**Рекомендуемый способ** — использовать готовый скрипт.

### Локально на Raspberry Pi:

```bash
cd /home/pi/reacthome-daemon
node scripts/get-daemon-uuid.js
```

**Вывод:**
```
📂 Открываю БД: /home/pi/reacthome-daemon/var/db

✅ UUID демона (ключ "mac"):
   fd6765f1-ed61-4ae4-8d72-9a078a9f4316

✅ Объект демона найден:
   Тип: daemon
   Токенов: 2
   Температура CPU: 71.575°C
   Устройств: 14
```

### Удалённо через SSH:

```bash
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && node scripts/get-daemon-uuid.js'
```

### С указанием пути к БД:

```bash
DB_PATH=/custom/path/to/db node scripts/get-daemon-uuid.js
```

---

## Способ 3: Из LevelDB (вручную)

Если скрипт недоступен, можно прочитать напрямую из LevelDB.

### Через Node.js:

```bash
cd /home/pi/reacthome-daemon
node -e "
const {Level} = require('level');
(async() => {
  const db = new Level('var/db', {valueEncoding: 'json'});
  const mac = await db.get('mac');
  console.log(mac);
  await db.close();
})();
"
```

### Через Python (если установлен leveldb):

```python
import leveldb
db = leveldb.LevelDB('/home/pi/reacthome-daemon/var/db')
mac = db.Get(b'mac').decode('utf-8')
print(mac)
```

**Ключ в БД:** `"mac"`  
**Значение:** UUID демона (например, `fd6765f1-ed61-4ae4-8d72-9a078a9f4316`)

---

## Способ 4: Через WebSocket

Если демон запущен и доступен через WebSocket, можно запросить объект демона.

### Локальное подключение:

```bash
# Используя wscat (npm install -g wscat)
wscat -c ws://localhost:3000
> {"type":"get","state":["<ваш-uuid-демона>"]}
```

**Проблема:** Нужно знать UUID заранее, чтобы запросить его.

### Альтернатива: Запросить список всех объектов

```bash
wscat -c ws://localhost:3000
> {"type":"list"}
# В ответе будет массив всех UUID, включая демона
```

**Или через скрипт:**

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'list' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'list' && msg.state) {
    // Ищем объект с type: 'daemon'
    msg.state.forEach(([id]) => {
      ws.send(JSON.stringify({ type: 'get', state: [id] }));
    });
  } else if (msg.type === 'ACTION_SET' && msg.payload?.type === 'daemon') {
    console.log('UUID демона:', msg.id);
    ws.close();
  }
});
```

---

## Способ 5: Через PM2 логи

Если демон запущен через PM2, UUID можно найти в логах.

### Просмотр последних логов:

```bash
pm2 logs daemon --lines 100 | grep -E "^[0-9a-f]{8}-"
```

### Поиск UUID в логах:

```bash
# В файле логов
grep -E "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" \
  ~/.pm2/logs/daemon-out.log | head -1
```

### Через SSH:

```bash
ssh pi@192.168.88.4 'pm2 logs daemon --lines 20 --nostream | grep -E "^[0-9a-f]{8}-" | head -1'
```

---

## Способ 6: Через SSH команду

**Быстрый способ** для получения UUID удалённо.

### Одной командой:

```bash
ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && \
  NODE_PATH=./node_modules node -e \
  "const {Level}=require(\"level\");(async()=>{try{const db=new Level(\"var/db\",{valueEncoding:\"json\"});const mac=await db.get(\"mac\");await db.close();console.log(mac);}catch(e){console.log(\"не найден\");}})();"'
```

### С сохранением в переменную:

```bash
DAEMON_UUID=$(ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && \
  NODE_PATH=./node_modules node -e \
  "const {Level}=require(\"level\");(async()=>{try{const db=new Level(\"var/db\",{valueEncoding:\"json\"});const mac=await db.get(\"mac\");await db.close();console.log(mac);}catch(e){console.log(\"не найден\");}})();"')

echo "Daemon UUID: $DAEMON_UUID"
```

---

## Где хранится UUID

### LevelDB структура:

```
var/db/
  ├── "mac" → "fd6765f1-ed61-4ae4-8d72-9a078a9f4316"  (ключ "mac")
  └── "fd6765f1-ed61-4ae4-8d72-9a078a9f4316" → {      (объект демона)
        type: "daemon",
        token: [...],
        temperature: 71.575,
        device: [...]
      }
```

### Код генерации:

**Файл:** `daemon.js` (строки 96-99)

```javascript
if (!init.mac) {
  init.mac = v4();  // Генерация UUID v4
  db.put("mac", init.mac);  // Сохранение в LevelDB
}
```

**Важно:** UUID генерируется **один раз** при первом запуске и сохраняется в БД. При последующих запусках он восстанавливается из БД.

---

## Примеры использования

### 1. Получить UUID для подключения через gateway:

```bash
DAEMON_UUID=$(ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && \
  node scripts/get-daemon-uuid.js 2>/dev/null | grep -E "^   [0-9a-f-]+$" | tr -d " "')

echo "Подключение: wss://gate.reacthome.net/$DAEMON_UUID"
```

### 2. Проверить, какой это демон (pochta/mindal):

```bash
DAEMON_UUID=$(ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && \
  node scripts/get-daemon-uuid.js 2>/dev/null | grep -E "^   [0-9a-f-]+$" | tr -d " "')

node scripts/identify-daemon-project.js "$DAEMON_UUID"
```

### 3. Сохранить UUID в переменную окружения:

```bash
export REACTHOME_DAEMON_UUID=$(ssh pi@192.168.88.4 'cd /home/pi/reacthome-daemon && \
  node scripts/get-daemon-uuid.js 2>/dev/null | grep -E "^   [0-9a-f-]+$" | tr -d " "')

echo "Daemon UUID: $REACTHOME_DAEMON_UUID"
```

---

## Устранение проблем

### Проблема: "Ключ 'mac' не найден в БД"

**Причина:** Демон ещё не был запущен или БД пуста.

**Решение:** Запустите демон хотя бы один раз:
```bash
cd /home/pi/reacthome-daemon
node daemon.js
# Или через PM2
pm2 start daemon.js --name daemon
```

### Проблема: "БД не найдена по пути"

**Причина:** Неверный путь к БД.

**Решение:** Укажите правильный путь:
```bash
DB_PATH=/home/pi/reacthome-daemon/var/db node scripts/get-daemon-uuid.js
```

### Проблема: "Module 'level' not found"

**Причина:** Зависимости не установлены.

**Решение:** Установите зависимости:
```bash
cd /home/pi/reacthome-daemon
npm install
```

---

## См. также

- **Справочник UUID:** `docs/DAEMON_ID_AND_UUID_REFERENCE.md`
- **Определение проекта:** `scripts/identify-daemon-project.js`
- **WebSocket API:** `docs/WEBSOCKET_API_REFERENCE.md`

---

**Документ:** `docs/HOW_TO_GET_DAEMON_UUID.md`  
**Дата:** 2025-12-12  
**Автор:** Жекин Ассистент



