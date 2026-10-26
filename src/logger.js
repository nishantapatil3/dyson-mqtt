const LEVELS = ['error', 'warn', 'info', 'debug'];

export function createLogger(level = process.env.DYSON_MQTT_LOG_LEVEL ?? 'info', output = console) {
  const threshold = LEVELS.indexOf(level.toLowerCase());
  if (threshold === -1) throw new Error(`Invalid DYSON_MQTT_LOG_LEVEL: ${level}`);
  return Object.fromEntries(LEVELS.map((name, index) => [name, message => {
    if (index <= threshold) output[name](`${new Date().toISOString()} ${name.toUpperCase()} ${message}`);
  }]));
}
