# Анализ покрытия тестами реального кода monitor.js

## Проблема

**Текущее состояние:** Тесты гипотез НЕ проверяют реальный код из `monitor.js`.

### Что происходит сейчас:

1. **Тесты создают упрощенные классы** (`TestDisplay`) вместо использования реального `TerminalKitStatusDisplay`
2. **Тесты симулируют логику** вместо проверки реальных методов
3. **Тесты не проверяют изменения** в `monitor.js` - если код изменится, тесты могут не заметить

### Примеры:

- `test-hypothesis-3-selected-actuator-restriction.js` - создает `TestDisplay` класс
- `test-hypothesis-4-async-linked-devices.js` - создает `TestDisplay` класс  
- `test-hypothesis-5-inefficient-device-search.js` - создает `TestDisplay` класс

## Решение

Создан вспомогательный модуль `monitor-test-helper.js`, который:

1. ✅ Использует реальные методы из `monitor.js`
2. ✅ Обходит требование TTY для создания экземпляра
3. ✅ Предоставляет обертки для реальных методов

## Что нужно исправить

### Тесты, которые нужно обновить:

1. **test-hypothesis-3-selected-actuator-restriction.js**
   - Заменить `TestDisplay` на `MonitorTestHelper`
   - Использовать реальный метод `requestChannelState` из monitor.js

2. **test-hypothesis-4-async-linked-devices.js**
   - Заменить `TestDisplay` на `MonitorTestHelper`
   - Использовать реальный метод `getActuatorChannels` из monitor.js
   - Использовать реальный метод `requestMissingDevice` из monitor.js

3. **test-hypothesis-5-inefficient-device-search.js**
   - Заменить `TestDisplay` на `MonitorTestHelper`
   - Использовать реальный метод `getActuatorChannels` из monitor.js

4. **test-hypothesis-7-ui-result.js**
   - Использовать реальный метод `getDeviceInfoText` из monitor.js для симуляции UI

5. **test-hypothesis-8-reresolution.js**
   - Использовать реальный метод `getActuatorChannels` из monitor.js

## Методы из monitor.js, которые должны использоваться

### Основные методы:

1. **getActuatorChannels(actuatorId, deviceType)** - строки 1835-1964
   - Реальная логика резолва каналов
   - Проверка bind и поиск linkedDevice
   - Вызов requestMissingDevice

2. **requestChannelState(channelId)** - строки 2832-2858
   - Реальная логика дозапроса каналов
   - Проверка cooldown
   - Отправка WebSocket запроса

3. **requestMissingDevice(deviceId)** - строки 2900-2930
   - Реальная логика запроса отсутствующих устройств
   - Проверка дубликатов
   - Отправка WebSocket запроса

4. **setDeviceState(deviceId, newState)** - строки 2700-2750
   - Реальная логика обновления состояния
   - Обработка частичных обновлений
   - Логика дозапроса для каналов

5. **getDeviceInfoText(device)** - строки 2020-2600
   - Реальная логика формирования UI текста
   - Проверка резолва каналов
   - Формирование строки "(не привязан)"

## План исправления

1. ✅ Создан `monitor-test-helper.js` - вспомогательный модуль
2. ⏳ Обновить тесты для использования `MonitorTestHelper`
3. ⏳ Проверить, что тесты используют реальные методы
4. ⏳ Убедиться, что изменения в monitor.js будут обнаружены тестами

## Итоговая оценка

**Текущее покрытие реального кода: ~30%**
- Тесты проверяют поведение, но не реальный код
- Симуляция может не совпадать с реальной логикой

**После исправления: 100%**
- Все тесты будут использовать реальные методы из monitor.js
- Изменения в monitor.js будут обнаружены тестами
- Тесты будут проверять реальную логику, а не симуляцию






