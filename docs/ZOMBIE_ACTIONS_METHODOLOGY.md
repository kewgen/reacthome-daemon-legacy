# Методика поиска зомби-экшенов

**Дата создания:** 2026-02-08  
**Связано с:** [SCRIPT_METADATA.md](./SCRIPT_METADATA.md)

## Определение

**Зомби-экшен** — объект в БД с типом `ACTION_*`, чей `id` не входит ни в один массив `script.action[]`. Такие экшены есть в БД, но не выполняются ни одним скриптом.

## Алгоритм определения

1. Собрать все объекты с `type.startsWith('ACTION_')` (или входящие в список типов экшенов).
2. Собрать множество использованных id: объединение `script.action[]` для всех скриптов.
3. **Зомби-экшен** = экшен, чей `id` не входит в множество использованных.

```
actionId ∈ script.action[]  →  используется
actionId ∉ any script.action[]  →  зомби
```

## Связь script ↔ action

| Связь | Где | Смысл |
|-------|-----|-------|
| **Владеет** | `script.action` → массив id экшенов | Скрипт содержит эти действия |
| **Принадлежит** | `action.script` → id скрипта | Указатель на скрипт-владельца до отвязки |

При удалении экшенов из скрипта (`delete-actions`) объекты ACTION_* остаются в БД — становятся зомби, если не используются другими скриптами.

## Инструменты

| Скрипт | Метод | Ограничение |
|--------|-------|-------------|
| `scripts/ws-find-zombie-actions.js` | WebSocket | Сервер УД (локально или Pi). Флаг `--report` → сохранение в `reports/ZOMBIE_ACTIONS_YYYY-MM-DD.md` |
| `scripts/check-orphaned-action-devices.js` | LevelDB | Только локальная БД (`DB_PATH`). Аналог для локальной отладки. |
| `scripts/ws-script-manager.js zombie-action <uuid>` | WebSocket | Резолвинг одного экшена: зомби или используется (+ в каких скриптах). |

## Использование

### Поиск всех зомби-экшенов

```bash
# Базовый запуск
node scripts/ws-find-zombie-actions.js

# С сохранением отчёта
node scripts/ws-find-zombie-actions.js --report

# Указание WebSocket
REACTHOME_WS_URI="ws://192.168.88.4:3000" node scripts/ws-find-zombie-actions.js
```

### Резолвинг одного экшена

```bash
node scripts/ws-script-manager.js zombie-action <uuid>
```

### Локальная проверка (LevelDB)

```bash
DB_PATH=/path/to/var/db node scripts/check-orphaned-action-devices.js
```

## Результат

- **Таблица:** UUID, type, script (владелец), payload.id (целевой объект).
- **Статистика:** всего ACTION_*, используются, зомби.

## См. также

- [SCRIPT_METADATA.md](./SCRIPT_METADATA.md) — структура скриптов и экшенов
- [script-chains skill](../.cursor/skills/script-chains/SKILL.md) — цепочки связей скриптов
