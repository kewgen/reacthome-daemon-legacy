const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Тесты на выравнивание "иконка + название" в центральной таблице monitor.js
 *
 * Зачем: в monitor.js раньше была логика:
 *   term(icon); term('  ')
 * которая предполагала ширину иконки = 2 клетки.
 * На некоторых терминалах часть символов/иконок имеет ширину 1 клетку,
 * из-за чего текст в колонке "Название" смещался ("прыгал") относительно иконки.
 *
 * В monitor.js это исправлено через расчет паддинга:
 *   pad = iconSpace - getTerminalIconVisualWidth(icon)
 *
 * Здесь тестируем именно расчет паддинга, чтобы регресс не вернулся.
 */

// Копия эвристики из src/monitor.js (getTerminalIconVisualWidth)
function getTerminalIconVisualWidth(icon) {
  if (!icon) return 0;
  return icon.length > 1 ? 2 : 1;
}

function getIconPadding(icon, iconSpace = 4) {
  const w = getTerminalIconVisualWidth(icon);
  return Math.max(0, iconSpace - w);
}

test('icon padding: empty icon fills the whole iconSpace', () => {
  assert.equal(getTerminalIconVisualWidth(''), 0);
  assert.equal(getIconPadding('', 4), 4);
  assert.equal(getTerminalIconVisualWidth(null), 0);
  assert.equal(getIconPadding(null, 4), 4);
});

test('icon padding: 1-cell icon gets 3 spaces for iconSpace=4', () => {
  assert.equal(getTerminalIconVisualWidth('A'), 1);
  assert.equal(getIconPadding('A', 4), 3);
});

test('icon padding: 2-cell emoji icon gets 2 spaces for iconSpace=4', () => {
  // surrogate-pair emoji (length > 1) should be treated as 2-cell
  assert.equal('🔌'.length > 1, true);
  assert.equal(getTerminalIconVisualWidth('🔌'), 2);
  assert.equal(getIconPadding('🔌', 4), 2);
});

test('icon padding: emoji+variation selector still treated as 2-cell', () => {
  // "⚙️" is often 2 codepoints (symbol + variation selector)
  assert.equal('⚙️'.length > 1, true);
  assert.equal(getTerminalIconVisualWidth('⚙️'), 2);
  assert.equal(getIconPadding('⚙️', 4), 2);
});

test('icon padding keeps name start column stable (iconWidth + pad == iconSpace)', () => {
  const iconSpace = 4;
  const icons = ['', 'A', '🔌', '⚙️'];
  for (const icon of icons) {
    const w = getTerminalIconVisualWidth(icon);
    const pad = getIconPadding(icon, iconSpace);
    assert.equal(w + pad, iconSpace);
  }
});


