#!/usr/bin/env node

/**
 * Тест гипотезы 2: Частичные обновления каналов без поля `bind`
 * 
 * Гипотеза: Каналы часто приходят через WebSocket с частичными payload,
 * в которых отсутствует поле `bind`.
 * 
 * Что проверяет:
 * - Процент обновлений каналов, содержащих поле `bind`
 * - Частота частичных обновлений без `bind`
 * - Корреляция между наличием `_context` и отсутствием `bind`
 * 
 * Использование:
 *   node tests/integration/test-hypothesis-2-partial-updates-without-bind.js [ws://host:port]
 * 
 * Зачем: Проверяем, что значительная часть обновлений каналов не содержит `bind`,
 * что подтверждает гипотезу проблемы
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || process.argv[2] || 'ws://192.168.88.4:3000';
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT) || 60000; // Зачем: Увеличенный таймаут для сбора статистики
const COLLECTION_DURATION = 45000; // Зачем: Время сбора обновлений

class Hypothesis2Test {
  constructor() {
    this.ws = null;
    this.channelUpdates = new Map(); // channelId -> Array<{hasContext, hasBind, bind, timestamp}>
    this.actuators = [];
    this.channelIds = new Set();
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('='.repeat(80));
      console.log('🧪 ТЕСТ ГИПОТЕЗЫ 2: Частичные обновления каналов без поля `bind`');
      console.log('='.repeat(80));
      console.log(`WebSocket URI: ${WS_URI}`);
      console.log(`Длительность сбора: ${COLLECTION_DURATION / 1000} секунд\n`);

      const timeout = setTimeout(() => {
        this.analyzeResults();
        clearTimeout(timeout);
        if (this.ws) this.ws.close();
        resolve();
      }, TEST_TIMEOUT);

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let listReceived = false;
      let getSent = false;
      let collectionStarted = false;

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket ошибка: ${error.message}`));
      });

      ws.on('open', () => {
        console.log('✅ Подключено к WebSocket\n');
        console.log('📤 [STEP 1] Отправляем LIST для получения списка устройств...');
        ws.send(JSON.stringify({ type: 'list' }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Зачем: Обрабатываем LIST
          if ((message.type === 'list' || message.type === 'LIST') && !listReceived) {
            listReceived = true;
            const stateList = message.state || [];
            const deviceIds = stateList.map(([id]) => id).filter(Boolean);
            
            console.log(`✅ [STEP 1] Получен LIST: ${deviceIds.length} устройств\n`);
            
            // Зачем: Запрашиваем устройства и их каналы
            console.log('📤 [STEP 2] Запрашиваем устройства и каналы актуаторов...');
            getSent = true;
            
            // Зачем: Сначала запрашиваем устройства для определения актуаторов
            ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
            
            // Зачем: Устанавливаем таймаут для запроса каналов
            setTimeout(() => {
              this.requestActuatorChannels(ws);
              
              // Зачем: Начинаем сбор обновлений
              setTimeout(() => {
                collectionStarted = true;
                console.log(`\n📊 [STEP 3] Начинаем сбор обновлений каналов (${COLLECTION_DURATION / 1000} секунд)...\n`);
              }, 5000);
            }, 10000);
          }

          // Зачем: Обрабатываем ACTION_SET для сбора статистики обновлений
          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const isChannel = deviceId.includes('/');
            
            if (isChannel && collectionStarted) {
              const payload = message.payload || {};
              const hasContext = !!message._context;
              const hasBindField = Object.prototype.hasOwnProperty.call(payload, 'bind');
              const bindValue = hasBindField ? payload.bind : null;
              
              if (!this.channelUpdates.has(deviceId)) {
                this.channelUpdates.set(deviceId, []);
              }
              
              this.channelUpdates.get(deviceId).push({
                hasContext,
                hasBindField,
                bind: bindValue,
                timestamp: Date.now(),
                payloadKeys: Object.keys(payload)
              });
            }
          }
        } catch (error) {
          console.error('Ошибка обработки сообщения:', error);
        }
      });
    });
  }

  // Зачем: Запрашиваем каналы актуаторов для мониторинга обновлений
  requestActuatorChannels(ws) {
    console.log('📤 Запрашиваем каналы актуаторов...');
    
    // Зачем: Собираем каналы из предыдущих сообщений
    const channelIds = Array.from(this.channelIds);
    if (channelIds.length > 0) {
      // Зачем: Запрашиваем каналы батчами по 50
      for (let i = 0; i < channelIds.length; i += 50) {
        const batch = channelIds.slice(i, i + 50);
        ws.send(JSON.stringify({ type: 'get', state: batch }));
      }
      console.log(`   Запрошено ${channelIds.length} каналов\n`);
    }
  }

  // Зачем: Анализируем результаты теста
  analyzeResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ');
    console.log('='.repeat(80) + '\n');

    const channels = Array.from(this.channelUpdates.keys());
    console.log(`📋 Собрано обновлений для ${channels.length} каналов\n`);

    if (channels.length === 0) {
      console.log('⚠️  Не получено обновлений каналов за время сбора.');
      console.log('   Возможные причины:');
      console.log('   - Каналы не были запрошены');
      console.log('   - Нет активных обновлений в системе');
      console.log('   - Недостаточно времени для сбора\n');
      return;
    }

    // Зачем: Собираем статистику
    let totalUpdates = 0;
    let updatesWithBind = 0;
    let updatesWithoutBind = 0;
    let updatesWithContext = 0;
    let updatesWithContextWithoutBind = 0;
    let updatesWithoutContext = 0;
    let updatesWithoutContextWithoutBind = 0;

    const channelStats = [];

    channels.forEach(channelId => {
      const updates = this.channelUpdates.get(channelId);
      if (!updates || updates.length === 0) return;

      const channelTotal = updates.length;
      const channelWithBind = updates.filter(u => u.hasBindField && u.bind !== null).length;
      const channelWithoutBind = updates.filter(u => !u.hasBindField || u.bind === null).length;
      const channelWithContext = updates.filter(u => u.hasContext).length;
      const channelWithContextWithoutBind = updates.filter(u => u.hasContext && (!u.hasBindField || u.bind === null)).length;
      const channelWithoutContext = updates.filter(u => !u.hasContext).length;
      const channelWithoutContextWithoutBind = updates.filter(u => !u.hasContext && (!u.hasBindField || u.bind === null)).length;

      totalUpdates += channelTotal;
      updatesWithBind += channelWithBind;
      updatesWithoutBind += channelWithoutBind;
      updatesWithContext += channelWithContext;
      updatesWithContextWithoutBind += channelWithContextWithoutBind;
      updatesWithoutContext += channelWithoutContext;
      updatesWithoutContextWithoutBind += channelWithoutContextWithoutBind;

      if (channelTotal > 0) {
        channelStats.push({
          channelId,
          total: channelTotal,
          withBind: channelWithBind,
          withoutBind: channelWithoutBind,
          withContext: channelWithContext,
          withContextWithoutBind: channelWithContextWithoutBind,
          withoutBindPercent: (channelWithoutBind / channelTotal * 100).toFixed(1)
        });
      }
    });

    // Зачем: Выводим общую статистику
    console.log('📊 Общая статистика обновлений:');
    console.log(`   Всего обновлений: ${totalUpdates}`);
    console.log(`   С полем bind: ${updatesWithBind} (${totalUpdates > 0 ? (updatesWithBind / totalUpdates * 100).toFixed(1) : 0}%)`);
    console.log(`   Без поля bind: ${updatesWithoutBind} (${totalUpdates > 0 ? (updatesWithoutBind / totalUpdates * 100).toFixed(1) : 0}%)\n`);

    console.log('📊 Статистика по наличию _context:');
    console.log(`   С _context: ${updatesWithContext} (${totalUpdates > 0 ? (updatesWithContext / totalUpdates * 100).toFixed(1) : 0}%)`);
    console.log(`   С _context БЕЗ bind: ${updatesWithContextWithoutBind} (${updatesWithContext > 0 ? (updatesWithContextWithoutBind / updatesWithContext * 100).toFixed(1) : 0}% от обновлений с _context)`);
    console.log(`   Без _context: ${updatesWithoutContext} (${totalUpdates > 0 ? (updatesWithoutContext / totalUpdates * 100).toFixed(1) : 0}%)`);
    console.log(`   Без _context БЕЗ bind: ${updatesWithoutContextWithoutBind} (${updatesWithoutContext > 0 ? (updatesWithoutContextWithoutBind / updatesWithoutContext * 100).toFixed(1) : 0}% от обновлений без _context)\n`);

    // Зачем: Выводим топ каналов по количеству обновлений без bind
    const topChannelsWithoutBind = channelStats
      .filter(s => s.withoutBind > 0)
      .sort((a, b) => b.withoutBind - a.withoutBind)
      .slice(0, 10);

    if (topChannelsWithoutBind.length > 0) {
      console.log('⚠️  Топ-10 каналов с обновлениями без bind:');
      topChannelsWithoutBind.forEach((stat, index) => {
        console.log(`   ${index + 1}. ${stat.channelId}:`);
        console.log(`      Всего: ${stat.total}, без bind: ${stat.withoutBind} (${stat.withoutBindPercent}%)`);
        console.log(`      С _context без bind: ${stat.withContextWithoutBind}`);
      });
      console.log('');
    }

    // Зачем: Формулируем вывод
    console.log('='.repeat(80));
    console.log('🎯 ВЫВОД');
    console.log('='.repeat(80) + '\n');

    const withoutBindPercent = totalUpdates > 0 ? (updatesWithoutBind / totalUpdates * 100) : 0;
    
    if (withoutBindPercent > 30) {
      console.log('✅ ГИПОТЕЗА ПОДТВЕРЖДЕНА:');
      console.log(`   ${withoutBindPercent.toFixed(1)}% обновлений каналов не содержат поле bind.`);
      console.log('   Это подтверждает проблему: каналы часто приходят с частичными payload.\n');
    } else if (withoutBindPercent > 10) {
      console.log('⚠️  ГИПОТЕЗА ЧАСТИЧНО ПОДТВЕРЖДЕНА:');
      console.log(`   ${withoutBindPercent.toFixed(1)}% обновлений каналов не содержат поле bind.`);
      console.log('   Проблема существует, но не критична.\n');
    } else {
      console.log('❓ ГИПОТЕЗА НЕ ПОДТВЕРЖДЕНА:');
      console.log(`   Только ${withoutBindPercent.toFixed(1)}% обновлений каналов не содержат поле bind.`);
      console.log('   Возможно, проблема решена или не проявляется в текущих условиях.\n');
    }

    if (updatesWithContextWithoutBind > 0) {
      const contextWithoutBindPercent = updatesWithContext > 0 
        ? (updatesWithContextWithoutBind / updatesWithContext * 100) 
        : 0;
      console.log(`📌 Дополнительно: ${contextWithoutBindPercent.toFixed(1)}% обновлений с _context не содержат bind.`);
      console.log('   Это указывает на то, что события изменений часто приходят без полного состояния.\n');
    }
  }
}

// Зачем: Запуск теста
async function main() {
  try {
    const test = new Hypothesis2Test();
    await test.run();
    console.log('✅ Тест завершён');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Тест провален:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { Hypothesis2Test };






