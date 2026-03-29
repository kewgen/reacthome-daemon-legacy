#!/usr/bin/env node

/**
 * Скрипт для резолва привязок каналов актуатора
 * 
 * Зачем: Загружает состояния каналов актуатора через WebSocket и показывает их привязки к устройствам.
 *        Поддерживает как локальные подключения, так и удалённые через gateway (gate.reacthome.net).
 * 
 * Алгоритм работы:
 * 1. Подключается к WebSocket (локально или через gateway)
 * 2. Запрашивает данные актуатора для определения его типа
 * 3. По типу устройства определяет количество и типы каналов (DO/DIM/AO)
 * 4. Запрашивает состояние всех каналов актуатора
 * 5. Собирает UUID связанных устройств из поля bind каждого канала
 * 6. Запрашивает данные связанных устройств для резолва их названий
 * 7. Выводит результаты с привязками и состояниями каналов
 * 
 * Использование:
 *   # Локальное подключение
 *   node scripts/resolve-actuator-channels.js "ec:c6:04:79:77:34"
 *   
 *   # Локальное подключение с указанием типа устройства
 *   node scripts/resolve-actuator-channels.js "ec:c6:04:79:77:34" 0xb5
 *   
 *   # Подключение через gateway
 *   REACTHOME_WS_URI="wss://gate.reacthome.net/d31775ae-19e8-40c9-81df-d6d672379563" \
 *   node scripts/resolve-actuator-channels.js "ec:c6:04:79:77:34" 0xb5
 * 
 * Переменные окружения:
 *   REACTHOME_WS_URI - URI WebSocket сервера (по умолчанию: ws://192.168.88.4:3000)
 *   DEBUG - если установлено, выводит отладочную информацию об ошибках парсинга
 * 
 * Примеры типов устройств (hex):
 *   0xb5 - MIX_6x12_RS (6 DO + 12 DIM каналов)
 *   0xa1 - RELAY_12 (12 DO каналов)
 *   0xa4 - DIM_8 (8 DIM каналов)
 *   0xaa - MIX_2 (2 DO + 2 DIM канала)
 */

const WebSocket = require('ws');

const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ACTUATOR_ID = process.argv[2];
// Зачем: Опциональный тип устройства для прямого указания (например, 0xb5 для MIX_6x12_RS)
const DEVICE_TYPE_OVERRIDE = process.argv[3] ? parseInt(process.argv[3], 16) : null;

if (!ACTUATOR_ID) {
  console.error('❌ Укажите ID актуатора');
  console.error('Использование: node scripts/resolve-actuator-channels.js "68:27:19:e4:2a:87" [0xb5]');
  console.error('Пример: node scripts/resolve-actuator-channels.js "ec:c6:04:79:77:34" 0xb5');
  process.exit(1);
}

// Зачем: Определяем, является ли URI gateway для использования subprotocol 'listen'
const isGateway = WS_URI.startsWith('wss://gate.reacthome.net');

/**
 * Определяет конфигурацию каналов актуатора по его типу
 * 
 * Зачем: Каждый тип актуатора имеет разное количество и типы каналов.
 *        Эта функция возвращает конфигурацию для правильной генерации ID каналов.
 * 
 * @param {number} deviceType - Числовой тип устройства (например, 0xb5 для MIX_6x12_RS)
 * @returns {Object|null} Объект с полями:
 *   - count: общее количество каналов
 *   - types: массив типов каналов ['do'], ['dim'], ['ao'] или ['do', 'dim']
 *   - null, если тип устройства не поддерживается
 */
function getActuatorChannelCount(deviceType) {
  // Зачем: Справочник типов устройств и их конфигураций каналов
  const channelConfigs = {
    // Реле (do каналы)
    0x0a: { count: 8, types: ['do'] },   0x0b: { count: 16, types: ['do'] },
    0x11: { count: 12, types: ['do'] },   0x23: { count: 2, types: ['do'] },
    0xa0: { count: 6, types: ['do'] },   0xa1: { count: 12, types: ['do'] },
    0xa2: { count: 24, types: ['do'] },  0xa7: { count: 2, types: ['do'] },
    0xae: { count: 12, types: ['do'] },
    // Диммеры (dim каналы)
    0x0e: { count: 4, types: ['dim'] },  0x0f: { count: 8, types: ['dim'] },
    0xa3: { count: 4, types: ['dim'] },  0xa4: { count: 8, types: ['dim'] },
    0xa5: { count: 8, types: ['dim'] },  0xaf: { count: 8, types: ['dim'] },
    0xad: { count: 12, types: ['dim'] },  0xb3: { count: 12, types: ['dim'] },
    0xb4: { count: 12, types: ['dim'] },  0xb6: { count: 1, types: ['dim'] },
    // Аналоговые выходы (ao каналы)
    0xa9: { count: 4, types: ['ao'] },
    // Смешанные устройства
    0x41: { count: 12, types: ['do', 'dim'] },  // MIX_H
    0xaa: { count: 4, types: ['do', 'dim'] },   // MIX_2
    0xab: { count: 2, types: ['do', 'dim'] },   // MIX_1
    0xac: { count: 2, types: ['do', 'dim'] },   // MIX_1_RS
    0xb5: { count: 18, types: ['do', 'dim'] },  // MIX_6x12_RS
  };
  return channelConfigs[deviceType] || null;
}

/**
 * Основная функция резолва каналов актуатора
 * 
 * Зачем: Организует процесс подключения к WebSocket, запроса данных актуатора и его каналов,
 *        сбора информации о привязках и вывода результатов.
 * 
 * Алгоритм:
 * 1. Создаёт WebSocket соединение (с subprotocol 'listen' для gateway)
 * 2. При подключении запрашивает данные актуатора или использует переданный тип
 * 3. Обрабатывает входящие сообщения и собирает данные каналов
 * 4. При получении данных актуатора определяет каналы и запрашивает их
 * 5. Собирает UUID связанных устройств и запрашивает их данные
 * 6. Форматирует и выводит результаты
 */
async function resolveActuatorChannels() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║ РЕЗОЛВ ПРИВЯЗОК КАНАЛОВ АКТУАТОРА                        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
  console.log(`Актуатор ID: ${ACTUATOR_ID}`);
  console.log(`WebSocket: ${WS_URI}`);
  if (isGateway) {
    console.log(`Тип: Gateway (используется subprotocol 'listen')\n`);
  } else {
    console.log(`Тип: Локальное подключение\n`);
  }
  
  // Зачем: Для gateway необходимо использовать subprotocol 'listen' согласно документации
  //        Gateway проксирует сообщения между клиентом и демоном, добавляя session ID
  const ws = isGateway ? new WebSocket(WS_URI, 'listen') : new WebSocket(WS_URI);
  
  // Зачем: Массив для накопления всех полученных сообщений от сервера
  const messages = [];
  
  // Зачем: Таймаут для предотвращения бесконечного ожидания ответов
  //        20 секунд достаточно для получения всех данных через gateway
  const timeout = setTimeout(() => {
    console.log('❌ Таймаут ожидания ответов');
    console.log(`Получено сообщений: ${messages.length}`);
    ws.close();
    process.exit(1);
  }, 20000);
  
  // Зачем: Обработчик установки соединения - отправляем первый запрос
  ws.on('open', () => {
    console.log(`[INFO] ✅ Подключено к ${WS_URI}\n`);
    
    // Зачем: Если тип устройства указан явно, сразу обрабатываем каналы
    //        Иначе запрашиваем данные актуатора для определения типа
    if (DEVICE_TYPE_OVERRIDE) {
      console.log(`[INFO] Используется указанный тип устройства: 0x${DEVICE_TYPE_OVERRIDE.toString(16)} (${DEVICE_TYPE_OVERRIDE})\n`);
      processActuatorByType(DEVICE_TYPE_OVERRIDE);
    } else {
      console.log('[STEP] Запрашиваем данные актуатора...');
      // Зачем: Запрос данных устройства через WebSocket API (формат: { type: 'get', state: [id] })
      const getCommand = { type: 'get', state: [ACTUATOR_ID] };
      const commandStr = JSON.stringify(getCommand);
      ws.send(commandStr);
    }
  });
  
  /**
   * Обрабатывает актуатор с известным типом устройства
   * 
   * Зачем: Когда тип устройства известен заранее, можно сразу сгенерировать список каналов
   *        без ожидания ответа с данными актуатора. Это ускоряет работу через gateway.
   * 
   * @param {number} deviceType - Числовой тип устройства (например, 0xb5)
   */
  function processActuatorByType(deviceType) {
    const channelConfig = getActuatorChannelCount(deviceType);
    if (!channelConfig) {
      console.log('❌ Неизвестный тип актуатора или каналы не поддерживаются');
      clearTimeout(timeout);
      ws.close();
      process.exit(1);
    }
    
    // Зачем: Список ID каналов для запроса через WebSocket
    const channelIds = [];
    const channelTypes = channelConfig.types;
    const channelCount = channelConfig.count;
    
    // Зачем: Для смешанных устройств (MIX_*) количество каналов каждого типа определяется специально
    //        Для остальных устройств используется общее количество каналов
    let doCount = 0, dimCount = 0, aoCount = 0;
    
    // Зачем: Смешанные устройства имеют разные количества DO и DIM каналов
    //        Формат ID канала: {MAC-адрес}/{тип}/{номер}, например "ec:c6:04:79:77:34/do/1"
    if (channelTypes.includes('do') && channelTypes.includes('dim')) {
      switch (deviceType) {
        case 0x41: doCount = 6; dimCount = 6; break;  // MIX_H
        case 0xaa: doCount = 2; dimCount = 2; break;  // MIX_2
        case 0xab: case 0xac: doCount = 1; dimCount = 1; break;  // MIX_1, MIX_1_RS
        case 0xb5: doCount = 6; dimCount = 12; break; // MIX_6x12_RS
      }
    } else {
      // Зачем: Для устройств с одним типом каналов используем общее количество
      if (channelTypes.includes('do')) doCount = channelCount;
      if (channelTypes.includes('dim')) dimCount = channelCount;
      if (channelTypes.includes('ao')) aoCount = channelCount;
    }
    
    // Зачем: Генерируем ID всех каналов для массового запроса
    for (let i = 1; i <= doCount; i++) {
      channelIds.push(`${ACTUATOR_ID}/do/${i}`);
    }
    for (let i = 1; i <= dimCount; i++) {
      channelIds.push(`${ACTUATOR_ID}/dim/${i}`);
    }
    for (let i = 1; i <= aoCount; i++) {
      channelIds.push(`${ACTUATOR_ID}/ao/${i}`);
    }
    
    console.log(`[STEP] Запрашиваем ${channelIds.length} каналов...`);
    // Зачем: Массовый запрос состояния всех каналов одним сообщением
    ws.send(JSON.stringify({ type: 'get', state: channelIds }));
    
    // Зачем: Даём время на получение ответов о состоянии каналов (3 секунды для gateway)
    setTimeout(() => {
      // Зачем: Собираем уникальные UUID связанных устройств из поля bind каждого канала
      //        Set исключает дубликаты, если несколько каналов привязаны к одному устройству
      const bindUuids = new Set();
      channelIds.forEach(channelId => {
        const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
        if (channelMsg && channelMsg.payload && channelMsg.payload.bind) {
          const bind = channelMsg.payload.bind;
          // Зачем: Если bind не содержит '/', это UUID устройства (не MAC-адрес/тип/индекс)
          //        UUID формата используем для запроса данных устройства
          if (!bind.includes('/')) {
            bindUuids.add(bind);
          }
        }
      });
      
      if (bindUuids.size > 0) {
        console.log(`[STEP] Запрашиваем ${bindUuids.size} связанных устройств...`);
        ws.send(JSON.stringify({ type: 'get', state: Array.from(bindUuids) }));
        
        setTimeout(() => {
          clearTimeout(timeout);
          processResults(messages, channelIds);
          ws.close();
          process.exit(0);
        }, 3000);
      } else {
        clearTimeout(timeout);
        processResults(messages, channelIds);
        ws.close();
        process.exit(0);
      }
    }, 3000);
  }
  
  let actuatorFound = false;
  
  ws.on('message', (data) => {
    try {
      let dataStr = data.toString();
      
      // Зачем: Gateway проксирует сообщения от демона к клиенту, добавляя session ID префикс (36 символов UUID)
      //        Согласно документации, формат: "{session_id}{json_message}"
      //        Префикс необходимо удалить перед парсингом JSON
      if (isGateway && dataStr.length >= 36) {
        // Зачем: Проверяем первые 36 символов на соответствие формату UUID
        const prefix = dataStr.substring(0, 36);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(prefix)) {
          // Зачем: Удаляем session ID префикс, оставляя только JSON сообщение
          dataStr = dataStr.substring(36);
        }
      }
      
      // Зачем: Парсим JSON сообщение и добавляем в массив для последующей обработки
      const message = JSON.parse(dataStr);
      messages.push(message);
      
      // Зачем: Обрабатываем данные актуатора только один раз при первом получении полного payload
      //        Проверяем наличие числового типа в payload для подтверждения полных данных
      if (!actuatorFound && message.type === 'ACTION_SET' && message.id === ACTUATOR_ID && message.payload && typeof message.payload.type === 'number') {
        actuatorFound = true;
        const deviceType = message.payload.type;
        
        if (typeof deviceType !== 'number') {
          console.log('❌ Актуатор не найден или не имеет числового типа');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        console.log(`[INFO] Тип актуатора: 0x${deviceType.toString(16)} (${deviceType})\n`);
        
        // Зачем: Определяем каналы актуатора
        const channelConfig = getActuatorChannelCount(deviceType);
        if (!channelConfig) {
          console.log('❌ Неизвестный тип актуатора или каналы не поддерживаются');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        const channelIds = [];
        const channelTypes = channelConfig.types;
        const channelCount = channelConfig.count;
        
        let doCount = 0, dimCount = 0, aoCount = 0;
        
        if (channelTypes.includes('do') && channelTypes.includes('dim')) {
          switch (deviceType) {
            case 0x41: doCount = 6; dimCount = 6; break;
            case 0xaa: doCount = 2; dimCount = 2; break;
            case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
            case 0xb5: doCount = 6; dimCount = 12; break;
          }
        } else {
          if (channelTypes.includes('do')) doCount = channelCount;
          if (channelTypes.includes('dim')) dimCount = channelCount;
          if (channelTypes.includes('ao')) aoCount = channelCount;
        }
        
        for (let i = 1; i <= doCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/do/${i}`);
        }
        for (let i = 1; i <= dimCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/dim/${i}`);
        }
        for (let i = 1; i <= aoCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/ao/${i}`);
        }
        
        console.log(`[STEP] Запрашиваем ${channelIds.length} каналов...`);
        ws.send(JSON.stringify({ type: 'get', state: channelIds }));
        
        // Зачем: Устанавливаем таймаут для сбора данных каналов и запроса связанных устройств
        setTimeout(() => {
          // Зачем: Собираем UUID из bind каналов после получения данных каналов
        const bindUuids = new Set();
        channelIds.forEach(channelId => {
          const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
          if (channelMsg && channelMsg.payload && channelMsg.payload.bind) {
            const bind = channelMsg.payload.bind;
            // Зачем: Если bind это UUID (не содержит '/'), добавляем его для запроса
            if (!bind.includes('/')) {
              bindUuids.add(bind);
            }
          }
        });
        
        // Зачем: Запрашиваем связанные устройства, если они есть
        if (bindUuids.size > 0) {
          console.log(`[STEP] Запрашиваем ${bindUuids.size} связанных устройств...`);
          ws.send(JSON.stringify({ type: 'get', state: Array.from(bindUuids) }));
        
            // Зачем: Устанавливаем дополнительный таймаут для обработки результатов после получения связанных устройств
        setTimeout(() => {
          clearTimeout(timeout);
          processResults(messages, channelIds);
          ws.close();
          process.exit(0);
            }, 3000);
          } else {
            // Зачем: Если связанных устройств нет, обрабатываем результаты сразу
            clearTimeout(timeout);
            processResults(messages, channelIds);
            ws.close();
            process.exit(0);
          }
        }, 2000); // Зачем: Таймаут для получения данных каналов
      }
    } catch (e) {
      // Игнорируем ошибки парсинга отдельных сообщений
      if (process.env.DEBUG) {
        console.error('[ERROR] Ошибка парсинга сообщения:', e.message);
      }
    }
  });
  
  // Зачем: Fallback механизм - если актуатор не найден сразу (например, через gateway приходят
  //        частичные обновления), проверяем все накопленные сообщения через 3 секунды
  //        Это решает проблему асинхронной загрузки данных через gateway
  setTimeout(() => {
    if (!actuatorFound) {
      const actuatorMsg = messages.find(m => 
        m.type === 'ACTION_SET' && 
        m.id === ACTUATOR_ID && 
        m.payload && 
        typeof m.payload.type === 'number'
      );
      
      if (actuatorMsg) {
        actuatorFound = true;
        const deviceType = actuatorMsg.payload.type;
        console.log(`[INFO] Тип актуатора: 0x${deviceType.toString(16)} (${deviceType})\n`);
        
        const channelConfig = getActuatorChannelCount(deviceType);
        if (!channelConfig) {
          console.log('❌ Неизвестный тип актуатора или каналы не поддерживаются');
          clearTimeout(timeout);
          ws.close();
          process.exit(1);
        }
        
        const channelIds = [];
        const channelTypes = channelConfig.types;
        const channelCount = channelConfig.count;
        
        let doCount = 0, dimCount = 0, aoCount = 0;
        
        if (channelTypes.includes('do') && channelTypes.includes('dim')) {
          switch (deviceType) {
            case 0x41: doCount = 6; dimCount = 6; break;
            case 0xaa: doCount = 2; dimCount = 2; break;
            case 0xab: case 0xac: doCount = 1; dimCount = 1; break;
            case 0xb5: doCount = 6; dimCount = 12; break;
          }
        } else {
          if (channelTypes.includes('do')) doCount = channelCount;
          if (channelTypes.includes('dim')) dimCount = channelCount;
          if (channelTypes.includes('ao')) aoCount = channelCount;
        }
        
        for (let i = 1; i <= doCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/do/${i}`);
        }
        for (let i = 1; i <= dimCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/dim/${i}`);
        }
        for (let i = 1; i <= aoCount; i++) {
          channelIds.push(`${ACTUATOR_ID}/ao/${i}`);
        }
        
        console.log(`[STEP] Запрашиваем ${channelIds.length} каналов...`);
        ws.send(JSON.stringify({ type: 'get', state: channelIds }));
        
        setTimeout(() => {
          const bindUuids = new Set();
          channelIds.forEach(channelId => {
            const channelMsg = messages.find(m => m.type === 'ACTION_SET' && m.id === channelId);
            if (channelMsg && channelMsg.payload && channelMsg.payload.bind) {
              const bind = channelMsg.payload.bind;
              if (!bind.includes('/')) {
                bindUuids.add(bind);
              }
            }
          });
          
          if (bindUuids.size > 0) {
            console.log(`[STEP] Запрашиваем ${bindUuids.size} связанных устройств...`);
            ws.send(JSON.stringify({ type: 'get', state: Array.from(bindUuids) }));
            
            setTimeout(() => {
              clearTimeout(timeout);
              processResults(messages, channelIds);
              ws.close();
              process.exit(0);
            }, 3000);
          } else {
            clearTimeout(timeout);
            processResults(messages, channelIds);
            ws.close();
            process.exit(0);
          }
        }, 3000);
      }
    }
  }, 3000);
  
  ws.on('error', (error) => {
    console.error('[ERROR] WebSocket error:', error.message);
    clearTimeout(timeout);
    process.exit(1);
  });
}

/**
 * Обрабатывает и выводит результаты резолва каналов
 * 
 * Зачем: Форматирует собранные данные каналов и их привязок в читаемый вид,
 *        группирует каналы по типам, резолвит названия связанных устройств и помещений.
 * 
 * @param {Array} messages - Массив всех полученных WebSocket сообщений
 * @param {Array} channelIds - Список ID запрошенных каналов
 */
function processResults(messages, channelIds) {
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  // Зачем: Используем Map для быстрого доступа к данным по ID
  //        channelData - данные каналов актуатора, deviceData - данные связанных устройств
  const channelData = new Map();
  const deviceData = new Map();
  
  messages.forEach(msg => {
    if (msg.type === 'ACTION_SET' && msg.id) {
      if (channelIds.includes(msg.id)) {
        channelData.set(msg.id, msg.payload || {});
      } else if (msg.id === ACTUATOR_ID) {
        deviceData.set(msg.id, msg.payload || {});
      } else {
        // Зачем: Сохраняем данные устройств, которые могут быть привязаны к каналам
        deviceData.set(msg.id, msg.payload || {});
      }
    }
  });
  
  console.log(`📊 РЕЗУЛЬТАТЫ РЕЗОЛВА:\n`);
  console.log(`Найдено каналов: ${channelData.size} из ${channelIds.length} запрошенных\n`);
  
  // Зачем: Группируем каналы по типам
  const channelsByType = {
    do: [],
    dim: [],
    ao: []
  };
  
  channelIds.forEach(channelId => {
    const parts = channelId.split('/');
    const channelType = parts[1];
    const channelIndex = parseInt(parts[2]);
    
    if (channelsByType[channelType]) {
      channelsByType[channelType].push({
        id: channelId,
        index: channelIndex,
        data: channelData.get(channelId) || {}
      });
    }
  });
  
  // Зачем: Выводим информацию о каналах
  Object.keys(channelsByType).sort().forEach(channelType => {
    const channels = channelsByType[channelType];
    if (channels.length === 0) return;
    
    const typeName = channelType === 'do' ? 'Реле (DO)' : channelType === 'dim' ? 'Диммер (DIM)' : 'Аналоговый выход (AO)';
    console.log(`${typeName} каналы:`);
    
    channels.forEach(channel => {
      const data = channel.data;
      const value = data.value !== undefined ? data.value : '—';
      const bind = data.bind || null;
      
      let valueStr = '';
      if (channelType === 'dim') {
        valueStr = `${value} (0-255)`;
      } else if (channelType === 'do') {
        valueStr = value ? 'ВКЛ' : 'ВЫКЛ';
      } else {
        valueStr = `${value}`;
      }
      
      const channelTypeName = channelType.toUpperCase();
      let line = `  ${channelTypeName}/${channel.index}: ${valueStr}`;
      
      // Зачем: Резолвим привязку канала к устройству для отображения понятного названия
      if (bind) {
        // Зачем: Bind может быть в двух форматах:
        //        1. MAC-адрес/тип/индекс (например, "68:27:19:e4:49:17/dim/1") - привязка к каналу другого устройства
        //        2. UUID (например, "e3549d47-f090-448a-8997-3483797b4196") - привязка к устройству
        if (bind.includes('/')) {
          // Зачем: Формат MAC-адрес/тип/индекс - привязка к каналу другого актуатора
          const [mac, type, index] = bind.split('/');
          const linkedDevice = deviceData.get(mac);
          if (linkedDevice) {
            // Зачем: Используем title (название), code (код) или name (имя) устройства для отображения
            const deviceName = linkedDevice.title || linkedDevice.code || linkedDevice.name || mac;
            const deviceType = linkedDevice.type || '—';
            // Зачем: Site может быть массивом или строкой - берём первый элемент если массив
            const deviceSite = linkedDevice.site ? (Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site) : null;
            line += ` → ${deviceName} (${deviceType})`;
            // Зачем: Резолвим название помещения для полной информации о местоположении устройства
            if (deviceSite) {
              const siteDevice = deviceData.get(deviceSite);
              if (siteDevice) {
                const siteName = siteDevice.title || siteDevice.code || siteDevice.name || deviceSite;
                line += ` / ${siteName}`;
              }
            }
          } else {
            line += ` → ⚠️  Устройство не найдено (bind: ${bind})`;
          }
        } else {
          // Зачем: UUID формат - привязка к устройству напрямую
          const linkedDevice = deviceData.get(bind);
          if (linkedDevice) {
            // Зачем: Для UUID используем первые 8 символов в fallback, если нет названия
            const deviceName = linkedDevice.title || linkedDevice.code || linkedDevice.name || bind.substring(0, 8) + '...';
            const deviceType = linkedDevice.type || '—';
            const deviceSite = linkedDevice.site ? (Array.isArray(linkedDevice.site) ? linkedDevice.site[0] : linkedDevice.site) : null;
            line += ` → ${deviceName} (${deviceType})`;
            if (deviceSite) {
              const siteDevice = deviceData.get(deviceSite);
              if (siteDevice) {
                const siteName = siteDevice.title || siteDevice.code || siteDevice.name || deviceSite;
                line += ` / ${siteName}`;
              }
            }
          } else {
            // Зачем: Показываем bind UUID для отладки, если устройство не найдено
            line += ` → ⚠️  Устройство не найдено`;
            console.log(`      bind: ${bind}`);
          }
        }
      } else {
        // Зачем: Канал без привязки - не связан ни с каким устройством
        line += ` → (не привязан)`;
      }
      
      console.log(line);
    });
    
    console.log('');
  });
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

resolveActuatorChannels().catch(error => {
  console.error('❌ Ошибка:', error.message);
  console.error(error.stack);
  process.exit(1);
});
