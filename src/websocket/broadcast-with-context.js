/**
 * Wrapper для broadcast() который автоматически добавляет _context из AsyncLocalStorage
 * Минимально инвазивное решение - не требует изменений в существующем коде
 */

const { broadcast: originalBroadcast } = require('./peer');

// Попытка загрузить модуль контекста
let contextModule = null;
try {
  contextModule = require('../logging/context');
} catch (e) {
  // Модуль не найден - будем работать без контекста
}

/**
 * Обёртка для broadcast() с автоматическим добавлением _context
 * @param {Object} message - Сообщение для отправки
 * @param {string} ignore - Session ID для игнорирования
 */
function broadcastWithContext(message, ignore) {
  // Получаем контекст из AsyncLocalStorage если доступен
  if (contextModule && contextModule.getStore) {
    const context = contextModule.getStore();
    if (context && message && typeof message === 'object') {
      // Добавляем _context к сообщению если его ещё нет
      if (!message._context) {
        message._context = context;
      }
    }
  }
  
  // Вызываем оригинальный broadcast
  return originalBroadcast(message, ignore);
}

module.exports = {
  broadcast: broadcastWithContext,
  // Экспортируем оригинал на случай если нужен
  originalBroadcast
};

