/**
 * Модуль для управления контекстом выполнения (trace_id, trigger info)
 * Использует AsyncLocalStorage для передачи контекста через async call stack
 */

const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Запускает функцию с заданным контекстом
 * @param {Object} context - Контекст выполнения {trace_id, type, ref, ...}
 * @param {Function} fn - Функция для выполнения
 * @returns {*} Результат выполнения функции
 */
function run(context, fn) {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Получает текущий контекст
 * @returns {Object|undefined} Контекст или undefined если не задан
 */
function getStore() {
  return asyncLocalStorage.getStore();
}

/**
 * Обновляет текущий контекст (добавляет/изменяет поля)
 * @param {Object} updates - Поля для обновления
 * @returns {Object} Обновлённый контекст
 */
function updateStore(updates) {
  const current = getStore() || {};
  const updated = { ...current, ...updates };
  // Нельзя обновить существующий store, но можно вернуть новый объект
  // Вызывающий код должен использовать run() с новым контекстом
  return updated;
}

module.exports = {
  run,
  getStore,
  updateStore,
  asyncLocalStorage
};

