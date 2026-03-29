# Runbook: Пошаговое применение шаблона

**Цель:** Применение шаблона с паузой после каждого логического шага. Агент выполняет шаг → показывает результат → получает подтверждение в чате → продолжает или останавливается для фикса.

**Правило для агента:** `.cursor/rules/apply-template-step-debug.mdc`

**Важно:** 1 шаг = 1 сущность (создание + добавление). Один шаг может содержать несколько WebSocket-запросов. Например: shell SET + shell ADD = 2 запроса, но 1 шаг.

## Флаги

- `--reuse-unused` — переиспользовать неиспользуемые скрипты (из реестра `data/unused-scripts-registry.json` или с "del" в title/code). По умолчанию: всегда создавать новые скрипты.
- Реестр: `scripts/ws-find-unused-scripts.js --save-registry` — запись в `scenario-templates/data/unused-scripts-registry.json`.

## Порядок шагов (соблюдать последовательность)

Один шаг = создание сущности + добавление (2+ запросов):

| Шаг | Сущность | Запросы |
|-----|----------|---------|
| Shell | SET + ADD в project | 2 |
| Script | SET (пустой) + ADD в site + Channel UPDATE (если bindings) | **3** при bindings |
| Action | ACTION_SET action + ACTION_SET script (добавить в action[]) | 2 |

Скрипт создаётся пустым; экшены добавляются на следующих шагах — устраняет orphaned-экшены при `execute-one` в изоляции.

**Биндинг (обязательно при bindings):** Шаги скриптов должны содержать 3-ю часть — ACTION_SET канала (onClick/onHold). Требуется `--map=sourceDeviceId:targetDeviceId`; для MAC используйте `::` или формат `50:35:cc:2d:8e:fe:50:85:48:15:00:f1` (12 hex-частей). Тест: `testBuildPlanScriptStepsWithBinding`.

**Важное правило:** Сразу после создания скрипта следующими шагами добавлять его во все запланированные привязки (кнопки, каналы), а не откладывать на конец. Для muzyka: после каждого script-блока — ACTION_SET channel с накопленными onClick/onHold.

## Процесс

1. Запустить шаг 1:
   ```bash
   node scenario-templates/scripts/apply-template.js --template=X --site-name=Y --step --execute-one=1
   ```
2. Проверить логи: `tail -20 logs/scenario-templates-apply.log` — наличие `ws_send` и `ws_get_result`.
3. **ВСЕГДА выводить полное тело созданного или обновлённого объекта** — результат GET без сокращений.
4. **ВСЕГДА выводить сравнительный анализ:** таблица по полям «шаблон | ожидание | результат | статус».
5. Вывести результат пользователю (команда, полное тело GET, таблица сравнения, STEP_DONE N).
6. Спросить: «Шаг N выполнен. Подтвердить? (y/n/стоп, замечания)».
7. Если **y** — запустить шаг N+1:
   ```bash
   node scenario-templates/scripts/apply-template.js --template=X --site-name=Y --step --from-step=N+1 --execute-one=N+1
   ```
8. Если **стоп** / замечание — сохранить текущий шаг, исправить, затем продолжить:
   ```bash
   node scenario-templates/scripts/apply-template.js --template=X --site-name=Y --step --from-step=N --execute-one=N
   ```
9. Повторять до конца (STEP_DONE совпадает с общим количеством логических шагов, не WebSocket-запросов).

## Маркер

Скрипт выводит `STEP_DONE N` в конце вывода шага. Использовать для парсинга и проверки успешности.

## Валидация

Перед применением шаблон проходит валидацию. При ошибках (цикл, маппинг и т.п.) шаги не выполняются. Исправить параметры (--map, --skip-cycle-check) и повторить.

При ошибке «Валидация payload экшенов не пройдена» — удалить кеш и пересобрать план:

```bash
rm logs/apply-plan-step.json
# затем apply с шага 1 — план пересоберётся с актуальной логикой copy-actions
```

После изменений в `scripts/lib/copy-actions/*` — удалить кеш (`logs/apply-plan-step.json`), иначе при `--step` будет загружаться старый план.
