import { readFile } from 'node:fs/promises';

export async function loadConfig(path = process.env.DYSON_MQTT_CONFIG ?? './config.json') {
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (!config.mqttUrl || !/^mqtts?:\/\//.test(config.mqttUrl)) throw new Error('mqttUrl must be an mqtt:// or mqtts:// URL');
  for (const key of ['topicPrefix', 'discoveryPrefix']) {
    config[key] ??= key === 'topicPrefix' ? 'dyson' : 'homeassistant';
    if (!/^[\w-]+(?:\/[\w-]+)*$/.test(config[key])) throw new Error(`Invalid ${key}`);
  }
  config.pollIntervalSeconds ??= 300;
  if (!Number.isInteger(config.pollIntervalSeconds) || config.pollIntervalSeconds < 0) throw new Error('pollIntervalSeconds must be a nonnegative integer');
  if (!Array.isArray(config.devices) || !config.devices.length) throw new Error('Configure at least one device');
  if (config.mode === 'cloud' && (!config.dysonCloud || typeof config.dysonCloud.token !== 'string' || !config.dysonCloud.token)) throw new Error('Missing Dyson cloud token');
  if (config.mode && !['cloud', 'local'].includes(config.mode)) throw new Error('Invalid mode');
  const serials = new Set();
  for (const device of config.devices) {
    if (!device.serial || !/^[a-zA-Z0-9-]+$/.test(device.serial)) throw new Error('Invalid device serial');
    if (!device.productType || !/^[a-zA-Z0-9]+$/.test(device.productType)) throw new Error('Invalid device productType');
    if (serials.has(device.serial)) throw new Error(`Duplicate serial ${device.serial}`);
    serials.add(device.serial);
    device.name ??= `Dyson ${device.serial}`;
    if (config.mode !== 'cloud') {
      if (!device.host || !/^[a-zA-Z0-9.:-]+$/.test(device.host)) throw new Error('Invalid device host');
      device.password = device.passwordEnv ? process.env[device.passwordEnv] : device.password;
      if (!device.password) throw new Error(`Missing password for ${device.serial}`);
      device.port ??= 1883;
      if (!Number.isInteger(device.port) || device.port < 1 || device.port > 65535) throw new Error(`Invalid port for ${device.serial}`);
    }
  }
  return config;
}
