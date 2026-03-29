// Общие утилиты для работы с устройствами.
// Используются в modules/monitor/, scripts/, tests/.
// Единый источник правды вместо 15+ копий.

const SHIELD_ACTUATOR_TYPES = [0x0a, 0x0b, 0x0e, 0x0f, 0x23, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa7, 0xa9, 0xac, 0xad, 0xae, 0xaf, 0xb3, 0xb4, 0xb5, 0xb6, 0xab];
const SHIELD_SENSOR_TYPES = [0x01, 0x02, 0x03, 0x04, 0x20, 0x22, 0x2b, 0x2d, 0x2e, 0x2f, 0xf0];
const SHIELD_CONTROL_TYPES = [0x25];
const SHIELD_TYPES = [...SHIELD_ACTUATOR_TYPES, ...SHIELD_SENSOR_TYPES, ...SHIELD_CONTROL_TYPES];

const ENDPOINT_DEVICE_TYPES = [
  0x26, 0x27, 0x2a, 0x2c, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b
];

const DEVICE_TYPE_NAMES = {
  0x01: 'SENSOR4', 0x02: 'SENSOR6', 0x03: 'THI', 0x04: 'DOPPLER',
  0x20: 'DI_4', 0x22: 'DOPPLER', 0x2b: 'CO2_SENSOR',
  0x2d: 'DOPPLER_1_DI_4', 0x2e: 'DOPPLER_5_DI_4', 0x2f: 'DI_4_RSM',
  0xf0: 'TEMPERATURE_EXT',
  0x0a: 'DO8', 0x0b: 'DO16', 0x11: 'DO12', 0x23: 'RELAY_2',
  0xa0: 'RELAY_6', 0xa1: 'RELAY_12', 0xa2: 'RELAY_24', 0xa7: 'RELAY_2_DIN', 0xae: 'RELAY_12_RS',
  0x0e: 'DIM4', 0x0f: 'DIM8',
  0xa3: 'DIM_4', 0xa4: 'DIM_8', 0xa5: 'LANAMP', 0xaf: 'DIM_8_RS',
  0xad: 'DIM_12_LED_RS', 0xb3: 'DIM_12_AC_RS', 0xb4: 'DIM_12_DC_RS', 0xb6: 'DIM_1_AC_RS',
  0xa9: 'AO_4_DIN',
  0x41: 'MIX_H', 0xaa: 'MIX_2', 0xab: 'MIX_1', 0xac: 'MIX_1_RS', 0xb5: 'MIX_6x12_RS',
  0x25: 'SMART_4G',
  0x26: 'SMART_4GD', 0x27: 'SMART_4A', 0x2a: 'SMART_4AM', 0x2c: 'SMART_6_PUSH',
  0x30: 'SMART_TOP_A6P', 0x31: 'SMART_TOP_G4D', 0x32: 'SMART_TOP_A4T', 0x33: 'SMART_TOP_A6T',
  0x34: 'SMART_TOP_G6', 0x35: 'SMART_TOP_G4', 0x36: 'SMART_TOP_G2', 0x37: 'SMART_TOP_A4P',
  0x38: 'SMART_TOP_A4TD', 0x39: 'SMART_TOP_A4TD_7S', 0x3a: 'SMART_BOTTOM_1', 0x3b: 'SMART_BOTTOM_2',
};

const CONSUMER_TYPES = [
  'light_220', 'light_LED', 'light_RGB', 'light_led',
  'socket_220', 'valve_heating', 'valve_water',
  'warm_floor', 'AC', 'FAN', 'fan', 'BOILER', 'PUMP',
  'curtains', 'curtain', 'blind', 'blinds', 'roller',
  'multiroom', 'NOVA', 'INTESIS_BOX', 'MODBUS',
];

const SENSOR_STRING_TYPES = [
  'leakage_sensor', 'reed', 'thermostat', 'hygrostat', 'co2_stat',
];

const INTEGRATION_TYPES = [];

function getDeviceCategory(type) {
  if (SHIELD_ACTUATOR_TYPES.includes(type)) return 'Актуатор';
  if (SHIELD_SENSOR_TYPES.includes(type)) return 'Сенсор';
  if (SHIELD_CONTROL_TYPES.includes(type)) return 'Панель';
  if (ENDPOINT_DEVICE_TYPES.includes(type)) return 'Потребитель';
  if (typeof type === 'string') {
    if (SENSOR_STRING_TYPES.includes(type)) return 'Сенсор';
    if (INTEGRATION_TYPES.includes(type)) return 'Интеграция';
    if (CONSUMER_TYPES.includes(type)) return 'Потребитель';
  }
  return 'Другое';
}

function getDeviceIcon(deviceType, category) {
  if (typeof deviceType === 'string') {
    const iconMap = {
      'light_220': '💡', 'light_LED': '💡', 'light_RGB': '🌈', 'light_led': '💡',
      'socket_220': '🔌', 'valve_heating': '🔥', 'valve_water': '💧',
      'warm_floor': '🔥', 'AC': '❄️', 'FAN': '🌀', 'fan': '🌀',
      'BOILER': '🔥', 'PUMP': '💧',
      'thermostat': '🌡️', 'hygrostat': '💨', 'co2_stat': '🌬️',
      'leakage_sensor': '💧', 'curtains': '🪟', 'curtain': '🪟',
      'blind': '🪟', 'blinds': '🪟', 'roller': '🪟',
      'multiroom': '🔊', 'reed': '🚪',
      'INTESIS_BOX': '❄️', 'MODBUS': '🔌', 'NOVA': '🌬️',
    };
    return iconMap[deviceType] || '';
  }
  if (typeof deviceType === 'number') {
    if (category === 'Актуатор') {
      if ([0x0a, 0x0b, 0x23, 0xa0, 0xa1, 0xa2, 0xa7, 0xae].includes(deviceType)) return '🔌';
      if ([0x0e, 0x0f, 0xa3, 0xa4, 0xa5, 0xaf, 0xad, 0xb3, 0xb4, 0xb6].includes(deviceType)) return '💡';
      if ([0xa9].includes(deviceType)) return '📊';
      if ([0x41, 0xaa, 0xab, 0xac, 0xb5].includes(deviceType)) return '🔀';
      return '⚙️';
    }
    if (category === 'Сенсор') {
      if ([0x01, 0x02, 0x03, 0xf0].includes(deviceType)) return '🌡️';
      if ([0x2b].includes(deviceType)) return '🌬️';
      if ([0x04, 0x22, 0x2d, 0x2e].includes(deviceType)) return '👁️';
      if ([0x20, 0x2f].includes(deviceType)) return '📥';
      return '📊';
    }
    if (category === 'Панель') return deviceType === 0x25 ? '📱' : '🖥️';
    if (category === 'Потребитель') return '📱';
    if (category === 'Другое') return '❓';
  }
  return '';
}

function getDeviceName(payload) {
  const code = payload.code || '';
  const title = payload.title || '';
  if (code && title) return `${code} ${title}`;
  if (code) return code;
  if (title) return title;
  if (payload.name) return payload.name;
  return 'Без названия';
}

function isScriptLikeType(type) {
  if (typeof type !== 'string') return false;
  if (type === 'SCRIPT' || type === 'script') return true;
  return type.startsWith('ACTION_');
}

module.exports = {
  SHIELD_ACTUATOR_TYPES, SHIELD_SENSOR_TYPES, SHIELD_CONTROL_TYPES,
  SHIELD_TYPES, ENDPOINT_DEVICE_TYPES, DEVICE_TYPE_NAMES,
  CONSUMER_TYPES, SENSOR_STRING_TYPES, INTEGRATION_TYPES,
  getDeviceCategory, getDeviceIcon, getDeviceName, isScriptLikeType,
};
