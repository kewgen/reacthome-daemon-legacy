# Индекс отчётов

Назначение: быстрый обзор исследовательских/аудиторских материалов. Новые отчёты размещаем здесь с одной строкой-резюме.

## Миграции и OpenSearch
- `migration-compliance-check.md` — сверка реализации WebSocket Event Logging с планом миграции (есть рекомендации по буферу/метрикам).
- `opensearch-schema-analysis-2025-12-12.md` — разбор схем и соответствия индексам.
- `2025-12-20-opensearch-events-lag.md` — причина задержек: шторм запросов/ретраев + `ERR_STREAM_PREMATURE_CLOSE`; фиксы: батчинг, таймауты, кеш mapping, защита от параллельных sendBatch.
- `2025-12-24-logger-connection-incident.md` — инцидент: остановка логгера из-за пропажи интернета; причина: "зомби" WebSocket-соединение (отсутствие Heartbeat); фикс: внедрен механизм ping/pong.
- `opensearch-config-check.md`, `opensearch-events-check.md`, `opensearch-events-fix*.md`, `opensearch-name-code-2025-12-10.md`, `opensearch-event-from-websocket-principle.md` — проверки конфигураций, событий и фиксы.

## Монитор/терминальный UI
- `monitor-improvements-2025-12-10.md` — план улучшений monitor.js.
- `monitor-js-insights-2025-12-10.md`, `monitor-js-study-2025-01-10.md` — анализ и обзор поведения monitor.js.
- `FEATURE_MONITOR_SUMMARY.md` — обзор функциональности мониторинга.

## Логи и безопасность
- `logging-system-implementation-2025-12-10.md`, `logs-audit.md`, `logs-audit-summary.md`, `logs-check-2025-12-10.md` — аудит и состояние логирования.
- `event-logger-security-audit-2025-12-10.md`, `websocket-logs-analysis.md`, `event-logger-websocket-requests-2025-12-10.md` — безопасность и трафик WebSocket.
- `websocket-context-fix-2025-12-10.md` — исправление контекста WebSocket.

## Бэкапы и БД
- `db-delete-operations-2025-12-10.md`, `db-recovery-plan-2025-12-10.md` — операции удаления и план восстановления.
- `var-backup-analysis.md`, `db-*copy*` отчёты — анализ бэкапов и копий.
- `leveldb-vs-websocket-data-2025-12-10.md` — сравнение данных БД и WebSocket.

## Устройства и параметры
- `device-fields-fix-2025-12-10.md`, `device-fields-resolving-2025-12-10.md`, `device-parameters-list-2025-12-10.md` — поля и параметры устройств.
- `device-types-s4-like-2025-01-10.md`, `session-field-explanation.md`, `site-field-empty-fix-2025-12-10.md` — типы устройств, поля session/site.

## Память и производительность
- `daemon-memory-leak-audit-2025-12-10.md`, `daemon-memory-leak-fix-2-2025-12-10.md`, `script-tracing-system-2025-12-10.md` — утечки памяти и трассировка.
- `tracing-system-enhancement-2025-12-10.md` — улучшения системы трассировки.
- `trace-chain-algorithm-implementation-2025-12-12.md` — реализация алгоритма построения цепочки срабатывания скриптов по trace_id.

## Сервис и инфраструктура
- `daemon-code-study-2025-01-10.md`, `server-audit-2025-01-10.md`, `study-reacthome-main-summary.md`, `project-study-2025-01-10.md` — обзоры кода и сервиса.
- `local-setup-report.md`, `SYNC_WITH_MAIN_2025-12-12.md`, `improvements-applied-2025-12-10.md`, `fix-missing-bind-import-2025-01-10.md` — локальная настройка, синхронизация, применённые фиксы.
- `logging-system-implementation-2025-12-10.md` — внедрение системы логирования.

## Как добавлять новый отчёт
1) Имя файла: `YYYY-MM-DD-<домен>-<тема>.md`.
2) Первая строка: цель и контекст.
3) Краткое резюме и действия (Action items) в начале файла.
4) Добавить запись в этот индекс с одной строкой-резюме.



