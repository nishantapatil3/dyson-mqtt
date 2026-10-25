import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { DysonBridge } from './bridge.js';
import { DysonCloud } from './dyson-cloud.js';

const configPath = process.env.DYSON_MQTT_CONFIG ?? '/app/data/config.json';
const authPath = process.env.DYSON_MQTT_AUTH ?? '/app/data/auth.json';
const port = Number(process.env.DYSON_MQTT_PORT ?? 3100);
let bridge;
let challenge;
let discovered = [];
let authorized;

try { authorized = JSON.parse(await readFile(authPath, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') console.error(`Saved authentication: ${error.message}`);
}

async function startBridge() {
  const next = new DysonBridge(await loadConfig(configPath));
  bridge?.stop();
  bridge = next;
  bridge.start();
}

try { await startBridge(); } catch (error) {
  if (error.code !== 'ENOENT') console.error(`Bridge configuration: ${error.message}`);
}

const html = await readFile(new URL('./setup.html', import.meta.url));

function send(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
}

async function input(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const host = request.headers.host ?? '';
  if (!/^((localhost|127\.0\.0\.1):\d+)$/.test(host)) return send(response, 403, { error: 'Local access only' });
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
    response.end(html);
    return;
  }
  if (request.method === 'GET' && request.url === '/api/status') return send(response, 200, {
    running: Boolean(bridge),
    authorized: Boolean(authorized),
    devices: bridge ? [...bridge.devices].map(([serial, device]) => ({ serial, name: device.config.name, online: device.online })) : []
  });
  if (request.method === 'GET' && request.url === '/api/auth/devices') {
    if (!authorized) return send(response, 200, { devices: [] });
    try {
      const cloud = new DysonCloud(authorized.china);
      discovered = await cloud.devices(authorized.token);
      return send(response, 200, { devices: discovered });
    } catch (error) { return send(response, 400, { error: error.message }); }
  }
  if (request.method !== 'POST' || !['/api/auth/start', '/api/auth/verify', '/api/configure'].includes(request.url)) return send(response, 404, { error: 'Not found' });
  if (request.headers.origin !== `http://${host}`) return send(response, 403, { error: 'Invalid origin' });
  try {
    const body = await input(request);
    if (request.url === '/api/auth/start') {
      if (typeof body.email !== 'string' || !/^\S+@\S+\.\S+$/.test(body.email)) throw new Error('Enter a valid email address');
      const cloud = new DysonCloud(body.china === true);
      challenge = { email: body.email, cloud, id: await cloud.begin(body.email), time: Date.now() };
      discovered = [];
      return send(response, 200, { ok: true });
    }
    if (request.url === '/api/auth/verify') {
      if (!challenge || Date.now() - challenge.time > 15 * 60 * 1000) throw new Error('Start a new login');
      if (typeof body.password !== 'string' || !body.password || !/^\d{6}$/.test(body.code)) throw new Error('Enter your password and six-digit email code');
      const token = await challenge.cloud.verify(challenge.id, challenge.email, body.password, body.code);
      authorized = { token, china: challenge.cloud.base.endsWith('.cn') };
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify(authorized), { mode: 0o600 });
      discovered = await challenge.cloud.devices(token);
      challenge = undefined;
      return send(response, 200, { devices: discovered });
    }
    if (!authorized || !discovered.length) throw new Error('Log in and retrieve devices first');
    if (typeof body.mqttUrl !== 'string' || !/^mqtts?:\/\//.test(body.mqttUrl)) throw new Error('Enter a valid MQTT broker URL');
    if (!Array.isArray(body.devices)) throw new Error('Select your devices');
    const devices = body.devices.map(item => {
      const found = discovered.find(device => device.serial === item.serial);
      if (!found) throw new Error('Unknown device');
      return found;
    });
    if (!devices.length) throw new Error('Select at least one device');
    const config = { mode: 'cloud', dysonCloud: authorized, mqttUrl: body.mqttUrl, topicPrefix: 'dyson', discoveryPrefix: 'homeassistant', pollIntervalSeconds: 300, devices };
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    await startBridge();
    discovered = [];
    return send(response, 200, { ok: true });
  } catch (error) {
    console.error(`Setup request failed: ${error.message}`);
    return send(response, 400, { error: error.message });
  }
});

server.listen(port, '0.0.0.0', () => console.info(`Setup UI listening on port ${port}`));

function shutdown() {
  bridge?.stop();
  server.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
