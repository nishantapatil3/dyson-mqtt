export const ON_OFF_FIELDS = {
  power: 'fpwr',
  auto: 'auto',
  oscillation: 'oson',
  night_mode: 'nmod',
  direction: 'fdir',
  continuous_monitoring: 'rhtm'
};

export function parseMessage(payload) {
  try {
    const value = JSON.parse(payload.toString());
    return value && typeof value === 'object' && !Array.isArray(value) && typeof value.msg === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function mergeProductState(previous, message) {
  const state = message['product-state'] ?? message.productState;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return previous;
  const changes = message.msg === 'STATE-CHANGE';
  const next = { ...previous };
  for (const [key, value] of Object.entries(state)) {
    next[key] = changes && Array.isArray(value) ? value.at(-1) : value;
  }
  return next;
}

export function normalizeSensor(value, scale = 1, offset = 0) {
  if (value === undefined || value === null || ['OFF', 'FAIL', 'NONE', 'INV'].includes(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number / scale + offset) * 10) / 10 : null;
}

export function stateView(product, sensors) {
  const speed = product.fnsp === 'AUTO' ? null : normalizeSensor(product.fnsp);
  return {
    power: product.fpwr !== undefined ? (product.fpwr === 'ON' ? 'ON' : 'OFF') : product.fmod !== undefined ? (product.fmod === 'OFF' ? 'OFF' : 'ON') : (product.fnst === 'FAN' ? 'ON' : 'OFF'),
    percentage: speed === null ? 0 : Math.max(0, Math.min(100, speed * 10)),
    preset_mode: product.auto === 'ON' || product.fmod === 'AUTO' || product.fnsp === 'AUTO' ? 'Auto' : 'Manual',
    oscillating: product.oson === 'ON',
    night_mode: product.nmod === 'ON',
    temperature: normalizeSensor(sensors.tact, 10, -273.15),
    humidity: normalizeSensor(sensors.hact),
    pm25: normalizeSensor(sensors.pm25),
    pm10: normalizeSensor(sensors.pm10),
    voc_index: normalizeSensor(sensors.va10 ?? sensors.vact),
    no2_index: normalizeSensor(sensors.noxl),
    filter_life: normalizeSensor(product.hflr ?? product.cflr),
    product_state: product,
    sensor_data: sensors
  };
}

export function commandFromTopic(command, payload, product = {}) {
  const value = payload.toString().trim();
  let data;
  if (command === 'power' && ['ON', 'OFF'].includes(value.toUpperCase())) {
    data = product.fmod !== undefined && product.fpwr === undefined
      ? { fmod: value.toUpperCase() === 'ON' ? 'FAN' : 'OFF' }
      : { fpwr: value.toUpperCase() };
  } else if (command === 'speed' && /^([1-9]|10)$/.test(value)) {
    data = { fnsp: String(value).padStart(4, '0'), ...(product.auto !== undefined ? { auto: 'OFF' } : product.fmod !== undefined ? { fmod: 'FAN' } : {}) };
  } else if (command === 'percentage' && value === '0') {
    data = product.fmod !== undefined && product.fpwr === undefined ? { fmod: 'OFF' } : { fpwr: 'OFF' };
  } else if (command === 'percentage' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100) {
    data = { fnsp: String(Math.ceil(Number(value) / 10)).padStart(4, '0'), ...(product.auto !== undefined ? { auto: 'OFF' } : product.fmod !== undefined ? { fmod: 'FAN' } : {}) };
  } else if (command === 'preset_mode' && ['Auto', 'Manual'].includes(value)) {
    data = product.fmod !== undefined ? { fmod: value === 'Auto' ? 'AUTO' : 'FAN' } : { auto: value === 'Auto' ? 'ON' : 'OFF' };
  } else if (command in ON_OFF_FIELDS && ['ON', 'OFF'].includes(value.toUpperCase())) {
    data = { [ON_OFF_FIELDS[command]]: value.toUpperCase() };
  } else if (command === 'heating' && ['ON', 'OFF'].includes(value.toUpperCase())) {
    data = { hmod: value.toUpperCase() === 'ON' ? 'HEAT' : 'OFF' };
  } else if (command === 'target_temperature' && Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= 37) {
    data = { hmax: String(Math.round((Number(value) + 273.15) * 10)).padStart(4, '0') };
  } else if (command === 'humidification' && ['ON', 'OFF'].includes(value.toUpperCase())) {
    data = { hume: value.toUpperCase() === 'ON' ? 'HUMD' : 'OFF' };
  } else if (command === 'humidity_target' && /^\d+$/.test(value) && Number(value) >= 30 && Number(value) <= 70) {
    data = { humt: value.padStart(4, '0') };
  } else if (command === 'request' && value.toUpperCase() === 'STATE') {
    return { msg: 'REQUEST-CURRENT-STATE', time: new Date().toISOString() };
  } else {
    throw new Error(`Invalid ${command} command: ${value}`);
  }
  return { msg: 'STATE-SET', time: new Date().toISOString(), 'mode-reason': 'LAPP', 'state-reason': 'MODE', data };
}
