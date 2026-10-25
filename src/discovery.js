const SENSORS = {
  temperature: { name: 'Temperature', unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' },
  humidity: { name: 'Humidity', unit_of_measurement: '%', device_class: 'humidity', state_class: 'measurement' },
  pm25: { name: 'PM2.5', unit_of_measurement: 'µg/m³', device_class: 'pm25', state_class: 'measurement' },
  pm10: { name: 'PM10', unit_of_measurement: 'µg/m³', device_class: 'pm10', state_class: 'measurement' },
  voc_index: { name: 'VOC index', state_class: 'measurement' },
  no2_index: { name: 'NO₂ index', state_class: 'measurement' },
  filter_life: { name: 'Filter life', unit_of_measurement: '%', state_class: 'measurement' }
};

export function discoveryMessages(config, device) {
  const id = device.serial.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const base = `${config.topicPrefix}/${device.serial}`;
  const stateTopic = `${base}/state`;
  const availabilityTopic = `${base}/availability`;
  const metadata = { identifiers: [device.serial], name: device.name, manufacturer: 'Dyson', model: device.productType, serial_number: device.serial };
  const common = { device: metadata, availability_topic: availabilityTopic, payload_available: 'online', payload_not_available: 'offline' };
  const fan = {
    ...common,
    name: device.name,
    unique_id: `dyson_${id}_fan`,
    state_topic: stateTopic,
    state_value_template: '{{ value_json.power }}',
    command_topic: `${base}/set/power`,
    percentage_state_topic: stateTopic,
    percentage_value_template: '{{ value_json.percentage }}',
    percentage_command_topic: `${base}/set/percentage`,
    oscillation_state_topic: stateTopic,
    oscillation_value_template: "{{ 'ON' if value_json.oscillating else 'OFF' }}",
    oscillation_command_topic: `${base}/set/oscillation`,
    payload_oscillation_on: 'ON',
    payload_oscillation_off: 'OFF',
    preset_modes: ['Auto', 'Manual'],
    preset_mode_state_topic: stateTopic,
    preset_mode_value_template: '{{ value_json.preset_mode }}',
    preset_mode_command_topic: `${base}/set/preset_mode`
  };
  const messages = [[`${config.discoveryPrefix}/fan/dyson_${id}/config`, fan]];
  for (const [key, attributes] of Object.entries(SENSORS)) {
    messages.push([`${config.discoveryPrefix}/sensor/dyson_${id}_${key}/config`, {
      ...common, ...attributes, unique_id: `dyson_${id}_${key}`,
      state_topic: stateTopic,
      value_template: `{{ value_json.${key} if value_json.${key} is not none else '' }}`
    }]);
  }
  return messages;
}
