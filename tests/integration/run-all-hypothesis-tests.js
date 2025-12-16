#!/usr/bin/env node

/**
 * Скрипт для запуска всех тестов гипотез проблемы резолва актуаторов
 * 
 * Использование:
 *   node tests/integration/run-all-hypothesis-tests.js [ws://host:port]
 * 
 * Зачем: Запускает все тесты гипотез последовательно и собирает общий отчет
 */

const { spawn } = require('child_process');
const path = require('path');

const WS_URI = process.env.REACTHOME_WS_URI || process.argv[2] || 'ws://192.168.88.4:3000';

const TESTS = [
  {
    name: 'Гипотеза 1: Каналы не запрашиваются при начальной загрузке',
    file: 'test-hypothesis-1-channels-not-initial-load.js'
  },
  {
    name: 'Гипотеза 2: Частичные обновления каналов без поля `bind`',
    file: 'test-hypothesis-2-partial-updates-without-bind.js'
  },
  {
    name: 'Гипотеза 3: Ограничительное условие дозапроса `bind`',
    file: 'test-hypothesis-3-selected-actuator-restriction.js'
  },
  {
    name: 'Гипотеза 4: Асинхронность загрузки связанных устройств',
    file: 'test-hypothesis-4-async-linked-devices.js'
  },
  {
    name: 'Гипотеза 5: Неэффективный поиск связанных устройств',
    file: 'test-hypothesis-5-inefficient-device-search.js'
  },
  {
    name: 'Гипотеза 6: Интеграционный тест цепочки проблем',
    file: 'test-hypothesis-6-problem-chain.js'
  },
  {
    name: 'Гипотеза 7: Результат в UI - показ "(не привязан)"',
    file: 'test-hypothesis-7-ui-result.js'
  },
  {
    name: 'Гипотеза 8: Механизм повторного резолва',
    file: 'test-hypothesis-8-reresolution.js'
  }
];

// Зачем: Функция для запуска одного теста
function runTest(test, index, total) {
  return new Promise((resolve, reject) => {
    console.log('\n' + '='.repeat(80));
    console.log(`🧪 ТЕСТ ${index + 1}/${total}: ${test.name}`);
    console.log('='.repeat(80));
    console.log(`Файл: ${test.file}\n`);

    const testPath = path.join(__dirname, test.file);
    const child = spawn('node', [testPath, WS_URI], {
      stdio: 'inherit',
      shell: false
    });

    let output = '';
    let errorOutput = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
    }

    child.on('close', (code) => {
      const result = {
        name: test.name,
        file: test.file,
        success: code === 0,
        exitCode: code,
        output: output,
        error: errorOutput
      };

      if (code === 0) {
        console.log(`\n✅ Тест ${index + 1} завершен успешно\n`);
        resolve(result);
      } else {
        console.log(`\n❌ Тест ${index + 1} завершен с ошибкой (код: ${code})\n`);
        resolve(result); // Зачем: Продолжаем выполнение даже при ошибке
      }
    });

    child.on('error', (error) => {
      console.error(`\n❌ Ошибка запуска теста: ${error.message}\n`);
      reject(error);
    });
  });
}

// Зачем: Главная функция для запуска всех тестов
async function runAllTests() {
  console.log('='.repeat(80));
  console.log('🚀 ЗАПУСК ВСЕХ ТЕСТОВ ГИПОТЕЗ ПРОБЛЕМЫ РЕЗОЛВА АКТУАТОРОВ');
  console.log('='.repeat(80));
  console.log(`WebSocket URI: ${WS_URI}`);
  console.log(`Количество тестов: ${TESTS.length}\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < TESTS.length; i++) {
    try {
      const result = await runTest(TESTS[i], i, TESTS.length);
      results.push(result);
      
      // Зачем: Небольшая пауза между тестами
      if (i < TESTS.length - 1) {
        console.log('⏳ Пауза перед следующим тестом...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`❌ Критическая ошибка при запуске теста ${i + 1}:`, error);
      results.push({
        name: TESTS[i].name,
        file: TESTS[i].file,
        success: false,
        exitCode: -1,
        error: error.message
      });
    }
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);

  // Зачем: Выводим итоговый отчет
  console.log('\n' + '='.repeat(80));
  console.log('📊 ИТОГОВЫЙ ОТЧЕТ');
  console.log('='.repeat(80) + '\n');

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`✅ Успешно: ${successful}/${TESTS.length}`);
  console.log(`❌ Провалено: ${failed}/${TESTS.length}`);
  console.log(`⏱️  Общее время: ${duration} секунд\n`);

  console.log('📋 Детали по тестам:');
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    console.log(`   ${status} ${index + 1}. ${result.name}`);
    if (!result.success) {
      console.log(`      Код выхода: ${result.exitCode}`);
      if (result.error) {
        console.log(`      Ошибка: ${result.error.substring(0, 100)}...`);
      }
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('🎯 РЕКОМЕНДАЦИИ');
  console.log('='.repeat(80) + '\n');

  if (failed === 0) {
    console.log('✅ Все тесты пройдены успешно!');
    console.log('   Все гипотезы проверены и подтверждены или опровергнуты.\n');
  } else {
    console.log('⚠️  Некоторые тесты провалены.');
    console.log('   Рекомендуется:');
    console.log('   1. Проверить подключение к WebSocket серверу');
    console.log('   2. Убедиться, что сервер содержит тестовые данные');
    console.log('   3. Проверить логи проваленных тестов для деталей\n');
  }

  // Зачем: Сохраняем результаты в файл
  const fs = require('fs');
  const reportPath = path.join(__dirname, 'hypothesis-tests-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    wsUri: WS_URI,
    duration: duration,
    total: TESTS.length,
    successful: successful,
    failed: failed,
    results: results.map(r => ({
      name: r.name,
      file: r.file,
      success: r.success,
      exitCode: r.exitCode
    }))
  };

  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Отчет сохранен в: ${reportPath}\n`);
  } catch (error) {
    console.error(`⚠️  Не удалось сохранить отчет: ${error.message}\n`);
  }

  // Зачем: Возвращаем код выхода в зависимости от результатов
  process.exit(failed > 0 ? 1 : 0);
}

// Зачем: Обработка сигналов завершения
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Прервано пользователем');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Получен сигнал завершения');
  process.exit(143);
});

// Зачем: Запуск всех тестов
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('\n❌ Критическая ошибка:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests, TESTS };






