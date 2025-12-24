/**
 * Система мьютирования событий для OpenSearch.
 * 
 * Мьютирование позволяет записывать события в локальный файл (для дебага/аудита),
 * но не отправлять их в OpenSearch (для экономии места и уменьшения шума).
 * 
 * В отличие от фильтров, которые полностью игнорируют событие,
 * мьютеры позволяют гибко управлять видимостью данных в поисковом движке.
 */

/**
 * @typedef {Object} MuteRule
 * @property {string} id - Уникальный идентификатор правила
 * @property {string} name - Название правила
 * @property {string} description - Описание правила
 * @property {boolean} enabled - Включено ли правило
 * @property {Function} check - Функция проверки (возвращает true, если событие ДОЛЖНО быть мьютировано)
 */

// Порог по умолчанию для допплера (если не указан в устройстве)
const DEFAULT_DOPPLER_THRESHOLD = 0;

/**
 * Правило 1: Допплеровский шум
 * Мьютит сигналы допплера ниже порога срабатывания.
 */
const RULE_DOPPLER_NOISE = {
  id: 'doppler_noise',
  name: 'Допплеровский шум',
  description: 'Мьютить сигналы допплера ниже порога срабатывания (по умолчанию < 15)',
  enabled: true,
  check: (event) => {
    // Проверяем, что это параметр doppler
    if (event.param !== 'doppler') {
      return false;
    }

    // Значение должно быть числом
    const value = event.new;
    if (typeof value !== 'number') {
      return false;
    }

    // Зачем: получаем порог из метаданных устройства или используем дефолтный.
    // Это позволяет настраивать чувствительность индивидуально для каждого датчика.
    const threshold = event.device?.doppler_threshold || DEFAULT_DOPPLER_THRESHOLD;

    // Если значение ниже порога - это шум, мьютируем для OpenSearch
    return value < threshold;
  }
};

/**
 * Список всех правил мьютирования
 */
const MUTE_RULES = [
  RULE_DOPPLER_NOISE
];

/**
 * Проверить, должно ли событие быть мьютировано для OpenSearch
 * 
 * @param {Object} event - Событие для проверки
 * @returns {boolean} true, если событие должно быть мьютировано
 */
const shouldMuteOpenSearch = (event) => {
  for (const rule of MUTE_RULES) {
    if (rule.enabled) {
      try {
        if (rule.check(event)) {
          return true; // Первое же сработавшее правило мьютирует событие
        }
      } catch (err) {
        console.error(`[muters] Ошибка в правиле мьютирования ${rule.id}:`, err.message);
      }
    }
  }
  return false;
};

/**
 * Получить список всех правил
 */
const getRules = () => {
  return MUTE_RULES.map(rule => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled
  }));
};

/**
 * Включить/выключить правило мьютирования
 * 
 * @param {string} ruleId - ID правила
 * @param {boolean} enabled - Статус
 */
const setRuleEnabled = (ruleId, enabled) => {
  const rule = MUTE_RULES.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = enabled;
    console.log(`[muters] Правило мьютирования "${rule.name}" ${enabled ? 'включено' : 'выключено'}`);
  }
};

module.exports = {
  shouldMuteOpenSearch,
  getRules,
  setRuleEnabled,
  MUTE_RULES
};

