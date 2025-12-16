# ⚡ Быстрая проверка готовности monitor.js для Raspberry Pi

**Дата:** 2025-12-12  
**Версия скрипта:** src/monitor.js (4477 строк)  
**Статус:** ⚠️ **Требуется 1 действие перед первым запуском**

---

## 🎯 Краткий результат

### ✅ Готово из коробки
- Node.js v20.19.2 (требуется 18+)
- WebSocket клиент `ws` (уже в dependencies)
- Встроенные модули (`fs`, `path`, `child_process`)
- База данных НЕ НУЖНА (работает только через WebSocket)
- Логи создаются автоматически
- Дефолтные значения для всех переменных окружения

### ⚠️ Требуется установить
```bash
npm install terminal-kit
```

### ℹ️ Опционально (для копирования)
```bash
# Для буфера обмена на Linux
sudo apt install xclip
```

---

## 📝 Быстрый старт на Raspberry Pi

### 1. Подготовка (один раз)
```bash
cd ~/reacthome
npm install terminal-kit
```

### 2. Запуск
```bash
# Локальное подключение (дефолт)
node src/monitor.js

# С указанием параметров
LOCATION_NAME="Квартира" REACTHOME_WS_URI=ws://localhost:3000 node src/monitor.js
```

---

## 🔍 Детальная проверка

### Node.js
- ✅ Требуется: 18+
- ✅ Установлено: v20.19.2
- ✅ Синтаксис: Корректен

### NPM зависимости
| Пакет | Статус | Действие |
|-------|--------|----------|
| `terminal-kit` | ❌ Отсутствует | `npm install terminal-kit` |
| `ws` | ✅ Установлен | — |
| `fs`, `path`, `child_process` | ✅ Встроенные | — |

### Переменные окружения
| Переменная | Обязательна | Дефолт | Описание |
|------------|-------------|--------|----------|
| `REACTHOME_WS_URI` | Нет | `ws://localhost:3000` | WebSocket сервер |
| `LOCATION_NAME` | Нет | `Локация` | Название локации в заголовке |
| `WS_REQUEST_LOGGING` | Нет | `false` | Логирование запросов |
| `WS_LOG_DIR` | Нет | `./logs` | Директория логов |

### Системные команды
| Команда | Назначение | Обязательна | Fallback |
|---------|------------|-------------|----------|
| `xclip` или `xsel` | Буфер обмена (Linux) | Нет | ✅ Есть (silent fail) |
| `pbcopy` | Буфер обмена (macOS) | Нет | N/A |
| `clip` | Буфер обмена (Windows) | Нет | N/A |

### Файловая система
- ✅ Логи: `./logs/` (создается автоматически)
- ✅ База данных: НЕ ИСПОЛЬЗУЕТСЯ
- ✅ Конфиги: НЕ ТРЕБУЮТСЯ

### Сеть
- ✅ WebSocket клиент (только исходящие подключения)
- ✅ Порт: Не слушает порты (только клиент)
- ✅ Firewall: Не требуется настройка

---

## 🚀 Команды для копирования

### Установка terminal-kit
```bash
cd ~/reacthome
npm install terminal-kit
```

### Установка xclip (опционально)
```bash
sudo apt install xclip
```

### Тестовый запуск
```bash
# Проверка синтаксиса
node -c src/monitor.js

# Запуск с локальным WebSocket
node src/monitor.js

# Запуск с параметрами
LOCATION_NAME="Дом" node src/monitor.js
```

---

## 📊 Проверка зависимостей

### Проверить наличие terminal-kit
```bash
npm list terminal-kit
```

**Ожидается:**
```
reacthome-daemon@1.0.0
└── terminal-kit@x.x.x
```

**Если отсутствует:**
```
reacthome-daemon@1.0.0
└── (empty)
```

### Проверить Node.js
```bash
node --version
```

**Должно быть:** v18.0.0 или выше

---

## ⚙️ Настройка переменных окружения

### Временная настройка (на текущую сессию)
```bash
export LOCATION_NAME="Квартира"
export REACTHOME_WS_URI="ws://localhost:3000"
node src/monitor.js
```

### Постоянная настройка (в ~/.bashrc)
```bash
echo 'export LOCATION_NAME="Квартира"' >> ~/.bashrc
echo 'export REACTHOME_WS_URI="ws://localhost:3000"' >> ~/.bashrc
source ~/.bashrc
```

### Настройка через PM2 (ecosystem.config.js)
```javascript
{
  name: 'monitor',
  script: 'src/monitor.js',
  env: {
    LOCATION_NAME: 'Квартира',
    REACTHOME_WS_URI: 'ws://localhost:3000'
  }
}
```

---

## 🐛 Диагностика проблем

### Проблема: "Cannot find module 'terminal-kit'"
**Решение:**
```bash
npm install terminal-kit
```

### Проблема: "WebSocket connection failed"
**Проверка:**
```bash
# Проверить, что daemon запущен
pm2 status

# Проверить порт 3000
netstat -tlnp | grep 3000

# Проверить переменную окружения
echo $REACTHOME_WS_URI
```

### Проблема: "Копирование не работает"
**Решение:**
```bash
# Установить xclip
sudo apt install xclip

# Или использовать альтернативу
sudo apt install xsel
```

### Проблема: "Permission denied" при создании логов
**Решение:**
```bash
# Создать директорию вручную
mkdir -p logs
chmod 755 logs
```

---

## 📚 Полная документация

Подробная документация находится внутри скрипта:
- Строки 1-450: Полное описание архитектуры, типов устройств, алгоритмов
- Строки 283-340: Системные требования и зависимости
- Строки 341-400: Чеклист тестирования

Открыть документацию:
```bash
head -450 src/monitor.js | less
```

---

## ✅ Финальный чеклист

Перед первым запуском на новой Raspberry Pi:

- [ ] Node.js v18+ установлен (`node --version`)
- [ ] terminal-kit установлен (`npm install terminal-kit`)
- [ ] (Опционально) xclip установлен для копирования
- [ ] WebSocket сервер (daemon) запущен (`pm2 status`)
- [ ] Переменные окружения настроены (или используются дефолты)

**После выполнения чеклиста:** Скрипт готов к запуску! 🎉

```bash
node src/monitor.js
```

---

## 📞 Контакты

**Автор:** Жекин Ассистент  
**Дата создания:** 2025-12-12  
**Версия скрипта:** 4477 строк  
**Статус:** ⚠️ Требуется `npm install terminal-kit`



