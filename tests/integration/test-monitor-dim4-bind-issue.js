#!/usr/bin/env node

/**
 * Тест, вскрывающий проблему с bind для каналов Dim4
 *
 * Проблема:
 * - Каналы Dim4 не запрашиваются при начальной загрузке (массовый GET)
 * - Дозапросы по каналам не возвращают bind
 * - UI показывает "(не привязан)" вместо реальных привязок
 *
 * Этот тест проверяет:
 * 1. Что каналы Dim4 имеют bind при прямом запросе
 * 2. Что массовый GET не включает каналы
 * 3. Что точечный GET по каналу должен вернуть bind, но не возвращает
 */

const WebSocket = require('ws');

// Зачем: Используем тот же URI, что и check-actuator-channels.js (боевой сервер)
const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const TEST_ACTUATOR_ID = '68:27:19:e4:49:19'; // Dim4
const TEST_TIMEOUT = 30000;

class Dim4BindIssueTest {
  constructor() {
    this.ws = null;
    this.messages = [];
    this.channelStates = new Map(); // channelId -> { payload, hasBind }
  }

  async run() {
    return new Promise((resolve, reject) => {
      console.log('🔍 Тест: Вскрытие проблемы с bind для каналов Dim4\n');

      const timeout = setTimeout(() => {
        reject(new Error(`Тест не завершился за ${TEST_TIMEOUT / 1000} секунд`));
      }, TEST_TIMEOUT);

      const ws = new WebSocket(WS_URI);
      this.ws = ws;

      let testPhase = 0; // 0: прямой запрос каналов, 1: массовый GET, 2: точечный GET

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket ошибка: ${error.message}`));
      });

      ws.on('open', () => {
        console.log(`✅ Подключено к ${WS_URI}\n`);

        // Фаза 1: Прямой запрос каналов Dim4 (как в check-actuator-channels.js)
        console.log('📋 Фаза 1: Прямой запрос каналов Dim4 (должен вернуть bind)');
        const channelIds = [];
        for (let i = 1; i <= 8; i++) {
          channelIds.push(`${TEST_ACTUATOR_ID}/dim/${i}`);
        }
        console.log(`   Запрашиваем ${channelIds.length} каналов...`);
        ws.send(JSON.stringify({ type: 'get', state: [TEST_ACTUATOR_ID, ...channelIds] }));

        setTimeout(() => {
          testPhase = 1;
          console.log('\n📋 Фаза 2: Массовый GET (как в monitor.js при загрузке)');
          console.log('   Запрашиваем только актуатор (без каналов)...');
          ws.send(JSON.stringify({ type: 'get', state: [TEST_ACTUATOR_ID] }));

          setTimeout(() => {
            testPhase = 2;
            console.log('\n📋 Фаза 3: Точечный GET по одному каналу (как requestChannelState)');
            console.log('   Запрашиваем один канал...');
            ws.send(JSON.stringify({ type: 'get', state: [`${TEST_ACTUATOR_ID}/dim/5`] }));

            setTimeout(() => {
              console.log('\n⏳ Ожидание ответов...');
              setTimeout(() => {
                analyzeResults();
                clearTimeout(timeout);
                resolve();
              }, 5000); // Зачем: Увеличиваем время ожидания для получения всех ответов
            }, 2000);
          }, 5000); // Зачем: Увеличиваем время между фазами
        }, 5000); // Зачем: Увеличиваем время ожидания ответов на фазу 1
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.messages.push(message);

          const isActionSet = message.type === 'action_set' || message.type === 'ACTION_SET';
          if (isActionSet && message.id) {
            const deviceId = message.id;
            const isChannel = deviceId.startsWith(`${TEST_ACTUATOR_ID}/dim/`);

            if (isChannel) {
              const payload = message.payload || {};
              const hasBindField = Object.prototype.hasOwnProperty.call(payload, 'bind');
              const bindValue = hasBindField ? payload.bind : null;

              // Зачем: Отладочный вывод для понимания что приходит
              console.log(`   [DEBUG] Получен ACTION_SET для ${deviceId}: hasContext=${!!message._context}, hasBindField=${hasBindField}, bind=${bindValue || 'null'}, payloadKeys=${Object.keys(payload).join(',')}`);

              // Зачем: Сохраняем состояние канала с метаданными о фазе
              // Зачем: Сохраняем ВСЕ сообщения, включая с _context (события изменений)
              if (!this.channelStates.has(deviceId)) {
                this.channelStates.set(deviceId, []);
              }
              this.channelStates.get(deviceId).push({
                phase: testPhase,
                hasContext: !!message._context,
                hasBindField,
                bind: bindValue,
                payloadKeys: Object.keys(payload),
                payload: JSON.stringify(payload).substring(0, 150),
              });
            }
          }
        } catch (error) {
          console.error('Ошибка парсинга сообщения:', error);
        }
      });

      const analyzeResults = () => {
        console.log('\n' + '='.repeat(80));
        console.log('📊 АНАЛИЗ РЕЗУЛЬТАТОВ');
        console.log('='.repeat(80) + '\n');

        const channels = [];
        for (let i = 1; i <= 8; i++) {
          channels.push(`${TEST_ACTUATOR_ID}/dim/${i}`);
        }

        console.log('🔍 Проверка каналов Dim4:\n');

        let phase1WithBind = 0; // Прямой запрос
        let phase2Received = 0; // Массовый GET
        let phase3WithBind = 0; // Точечный GET

        for (const channelId of channels) {
          const states = this.channelStates.get(channelId) || [];
          console.log(`\n${channelId}:`);

          if (states.length === 0) {
            console.log('   ❌ Сообщений не получено');
            continue;
          }

          // Зачем: Анализируем каждую фазу
          const phase1States = states.filter(s => s.phase === 0);
          const phase2States = states.filter(s => s.phase === 1);
          const phase3States = states.filter(s => s.phase === 2);

          if (phase1States.length > 0) {
            const state = phase1States[0];
            console.log(`   Фаза 1 (прямой запрос):`);
            console.log(`     hasBindField: ${state.hasBindField}, bind: ${state.bind || 'null'}`);
            if (state.hasBindField && state.bind) {
              phase1WithBind++;
            }
          } else {
            console.log(`   Фаза 1: ❌ Сообщение не получено`);
          }

          if (phase2States.length > 0) {
            phase2Received++;
            const state = phase2States[0];
            console.log(`   Фаза 2 (массовый GET):`);
            console.log(`     hasBindField: ${state.hasBindField}, bind: ${state.bind || 'null'}`);
          } else {
            console.log(`   Фаза 2: ⚠️  Сообщение не получено (каналы не запрашивались)`);
          }

          if (phase3States.length > 0 && channelId.includes('/dim/5')) {
            const state = phase3States[0];
            console.log(`   Фаза 3 (точечный GET):`);
            console.log(`     hasBindField: ${state.hasBindField}, bind: ${state.bind || 'null'}`);
            if (state.hasBindField && state.bind) {
              phase3WithBind++;
            }
          }
        }

        console.log('\n' + '='.repeat(80));
        console.log('📊 ИТОГОВАЯ СТАТИСТИКА');
        console.log('='.repeat(80));
        console.log(`Фаза 1 (прямой запрос): ${phase1WithBind}/8 каналов имеют bind`);
        console.log(`Фаза 2 (массовый GET): ${phase2Received}/8 каналов получены (ожидается 0)`);
        console.log(`Фаза 3 (точечный GET): ${phase3WithBind}/1 канал имеет bind`);

        console.log('\n' + '='.repeat(80));
        console.log('🎯 ВЫВОДЫ');
        console.log('='.repeat(80));

        if (phase1WithBind > 0) {
          console.log('✅ Прямой запрос каналов РАБОТАЕТ — bind присутствует');
        } else {
          console.log('❌ Прямой запрос каналов НЕ РАБОТАЕТ — bind отсутствует');
        }

        if (phase2Received === 0) {
          console.log('⚠️  ПРОБЛЕМА: Массовый GET НЕ запрашивает каналы (как в monitor.js)');
          console.log('   → Каналы не загружаются при старте monitor.js');
        } else {
          console.log('✅ Массовый GET запрашивает каналы');
        }

        if (phase3WithBind === 0) {
          console.log('⚠️  ПРОБЛЕМА: Точечный GET по каналу НЕ возвращает bind');
          console.log('   → requestChannelState() не помогает получить bind');
        } else {
          console.log('✅ Точечный GET возвращает bind');
        }

        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        if (phase2Received === 0) {
          console.log('   1. Добавить каналы актуаторов в массовый GET при загрузке');
        }
        if (phase3WithBind === 0 && phase1WithBind > 0) {
          console.log('   2. Проверить, почему точечный GET не возвращает bind (возможно, нужен другой формат запроса)');
        }
      };
    });
  }
}

async function main() {
  try {
    const test = new Dim4BindIssueTest();
    await test.run();
    console.log('\n✅ Тест завершён');
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

module.exports = { Dim4BindIssueTest };






