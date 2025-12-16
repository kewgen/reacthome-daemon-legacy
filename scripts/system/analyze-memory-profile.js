#!/usr/bin/env node

/**
 * Анализ профиля памяти
 * 
 * Использование:
 *   node scripts/system/analyze-memory-profile.js <profile.json>
 */

const fs = require('fs');
const path = require('path');

const profileFile = process.argv[2];

if (!profileFile || !fs.existsSync(profileFile)) {
  console.error('❌ Ошибка: файл профиля не указан или не существует');
  console.error('Использование: node analyze-memory-profile.js <profile.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(profileFile, 'utf8'));

if (!Array.isArray(data)) {
  console.error('❌ Ошибка: неверный формат профиля (ожидается массив)');
  process.exit(1);
}

if (data.length === 0) {
  console.error('❌ Ошибка: профиль пуст');
  process.exit(1);
}

console.log('📊 Анализ профиля памяти');
console.log('='.repeat(60));
console.log(`📁 Файл: ${profileFile}`);
console.log(`📈 Записей: ${data.length}`);
console.log(`⏱️  Период: ${((data[data.length - 1].timestamp - data[0].timestamp) / 1000).toFixed(1)} секунд`);
console.log('');

// Анализ RSS (физическая память)
const rssValues = data.map(d => d.vmRSS);
const minRSS = Math.min(...rssValues);
const maxRSS = Math.max(...rssValues);
const avgRSS = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;
const medianRSS = rssValues.sort((a, b) => a - b)[Math.floor(rssValues.length / 2)];

console.log('📈 Статистика RSS (физическая память):');
console.log(`   Минимум:    ${(minRSS / 1024).toFixed(2)}MB`);
console.log(`   Максимум:   ${(maxRSS / 1024).toFixed(2)}MB`);
console.log(`   Среднее:    ${(avgRSS / 1024).toFixed(2)}MB`);
console.log(`   Медиана:    ${(medianRSS / 1024).toFixed(2)}MB`);
console.log(`   Разница:    ${((maxRSS - minRSS) / 1024).toFixed(2)}MB`);
console.log(`   Рост:       ${((maxRSS - minRSS) / minRSS * 100).toFixed(2)}%`);
console.log('');

// Анализ VmSize (виртуальная память)
const vmSizeValues = data.map(d => d.vmSize);
const minVmSize = Math.min(...vmSizeValues);
const maxVmSize = Math.max(...vmSizeValues);
const avgVmSize = vmSizeValues.reduce((a, b) => a + b, 0) / vmSizeValues.length;

console.log('📈 Статистика VmSize (виртуальная память):');
console.log(`   Минимум:    ${(minVmSize / 1024).toFixed(2)}MB`);
console.log(`   Максимум:   ${(maxVmSize / 1024).toFixed(2)}MB`);
console.log(`   Среднее:    ${(avgVmSize / 1024).toFixed(2)}MB`);
console.log(`   Разница:    ${((maxVmSize - minVmSize) / 1024).toFixed(2)}MB`);
console.log('');

// Поиск пиков памяти
const rssGrowth = [];
for (let i = 1; i < data.length; i++) {
  const growth = data[i].vmRSS - data[i - 1].vmRSS;
  rssGrowth.push({ index: i, growth, timestamp: data[i].timestamp });
}

const topGrowth = rssGrowth
  .sort((a, b) => b.growth - a.growth)
  .slice(0, 5);

console.log('🔺 Топ-5 моментов роста памяти:');
topGrowth.forEach((item, idx) => {
  const time = new Date(item.timestamp).toLocaleTimeString();
  console.log(`   ${idx + 1}. +${(item.growth / 1024).toFixed(2)}MB в ${time}`);
});
console.log('');

// Анализ тренда
const firstHalf = rssValues.slice(0, Math.floor(rssValues.length / 2));
const secondHalf = rssValues.slice(Math.floor(rssValues.length / 2));
const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
const trend = avgSecond - avgFirst;

console.log('📉 Тренд памяти:');
if (trend > 1024) {
  console.log(`   ⚠️  Рост памяти: +${(trend / 1024).toFixed(2)}MB (возможна утечка)`);
} else if (trend < -1024) {
  console.log(`   ✅ Снижение памяти: ${(trend / 1024).toFixed(2)}MB`);
} else {
  console.log(`   ✅ Стабильное потребление: ${(Math.abs(trend) / 1024).toFixed(2)}MB`);
}
console.log('');

// Рекомендации
console.log('💡 Рекомендации:');
if ((maxRSS - minRSS) / 1024 > 50) {
  console.log('   ⚠️  Большой разброс памяти (>50MB) - возможна утечка памяти');
}
if (trend > 1024 * 10) {
  console.log('   ⚠️  Значительный рост памяти - требуется оптимизация');
}
if (maxRSS / 1024 > 200) {
  console.log('   ⚠️  Высокое потребление памяти (>200MB) - рассмотрите оптимизацию');
}
if ((maxRSS - minRSS) / 1024 < 5 && trend < 1024) {
  console.log('   ✅ Стабильное потребление памяти - оптимизация не требуется');
}
console.log('');

