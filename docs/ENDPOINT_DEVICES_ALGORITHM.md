# Алгоритм получения списка конечных устройств со всеми параметрами

## Обзор

Документ описывает алгоритм получения списка конечных устройств (endpoint devices) ReactHome со всеми их параметрами из базы данных LevelDB и через WebSocket API.

**Зачем:** Позволяет систематически получать полную информацию о всех конечных устройствах (Smart TOP, Smart BOTTOM, Smart 4G серия) для мониторинга, управления и отображения в интерфейсах.

---

## Определение Site (Помещение)

**Site** (помещение) — это основная организационная единица в системе ReactHome, которая представляет физическое пространство (комнату, зону, этаж и т.д.). **Каждое устройство в системе привязано к помещению** через поле `site` в своей структуре данных.

### Характеристики Site

1. **Тип:** `"site"` или `"SITE"` (строка)
2. **Идентификатор:** UUID (уникальный идентификатор)
3. **Название:** Поле `title` или `code` (например, "Лоджия", "Кухня", "Спальня")
4. **Хранение:** В базе данных LevelDB по UUID, а не по названию
5. **Привязка устройств:** Каждое устройство имеет поле `site` с UUID помещения, к которому оно относится

### Структура Site

Site содержит массивы ID устройств и потребителей, привязанных к этому помещению:

```json
{
  "id": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d",
  "type": "site",
  "title": "Лоджия",
  "code": "6",
  "light_220": [
    "34731215-af9b-4847-b2f9-67c8940271c0",
    "8828b19b-55b6-4f88-ac6b-20c41b02f1ad"
  ],
  "light_LED": [],
  "light_RGB": [],
  "socket_220": [],
  "valve_heating": [],
  "valve_water": [],
  "warm_floor": [],
  "AC": [],
  "FAN": [],
  "BOILER": [],
  "PUMP": [],
  "thermostat": [],
  "hygrostat": [],
  "co2_stat": [],
  "sensor": [],
  "site": [],  // Дочерние локации
  "project": null  // Родительский проект
}
```

### Массивы потребителей в Site

| Массив | Описание | Тип элементов |
|--------|----------|---------------|
| `light_220[]` | Освещение 220В | UUID каналов освещения |
| `light_LED[]` | LED освещение | UUID LED светильников |
| `light_RGB[]` | RGB освещение | UUID RGB светильников |
| `socket_220[]` | Розетки 220В | UUID розеток |
| `valve_heating[]` | Клапаны отопления | UUID клапанов |
| `valve_water[]` | Клапаны воды | UUID клапанов |
| `warm_floor[]` | Тёплый пол | UUID систем тёплого пола |
| `AC[]` | Кондиционеры | UUID кондиционеров |
| `FAN[]` | Вентиляторы | UUID вентиляторов |
| `BOILER[]` | Котлы | UUID котлов |
| `PUMP[]` | Насосы | UUID насосов |
| `thermostat[]` | Термостаты | UUID термостатов |
| `hygrostat[]` | Гигростаты | UUID гигростатов |
| `co2_stat[]` | CO2 статы | UUID CO2 статов |
| `sensor[]` | Датчики | UUID датчиков |

### Использование Site

**Зачем:** Site позволяет:

1. **Организация устройств** — каждое устройство привязано к помещению через поле `site`, что позволяет:
   - Фильтровать устройства по помещениям
   - Группировать устройства для отображения
   - Определять, к какому помещению относится устройство

2. **Групповое управление** — управлять всеми устройствами в помещении одной командой:
   ```javascript
   // Включить всё освещение в помещении
   { type: "ACTION_SITE_LIGHT_ON", id: "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d" }
   ```

3. **Иерархия** — создавать вложенные структуры (проект → помещения → устройства)

4. **Фильтрация и поиск** — находить все устройства конкретного помещения по UUID

### Связь устройств с Site

**Каждое устройство привязано к помещению** через поле `site` в структуре устройства:

```json
{
  "id": "device-uuid",
  "type": 0xa1,  // или строка для потребителей
  "title": "Реле кухня",
  "site": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d",  // UUID помещения (обязательно)
  "online": true,
  "ip": "172.16.0.5"
}
```

**Поле `site` в устройстве:**
- Может быть **строкой** (UUID одного помещения)
- Может быть **массивом** (UUID нескольких помещений, если устройство относится к нескольким)
- **Обязательно присутствует** у каждого устройства для организации по помещениям

**Дополнительно:** Site также содержит массивы ID потребителей (light_220, warm_floor и т.д.) для группового управления, но основная связь "устройство → помещение" осуществляется через поле `site` в самом устройстве.

### Команды управления Site

| Команда | Описание |
|---------|----------|
| `ACTION_SITE_LIGHT_ON` | Включить всё освещение в локации |
| `ACTION_SITE_LIGHT_OFF` | Выключить всё освещение в локации |
| `ACTION_SITE_LIGHT_DIM_RELATIVE` | Изменить яркость освещения в локации |

**Важно:** Команды работают с UUID локации, а не с названием!

---

## Полный список устройств по категориям

### 1. Актуаторы (Actuators)

**Типы:** `0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6`

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x0a | 10 | DO8 | 8 цифровых выходов |
| 0x0b | 11 | DO16 | 16 цифровых выходов |
| 0x0e | 14 | DIM4 | 4 канала диммера |
| 0x0f | 15 | DIM8 | 8 каналов диммера |
| 0x23 | 35 | RELAY_2 | 2 реле |
| 0xa0 | 160 | RELAY_6 | 6 реле |
| 0xa1 | 161 | RELAY_12 | 12 реле |
| 0xa3 | 163 | DIM_4 | 4 канала диммера (новый) |
| 0xa4 | 164 | DIM_8 | 8 каналов диммера (новый) |
| 0xa5 | 165 | LANAMP | LAN усилитель |
| 0xa7 | 167 | RELAY_2_DIN | 2 реле DIN |
| 0xa9 | 169 | AO_4_DIN | 4 аналоговых выхода DIN |
| 0xab | 171 | MIX_1 | Смешанное устройство 1 |
| 0xac | 172 | MIX_1_RS | Смешанное устройство 1 RS |
| 0xad | 173 | DIM_12_LED_RS | 12 каналов диммера LED RS |
| 0xae | 174 | RELAY_12_RS | 12 реле RS |
| 0xaf | 175 | DIM_8_RS | 8 каналов диммера RS |
| 0xb3 | 179 | DIM_12_AC_RS | 12 каналов диммера AC RS |
| 0xb4 | 180 | DIM_12_DC_RS | 12 каналов диммера DC RS |
| 0xb5 | 181 | MIX_6x12_RS | Смешанное устройство 6x12 RS |
| 0xb6 | 182 | DIM_1_AC_RS | 1 канал диммера AC RS |

**Всего актуаторов:** 21 тип

---

### 2. Сенсоры (Sensors)

**Типы:** `0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0`

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x01 | 1 | SENSOR4 | 4-канальный сенсор |
| 0x02 | 2 | SENSOR6 | 6-канальный сенсор |
| 0x03 | 3 | THI | Температура, влажность, освещенность |
| 0x04 | 4 | DOPPLER | Доплеровский датчик движения |
| 0x20 | 32 | DI_4 | 4 цифровых входа |
| 0x2b | 43 | CO2_SENSOR | Датчик CO2 |
| 0x2d | 45 | DOPPLER_1_DI_4 | Доплер + 4 цифровых входа |
| 0x2e | 46 | DOPPLER_5_DI_4 | Доплер 5 + 4 цифровых входа |
| 0x2f | 47 | DI_4_RSM | 4 цифровых входа RSM |
| 0xf0 | 240 | TEMPERATURE_EXT | Внешний датчик температуры |

**Всего сенсоров:** 10 типов

---

### 3. Панели управления (Control Panels)

**Типы:** `0x25`

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x25 | 37 | SMART_4G | Щитовая панель управления Smart 4G |

**Всего панелей:** 1 тип

---

### 4. Конечные устройства (Endpoint Devices)

**Типы:** `0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b`

#### 4.1. Smart 4G серия

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x26 | 38 | SMART_4GD | Smart 4G с дисплеем |
| 0x27 | 39 | SMART_4A | Smart 4A |
| 0x2a | 42 | SMART_4AM | Smart 4AM |
| 0x2c | 44 | SMART_6_PUSH | Smart 6 кнопок |

#### 4.2. Smart TOP серия

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x30 | 48 | SMART_TOP_A6P | Smart TOP A6P (6 кнопок) |
| 0x31 | 49 | SMART_TOP_G4D | Smart TOP G4D (4 кнопки с дисплеем) |
| 0x32 | 50 | SMART_TOP_A4T | Smart TOP A4T (4 кнопки с тачскрином) |
| 0x33 | 51 | SMART_TOP_A6T | Smart TOP A6T (6 кнопок с тачскрином) |
| 0x34 | 52 | SMART_TOP_G6 | Smart TOP G6 (6 кнопок) |
| 0x35 | 53 | SMART_TOP_G4 | Smart TOP G4 (4 кнопки) |
| 0x36 | 54 | SMART_TOP_G2 | Smart TOP G2 (2 кнопки) |
| 0x37 | 55 | SMART_TOP_A4P | Smart TOP A4P (4 кнопки) |
| 0x38 | 56 | SMART_TOP_A4TD | Smart TOP A4TD (4 кнопки с дисплеем) |
| 0x39 | 57 | SMART_TOP_A4TD_7S | Smart TOP A4TD 7S (4 кнопки с дисплеем 7 сегментов) |

#### 4.3. Smart BOTTOM серия

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x3a | 58 | SMART_BOTTOM_1 | Smart BOTTOM 1 |
| 0x3b | 59 | SMART_BOTTOM_2 | Smart BOTTOM 2 |

**Всего конечных устройств:** 16 типов

---

### 5. Потребители (Consumers)

**Зачем:** Логические устройства, представляющие потребители энергии и ресурсов (свет, тепло, вода и т.д.). Эти устройства не имеют числовых типов, а определяются строковыми значениями в поле `type`.

| Тип (строка) | Название | Описание | Параметры состояния |
|--------------|----------|----------|---------------------|
| `light_220` | Освещение 220В | Освещение на 220В | `value`, `brightness` |
| `light_LED` | LED освещение | LED светильники | `value`, `brightness` |
| `light_RGB` | RGB освещение | RGB светильники | `r`, `g`, `b`, `brightness` |
| `socket_220` | Розетка 220В | Умная розетка | `value` (0/1) |
| `valve_heating` | Клапан отопления | Клапан системы отопления | `value`, `setpoint` |
| `valve_water` | Клапан воды | Клапан водоснабжения | `value` (0/1) |
| `warm_floor` | Тёплый пол | Система тёплого пола | `value`, `setpoint`, `temperature` |
| `AC` | Кондиционер | Система кондиционирования | `mode` (heat/cool/stop/dry/wet/ventilation), `setpoint`, `temperature` |
| `FAN` | Вентилятор | Вентилятор | `fan_speed`, `value` |
| `BOILER` | Котёл | Котёл отопления | `value`, `setpoint`, `temperature` |
| `PUMP` | Насос | Насос | `value` (0/1) |

**Особенности потребителей:**
- Хранятся в БД с строковым типом (не числовым)
- Могут быть привязаны к помещениям (sites) через массивы: `light_220[]`, `light_LED[]`, `light_RGB[]`, `warm_floor[]`
- Управляются через специальные команды: `ACTION_SITE_LIGHT_ON`, `ACTION_SITE_LIGHT_OFF`, `ACTION_SITE_LIGHT_DIM_RELATIVE`
- Определяются по наличию специфических полей в состоянии:
  - **Свет:** `value`, `brightness`, `r`, `g`, `b`
  - **Вентилятор:** `fan_speed`
  - **Кондиционер:** `mode`
  - **Тёплый пол:** `setpoint` или `type === 'warm_floor'`

**Всего типов потребителей:** 11+

---

## Алгоритм резолвинга потребителей

**Зачем:** Позволяет определить тип потребителя по полям состояния, даже если поле `type` отсутствует или неопределено. Это особенно полезно при получении данных через WebSocket, когда тип устройства может быть не указан явно.

### Метод 1: Резолвинг по полю `type` (приоритетный)

Если в состоянии устройства есть поле `type` со строковым значением из списка потребителей:

```javascript
function resolveConsumerByType(state) {
  if (!state || typeof state !== 'object') return null;
  
  const consumerTypes = [
    'light_220', 'light_LED', 'light_RGB', 'light_led',
    'socket_220', 'valve_heating', 'valve_water',
    'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP'
  ];
  
  if (state.type && consumerTypes.includes(state.type)) {
    return state.type;
  }
  
  return null;
}
```

### Метод 2: Резолвинг по полям состояния (fallback)

Если поле `type` отсутствует или неопределено, определяем тип по наличию специфических полей:

```javascript
function resolveConsumerByFields(state) {
  if (!state || typeof state !== 'object') return null;
  
  // 1. Освещение: есть value, brightness или RGB компоненты
  if ('value' in state || 'brightness' in state || 
      'r' in state || 'g' in state || 'b' in state) {
    
    // Определяем подтип освещения
    if ('r' in state || 'g' in state || 'b' in state) {
      return 'light_RGB';  // RGB освещение
    } else if (state.brightness !== undefined) {
      return 'light_LED';  // LED освещение (обычно имеет brightness)
    } else {
      return 'light_220';  // Освещение 220В (обычно только value)
    }
  }
  
  // 2. Вентилятор: есть fan_speed
  if ('fan_speed' in state) {
    return 'FAN';
  }
  
  // 3. Кондиционер: есть mode (heat, cool, stop, dry, wet, ventilation)
  if ('mode' in state && typeof state.mode === 'string') {
    const validModes = ['heat', 'cool', 'stop', 'dry', 'wet', 'ventilation'];
    if (validModes.includes(state.mode)) {
      return 'AC';
    }
  }
  
  // 4. Тёплый пол: есть setpoint или type === 'warm_floor'
  if ('setpoint' in state || state.type === 'warm_floor') {
    return 'warm_floor';
  }
  
  // 5. Котёл: есть setpoint и temperature, но нет mode
  if ('setpoint' in state && 'temperature' in state && !('mode' in state)) {
    return 'BOILER';
  }
  
  // 6. Клапан отопления: есть setpoint, но нет temperature и mode
  if ('setpoint' in state && !('temperature' in state) && !('mode' in state)) {
    // Проверяем контекст - если есть связь с отоплением
    if (state.value !== undefined) {
      return 'valve_heating';
    }
  }
  
  // 7. Клапан воды: только value (0/1), без других специфических полей
  if ('value' in state && 
      !('brightness' in state) && 
      !('setpoint' in state) && 
      !('fan_speed' in state) && 
      !('mode' in state) &&
      (state.value === 0 || state.value === 1)) {
    return 'valve_water';
  }
  
  // 8. Розетка: только value (0/1), без других специфических полей
  if ('value' in state && 
      typeof state.value === 'boolean' &&
      !('brightness' in state) && 
      !('setpoint' in state) && 
      !('fan_speed' in state) && 
      !('mode' in state)) {
    return 'socket_220';
  }
  
  // 9. Насос: только value (0/1), может быть в контексте отопления/воды
  if ('value' in state && 
      (state.value === 0 || state.value === 1) &&
      !('brightness' in state) && 
      !('setpoint' in state) && 
      !('fan_speed' in state) && 
      !('mode' in state)) {
    // Если не определён как клапан или розетка, может быть насос
    return 'PUMP';
  }
  
  return null; // Не является потребителем или тип не определён
}
```

### Комбинированный алгоритм резолвинга

**Зачем:** Объединяет оба метода для надёжного определения типа потребителя:

```javascript
function resolveConsumer(deviceId, state) {
  if (!state || typeof state !== 'object') return null;
  
  // Приоритет 1: Резолвинг по полю type
  const typeFromField = resolveConsumerByType(state);
  if (typeFromField) {
    return typeFromField;
  }
  
  // Приоритет 2: Резолвинг по полям состояния
  const typeFromFields = resolveConsumerByFields(state);
  if (typeFromFields) {
    return typeFromFields;
  }
  
  // Приоритет 3: Проверка по ID (если ID содержит тип в названии)
  if (deviceId) {
    const idLower = deviceId.toLowerCase();
    const consumerTypes = {
      'light': 'light_220',
      'led': 'light_LED',
      'rgb': 'light_RGB',
      'socket': 'socket_220',
      'valve': 'valve_heating',
      'warm': 'warm_floor',
      'ac': 'AC',
      'fan': 'FAN',
      'boiler': 'BOILER',
      'pump': 'PUMP'
    };
    
    for (const [key, type] of Object.entries(consumerTypes)) {
      if (idLower.includes(key)) {
        return type;
      }
    }
  }
  
  return null;
}
```

### Определение состояния потребителя

После резолвинга типа потребителя, можно определить его текущее состояние:

```javascript
function getConsumerState(consumerType, state) {
  if (!consumerType || !state) return null;
  
  const result = {
    type: consumerType,
    isOn: false,
    value: null,
    details: {}
  };
  
  switch (consumerType) {
    case 'light_220':
    case 'light_LED':
      result.isOn = (state.value > 0) || (state.brightness > 0);
      result.value = state.brightness || state.value || 0;
      result.details = {
        brightness: state.brightness,
        value: state.value
      };
      break;
      
    case 'light_RGB':
      result.isOn = (state.r > 0 || state.g > 0 || state.b > 0) || 
                     (state.brightness > 0) || 
                     (state.value > 0);
      result.value = state.brightness || state.value || 0;
      result.details = {
        r: state.r,
        g: state.g,
        b: state.b,
        brightness: state.brightness
      };
      break;
      
    case 'socket_220':
    case 'valve_water':
    case 'PUMP':
      result.isOn = state.value === true || state.value === 1;
      result.value = state.value ? 1 : 0;
      break;
      
    case 'FAN':
      result.isOn = (state.fan_speed > 0);
      result.value = state.fan_speed || 0;
      result.details = {
        fan_speed: state.fan_speed
      };
      break;
      
    case 'AC':
      result.isOn = (state.mode && state.mode !== 'stop' && state.mode !== null);
      result.value = state.mode || 'stop';
      result.details = {
        mode: state.mode,
        setpoint: state.setpoint,
        temperature: state.temperature
      };
      break;
      
    case 'warm_floor':
    case 'BOILER':
      result.isOn = (state.setpoint > 0) || (state.value > 0);
      result.value = state.setpoint || state.value || 0;
      result.details = {
        setpoint: state.setpoint,
        temperature: state.temperature,
        value: state.value
      };
      break;
      
    case 'valve_heating':
      result.isOn = (state.value > 0) || (state.setpoint > 0);
      result.value = state.setpoint || state.value || 0;
      result.details = {
        setpoint: state.setpoint,
        value: state.value
      };
      break;
  }
  
  return result;
}
```

### Пример использования

```javascript
// Получаем состояние устройства через WebSocket
ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
      const deviceId = msg.id;
      const state = msg.payload;
      
      // Резолвим тип потребителя
      const consumerType = resolveConsumer(deviceId, state);
      
      if (consumerType) {
        // Получаем детальное состояние
        const consumerState = getConsumerState(consumerType, state);
        
        console.log(`Потребитель ${deviceId}:`, {
          type: consumerType,
          isOn: consumerState.isOn,
          value: consumerState.value,
          details: consumerState.details
        });
      }
    }
  } catch (e) {
    // Обработка ошибок
  }
});
```

### Порядок приоритетов резолвинга

1. **Поле `type`** — если явно указан тип потребителя
2. **Поля состояния** — анализ наличия специфических полей (`brightness`, `fan_speed`, `mode`, `setpoint`)
3. **ID устройства** — поиск ключевых слов в идентификаторе (fallback)

**Зачем:** Алгоритм резолвинга позволяет надёжно определять тип потребителя даже при неполных данных, что критично для корректного отображения и управления устройствами в системе.

---

## Связь потребителей с актуаторами

**Зачем:** Каждый потребитель имеет связь с актуатором (реле, диммер, AO) через поле `bind`. Это позволяет системе управлять физическими устройствами при командах на потребителей.

### Механизм связи

Потребитель содержит поле `bind`, которое указывает на канал актуатора в формате:
```
{MAC-адрес}/{тип_канала}/{индекс}
```

Где:
- `MAC-адрес` — MAC-адрес физического устройства (актуатора)
- `тип_канала` — тип канала: `do` (цифровой выход), `dim` (диммер), `ao` (аналоговый выход)
- `индекс` — номер канала на устройстве (начинается с 1)

### Пример: Розетка "TV Младшая"

Рассмотрим пример розетки `socket_220` с названием "TV Младшая":

#### Структура потребителя (розетки):

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "socket_220",
  "title": "TV Младшая",
  "code": "TV_младшая",
  "bind": "68:27:19:e4:49:17/do/1",
  "site": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d",
  "value": false,
  "timestamp": 1704123456789
}
```

#### Расшифровка поля `bind`:

```
68:27:19:e4:49:17/do/1
│  │  │  │  │  │  │  │  │
│  │  │  │  │  │  │  │  └─ Индекс канала: 1 (первый канал)
│  │  │  │  │  │  │  └──── Тип канала: do (цифровой выход/реле)
│  │  │  │  │  │  └─────── Разделитель
│  └──┴──┴──┴──┴────────── MAC-адрес устройства: 68:27:19:e4:49:17
```

#### Структура актуатора (реле):

```json
{
  "id": "68:27:19:e4:49:17",
  "type": 161,  // DEVICE_TYPE_RELAY_12 (12 реле)
  "title": "R1",
  "ip": "172.16.0.5",
  "online": true,
  "ready": true
}
```

#### Структура канала актуатора:

```json
{
  "id": "68:27:19:e4:49:17/do/1",
  "value": 0,  // 0 = выключено, 1 = включено
  "bind": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",  // Обратная связь на потребителя
  "onOn": null,   // Скрипт при включении
  "onOff": null,  // Скрипт при выключении
  "timestamp": 1704123456789
}
```

### Поток управления потребителем

При команде `ACTION_ON` на розетку "TV Младшая":

```
1. WebSocket клиент → {"type": "ACTION_ON", "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}

2. src/controllers/service.js → case ACTION_ON
   - Получает потребителя: get("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
   - Находит поле bind: "68:27:19:e4:49:17/do/1"

3. Парсинг bind:
   - [dev, kind, index] = "68:27:19:e4:49:17/do/1".split("/")
   - dev = "68:27:19:e4:49:17"
   - kind = "do"
   - index = "1"

4. Получение устройства:
   - device = get("68:27:19:e4:49:17")
   - deviceType = 161 (RELAY_12)
   - ip = "172.16.0.5"

5. Отправка команды на физическое устройство:
   - run({ type: ACTION_DO, id: "68:27:19:e4:49:17", index: 1, value: 1 })

6. Физическое устройство:
   - Получает команду ACTION_DO
   - Включает реле на канале 1
   - Отправляет обратно состояние канала

7. Обновление состояния:
   - Канал "68:27:19:e4:49:17/do/1" → value: 1
   - Потребитель "a1b2c3d4-e5f6-7890-abcd-ef1234567890" → value: true
   - Выполняется count_on("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
```

### Типы каналов актуаторов

| Тип канала | Описание | Используется для |
|------------|----------|------------------|
| `do` | Цифровой выход (реле) | Розетки (`socket_220`), клапаны (`valve_water`, `valve_heating`), насосы (`PUMP`) |
| `dim` | Диммер | Освещение (`light_220`, `light_LED`) |
| `ao` | Аналоговый выход | Тёплый пол (`warm_floor`), клапаны с регулировкой |
| `rgb` | RGB канал | RGB освещение (`light_RGB`) |

### Алгоритм получения связи потребитель → актуатор

```javascript
function getConsumerActuatorBinding(consumerId, state) {
  if (!state || !state.bind) return null;
  
  // Парсим bind: "MAC-адрес/тип/индекс"
  const [deviceMac, channelType, channelIndex] = state.bind.split('/');
  
  if (!deviceMac || !channelType || !channelIndex) {
    return null;
  }
  
  // Получаем информацию об актуаторе
  const actuator = get(deviceMac);
  if (!actuator) return null;
  
  // Получаем информацию о канале
  const channelId = `${deviceMac}/${channelType}/${channelIndex}`;
  const channel = get(channelId);
  
  return {
    consumerId: consumerId,
    actuatorId: deviceMac,
    actuatorType: actuator.type,
    actuatorName: actuator.title || actuator.code || deviceMac,
    channelId: channelId,
    channelType: channelType,  // 'do', 'dim', 'ao'
    channelIndex: parseInt(channelIndex, 10),
    channelState: channel || null,
    bind: state.bind
  };
}
```

### Пример использования

```javascript
// Получаем состояние розетки "TV Младшая"
const socketState = await getDeviceState('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

// Получаем информацию о связи с актуатором
const binding = getConsumerActuatorBinding('a1b2c3d4-e5f6-7890-abcd-ef1234567890', socketState);

if (binding) {
  console.log(`Розетка "${socketState.title}" связана с:`);
  console.log(`  Актуатор: ${binding.actuatorName} (${binding.actuatorId})`);
  console.log(`  Тип: ${getDeviceTypeName(binding.actuatorType)}`);
  console.log(`  Канал: ${binding.channelType}/${binding.channelIndex}`);
  console.log(`  Состояние канала: ${binding.channelState?.value ? 'Включено' : 'Выключено'}`);
}
```

### Обратная связь (канал → потребитель)

**Зачем:** Канал актуатора также имеет поле `bind`, которое указывает обратно на потребителя. Это позволяет синхронизировать состояние:

```json
{
  "id": "68:27:19:e4:49:17/do/1",
  "value": 1,
  "bind": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",  // UUID розетки
  "onOn": "script-uuid-1",   // Скрипт при включении
  "onOff": "script-uuid-2"   // Скрипт при выключении
}
```

При изменении состояния канала:
1. Обновляется состояние канала
2. Выполняется `count_on(bind)` или `count_off(bind)` для обновления состояния потребителя
3. Запускаются скрипты `onOn` или `onOff`, если они указаны

### Получение всех потребителей для актуатора

```javascript
function getActuatorConsumers(actuatorId) {
  const consumers = [];
  const device = get(actuatorId);
  
  if (!device) return consumers;
  
  // Определяем количество каналов в зависимости от типа устройства
  let channelCount = 0;
  let channelType = null;
  
  switch (device.type) {
    case 0xa1: // RELAY_12
      channelCount = 12;
      channelType = 'do';
      break;
    case 0xa0: // RELAY_6
      channelCount = 6;
      channelType = 'do';
      break;
    case 0xa4: // DIM_8
      channelCount = 8;
      channelType = 'dim';
      break;
    // ... другие типы
  }
  
  // Проверяем каждый канал
  for (let i = 1; i <= channelCount; i++) {
    const channelId = `${actuatorId}/${channelType}/${i}`;
    const channel = get(channelId);
    
    if (channel && channel.bind) {
      // Нашли потребителя, привязанного к этому каналу
      const consumer = get(channel.bind);
      if (consumer) {
        consumers.push({
          consumerId: channel.bind,
          consumerType: consumer.type,
          consumerName: consumer.title || consumer.code || channel.bind,
          channelIndex: i,
          channelState: channel.value
        });
      }
    }
  }
  
  return consumers;
}
```

### Важные моменты

1. **Двусторонняя связь:** Потребитель → канал актуатора (через `bind` в потребителе) и канал → потребитель (через `bind` в канале)
2. **Синхронизация состояния:** При изменении состояния канала автоматически обновляется состояние потребителя через `count_on`/`count_off`
3. **Формат bind:** Строго `{MAC}/{тип}/{индекс}`, где MAC в формате `xx:xx:xx:xx:xx:xx`
4. **Типы каналов:** `do` для реле, `dim` для диммеров, `ao` для аналоговых выходов

---

## Связь актуаторов с устройствами (на примере Dim2)

**Зачем:** Каждый канал актуатора может быть связан с потребителем или другим устройством через поле `bind` в канале. Это позволяет синхронизировать состояние и управлять устройствами через каналы актуаторов.

### Пример: Канал Dim2 диммера

Рассмотрим пример канала диммера `dim/2` на устройстве "Диммер зал":

#### Структура актуатора (диммера):

```json
{
  "id": "68:27:19:e4:49:17",
  "type": 164,  // DEVICE_TYPE_DIM_8 (8 каналов диммера)
  "title": "Диммер зал",
  "ip": "172.16.0.6",
  "online": true,
  "ready": true
}
```

#### Структура канала Dim2:

```json
{
  "id": "68:27:19:e4:49:17/dim/2",
  "type": 3,  // DIM_TYPE_PWM (тип диммера)
  "group": 1,  // Группа каналов
  "value": 180,  // Текущее значение яркости (0-255)
  "velocity": 180,  // Скорость изменения
  "dimmable": true,  // Поддерживает диммирование
  "bind": "34731215-af9b-4847-b2f9-67c8940271c0",  // UUID потребителя (светильника)
  "onOn": "script-uuid-1",   // Скрипт при включении
  "onOff": "script-uuid-2",  // Скрипт при выключении
  "timestamp": 1704123456789
}
```

#### Структура связанного потребителя (светильника):

```json
{
  "id": "34731215-af9b-4847-b2f9-67c8940271c0",
  "type": "light_220",
  "title": "Лоджия спот",
  "code": "6.D.L.3 Лоджия",
  "bind": "68:27:19:e4:49:17/dim/2",  // Обратная связь на канал
  "site": "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d",
  "value": true,  // Синхронизировано с каналом
  "timestamp": 1704123456789
}
```

### Двусторонняя связь

**Связь 1: Потребитель → Канал актуатора**
- Потребитель `light_220` имеет `bind: "68:27:19:e4:49:17/dim/2"`
- При команде `ACTION_ON` на потребителя система находит канал и управляет им

**Связь 2: Канал актуатора → Потребитель**
- Канал `68:27:19:e4:49:17/dim/2` имеет `bind: "34731215-af9b-4847-b2f9-67c8940271c0"`
- При изменении состояния канала автоматически обновляется состояние потребителя

### Поток управления через канал Dim2

При команде `ACTION_ON` на светильник "Лоджия спот":

```
1. WebSocket клиент → {"type": "ACTION_ON", "id": "34731215-af9b-4847-b2f9-67c8940271c0"}

2. src/controllers/service.js → case ACTION_ON
   - Получает потребителя: get("34731215-af9b-4847-b2f9-67c8940271c0")
   - Находит поле bind: "68:27:19:e4:49:17/dim/2"

3. Парсинг bind:
   - [dev, kind, index] = "68:27:19:e4:49:17/dim/2".split("/")
   - dev = "68:27:19:e4:49:17"
   - kind = "dim"
   - index = "2"

4. Получение канала:
   - channel = get("68:27:19:e4:49:17/dim/2")
   - channelType = 3 (DIM_TYPE_PWM)
   - lastValue = channel.value || 255

5. Получение устройства:
   - device = get("68:27:19:e4:49:17")
   - deviceType = 164 (DEVICE_TYPE_DIM_8)
   - ip = "172.16.0.6"

6. Отправка команды на физическое устройство:
   - device.send(Buffer.from([
       ACTION_DIMMER,  // Команда диммера
       2,              // Индекс канала
       DIM_FADE,       // Режим плавного изменения
       255,            // Значение (максимальная яркость)
       DIM_VELOCITY    // Скорость изменения
     ]), ip)

7. Физическое устройство:
   - Получает команду ACTION_DIMMER
   - Плавно включает канал 2 до максимальной яркости
   - Отправляет обратно состояние канала

8. Обновление состояния:
   - Канал "68:27:19:e4:49:17/dim/2" → value: 255
   - Выполняется count_on("34731215-af9b-4847-b2f9-67c8940271c0")
   - Потребитель "34731215-af9b-4847-b2f9-67c8940271c0" → value: true
   - Запускается скрипт onOn, если указан
```

### Поток синхронизации состояния (канал → потребитель)

При изменении состояния канала Dim2 от физического устройства:

```
1. Физическое устройство отправляет ACTION_DIMMER:
   - index: 2
   - value: 180
   - velocity: 180

2. src/controllers/device.js → case ACTION_DIMMER
   - Обновляет канал: set("68:27:19:e4:49:17/dim/2", { value: 180, ... })

3. Проверка изменения состояния:
   - oldValue = chan.value ? 1 : 0  // Старое значение (0 или 1)
   - newValue = value ? 1 : 0       // Новое значение (0 или 1)
   - if (oldValue !== newValue) → состояние изменилось

4. Обновление связанного потребителя:
   - bind = "34731215-af9b-4847-b2f9-67c8940271c0"
   - if (newValue === 1) → count_on(bind)
   - if (newValue === 0) → count_off(bind)

5. Запуск скриптов:
   - if (newValue === 1) → run({ type: ACTION_SCRIPT_RUN, id: chan.onOn })
   - if (newValue === 0) → run({ type: ACTION_SCRIPT_RUN, id: chan.onOff })
```

### Алгоритм получения всех устройств для канала актуатора

```javascript
function getChannelDevices(actuatorId, channelType, channelIndex) {
  const channelId = `${actuatorId}/${channelType}/${channelIndex}`;
  const channel = get(channelId);
  
  if (!channel || !channel.bind) {
    return null;
  }
  
  // Получаем связанное устройство (потребитель)
  const device = get(channel.bind);
  
  if (!device) {
    return null;
  }
  
  return {
    channelId: channelId,
    channelType: channelType,
    channelIndex: channelIndex,
    channelState: {
      value: channel.value,
      type: channel.type,
      dimmable: channel.dimmable,
      velocity: channel.velocity
    },
    deviceId: channel.bind,
    deviceType: device.type,
    deviceName: device.title || device.code || device.name || channel.bind,
    deviceCategory: getDeviceCategory(device.type),
    bind: channel.bind
  };
}
```

### Пример использования для Dim2

```javascript
// Получаем информацию о канале Dim2
const actuatorId = "68:27:19:e4:49:17";
const channelInfo = getChannelDevices(actuatorId, 'dim', 2);

if (channelInfo) {
  console.log(`Канал Dim2 диммера "${actuatorId}":`);
  console.log(`  Состояние: ${channelInfo.channelState.value} (0-255)`);
  console.log(`  Диммируемый: ${channelInfo.channelState.dimmable ? 'Да' : 'Нет'}`);
  console.log(`  Связан с устройством:`);
  console.log(`    ID: ${channelInfo.deviceId}`);
  console.log(`    Название: ${channelInfo.deviceName}`);
  console.log(`    Тип: ${channelInfo.deviceType}`);
  console.log(`    Категория: ${channelInfo.deviceCategory}`);
}
```

### Получение всех каналов актуатора с их связями

```javascript
function getActuatorChannels(actuatorId) {
  const actuator = get(actuatorId);
  if (!actuator) return [];
  
  const channels = [];
  let channelCount = 0;
  let channelType = null;
  
  // Определяем количество каналов по типу устройства
  switch (actuator.type) {
    case 0x0e: // DIM4
    case 0xa3: // DIM_4
      channelCount = 4;
      channelType = 'dim';
      break;
    case 0x0f: // DIM8
    case 0xa4: // DIM_8
      channelCount = 8;
      channelType = 'dim';
      break;
    case 0xa1: // RELAY_12
      channelCount = 12;
      channelType = 'do';
      break;
    // ... другие типы
  }
  
  // Проверяем каждый канал
  for (let i = 1; i <= channelCount; i++) {
    const channelId = `${actuatorId}/${channelType}/${i}`;
    const channel = get(channelId);
    
    if (channel && channel.bind) {
      const device = get(channel.bind);
      channels.push({
        channelId: channelId,
        channelIndex: i,
        channelState: {
          value: channel.value,
          type: channel.type,
          dimmable: channel.dimmable
        },
        device: device ? {
          id: channel.bind,
          name: device.title || device.code || device.name || channel.bind,
          type: device.type,
          category: getDeviceCategory(device.type)
        } : null
      });
    }
  }
  
  return channels;
}
```

### Пример вывода для Dim2

```
Актуатор: Диммер зал (68:27:19:e4:49:17)
Тип: DIM_8 (8 каналов)

Каналы с связями:
  dim/1 → Лоджия спот 1 (light_220) - value: 255
  dim/2 → Лоджия спот 2 (light_220) - value: 180
  dim/3 → Кухня LED (light_LED) - value: 80
  dim/4 → (не привязан)
  dim/5 → Зал RGB (light_RGB) - value: 128
  dim/6 → (не привязан)
  dim/7 → (не привязан)
  dim/8 → (не привязан)
```

### Важные моменты

1. **Каналы актуаторов** имеют ID вида `{MAC}/{тип}/{индекс}`, например `68:27:19:e4:49:17/dim/2`
2. **Поле `bind` в канале** указывает на UUID потребителя или другого устройства
3. **Синхронизация** происходит автоматически через `count_on`/`count_off`
4. **Скрипты** могут быть привязаны к событиям канала через `onOn` и `onOff`
5. **Тип канала** (`type`) определяет способ управления (PWM, реле и т.д.)

### Поиск всех устройств, связанных с каналами dim/2

**Зачем:** Найти все каналы диммера с индексом 2 и показать связанные с ними устройства для анализа и диагностики системы.

Для поиска всех устройств, связанных с каналами `dim/2`, используйте скрипт:

```bash
node scripts/find-dim2-devices.js
```

Скрипт выполняет следующие действия:

1. **Загрузка из LevelDB:**
   - Находит все каналы с ID вида `{MAC}/dim/2`
   - Загружает информацию об актуаторах (диммерах)
   - Загружает информацию о связанных устройствах через поле `bind`
   - Резолвит названия помещений по UUID

2. **Получение актуального состояния:**
   - Подключается к WebSocket серверу
   - Запрашивает текущее состояние всех найденных устройств и каналов
   - Обновляет информацию о статусе (онлайн/оффлайн, значения и т.д.)

3. **Вывод результатов:**
   - Для каждого канала `dim/2` показывает:
     - Информацию об актуаторе (название, тип, IP, статус)
     - Информацию о канале (значение, тип диммера, скорость)
     - Информацию о связанном устройстве (название, тип, помещение)
     - Проверку обратной связи (есть ли у устройства `bind` на этот канал)

#### Пример вывода скрипта

```
================================================================================
НАЙДЕНО КАНАЛОВ DIM/2: 7
================================================================================

────────────────────────────────────────────────────────────────────────────────
КАНАЛ #1: 68:27:19:e4:49:17/dim/2
────────────────────────────────────────────────────────────────────────────────

📡 АКТУАТОР (Диммер):
   ID: 68:27:19:e4:49:17
   Название: Dim1
   Тип: DIM_8 (0xa4)
   Категория: Актуатор
   IP: 172.16.0.14
   Статус: 🟢 Онлайн
   Готовность: ✓ Готов

⚙️  КАНАЛ DIM/2:
   ID канала: 68:27:19:e4:49:17/dim/2
   Значение: 0 (0-255)
   Тип диммера: 4
   Диммируемый: Нет
   Скорость: 0
   Группа: 2

🔗 СВЯЗАННОЕ УСТРОЙСТВО:
   Bind: e3549d47-f090-448a-8997-3483797b4196
   ID: e3549d47-f090-448a-8997-3483797b4196
   Название: Освещение
   Тип: light_220
   Категория: Потребитель
   Помещение: Кладовая
   Значение: false
   ✓ Обратная связь: устройство имеет bind на этот канал
```

#### Использование скрипта для других каналов

Для поиска устройств, связанных с другими каналами (например, `dim/1`, `dim/3`, `do/1`), можно модифицировать скрипт, изменив условие поиска:

```javascript
// Вместо:
if (key.includes('/dim/2')) {

// Использовать:
if (key.includes('/dim/1')) {  // Для dim/1
if (key.includes('/do/1')) {   // Для do/1
if (key.match(/\/dim\/\d+/)) { // Для всех dim каналов
```

---

### 6. Другие устройства (не входят в основные категории)

Эти устройства не попадают в категории "Актуатор", "Сенсор", "Панель", "Конечное" или "Потребитель", но могут присутствовать в системе:

| Тип (hex) | Тип (dec) | Название | Описание |
|-----------|-----------|----------|----------|
| 0x00 | 0 | DEVICE_TYPE_UNKNOWN | Неизвестное устройство |
| 0x05 | 5 | DMX | DMX контроллер |
| 0x06 | 6 | RS485 | RS485 устройство |
| 0x07 | 7 | IR6 | 6-канальный ИК приемник |
| 0x08 | 8 | DI16 | 16 цифровых входов |
| 0x09 | 9 | DI32 | 32 цифровых входа |
| 0x10 | 16 | IR_RECEIVER | ИК приемник |
| 0x11 | 17 | DO12 | 12 цифровых выходов |
| 0x12 | 18 | DI24 | 24 цифровых входа |
| 0x14 | 20 | IR1 | 1-канальный ИК приемник |
| 0x24 | 36 | IR_4 | 4-канальный ИК приемник |
| 0x40 | 64 | DI_4_LA | 4 цифровых входа LA |
| 0x41 | 65 | MIX_H | Смешанное устройство H |
| 0xaa | 170 | MIX_2 | Смешанное устройство 2 |
| 0xb0 | 176 | RS_HUB1_RS | RS концентратор 1 RS |
| 0xb1 | 177 | RS_HUB1_LEGACY | RS концентратор 1 (legacy) |
| 0xb2 | 178 | RS_HUB4_LEGACY | RS концентратор 4 (legacy) |
| 0xc0 | 192 | SERVER | Сервер |
| 0xc1 | 193 | RS_HUB4 | RS концентратор 4 |
| 0xc2 | 194 | SOUNDBOX | Звуковой блок |
| 0xe0 | 224 | PNP | PNP устройство |
| 0xfe | 254 | PLC | Программируемый контроллер |
| 0xff | 255 | BOOTLOADER | Загрузчик |

---

## Итоговая статистика

| Категория | Количество типов | Типы/Идентификаторы |
|-----------|------------------|---------------------|
| **Актуаторы** | 21 | Числовые типы: 0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6 |
| **Сенсоры** | 10 | Числовые типы: 0x01, 0x02, 0x03, 0x04, 0x20, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0 |
| **Панели** | 1 | Числовой тип: 0x25 |
| **Конечные** | 16 | Числовые типы: 0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b |
| **Потребители** | 11+ | Строковые типы: `light_220`, `light_LED`, `light_RGB`, `socket_220`, `valve_heating`, `valve_water`, `warm_floor`, `AC`, `FAN`, `BOILER`, `PUMP` |
| **Другие** | 22+ | См. таблицу выше |
| **ВСЕГО** | **81+** | Все типы устройств ReactHome (физические + логические) |

---

## Определение конечных устройств

### Типы конечных устройств

Конечные устройства определяются массивом `ENDPOINT_DEVICE_TYPES`:

```javascript
const ENDPOINT_DEVICE_TYPES = [
  0x26, // SMART_4GD
  0x27, // SMART_4A
  0x2a, // SMART_4AM
  0x2c, // SMART_6_PUSH
  0x30, // SMART_TOP_A6P
  0x31, // SMART_TOP_G4D
  0x32, // SMART_TOP_A4T
  0x33, // SMART_TOP_A6T
  0x34, // SMART_TOP_G6
  0x35, // SMART_TOP_G4
  0x36, // SMART_TOP_G2
  0x37, // SMART_TOP_A4P
  0x38, // SMART_TOP_A4TD
  0x39, // SMART_TOP_A4TD_7S
  0x3a, // SMART_BOTTOM_1
  0x3b, // SMART_BOTTOM_2
];
```

**Примечание:** `SMART_4G` (0x25) относится к категории "Панель" (SHIELD_CONTROL_TYPES), а не к конечным устройствам.

---

## Алгоритм получения списка

### Этап 1: Загрузка базовой информации из LevelDB

**Зачем:** Получаем список всех конечных устройств с базовыми параметрами (ID, название, тип, категория, помещение) из базы данных LevelDB.

```javascript
async function getDevicesAndSitesFromDB() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const sites = [];
  
  try {
    // Зачем: Один проход по базе для загрузки и устройств, и помещений
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      
      const type = value.type;
      
      // Загружаем помещения
      if (type === 'site' || type === 'SITE') {
        sites.push({
          id: key,
          name: value.title || value.code || key,
        });
      }
      
      // Загружаем устройства (щитовые и конечные)
      // Зачем: Фильтруем только устройства с числовым типом, которые не являются каналами (не содержат '/')
      if (typeof type === 'number' && !key.includes('/') && ALL_DEVICE_TYPES.includes(type)) {
        devices.push({
          id: key,
          name: getDeviceName(value),
          type: type,
          typeName: DEVICE_TYPE_NAMES[type] || `Тип${type}`,
          category: getDeviceCategory(type),
          site: value.site || null, // Название помещения, если есть
        });
      }
      
      // Загружаем потребители (логические устройства с строковыми типами)
      // Зачем: Потребители (свет, тепло, розетки) имеют строковые типы, а не числовые
      if (typeof type === 'string' && !key.includes('/')) {
        const consumerTypes = ['light_220', 'light_LED', 'light_RGB', 'light_led', 
                               'socket_220', 'valve_heating', 'valve_water', 
                               'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP'];
        if (consumerTypes.includes(type)) {
          // Зачем: Получаем информацию о связи с актуатором через поле bind
          const bind = value.bind || null;
          let actuatorInfo = null;
          
          if (bind) {
            const [deviceMac, channelType, channelIndex] = bind.split('/');
            if (deviceMac && channelType && channelIndex) {
              // Зачем: Загружаем информацию об актуаторе для отображения связи
              const actuator = db.get(deviceMac).catch(() => null);
              if (actuator) {
                actuatorInfo = {
                  id: deviceMac,
                  name: getDeviceName(actuator),
                  type: actuator.type,
                  channelType: channelType,  // 'do', 'dim', 'ao'
                  channelIndex: parseInt(channelIndex, 10),
                  bind: bind
                };
              }
            }
          }
          
          devices.push({
            id: key,
            name: getDeviceName(value),
            type: type,
            typeName: type.toUpperCase().replace('_', ' '),
            category: 'Потребитель',
            site: value.site || null,
            bind: bind,  // Связь с актуатором
            actuator: actuatorInfo  // Информация об актуаторе
          });
        }
      }
    }
  } finally {
    await db.close();
  }
  
  // Зачем: Сортируем результаты для удобного отображения
  const sortedDevices = devices.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
  
  const sortedSites = sites.sort((a, b) => a.name.localeCompare(b.name));
  
  return { devices: sortedDevices, sites: sortedSites };
}
```

**Параметры, получаемые из БД:**
- `id` - уникальный идентификатор устройства
- `name` - название устройства (из `title`, `code` или `name`)
- `type` - тип устройства (числовой для физических устройств, строковый для потребителей)
- `typeName` - человекочитаемое название типа
- `category` - категория устройства ("Актуатор", "Сенсор", "Панель", "Конечное", "Потребитель")
- `site` - UUID помещения, к которому привязано устройство (обязательное поле для всех устройств)

**Важно:** 
- Каждое устройство имеет поле `site` с UUID помещения
- Для получения названия помещения нужно загрузить Site по UUID и взять поле `title` или `code`
- Потребители (свет, тепло, розетки) имеют строковые типы (`light_220`, `warm_floor` и т.д.), а не числовые, поэтому их нужно обрабатывать отдельно

---

### Этап 2: Получение полных параметров через WebSocket

**Зачем:** Получаем актуальное состояние устройств (онлайн/оффлайн, IP-адрес, параметры сенсоров) через WebSocket API в реальном времени.

#### 2.1. Подключение к WebSocket

```javascript
const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';
const ws = new WebSocket(WS_URI);
```

#### 2.2. Запрос состояния устройств

После подключения отправляем запрос `GET` с массивом ID устройств:

```javascript
ws.on('open', () => {
  const deviceIds = devices.map(d => d.id);
  
  // Зачем: Запрашиваем полное состояние всех устройств
  ws.send(JSON.stringify({ 
    type: 'get', 
    state: deviceIds 
  }));
  
  // Зачем: Периодически обновляем состояние (каждые 3 секунды)
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
    }
  }, UPDATE_INTERVAL);
});
```

#### 2.3. Обработка ответов ACTION_SET

Сервер отправляет серию сообщений `ACTION_SET` (по одному на каждое устройство):

```javascript
ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    
    if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
      const deviceId = msg.id;
      const state = msg.payload;
      
      // Зачем: Обновляем состояние устройства с временной меткой
      updateDeviceState(deviceId, {
        ...state,
        lastUpdate: Date.now(),
      });
    }
  } catch (e) {
    // Игнорируем ошибки парсинга
  }
});
```

---

## Параметры конечных устройств

### Базовые параметры (из LevelDB)

| Параметр | Тип | Описание | Источник |
|----------|-----|----------|----------|
| `id` | string | UUID устройства | Ключ в БД |
| `name` | string | Название устройства | `value.title`, `value.code`, `value.name` |
| `type` | number | Числовой тип устройства | `value.type` |
| `typeName` | string | Название типа | `DEVICE_TYPE_NAMES[type]` |
| `category` | string | Категория ("Конечное") | `getDeviceCategory(type)` |
| `site` | string\|null | Название помещения | `value.site` |

### Параметры состояния (из WebSocket ACTION_SET)

| Параметр | Тип | Описание | Доступность |
|----------|-----|----------|-------------|
| `online` | boolean | Статус подключения | Все устройства |
| `ip` | string | IP-адрес устройства | Если устройство онлайн |
| `temperature` | number | Температура (°C) | Для устройств с датчиком температуры |
| `humidity` | number | Влажность (%) | Для устройств с датчиком влажности |
| `co2` | number | Уровень CO2 (ppm) | Для устройств с CO2 сенсором |
| `illumination` | number | Освещенность | Для устройств с датчиком освещенности |
| `timestamp` | number | Временная метка последнего обновления | Все устройства |
| `lastUpdate` | number | Время получения данных (клиентская метка) | Все устройства |

### Дополнительные параметры (зависят от типа устройства)

Для Smart TOP панелей могут быть доступны:
- `rgb` - RGB значения подсветки
- `brightness` - Яркость дисплея
- `button_states` - Состояния кнопок
- `display_content` - Содержимое дисплея

---

## Определение статуса устройства

**Зачем:** Улучшенная логика определения онлайн-статуса, учитывающая случаи, когда устройство отправляет данные, но поле `online=false` (например, из-за таймаута discovery).

```javascript
function determineOnlineStatus(state) {
  // Проверяем поле online
  let isOnline = state.online === true;
  
  // Если online=false, но устройство отправляет актуальные данные - считаем его онлайн
  if (!isOnline) {
    const dataAge = state.lastUpdate ? Math.floor((Date.now() - state.lastUpdate) / 1000) : null;
    
    // Устройство считается работающим, если:
    // 1. Есть IP-адрес И данные обновлялись недавно (меньше 2 минут)
    // 2. ИЛИ есть актуальные данные от сенсоров (температура, влажность, CO2) и данные свежие
    const hasRecentData = dataAge !== null && dataAge < 120; // 2 минуты
    const hasSensorData = (state.temperature !== undefined && state.temperature !== null) ||
                         (state.humidity !== undefined && state.humidity !== null) ||
                         (state.co2 !== undefined && state.co2 !== null);
    const hasIp = state.ip && state.ip !== '—';
    
    if (hasRecentData && (hasIp || hasSensorData)) {
      isOnline = true;
    }
  }
  
  return isOnline;
}
```

---

## Полный алгоритм (пошагово)

### Шаг 1: Инициализация

1. Открыть соединение с LevelDB
2. Определить путь к БД (из переменной окружения или по умолчанию)
3. Определить URI WebSocket (из переменной окружения или по умолчанию)

### Шаг 2: Загрузка из БД

1. Итерировать по всем записям в БД
2. Для каждой записи:
   - Проверить, что значение - объект
   - Если `type === 'site'` или `type === 'SITE'` → добавить в список помещений
   - Если `typeof type === 'number'` и `!key.includes('/')` и `ALL_DEVICE_TYPES.includes(type)`:
     - Извлечь базовую информацию (id, name, type, typeName, category, site)
     - Добавить в список устройств
   - Если `typeof type === 'string'` и `!key.includes('/')`:
     - Проверить, является ли тип потребителем (из списка `CONSUMER_TYPES`)
     - Если да → извлечь информацию (id, name, type, typeName: type.toUpperCase(), category: 'Потребитель', site)
     - Добавить в список устройств
3. Отсортировать устройства по категории и названию
4. Закрыть соединение с БД

### Шаг 3: Подключение к WebSocket

1. Создать WebSocket соединение
2. Обработать событие `open`:
   - Отправить запрос `GET` с массивом ID всех устройств
   - Настроить периодическое обновление (каждые 3 секунды)
3. Обработать событие `message`:
   - Распарсить JSON сообщение
   - Если `type === 'ACTION_SET'`:
     - Извлечь `id` и `payload`
     - Обновить состояние устройства с временной меткой `lastUpdate`
4. Обработать события `error` и `close` для переподключения

### Шаг 4: Обработка состояния

1. Для каждого полученного `ACTION_SET`:
   - Определить, изменилось ли состояние (сравнить ключевые поля)
   - Обновить `lastStateChange` при реальных изменениях
   - Сохранить состояние в кэше
   
   **Для потребителей:**
   - Выполнить резолвинг типа потребителя (если не определён ранее)
   - Определить состояние потребителя (включен/выключен, значение)
   - Сохранить детальную информацию о состоянии
   
2. Обновить отображение (если используется UI)

---

## Пример использования

```javascript
const { Level } = require('level');
const WebSocket = require('ws');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'var', 'db');
const WS_URI = process.env.REACTHOME_WS_URI || 'ws://192.168.88.4:3000';

// Определение типов конечных устройств
const ENDPOINT_DEVICE_TYPES = [0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b];

// Шаг 1: Загрузка из БД
async function loadEndpointDevices() {
  const db = new Level(DB_PATH, { valueEncoding: 'json' });
  const devices = [];
  const actuatorCache = {}; // Кэш для актуаторов
  
  const CONSUMER_TYPES = [
    'light_220', 'light_LED', 'light_RGB', 'light_led',
    'socket_220', 'valve_heating', 'valve_water',
    'warm_floor', 'AC', 'FAN', 'BOILER', 'PUMP'
  ];
  
  try {
    // Зачем: Первый проход - загружаем все устройства и актуаторы в кэш
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      if (key.includes('/')) continue; // Пропускаем каналы
      
      const type = value.type;
      
      // Сохраняем актуаторы в кэш для быстрого доступа
      if (typeof type === 'number') {
        const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6];
        if (SHIELD_ACTUATOR_TYPES.includes(type)) {
          actuatorCache[key] = value;
        }
      }
    }
    
    // Зачем: Второй проход - загружаем конечные устройства и потребители с информацией о связях
    for await (const [key, value] of db.iterator()) {
      if (!value || typeof value !== 'object') continue;
      if (key.includes('/')) continue; // Пропускаем каналы
      
      const type = value.type;
      
      // Конечные устройства (числовые типы)
      if (typeof type === 'number' && ENDPOINT_DEVICE_TYPES.includes(type)) {
        devices.push({
          id: key,
          name: value.title || value.code || value.name || 'без названия',
          type: type,
          typeName: getDeviceTypeName(type),
          category: 'Конечное',
          site: value.site || null,
        });
      }
      
      // Потребители (строковые типы)
      if (typeof type === 'string' && CONSUMER_TYPES.includes(type)) {
        // Зачем: Получаем информацию о связи с актуатором через поле bind
        const bind = value.bind || null;
        let actuatorInfo = null;
        
        if (bind) {
          const [deviceMac, channelType, channelIndex] = bind.split('/');
          if (deviceMac && channelType && channelIndex) {
            // Зачем: Используем кэш для быстрого доступа к актуатору
            const actuator = actuatorCache[deviceMac];
            if (actuator) {
              actuatorInfo = {
                id: deviceMac,
                name: actuator.title || actuator.code || actuator.name || deviceMac,
                type: actuator.type,
                typeName: getDeviceTypeName(actuator.type),
                channelType: channelType,  // 'do', 'dim', 'ao'
                channelIndex: parseInt(channelIndex, 10),
                bind: bind
              };
            }
          }
        }
        
        devices.push({
          id: key,
          name: value.title || value.code || value.name || 'без названия',
          type: type,
          typeName: type.toUpperCase().replace('_', ' '),
          category: 'Потребитель',
          site: value.site || null,
          bind: bind,  // Связь с актуатором
          actuator: actuatorInfo  // Информация об актуаторе
        });
      }
    }
  } finally {
    await db.close();
  }
  
  return devices.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

// Шаг 2: Получение состояния через WebSocket
async function getDeviceStates(deviceIds) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URI);
    const states = new Map();
    let receivedCount = 0;
    
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'get', state: deviceIds }));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ACTION_SET' && msg.id && msg.payload) {
          states.set(msg.id, {
            ...msg.payload,
            lastUpdate: Date.now(),
          });
          receivedCount++;
          
          if (receivedCount >= deviceIds.length) {
            ws.close();
            resolve(states);
          }
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    });
    
    ws.on('error', reject);
    
    // Таймаут
    setTimeout(() => {
      ws.close();
      resolve(states);
    }, 10000);
  });
}

// Использование
(async () => {
  const devices = await loadEndpointDevices();
  console.log(`Найдено ${devices.length} устройств (конечные + потребители)`);
  
  const deviceIds = devices.map(d => d.id);
  const states = await getDeviceStates(deviceIds);
  
  // Объединяем данные
  const fullDevices = devices.map(device => {
    const state = states.get(device.id) || null;
    
    // Для потребителей выполняем резолвинг и определение состояния
    let consumerInfo = null;
    if (device.category === 'Потребитель' && state) {
      const consumerType = resolveConsumer(device.id, state);
      if (consumerType) {
        consumerInfo = getConsumerState(consumerType, state);
      }
    }
    
    return {
      ...device,
      state: state,
      consumerInfo: consumerInfo
    };
  });
  
  console.log('Полный список устройств:');
  fullDevices.forEach(device => {
    console.log(`\n${device.name} (${device.typeName}) [${device.category}]`);
    
    if (device.category === 'Потребитель') {
      // Вывод информации о потребителе
      if (device.consumerInfo) {
        console.log(`  Состояние: ${device.consumerInfo.isOn ? 'Включено' : 'Выключено'}`);
        console.log(`  Значение: ${device.consumerInfo.value}`);
        if (Object.keys(device.consumerInfo.details).length > 0) {
          console.log(`  Детали:`, device.consumerInfo.details);
        }
      }
      
      // Вывод информации о связи с актуатором
      if (device.actuator) {
        console.log(`  Связан с актуатором:`);
        console.log(`    Устройство: ${device.actuator.name} (${device.actuator.id})`);
        console.log(`    Канал: ${device.actuator.channelType}/${device.actuator.channelIndex}`);
      } else if (device.bind) {
        console.log(`  Bind: ${device.bind} (актуатор не найден в БД)`);
      } else {
        console.log(`  ⚠️  Не привязан к актуатору (bind отсутствует)`);
      }
    } else if (device.state) {
      // Вывод информации о физическом устройстве
      console.log(`  Онлайн: ${device.state.online ? 'Да' : 'Нет'}`);
      console.log(`  IP: ${device.state.ip || '—'}`);
      if (device.state.temperature !== undefined) {
        console.log(`  Температура: ${device.state.temperature}°C`);
      }
    }
  });
})();
```

---

## Пример вывода скрипта

При выполнении скрипта из примера выше, вы получите список следующего формата:

```
Найдено 5 конечных устройств
Полный список конечных устройств:

Кухня Smart TOP (SMART_TOP_A6P)
  Онлайн: Да
  IP: 172.16.0.10
  Температура: 22.5°C

Спальня Smart (SMART_TOP_G4D)
  Онлайн: Да
  IP: 172.16.0.11

Гостиная Smart (SMART_TOP_A4T)
  Онлайн: Нет
  IP: —

Ванная Smart (SMART_BOTTOM_1)
  Онлайн: Да
  IP: 172.16.0.13

Прихожая Smart 4G (SMART_4GD)
  Онлайн: Да
  IP: 172.16.0.14
```

### Структура данных в коде

Каждый элемент массива `fullDevices` содержит:

**Для физических устройств (конечные, актуаторы, сенсоры):**
```javascript
{
  id: "83db5b75-fa69-42f9-bd57-ee9f33d59ed7",        // UUID устройства
  name: "Кухня Smart TOP",                            // Название
  type: 48,                                           // Числовой тип (0x30)
  typeName: "SMART_TOP_A6P",                         // Название типа
  category: "Конечное",                              // Категория
  site: "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d",     // UUID помещения
  state: {                                            // Состояние из WebSocket
    online: true,                                     // Статус подключения
    ip: "172.16.0.10",                               // IP-адрес
    temperature: 22.5,                               // Температура (если есть)
    humidity: 45,                                    // Влажность (если есть)
    timestamp: 1704123456789,                        // Временная метка
    lastUpdate: 1704123456789                        // Время получения данных
  }
}
```

**Для потребителей:**
```javascript
{
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",        // UUID потребителя
  name: "TV Младшая",                                 // Название
  type: "socket_220",                                 // Строковый тип
  typeName: "SOCKET 220",                            // Название типа
  category: "Потребитель",                           // Категория
  site: "6b1afa99-9c1e-496e-8bd4-be7e90b71c8d",     // UUID помещения
  bind: "68:27:19:e4:49:17/do/1",                    // Связь с актуатором
  actuator: {                                         // Информация об актуаторе
    id: "68:27:19:e4:49:17",                         // MAC-адрес актуатора
    name: "R1",                                       // Название актуатора
    type: 161,                                        // Тип актуатора (RELAY_12)
    typeName: "RELAY_12",                            // Название типа
    channelType: "do",                                // Тип канала
    channelIndex: 1,                                  // Индекс канала
    bind: "68:27:19:e4:49:17/do/1"                   // Полный bind
  },
  state: {                                            // Состояние из WebSocket
    value: true,                                      // Включено/выключено
    timestamp: 1704123456789,                        // Временная метка
    lastUpdate: 1704123456789                        // Время получения данных
  },
  consumerInfo: {                                     // Детальная информация о состоянии
    type: "socket_220",
    isOn: true,
    value: 1,
    details: {}
  }
}
```

### Полный пример вывода с группировкой

Если добавить группировку по категориям (как в `monitor-shield-devices-status.js`):

```
╔═══════════════════════════════════════════════════════════════════════════╗
║ СПИСОК УСТРОЙСТВ ПО КАТЕГОРИЯМ                                             ║
╚═══════════════════════════════════════════════════════════════════════════╝

📦 АКТУАТОРЫ (3 устройства)

  🟢 R1                                 RELAY_12        172.16.0.5       изм: 5s (2s)
  🟢 Диммер зал                         DIM_8          172.16.0.6       изм: 3s (2s)
  🟢 AO 4                               AO_4_DIN       172.16.0.3       изм: 8s (2s)

📦 СЕНСОРЫ (2 устройства)

  🟢 1.СО2 Младшая                      CO2_SENSOR     172.16.0.5       CO2: 810 изм: 0s (2s)
  🟢 Доплер кухня                       DOPPLER        172.16.0.7       изм: 1м (2s)

📦 ПАНЕЛИ (1 устройство)

  🟢 S4 Ванна                           SMART_4G       172.16.0.8       изм: 2s (2s)

📦 КОНЕЧНОЕ (5 устройств)

  🟢 Кухня Smart TOP                    SMART_TOP_A6P  172.16.0.10      T: 22.5°C изм: 5s (2s)
  🟢 Спальня Smart                      SMART_TOP_G4D 172.16.0.11      изм: 10s (2s)
  🔴 Гостиная Smart                     SMART_TOP_A4T  —                изм: 2ч (2s)
  🟢 Ванная Smart                       SMART_BOTTOM_1  172.16.0.13      изм: 3s (2s)
  🟢 Прихожая Smart 4G                  SMART_4GD      172.16.0.14      изм: 1м (2s)

📦 ПОТРЕБИТЕЛИ (8 устройств)

  🟢 Лоджия спот                        LIGHT_220       —                value: 1 изм: 5s (2s)
     → Актуатор: R1 (68:27:19:e4:49:17) канал dim/3
  
  🟢 Кухня LED                          LIGHT_LED       —                brightness: 80 изм: 3s (2s)
     → Актуатор: Диммер зал (68:27:19:e4:49:18) канал dim/1
  
  🟢 Зал RGB                            LIGHT_RGB       —                RGB: 255,128,0 изм: 2s (2s)
     → Актуатор: R1 (68:27:19:e4:49:17) канал rgb/1
  
  🟢 TV Младшая                         SOCKET_220      —                value: 1 изм: 1м (2s)
     → Актуатор: R1 (68:27:19:e4:49:17) канал do/1
  
  🟢 Розетка зал                        SOCKET_220      —                value: 1 изм: 1м (2s)
     → Актуатор: R1 (68:27:19:e4:49:17) канал do/2
  
  🟢 Тёплый пол ванная                  WARM_FLOOR      —                setpoint: 25°C изм: 10s (2s)
     → Актуатор: AO 4 (68:27:19:e4:49:19) канал ao/1
  
  🟢 Кондиционер спальня                AC              —                mode: cool изм: 5м (2s)
     → Актуатор: (через драйвер IntesisBox)
  
  🟢 Вентилятор кухня                   FAN             —                fan_speed: 3 изм: 2м (2s)
     → Актуатор: (через драйвер)
  
  🟢 Котёл                              BOILER          —                setpoint: 60°C изм: 1м (2s)
     → Актуатор: (через драйвер)

═══════════════════════════════════════════════════════════════════════════

📊 Всего: 19  🟢 Онлайн: 18  🔴 Оффлайн: 1  ⚪ Ожидание: 0
```

### JSON формат (для программной обработки)

Если вывести результат в JSON:

```json
[
  {
    "id": "83db5b75-fa69-42f9-bd57-ee9f33d59ed7",
    "name": "Кухня Smart TOP",
    "type": 48,
    "typeName": "SMART_TOP_A6P",
    "category": "Конечное",
    "site": "Кухня",
    "state": {
      "online": true,
      "ip": "172.16.0.10",
      "temperature": 22.5,
      "humidity": 45,
      "timestamp": 1704123456789,
      "lastUpdate": 1704123456789
    }
  },
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Спальня Smart",
    "type": 49,
    "typeName": "SMART_TOP_G4D",
    "category": "Конечное",
    "site": "Спальня",
    "state": {
      "online": true,
      "ip": "172.16.0.11",
      "timestamp": 1704123456789,
      "lastUpdate": 1704123456789
    }
  }
]
```

### Варианты вывода

В зависимости от реализации скрипта, вывод может быть:

1. **Простой список** - только названия и статус
2. **Детальный список** - все параметры в читаемом формате
3. **Группированный** - по категориям/помещениям
4. **JSON** - для программной обработки
5. **Табличный** - в виде таблицы с колонками
```

---

## Оптимизации

1. **Кэширование состояния:** Сохранять состояние устройств в памяти для быстрого доступа
2. **Батчинг запросов:** Запрашивать состояние всех устройств одним запросом `GET`
3. **Инкрементальные обновления:** Обновлять только измененные параметры
4. **Фильтрация на стороне БД:** Использовать индексы для быстрого поиска устройств по типу

---

## Обработка ошибок

1. **Ошибки БД:** Закрывать соединение в блоке `finally`
2. **Ошибки WebSocket:** Реализовать переподключение с экспоненциальной задержкой
3. **Таймауты:** Устанавливать таймауты для запросов GET
4. **Валидация данных:** Проверять наличие обязательных полей перед обработкой

---

## См. также

- `scripts/monitor-shield-devices-status-ui-example.js` - пример реализации с UI
- `docs/WEBSOCKET_API_REFERENCE.md` - документация WebSocket API
- `src/constants.js` - определения типов устройств
