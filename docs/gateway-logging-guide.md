# Исчерпывающая инструкция по добавлению логов на сервер

**Дата создания:** 2025-11-22  
**Версия:** 1.0

## Содержание

1. [Обзор архитектуры логирования](#обзор-архитектуры-логирования)
2. [Структура файлов на сервере](#структура-файлов-на-сервере)
3. [Типы логирования](#типы-логирования)
4. [Примеры добавления логов](#примеры-добавления-логов)
5. [Копирование файлов на сервер](#копирование-файлов-на-сервер)
6. [Перезапуск демона](#перезапуск-демона)
7. [Проверка логов](#проверка-логов)
8. [Лучшие практики](#лучшие-практики)

---

## Обзор архитектуры логирования

### Как работает логирование в демоне

Демон использует Node.js и библиотеку `ws` для WebSocket соединений. Логи выводятся через `console.log()`, `console.error()` и попадают в файлы PM2:

- **Стандартный вывод**: `~/.pm2/logs/daemon-out.log`
- **Ошибки**: `~/.pm2/logs/daemon-error.log`
- **PM2 логи**: `~/.pm2/pm2.log`

### Gateway архитектура

```
Клиент (тест) 
    ↓
Gateway сервер (gate.reacthome.net)
    ↓ добавляет session ID
Демон (gate.js) 
    ↓ извлекает session ID
handle.js 
    ↓ обрабатывает команду
service.js / actions.js
```

---

## Структура файлов на сервере

### Локальная структура (для разработки)

```
reacthome-daemon-legacy-main/
├── src/
│   └── websocket/
│       ├── gate.js          # Обработка gateway соединений
│       ├── handle.js        # Обработка входящих команд
│       ├── server.js        # Локальный WebSocket сервер
│       └── index.js         # Инициализация WebSocket
├── src/
│   └── controllers/
│       └── service.js       # Выполнение скриптов
└── daemon.js                # Главный файл демона
```

### Структура на сервере

```
/home/pi/reacthome-daemon/
├── src/
│   └── websocket/
│       ├── gate.js
│       ├── handle.js
│       └── ...
└── daemon.js
```

### Логи PM2

```
/home/pi/.pm2/
├── logs/
│   ├── daemon-out.log       # Стандартный вывод
│   └── daemon-error.log     # Ошибки
└── pm2.log                  # Логи PM2
```

---

## Типы логирования

### 1. Простое логирование

```javascript
console.log("Простое сообщение");
console.error("Сообщение об ошибке");
```

### 2. Логирование с префиксом

```javascript
console.log("[GATEWAY] Сообщение");
console.error("[GATEWAY] Ошибка");
```

### 3. Логирование с данными

```javascript
console.log(`[GATEWAY] Session: ${session}, Command: ${command.type}`);
console.error(`[GATEWAY] Ошибка парсинга: ${error.message}`);
```

### 4. Логирование объектов

```javascript
console.log("[GATEWAY] Данные:", JSON.stringify(data, null, 2));
console.error("[GATEWAY] Ошибка:", error);
```

### 5. Условное логирование

```javascript
if (DEBUG_MODE) {
  console.log("[GATEWAY] Детальная информация:", details);
}
```

---

## Примеры добавления логов

### Пример 1: Логирование подключения к gateway

**Файл:** `src/websocket/gate.js`

**Место:** В обработчике события `open`

```javascript
socket.on("open", () => {
  console.log("[GATEWAY] WebSocket подключен к gateway");
  console.log(`[GATEWAY] URL: ${gateURL(id)}`);
  console.log(`[GATEWAY] Protocol: ${PROTOCOL}`);
  clearInterval(interval);
  interval = setInterval(() => {
    clearTimeout(timeout);
    timeout = setTimeout(() => socket.close(), 2 * TIMEOUT);
    socket.ping();
  }, TIMEOUT);
});
```

**Полный контекст:**

```javascript
const connect = (id) => {
  const socket = new WebSocket(gateURL(id), PROTOCOL);
  
  socket.on("open", () => {
    console.log("[GATEWAY] WebSocket подключен к gateway");
    console.log(`[GATEWAY] URL: ${gateURL(id)}`);
    console.log(`[GATEWAY] Protocol: ${PROTOCOL}`);
    clearInterval(interval);
    interval = setInterval(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => socket.close(), 2 * TIMEOUT);
      socket.ping();
    }, TIMEOUT);
  });
  
  // ... остальной код
};
```

---

### Пример 2: Логирование входящих сообщений

**Файл:** `src/websocket/gate.js`

**Место:** В обработчике события `message`

```javascript
socket.on("message", (data) => {
  // Преобразуем data в строку, если это Buffer
  const dataStr = typeof data === 'string' ? data : data.toString('utf8');
  
  // Логируем сырые данные для диагностики
  console.log(`[GATEWAY] Получено сырое сообщение: длина=${dataStr.length}, первые 100 символов: ${dataStr.substring(0, 100)}`);
  
  // Проверяем минимальную длину (36 символов для UUID)
  if (dataStr.length < 36) {
    console.log(`[GATEWAY] Сообщение слишком короткое: ${dataStr.length} символов`);
    return;
  }
  
  const session = dataStr.substring(0, 36);
  if (!isUUID.test(session)) {
    console.log(`[GATEWAY] Невалидный session ID: ${session.substring(0, 20)}...`);
    return;
  }
  
  const message = dataStr.substring(36);
  console.log(`[GATEWAY] Извлечён session: ${session}, длина сообщения: ${message.length}`);
  
  if (message) {
    // ... обработка сообщения
  }
});
```

**Полный контекст:**

```javascript
socket.on("message", (data) => {
  // Преобразуем data в строку, если это Buffer
  const dataStr = typeof data === 'string' ? data : data.toString('utf8');
  
  // Логируем сырые данные для диагностики
  console.log(`[GATEWAY] Получено сырое сообщение: длина=${dataStr.length}, первые 100 символов: ${dataStr.substring(0, 100)}`);
  
  // Проверяем минимальную длину (36 символов для UUID)
  if (dataStr.length < 36) {
    console.log(`[GATEWAY] Сообщение слишком короткое: ${dataStr.length} символов`);
    return;
  }
  
  const session = dataStr.substring(0, 36);
  if (!isUUID.test(session)) {
    console.log(`[GATEWAY] Невалидный session ID: ${session.substring(0, 20)}...`);
    return;
  }
  
  const message = dataStr.substring(36);
  console.log(`[GATEWAY] Извлечён session: ${session}, длина сообщения: ${message.length}`);
  
  if (message) {
    if (!sessions.has(session)) {
      sessions.add(session);
      peers.set(session, {
        session,
        online: true,
        state: "active",
        timestamp: Date.now(),
        send(message, cb) {
          socket.send(`${session}${JSON.stringify(message)}`, cb);
        },
      });
      console.log(`[GATEWAY] Новый session: ${session}`);
    }
    
    // Парсим JSON и логируем
    let action;
    try {
      action = JSON.parse(message);
      console.log(`[GATEWAY] Получена команда: type=${action.type}, session=${session}`);
      
      // Специальное логирование для ACTION_SCRIPT_RUN
      if (action.type === "ACTION_SCRIPT_RUN") {
        console.log(`[GATEWAY] Получена команда ACTION_SCRIPT_RUN: session=${session}, script_id=${action.id}`);
      }
    } catch (e) {
      console.error(`[GATEWAY] Ошибка парсинга JSON для session ${session}: ${e.message}`);
      console.error(`[GATEWAY] Сообщение (первые 200 символов): ${message.substring(0, 200)}`);
      console.error(`[GATEWAY] Длина сообщения: ${message.length}, первые символы: ${message.substring(0, 50)}`);
      return;
    }
    
    handle(session, message);
  } else {
    deleteSession(session);
    sessions.delete(session);
    peers.delete(session);
    terminals.delete(session);
  }
});
```

---

### Пример 3: Логирование обработки команд

**Файл:** `src/websocket/handle.js`

**Место:** В начале функции `handle`

```javascript
module.exports = (session, message) => {
  try {
    const peer = peers.get(session);
    if (!peer) {
      console.error(`[GATEWAY] Peer не найден для session: ${session}`);
      return;
    }
    peer.timestamp = Date.now();
    
    // Логируем сырое сообщение
    console.log(`[GATEWAY] Обработка сообщения: session=${session}, длина=${message.length}`);
    
    let action;
    try {
      action = JSON.parse(message);
      console.log(`[GATEWAY] Распарсена команда: type=${action.type}, session=${session}`);
    } catch (e) {
      console.error(`[GATEWAY] Ошибка парсинга JSON в handle.js для session ${session}: ${e.message}`);
      console.error(`[GATEWAY] Сообщение (первые 200 символов): ${message.substring(0, 200)}`);
      throw e;
    }
    
    // Специальное логирование для ACTION_SCRIPT_RUN
    if (action.type === 'ACTION_SCRIPT_RUN') {
      console.log(`[GATEWAY] Обработка ACTION_SCRIPT_RUN: session=${session}, script_id=${action.id}`);
    }
    
    switch (action.type) {
      case ACTION_SET: {
        const { id, payload = {} } = action;
        console.log(`[GATEWAY] ACTION_SET: id=${id}, session=${session}`);
        // ... обработка
        break;
      }
      // ... остальные case
      default: {
        console.log(`[GATEWAY] Обработка команды в default: type=${action.type}, session=${session}`);
        run(action);
      }
    }
  } catch (e) {
    console.error(`[GATEWAY] Ошибка в handle.js:`, e);
  }
};
```

**Полный контекст:**

```javascript
const { GET, LIST } = require('../init/constants');
const { ACK, BYE, INFO } = require('../sip/constants');
const { START, STOP, WATCH, PAUSE } = require('../camera/constants');
const { run } = require('../controllers/service');
const { onWatch, onStart, onStop, onPause } = require('../camera');
const { TOKEN } = require('../notification/constants');
const { addToken } = require('../notification');
const { broadcast, peers } = require('./peer');
const onGet = require('../init/get');
const onList = require('../init/list');
const onAck = require('../sip/ack');
const onBye = require('../sip/bye');
const onInfo = require('../sip/info');
const { PTY } = require('../terminal/constants');
const onPTY = require('../terminal');
const janus = require('../janus');
const { CANDIDATE, KEEPALIVE } = require('../janus/constants');
const { ACTION_ASSIST, ACTION_SET, POOL, ACTION_ADD, ACTION_MAKE_BIND, ACTION_ADD_BIND, ACTION_ASSET, ACTION_DEL } = require('../constants');
const { handleAssist, initAssistDelayed } = require('../assist');
const { set, add, makeBind, addBind, del } = require('../actions');
const { writeFile, asset } = require('../fs');

module.exports = (session, message) => {
  try {
    const peer = peers.get(session);
    if (!peer) {
      console.error(`[GATEWAY] Peer не найден для session: ${session}`);
      return;
    }
    peer.timestamp = Date.now();
    
    // Логируем сырое сообщение
    console.log(`[GATEWAY] Обработка сообщения: session=${session}, длина=${message.length}`);
    
    let action;
    try {
      action = JSON.parse(message);
      console.log(`[GATEWAY] Распарсена команда: type=${action.type}, session=${session}`);
    } catch (e) {
      console.error(`[GATEWAY] Ошибка парсинга JSON в handle.js для session ${session}: ${e.message}`);
      console.error(`[GATEWAY] Сообщение (первые 200 символов): ${message.substring(0, 200)}`);
      throw e;
    }
    
    // Специальное логирование для ACTION_SCRIPT_RUN
    if (action.type === 'ACTION_SCRIPT_RUN') {
      console.log(`[GATEWAY] Обработка ACTION_SCRIPT_RUN: session=${session}, script_id=${action.id}`);
    }
    
    switch (action.type) {
      case ACTION_SET: {
        const { id, payload = {} } = action;
        console.log(`[GATEWAY] ACTION_SET: id=${id}, session=${session}`);
        if (payload.title || payload.code) {
          initAssistDelayed()
        }
        if (id !== POOL) {
          set(id, payload);
        }
        break;
      }
      // ... остальные case
      default: {
        console.log(`[GATEWAY] Обработка команды в default: type=${action.type}, session=${session}`);
        run(action);
      }
    }
  } catch (e) {
    console.error(`[GATEWAY] Ошибка в handle.js:`, e);
  }
};
```

---

### Пример 4: Логирование выполнения скриптов

**Файл:** `src/controllers/service.js`

**Место:** В функции обработки ACTION_SCRIPT_RUN

```javascript
const { ACTION_SCRIPT_RUN } = require('../constants');

// В функции run или обработчике ACTION_SCRIPT_RUN
if (action.type === ACTION_SCRIPT_RUN) {
  const { id } = action;
  console.log(`[SERVICE] Выполнение скрипта: script_id=${id}`);
  
  // Получаем скрипт
  const script = get(id);
  if (!script) {
    console.error(`[SERVICE] Скрипт не найден: script_id=${id}`);
    return;
  }
  
  console.log(`[SERVICE] Скрипт найден: script_id=${id}, название=${script.title || 'N/A'}`);
  
  // Выполняем скрипт
  try {
    // ... выполнение скрипта
    console.log(`[SERVICE] Скрипт выполнен успешно: script_id=${id}`);
  } catch (e) {
    console.error(`[SERVICE] Ошибка выполнения скрипта: script_id=${id}, error=${e.message}`);
    throw e;
  }
}
```

---

### Пример 5: Логирование отправки сообщений через gateway

**Файл:** `src/websocket/gate.js`

**Место:** В методе `send` peer

```javascript
peers.set(session, {
  session,
  online: true,
  state: "active",
  timestamp: Date.now(),
  send(message, cb) {
    const messageStr = `${session}${JSON.stringify(message)}`;
    console.log(`[GATEWAY] Отправка сообщения: session=${session}, type=${message.type || 'N/A'}, длина=${messageStr.length}`);
    socket.send(messageStr, cb);
  },
});
```

---

### Пример 6: Логирование ошибок WebSocket

**Файл:** `src/websocket/gate.js`

**Место:** В обработчике события `error` и `close`

```javascript
socket.on("error", (err) => {
  console.error("[GATEWAY] Ошибка WebSocket:", err);
  console.error(`[GATEWAY] URL: ${gateURL(id)}`);
  console.error(`[GATEWAY] Protocol: ${PROTOCOL}`);
});

socket.on("close", () => {
  console.log("[GATEWAY] WebSocket отключен от gateway, переподключение...");
  console.log(`[GATEWAY] Активных sessions: ${sessions.size}`);
  for (const session of sessions) {
    deleteSession(session);
    sessions.delete(session);
    peers.delete(session);
    terminals.delete(session);
  }
  clearInterval(interval);
  setTimeout(connect, TIMEOUT, id);
});
```

---

## Копирование файлов на сервер

**Создайте скрипт:** `scripts/deploy_gateway_logs.sh`

```bash
#!/bin/bash

# Скрипт для копирования файлов с логированием на сервер

HOST="192.168.88.4"
USER="pi"
PASS="raspberry"
REMOTE_DIR="/home/pi/reacthome-daemon"

echo "📤 Копирование файлов на сервер..."

# Копируем gate.js
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no src/websocket/gate.js $USER@$HOST:$REMOTE_DIR/src/websocket/gate.js
expect "password:" { send "$PASS\r" }
expect eof
EOF

if [ $? -eq 0 ]; then
    echo "✅ gate.js скопирован"
else
    echo "❌ Ошибка копирования gate.js"
    exit 1
fi

# Копируем handle.js
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no src/websocket/handle.js $USER@$HOST:$REMOTE_DIR/src/websocket/handle.js
expect "password:" { send "$PASS\r" }
expect eof
EOF

if [ $? -eq 0 ]; then
    echo "✅ handle.js скопирован"
else
    echo "❌ Ошибка копирования handle.js"
    exit 1
fi

echo "✅ Все файлы скопированы успешно"
```

**Использование:**

```bash
chmod +x scripts/deploy_gateway_logs.sh
./scripts/deploy_gateway_logs.sh
```

---

## Перезапуск демона

**Создайте скрипт:** `scripts/restart_daemon.sh`

```bash
#!/bin/bash

HOST="192.168.88.4"
USER="pi"
PASS="raspberry"

echo "🔄 Перезапуск демона на сервере $USER@$HOST..."

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no $USER@$HOST "pm2 restart daemon && sleep 2 && pm2 list | grep daemon"
expect "password:" { send "$PASS\r" }
expect eof
EOF

if [ $? -eq 0 ]; then
    echo "✅ Демон перезапущен успешно"
    echo "⏳ Ожидание инициализации (3-5 минут)..."
    echo "💡 Используйте 'pm2 logs daemon' для проверки логов"
else
    echo "❌ Ошибка при перезапуске демона"
    exit 1
fi
```

**Использование:**

```bash
chmod +x scripts/restart_daemon.sh
./scripts/restart_daemon.sh
```

---

## Проверка логов

**Создайте скрипт:** `scripts/fetch_logs.sh`

```bash
#!/bin/bash

HOST="192.168.88.4"
USER="pi"
PASS="raspberry"
LOCAL_DIR="./logs"
REMOTE_DIR="/home/pi/.pm2/logs"

mkdir -p $LOCAL_DIR

echo "📥 Скачивание логов с сервера..."

# Скачиваем daemon-out.log
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no $USER@$HOST:$REMOTE_DIR/daemon-out.log $LOCAL_DIR/daemon-out.log
expect "password:" { send "$PASS\r" }
expect eof
EOF

# Скачиваем daemon-error.log
expect << EOF
set timeout 30
spawn scp -o StrictHostKeyChecking=no $USER@$HOST:$REMOTE_DIR/daemon-error.log $LOCAL_DIR/daemon-error.log
expect "password:" { send "$PASS\r" }
expect eof
EOF

echo "✅ Логи выгружены в $LOCAL_DIR/"
ls -lh $LOCAL_DIR/
```

**Использование:**

```bash
chmod +x scripts/fetch_logs.sh
./scripts/fetch_logs.sh

# Просмотр логов локально
grep -E '\[GATEWAY\]' logs/daemon-out.log | tail -50

# Поиск ACTION_SCRIPT_RUN
grep -E 'ACTION_SCRIPT_RUN' logs/daemon-out.log | tail -50

# Поиск ошибок парсинга
grep -E 'Ошибка парсинга' logs/daemon-out.log | tail -50

# Поиск по session ID
grep -E 'session=.*ваш-session-id' logs/daemon-out.log | tail -50
```

---

## Лучшие практики

### 1. Используйте префиксы для категоризации

```javascript
console.log("[GATEWAY] ...");      // Gateway логи
console.log("[SERVICE] ...");      // Service логи
console.log("[ACTION] ...");       // Action логи
console.log("[ERROR] ...");        // Ошибки
```

### 2. Логируйте важные события

- ✅ Подключение/отключение
- ✅ Получение команд
- ✅ Ошибки парсинга
- ✅ Выполнение скриптов
- ✅ Изменения состояния

### 3. Избегайте избыточного логирования

```javascript
// ❌ Плохо - логирует каждое сообщение
socket.on("message", (data) => {
  console.log("[GATEWAY] Получено сообщение:", data);
});

// ✅ Хорошо - логирует только важные события
socket.on("message", (data) => {
  // Логируем только при ошибках или важных командах
  try {
    const action = JSON.parse(data);
    if (action.type === "ACTION_SCRIPT_RUN") {
      console.log(`[GATEWAY] ACTION_SCRIPT_RUN: ${action.id}`);
    }
  } catch (e) {
    console.error("[GATEWAY] Ошибка парсинга:", e);
  }
});
```

### 4. Используйте структурированное логирование

```javascript
// ❌ Плохо
console.log("Session:", session, "Command:", command);

// ✅ Хорошо
console.log(`[GATEWAY] Session: ${session}, Command: ${command.type}, ID: ${command.id}`);
```

### 5. Логируйте контекст ошибок

```javascript
// ❌ Плохо
catch (e) {
  console.error(e);
}

// ✅ Хорошо
catch (e) {
  console.error(`[GATEWAY] Ошибка парсинга JSON для session ${session}: ${e.message}`);
  console.error(`[GATEWAY] Сообщение (первые 200 символов): ${message.substring(0, 200)}`);
  console.error(`[GATEWAY] Длина сообщения: ${message.length}`);
}
```

### 6. Логируйте с временными метками (опционально)

```javascript
function logWithTime(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [GATEWAY] ${message}`);
}

// Использование
logWithTime('Подключение установлено');
logWithTime('Получена команда ACTION_SCRIPT_RUN');
```

---

## Полный пример: Добавление логирования в gate.js

```javascript
const WebSocket = require("ws");
const { isUUID } = require("../uuid");
const { deleteSession } = require("../notification");
const { peers } = require("./peer");
const handle = require("./handle");
const { terminals } = require("../terminal");

const PROTOCOL = "listen";
const TIMEOUT = 1000;
const gateURL = (id) => `wss://gate.reacthome.net/${id}`;

let interval, timeout;
const sessions = new Set();

const connect = (id) => {
  const socket = new WebSocket(gateURL(id), PROTOCOL);
  
  // ЛОГИРОВАНИЕ: Подключение
  socket.on("open", () => {
    console.log("[GATEWAY] WebSocket подключен к gateway");
    console.log(`[GATEWAY] URL: ${gateURL(id)}`);
    console.log(`[GATEWAY] Protocol: ${PROTOCOL}`);
    clearInterval(interval);
    interval = setInterval(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => socket.close(), 2 * TIMEOUT);
      socket.ping();
    }, TIMEOUT);
  });
  
  // ЛОГИРОВАНИЕ: Ошибки
  socket.on("error", (err) => {
    console.error("[GATEWAY] Ошибка WebSocket:", err);
    console.error(`[GATEWAY] URL: ${gateURL(id)}`);
  });
  
  // ЛОГИРОВАНИЕ: Отключение
  socket.on("close", () => {
    console.log("[GATEWAY] WebSocket отключен от gateway, переподключение...");
    console.log(`[GATEWAY] Активных sessions: ${sessions.size}`);
    for (const session of sessions) {
      deleteSession(session);
      sessions.delete(session);
      peers.delete(session);
      terminals.delete(session);
    }
    clearInterval(interval);
    setTimeout(connect, TIMEOUT, id);
  });
  
  // ЛОГИРОВАНИЕ: Входящие сообщения
  socket.on("message", (data) => {
    // Преобразуем data в строку
    const dataStr = typeof data === 'string' ? data : data.toString('utf8');
    
    // Логируем сырые данные (можно отключить в production)
    console.log(`[GATEWAY] Получено сырое сообщение: длина=${dataStr.length}, первые 100 символов: ${dataStr.substring(0, 100)}`);
    
    // Проверяем минимальную длину
    if (dataStr.length < 36) {
      console.log(`[GATEWAY] Сообщение слишком короткое: ${dataStr.length} символов`);
      return;
    }
    
    const session = dataStr.substring(0, 36);
    if (!isUUID.test(session)) {
      console.log(`[GATEWAY] Невалидный session ID: ${session.substring(0, 20)}...`);
      return;
    }
    
    const message = dataStr.substring(36);
    console.log(`[GATEWAY] Извлечён session: ${session}, длина сообщения: ${message.length}`);
    
    if (message) {
      // Новый session
      if (!sessions.has(session)) {
        sessions.add(session);
        peers.set(session, {
          session,
          online: true,
          state: "active",
          timestamp: Date.now(),
          send(message, cb) {
            const messageStr = `${session}${JSON.stringify(message)}`;
            console.log(`[GATEWAY] Отправка сообщения: session=${session}, type=${message.type || 'N/A'}, длина=${messageStr.length}`);
            socket.send(messageStr, cb);
          },
        });
        console.log(`[GATEWAY] Новый session: ${session}`);
      }
      
      // Парсим и логируем команду
      let action;
      try {
        action = JSON.parse(message);
        console.log(`[GATEWAY] Получена команда: type=${action.type}, session=${session}`);
        
        // Специальное логирование для ACTION_SCRIPT_RUN
        if (action.type === "ACTION_SCRIPT_RUN") {
          console.log(`[GATEWAY] Получена команда ACTION_SCRIPT_RUN: session=${session}, script_id=${action.id}`);
        }
      } catch (e) {
        console.error(`[GATEWAY] Ошибка парсинга JSON для session ${session}: ${e.message}`);
        console.error(`[GATEWAY] Сообщение (первые 200 символов): ${message.substring(0, 200)}`);
        console.error(`[GATEWAY] Длина сообщения: ${message.length}, первые символы: ${message.substring(0, 50)}`);
        return;
      }
      
      handle(session, message);
    } else {
      // Пустое сообщение - удаление session
      console.log(`[GATEWAY] Получено пустое сообщение, удаление session: ${session}`);
      deleteSession(session);
      sessions.delete(session);
      peers.delete(session);
      terminals.delete(session);
    }
  });
  
  socket.on("pong", () => {
    clearTimeout(timeout);
  });
};

module.exports = connect;
```

---

## Чеклист добавления логов

- [ ] Определить место для логирования
- [ ] Добавить `console.log()` или `console.error()` с префиксом `[GATEWAY]`
- [ ] Включить контекстную информацию (session, command type, etc.)
- [ ] Обработать ошибки с детальным логированием
- [ ] Скопировать файл на сервер
- [ ] Перезапустить демон
- [ ] Проверить логи через `pm2 logs daemon`
- [ ] Убедиться, что логи появляются в `daemon-out.log`

---

## Заключение

Эта инструкция покрывает все аспекты добавления логирования на сервер. Используйте примеры кода как основу для ваших собственных логов. Помните:

1. **Всегда используйте префиксы** для категоризации логов
2. **Логируйте контекст** - session ID, команды, ошибки
3. **Избегайте избыточного логирования** - только важные события
4. **Проверяйте логи** после добавления новых записей
5. **Документируйте изменения** в коде

---

## См. также

- **[WEBSOCKET_API_REFERENCE.md](./WEBSOCKET_API_REFERENCE.md)** - полное описание WebSocket API
- **[PROJECT_DESCRIPTION.md](./PROJECT_DESCRIPTION.md)** - описание архитектуры проекта
- `src/websocket/gate.js` - обработка gateway соединений
- `src/websocket/handle.js` - обработка входящих команд
- `scripts/restart_daemon.sh` - скрипт перезапуска демона
- `scripts/fetch_logs.sh` - скрипт получения логов с сервера

---

**Версия документа:** 1.0  
**Последнее обновление:** 2025-11-22

