# Документация проекта ReactHome Daemon

**Дата создания:** 2025-12-12  
**Версия:** 2.0

> 📚 Полная документация проекта ReactHome Daemon — системы управления умным домом

---

## 🗂️ Структура документации

Документация организована в **14 тематических разделов** с порядковой нумерацией для удобной навигации:

### [00 — Метадокументация](./00-meta/README.md)

Документация о документации: стандарты, требования, глоссарий

- [Требования к документации](./00-meta/DOCUMENTATION_REQUIREMENTS.md) ⭐
- [Руководство для контрибьюторов](./00-meta/CONTRIBUTING.md)
- [Глоссарий терминов](./00-meta/GLOSSARY.md)

### [01 — Обзор проекта](./01-overview/README.md)

Общая информация, архитектура, начало работы

- [Описание проекта](./01-overview/PROJECT_DESCRIPTION.md) ⭐
- [Архитектура](./01-overview/ARCHITECTURE.md)
- [Начало работы](./01-overview/GETTING_STARTED.md)
- [Системные требования](./01-overview/SYSTEM_REQUIREMENTS.md)

### [02 — Быстрые старты](./02-quick-starts/README.md)

Практические руководства для быстрого начала

- [WebSocket Quick Start](./02-quick-starts/WEBSOCKET_QUICK_START.md)
- [Выполнение скриптов](./02-quick-starts/SCRIPT_EXECUTION_QUICK_START.md) ⭐
- [Лоджия](./02-quick-starts/QUICK_START_LODGIA.md)

### [03 — API Reference](./03-api-reference/README.md)

Справочники по всем API системы

- [WebSocket API Reference](./03-api-reference/websocket/WEBSOCKET_API_REFERENCE.md) ⭐
- [WebSocket Port 3000 Guide](./03-api-reference/websocket/WEBSOCKET_PORT_3000_GUIDE.md)
- [WebSocket Diagnostics](./03-api-reference/websocket/WEBSOCKET_DIAGNOSTICS_GUIDE.md)
- [RBUS API](./03-api-reference/rbus/README.md)
- [Modbus API](./03-api-reference/modbus/README.md)

### [04 — Архитектура](./04-architecture/README.md)

Архитектурные решения, компоненты, алгоритмы

- **ADR** (Architecture Decision Records)
  - [ADR-001: Event Logging System](./04-architecture/adr/001-event-logging-system.md)
  - [ADR-002: WebSocket Gateway](./04-architecture/adr/002-websocket-gateway.md)
- **Компоненты**
  - [Система логирования](./04-architecture/components/EVENT_LOGGING_SYSTEM.md)
  - [Термостаты](./04-architecture/components/THERMOSTAT_ARCHITECTURE.md)
  - [Doppler](./04-architecture/components/DOPPLER_ARCHITECTURE.md)
- **Алгоритмы**
  - [Конечные устройства](./04-architecture/algorithms/ENDPOINT_DEVICES_ALGORITHM.md)
  - [Привязка термостатов](./04-architecture/algorithms/THERMOSTAT_BINDING_ALGORITHM.md)

### [05 — Руководства](./05-guides/README.md)

Детальные инструкции по различным аспектам

- **Развёртывание**
  - [Deployment Guide](./05-guides/deployment/DEPLOYMENT_GUIDE.md)
  - [Удалённое управление Pi](./05-guides/deployment/MANAGE_REMOTE_ON_PI.md)
- **Эксплуатация**
  - [Мониторинг](./05-guides/operations/MONITORING_GUIDE.md)
  - [Резервное копирование](./05-guides/operations/BACKUP_GUIDE.md)
- **Разработка**
  - [Development Guide](./05-guides/development/DEVELOPMENT_GUIDE.md)
  - [Testing Guide](./05-guides/development/TESTING_GUIDE.md)
- **Решение проблем**
  - [DNS Troubleshooting](./05-guides/troubleshooting/DNS_TROUBLESHOOTING.md)
  - [WebSocket Troubleshooting](./05-guides/troubleshooting/WEBSOCKET_TROUBLESHOOTING.md)

### [06 — Устройства](./06-devices/README.md)

Документация по устройствам и протоколам

- [Принципы именования](./06-devices/naming/DEVICE_NAMING_PRINCIPLES.md)
- [Логика обновления статуса](./06-devices/DEVICE_STATUS_UPDATE_LOGIC.md)
- **Термостаты**
  - [Архитектура](./06-devices/thermostats/THERMOSTAT_ARCHITECTURE.md)
  - [Алгоритм привязки](./06-devices/thermostats/THERMOSTAT_BINDING_ALGORITHM.md)
- **Датчики**
  - [Целостность датчиков температуры](./06-devices/sensors/TEMPERATURE_SENSORS_INTEGRITY_ISSUES.md)
- **Актуаторы**
  - [Проблемы резолвинга](./06-devices/actuators/ACTUATOR_RESOLUTION_PROBLEM.md)
  - [Руководство по резолвингу](./06-devices/actuators/ACTUATOR_RESOLVING_GUIDE.md)

### [07 — Скрипты](./07-scripts/README.md)

Документация по скриптам и утилитам

- [Структура скриптов](./07-scripts/SCRIPTS_STRUCTURE.md) ⭐
- [Метаданные скриптов](./07-scripts/SCRIPT_METADATA.md)
- [Выполнение по коду](./07-scripts/SCRIPT_EXECUTION_BY_CODE.md)
- [Методология поиска](./07-scripts/SCRIPT_SEARCH_METHODOLOGY.md)

### [08 — Мониторинг](./08-monitoring/README.md)

Мониторинг, логирование, наблюдаемость

- **Наблюдаемость**
  - [План наблюдаемости](./08-monitoring/observability/Observability.Plan.md)
  - [Поиск trace-цепочек](./08-monitoring/observability/trace-chain-search.md)
- **Логирование**
  - [Система событийного логирования](./08-monitoring/logging/EVENT_LOGGING_SYSTEM.md) ⭐
  - [Gateway logging](./08-monitoring/logging/gateway-logging-guide.md)
- **Raspberry Pi**
  - [Быстрая проверка Pi](./08-monitoring/pi/MONITOR_PI_QUICK_CHECK.md)
  - [Аудит готовности Pi](./08-monitoring/pi/MONITOR_PI_READINESS_AUDIT.md)
- **Профилирование**
  - [CPU Profiling](./08-monitoring/profiling/CPU_PROFILING_GUIDE.md)
  - [Memory Leak Detection](./08-monitoring/profiling/MEMORY_LEAK_DETECTION.md)

### [09 — Операции](./09-operations/README.md)

Операционные руководства и процедуры

- **Runbooks**
  - [Incident Response](./09-operations/runbooks/INCIDENT_RESPONSE.md)
  - [Rollback Procedure](./09-operations/runbooks/ROLLBACK_PROCEDURE.md)
  - [Disaster Recovery](./09-operations/runbooks/DISASTER_RECOVERY.md)
- **ODR** (Operations Decision Records)
- **Процедуры**
  - [Backup Procedure](./09-operations/procedures/BACKUP_PROCEDURE.md)
  - [Update Procedure](./09-operations/procedures/UPDATE_PROCEDURE.md)

### [10 — Интеграции](./10-integration/README.md)

Интеграции с внешними системами

- [OpenSearch](./10-integration/opensearch/OPENSEARCH_CONNECTION.md)
- [Janus](./10-integration/janus/JANUS_INTEGRATION.md)
- **Уведомления**
  - [Apple Push Notifications](./10-integration/notifications/APNS_INTEGRATION.md)
  - [Firebase Cloud Messaging](./10-integration/notifications/FCM_INTEGRATION.md)

### [11 — Тестирование](./11-testing/README.md)

Тестирование и обеспечение качества

- [100% Coverage Goal](./11-testing/TEST_COVERAGE_100_PERCENT.md)
- [Анализ покрытия](./11-testing/TEST_COVERAGE_ANALYSIS.md)
- [Покрытие мониторинга](./11-testing/TEST_MONITOR_COVERAGE_ANALYSIS.md)

### [12 — Миграции](./12-migration/README.md)

Планы миграции между версиями

- [WebSocket Event Logging Migration](./12-migration/websocket/WEBSOCKET_EVENT_LOGGING_MIGRATION_PLAN.md)

### [13 — Примеры](./13-examples/README.md)

Практические примеры использования

- **Лоджия**
  - [Управление светом](./13-examples/lodgia/LODGIA_LIGHT_CONTROL_GUIDE.md)
  - [Скрипт "Спот"](./13-examples/lodgia/LODGIA_SPOT_SCRIPT.md)
- **WebSocket**
  - Примеры WebSocket-клиентов

### [14 — Устаревшее](./14-deprecated/README.md)

Устаревшие документы (для истории)

- [Проблемы бэкапов](./14-deprecated/BACKUP_SCRIPTS_PROBLEMS.md)
- [Проблемы восстановления БД](./14-deprecated/DB_COUNTING_RESTORE_PROBLEMS.md)

---

## 🚀 Быстрый старт

### Для новых разработчиков

1. **Начните с обзора:** [Описание проекта](./01-overview/PROJECT_DESCRIPTION.md)
2. **Изучите архитектуру:** [Архитектура](./01-overview/ARCHITECTURE.md)
3. **Запустите систему:** [Начало работы](./01-overview/GETTING_STARTED.md)
4. **Попробуйте примеры:** [Quick Starts](./02-quick-starts/README.md)

### Для интеграторов

1. **API Reference:** [WebSocket API](./03-api-reference/websocket/WEBSOCKET_API_REFERENCE.md)
2. **Quick Start:** [WebSocket Quick Start](./02-quick-starts/WEBSOCKET_QUICK_START.md)
3. **Примеры:** [Examples](./13-examples/README.md)

### Для контрибьюторов

1. **Прочитайте:** [Руководство для контрибьюторов](./00-meta/CONTRIBUTING.md)
2. **Изучите:** [Требования к документации](./00-meta/DOCUMENTATION_REQUIREMENTS.md)
3. **Ознакомьтесь:** [Глоссарий](./00-meta/GLOSSARY.md)

---

## 📋 Ключевые документы

### Обязательно к прочтению

1. [Описание проекта](./01-overview/PROJECT_DESCRIPTION.md) — Что такое ReactHome
2. [WebSocket API Reference](./03-api-reference/websocket/WEBSOCKET_API_REFERENCE.md) — Основной API
3. [Структура скриптов](./07-scripts/SCRIPTS_STRUCTURE.md) — Организация скриптов
4. [Система логирования](./08-monitoring/logging/EVENT_LOGGING_SYSTEM.md) — Событийное логирование

### Важные руководства

- [Требования к документации](./00-meta/DOCUMENTATION_REQUIREMENTS.md) — Стандарты документации
- [Руководство для контрибьюторов](./00-meta/CONTRIBUTING.md) — Как вносить вклад
- [Принципы именования устройств](./06-devices/naming/DEVICE_NAMING_PRINCIPLES.md) — Именование
- [CPU Profiling Guide](./08-monitoring/profiling/CPU_PROFILING_GUIDE.md) — Профилирование

---

## 🔍 Поиск документации

### По задачам

- **Подключиться к API** → [WebSocket Quick Start](./02-quick-starts/WEBSOCKET_QUICK_START.md)
- **Запустить скрипт** → [Script Execution Quick Start](./02-quick-starts/SCRIPT_EXECUTION_QUICK_START.md)
- **Решить проблему** → [Troubleshooting](./05-guides/troubleshooting/README.md)
- **Понять архитектуру** → [Architecture](./04-architecture/README.md)
- **Добавить устройство** → [Devices](./06-devices/README.md)

### По компонентам

- **WebSocket** → [03-api-reference/websocket/](./03-api-reference/websocket/)
- **RBUS** → [03-api-reference/rbus/](./03-api-reference/rbus/)
- **Термостаты** → [06-devices/thermostats/](./06-devices/thermostats/)
- **Скрипты** → [07-scripts/](./07-scripts/)
- **Мониторинг** → [08-monitoring/](./08-monitoring/)

---

## 📚 Дополнительные ресурсы

### Отчёты и аналитика

- [Отчёты](../reports/README.md) — Технические отчёты и анализ
- [Реестр устройств](../reports/device-registry/) — База данных устройств
- [Инциденты](../reports/incidents/) — Анализ инцидентов

### Код

- [Главный README](../README.md) — Корневой README проекта
- [Скрипты](../scripts/README.md) — Утилиты и скрипты
- [Тесты](../tests/integration/) — Интеграционные тесты

---

## 🛠️ Поддержка и вклад

### Нашли ошибку?

1. Проверьте [Issues](https://github.com/your-org/reacthome/issues)
2. Создайте новый Issue с описанием проблемы
3. Или отправьте Pull Request с исправлением

### Хотите помочь?

Прочитайте [Руководство для контрибьюторов](./00-meta/CONTRIBUTING.md)

---

## 📝 О документации

### Принципы

Документация ReactHome следует принципам:

- **DDD** — Ubiquitous Language во всех документах
- **Clean Code** — Ясность и простота изложения
- **GitOps** — Версионирование через Git
- **Актуальность** — Соответствие коду

Подробнее: [Требования к документации](./00-meta/DOCUMENTATION_REQUIREMENTS.md)

### История изменений

- **v2.0** (2025-12-12) — Рефакторинг структуры, 14 тематических разделов
- **v1.0** (2025-11-22) — Первая версия документации

---

## См. также

- [Главный README проекта](../README.md)
- [Отчёты и аналитика](../reports/README.md)
- [План рефакторинга документации](../reports/DOCUMENTATION_REFACTORING_PLAN.md)

---

**Версия:** 2.0  
**Последнее обновление:** 2025-12-12  
**Автор рефакторинга:** Жекин Ассистент

