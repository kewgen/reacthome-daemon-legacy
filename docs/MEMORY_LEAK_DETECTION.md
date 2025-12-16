# Определение утечек памяти в Node.js сервисе

## Методы достоверного определения утечек памяти

### 1. Heap Snapshots (Снимки кучи) - ⭐ Самый надежный метод

**Зачем:** Позволяет точно увидеть, какие объекты занимают память и как они растут со временем.

**Как использовать:**

```bash
# Автоматический анализ с созданием нескольких snapshots
./scripts/system/detect-memory-leak.sh events 30

# Ручное создание snapshot
./scripts/system/profile-memory-heap-on-pi.sh events
```

**Анализ в Chrome DevTools:**

1. Откройте `chrome://inspect` в Chrome
2. Нажмите "Open dedicated DevTools for Node"
3. Перейдите на вкладку "Memory"
4. Нажмите "Load" и выберите файл `.heapsnapshot`
5. Для сравнения загрузите два snapshots и используйте "Comparison" view

**Что искать:**
- Объекты, которые растут между snapshots
- Большие объекты, которые не должны существовать
- Цепочки ссылок, удерживающие память

### 2. Heap Profiling (Профилирование выделения памяти)

**Зачем:** Показывает, где именно в коде происходит выделение памяти.

**Как использовать:**

```bash
# Запуск процесса с heap profiling
pm2 restart events --update-env --node-args="--inspect=0.0.0.0:9229"

# Подключение через Chrome DevTools
# chrome://inspect → Open dedicated DevTools → Memory → Record Allocation Timeline
```

**Анализ:**
- Записывайте timeline во время работы сервиса
- Останавливайте запись через некоторое время
- Ищите паттерны постоянного роста памяти

### 3. Мониторинг памяти в реальном времени

**Зачем:** Отслеживает динамику использования памяти.

**Как использовать:**

```bash
# Непрерывный мониторинг
./scripts/system/monitor-memory-continuous.sh events 5

# Профилирование за период времени
./scripts/system/profile-memory-on-pi.sh events 60

# Анализ результатов
node scripts/system/analyze-memory-profile.js /tmp/memory-profile-events-*.json
```

**Что искать:**
- Постоянный рост RSS (физической памяти)
- Рост Heap Used без снижения
- Разница между минимумом и максимумом > 50MB

### 4. Статистика V8 Heap

**Зачем:** Детальная информация о состоянии кучи V8.

**Как использовать:**

```bash
# Получение статистики
./scripts/system/profile-memory-heap-on-pi.sh events
```

**Метрики для анализа:**
- `total_heap_size` - общий размер кучи
- `used_heap_size` - используемая память
- `heap_size_limit` - лимит кучи
- `number_of_detached_contexts` - отключенные контексты (утечки!)

### 5. Самомониторинг в коде

**Зачем:** Встроенный мониторинг памяти прямо в приложении.

**Как использовать:**

```bash
# Добавление самомониторинга
./scripts/system/add-memory-self-monitoring-to-event-logger.sh

# Просмотр логов
pm2 logs events | grep "Memory Monitor"
```

**Метрики:**
- RSS (Resident Set Size) - физическая память
- Heap Used - используемая куча
- Размеры кэшей и структур данных

## Пошаговая инструкция для определения утечки

### Шаг 1: Подтверждение утечки

```bash
# Мониторинг в течение 30 минут
./scripts/system/monitor-memory-continuous.sh events 5
# Нажмите Ctrl+C через 30 минут

# Анализ: если RSS растет постоянно - есть утечка
```

### Шаг 2: Создание snapshots

```bash
# Автоматическое создание snapshots с интервалом
./scripts/system/detect-memory-leak.sh events 30
```

Это создаст:
- Базовый snapshot (t=0)
- Промежуточные snapshots (каждые 10 минут)
- Финальный snapshot (t=30 минут)

### Шаг 3: Анализ в Chrome DevTools

1. **Откройте Chrome DevTools:**
   ```
   chrome://inspect → Open dedicated DevTools
   ```

2. **Загрузите snapshots:**
   - Memory → Load → выберите первый snapshot
   - Load → выберите последний snapshot

3. **Сравните snapshots:**
   - Выберите последний snapshot
   - В выпадающем списке выберите "Comparison"
   - Выберите первый snapshot для сравнения

4. **Ищите растущие объекты:**
   - Сортировка по "Size Delta" (по убыванию)
   - Ищите объекты с большим положительным delta
   - Проверяйте цепочки ссылок (Retainer tree)

### Шаг 4: Определение источника

**Типичные источники утечек:**

1. **Незакрытые таймеры/интервалы:**
   ```javascript
   // Плохо
   setInterval(() => {}, 1000);
   
   // Хорошо
   const interval = setInterval(() => {}, 1000);
   clearInterval(interval);
   ```

2. **Незакрытые WebSocket соединения:**
   ```javascript
   // Плохо
   const ws = new WebSocket('ws://...');
   
   // Хорошо
   ws.on('close', () => { /* cleanup */ });
   ws.close();
   ```

3. **Растущие кэши без ограничений:**
   ```javascript
   // Плохо
   const cache = new Map();
   cache.set(key, value); // растет бесконечно
   
   // Хорошо
   if (cache.size > MAX_SIZE) {
     const firstKey = cache.keys().next().value;
     cache.delete(firstKey);
   }
   ```

4. **Замыкания, удерживающие большие объекты:**
   ```javascript
   // Плохо
   function createHandler(largeData) {
     return () => {
       // largeData удерживается в памяти
     };
   }
   
   // Хорошо
   function createHandler(largeData) {
     const smallData = extractNeeded(largeData);
     return () => {
       // используем только smallData
     };
   }
   ```

5. **Event listeners без удаления:**
   ```javascript
   // Плохо
   emitter.on('event', handler);
   
   // Хорошо
   emitter.on('event', handler);
   emitter.removeListener('event', handler);
   ```

### Шаг 5: Исправление и проверка

1. Исправьте найденные проблемы
2. Повторите анализ с новыми snapshots
3. Убедитесь, что память стабилизировалась

## Интерпретация результатов

### Нормальное поведение:
- RSS стабилен (±10MB колебания)
- Heap Used стабилен или циклически очищается
- Разница между min/max < 20MB

### Признаки утечки:
- RSS постоянно растет (>50MB за час)
- Heap Used постоянно растет
- Heap Total постоянно растет
- `number_of_detached_contexts` > 0
- Разница между snapshots показывает растущие объекты

### Критические признаки:
- RSS растет >100MB за час
- Процесс достигает лимита памяти
- Частые GC не помогают
- Процесс падает из-за нехватки памяти

## Инструменты и команды

### Быстрый старт:
```bash
# 1. Мониторинг (подтверждение утечки)
./scripts/system/monitor-memory-continuous.sh events 5

# 2. Детальный анализ (создание snapshots)
./scripts/system/detect-memory-leak.sh events 30

# 3. Анализ результатов
# Откройте Chrome DevTools и загрузите snapshots
```

### Дополнительные инструменты:

```bash
# Статистика heap
./scripts/system/profile-memory-heap-on-pi.sh events

# Профилирование за период
./scripts/system/profile-memory-on-pi.sh events 60

# Анализ профиля
node scripts/system/analyze-memory-profile.js /path/to/profile.json
```

## Рекомендации

1. **Регулярный мониторинг:** Запускайте мониторинг памяти регулярно
2. **Базовые snapshots:** Создавайте базовые snapshots после деплоя
3. **Сравнение:** Всегда сравнивайте snapshots до и после изменений
4. **Документация:** Фиксируйте результаты анализа в ADR
5. **Автоматизация:** Используйте самомониторинг для алертов

## Полезные ссылки

- [Chrome DevTools Memory Profiling](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)
- [V8 Heap Snapshot Format](https://github.com/v8/v8/blob/main/src/profiler/heap-snapshot-generator.cc)








