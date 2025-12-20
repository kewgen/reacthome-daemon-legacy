/**
 * Утилиты для метаданных события.
 *
 * Зачем: держим заполнение критичных полей (например, logger_pid) в одном месте,
 * чтобы не ловить регрессии и легко покрывать юнит‑тестами без запуска демона/PM2/OpenSearch.
 */

/**
 * Проставляет logger_pid, если он отсутствует или равен null/undefined.
 * Не мутирует исходный объект.
 *
 * @param {any} event
 * @param {number} pid
 * @returns {any}
 */
function ensureLoggerPid(event, pid) {
  if (!event || typeof event !== 'object') return event;
  if (event.logger_pid != null) return event; // Зачем: не перетираем уже заполненное значение
  return { ...event, logger_pid: pid };
}

module.exports = {
  ensureLoggerPid
};

