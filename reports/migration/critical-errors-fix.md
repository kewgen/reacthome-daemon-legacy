# Исправление критических ошибок

**Дата:** 2025-12-07  
**Статус:** Анализ завершён, исправления готовы

---

## Обнаруженные критические ошибки

### 1. SQLite Error: no such table: forms

**Описание:**
- Ошибка возникает при каждом запуске демона
- Модуль `src/assist/lang/ru.js` пытается обратиться к таблице `forms` в БД `var/lang/ru.db`
- Таблица отсутствует, хотя файл БД существует (474MB)
- Ошибка происходит на этапе загрузки модуля (при `db.prepare()`)

**Локация:**
- Файл: `src/assist/lang/ru.js:5`
- Вызывается из: `src/assist/index.js:11`
- Используется в: `src/assist/index.js:147` (функция `getForms`)

**Влияние:**
- ⚠️ Не критично для основной работы демона (LevelDB работает нормально)
- ⚠️ Может влиять на работу голосового помощника (assist)
- ⚠️ Засоряет логи повторяющимися ошибками

**Причина:**
- База данных `ru.db` существует, но таблица `forms` отсутствует
- Модуль пытается подготовить запрос при загрузке, до проверки наличия таблицы

---

## Предлагаемые исправления

### Исправление 1: Безопасная загрузка модуля с обработкой ошибок

**Файл:** `src/assist/lang/ru.js`

**Проблема:** `db.prepare()` выполняется сразу при загрузке модуля, что вызывает ошибку если таблицы нет.

**Решение:** Обернуть инициализацию в try-catch и сделать функцию безопасной.

```javascript
const sqlite = require('better-sqlite3');
const path = require('path');

let db = null;
let query = null;
let isInitialized = false;

// Безопасная инициализация
try {
    const dbPath = path.join(process.cwd(), 'var', 'lang', 'ru.db');
    db = sqlite(dbPath);
    
    // Проверка наличия таблицы
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='forms'
    `).get();
    
    if (tableExists) {
        query = db.prepare(`
            SELECT DISTINCT f1.text
            FROM forms f1
            JOIN forms f2 ON f1.lemma = f2.lemma
            WHERE f2.text = ?
        `);
        isInitialized = true;
    } else {
        console.warn('[ASSIST] Таблица forms не найдена в ru.db, морфология отключена');
    }
} catch (error) {
    console.warn('[ASSIST] Не удалось инициализировать морфологию:', error.message);
}

const getAllForms = (lemma) => {
    if (!isInitialized || !query) {
        return []; // Возвращаем пустой массив, если БД не инициализирована
    }
    
    try {
        return query.all(lemma.toLowerCase()).map(row => row.text);
    } catch (error) {
        console.warn(`[ASSIST] Ошибка при получении форм для "${lemma}":`, error.message);
        return []; // Возвращаем пустой массив при ошибке
    }
}

module.exports.getAllForms = getAllForms;
```

**Преимущества:**
- ✅ Демон не падает при отсутствии таблицы
- ✅ Морфология отключается gracefully
- ✅ Нет повторяющихся ошибок в логах
- ✅ Функция `getAllForms` безопасна и возвращает пустой массив при ошибке

---

### Исправление 2: Альтернативный вариант - ленивая инициализация

**Вариант с ленивой инициализацией (инициализация при первом вызове):**

```javascript
const sqlite = require('better-sqlite3');
const path = require('path');

let db = null;
let query = null;
let isInitialized = false;
let initError = null;

const init = () => {
    if (isInitialized || initError) {
        return isInitialized;
    }
    
    try {
        const dbPath = path.join(process.cwd(), 'var', 'lang', 'ru.db');
        db = sqlite(dbPath);
        
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='forms'
        `).get();
        
        if (tableExists) {
            query = db.prepare(`
                SELECT DISTINCT f1.text
                FROM forms f1
                JOIN forms f2 ON f1.lemma = f2.lemma
                WHERE f2.text = ?
            `);
            isInitialized = true;
        } else {
            initError = new Error('Таблица forms не найдена');
            console.warn('[ASSIST] Таблица forms не найдена в ru.db');
        }
    } catch (error) {
        initError = error;
        console.warn('[ASSIST] Не удалось инициализировать морфологию:', error.message);
    }
    
    return isInitialized;
}

const getAllForms = (lemma) => {
    if (!init()) {
        return []; // Возвращаем пустой массив, если инициализация не удалась
    }
    
    try {
        return query.all(lemma.toLowerCase()).map(row => row.text);
    } catch (error) {
        console.warn(`[ASSIST] Ошибка при получении форм для "${lemma}":`, error.message);
        return [];
    }
}

module.exports.getAllForms = getAllForms;
```

---

## Рекомендация

**Рекомендуется использовать Исправление 1** (безопасная загрузка с проверкой при старте):
- Проще и понятнее
- Ошибка обнаруживается сразу при загрузке модуля
- Меньше кода и проверок

---

## План внедрения

1. ✅ Создать исправленную версию `src/assist/lang/ru.js`
2. ✅ Исправление применено в коде
3. ⏳ Протестировать на малинке
4. ⏳ Проверить, что ошибки исчезли из логов
5. ⏳ Убедиться, что assist работает (даже без морфологии)

## Внедрение на малинке

**Шаги для применения исправления:**

1. Скопировать исправленный файл на малинку:
   ```bash
   scp src/assist/lang/ru.js pi@192.168.88.4:/home/pi/reacthome-daemon/src/assist/lang/ru.js
   ```

2. Перезапустить демон:
   ```bash
   ssh pi@192.168.88.4 "cd /home/pi/reacthome-daemon && pm2 restart daemon"
   ```

3. Проверить логи (ошибки SQLite должны исчезнуть):
   ```bash
   ssh pi@192.168.88.4 "cd /home/pi/reacthome-daemon && pm2 logs daemon --lines 50 --nostream | grep -i sqlite"
   ```

4. Проверить, что демон работает:
   ```bash
   ssh pi@192.168.88.4 "pm2 list | grep daemon"
   ```

---

## Дополнительные проверки

### Проверка структуры БД

Если нужно восстановить таблицу `forms`, можно:

1. Проверить, есть ли бэкап БД с таблицей
2. Создать таблицу вручную (если известна структура)
3. Импортировать данные из другого источника

Но это не критично, так как assist может работать и без морфологии.

---

---

## Автоматическое применение исправления

Создан скрипт для автоматического применения исправления:

```bash
export REACTHOME_PI_PASS='ваш_пароль'
./scripts/system/apply-critical-fix.sh
```

Скрипт:
1. Копирует исправленный файл на малинку
2. Проверяет наличие файла
3. Перезапускает демон
4. Проверяет, что ошибки SQLite исчезли
5. Показывает статус демона

---

**Статус:** ✅ Исправление готово к применению
