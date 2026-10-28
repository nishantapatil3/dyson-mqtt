import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DysonBridge } from '../src/bridge.js';

class Client extends EventEmitter {
  connected = true;
  subscriptions = [];
  published = [];
  publish(topic, payload, options, callback) {
    this.published.push({ topic, payload: String(payload) });
    (typeof options === 'function' ? options : callback)?.();
  }
  subscribe(topics, options, callback) { this.subscriptions.push(topics); (typeof options === 'function' ? options : callback)?.(); }
  end() { this.connected = false; }
}

test('cloud bridge uses fresh AWS IoT credentials and never needs a device IP', async () => {
  const connections = [];
  const config = { mode: 'cloud', dysonCloud: { token: 'saved-token', china: false }, mqttUrl: 'mqtt://broker', topicPrefix: 'dyson', pollIntervalSeconds: 0,
    devices: [{ serial: 'AB1-CD', name: 'Purifier', productType: '527M' }] };
  const cloud = { async iotCredentials(token, serial) {
    assert.equal(token, 'saved-token');
    assert.equal(serial, 'AB1-CD');
    return { Endpoint: 'aws.example', IoTCredentials: { ClientId: 'client-id', TokenKey: 'token', TokenValue: 'token-value', TokenSignature: 'signature', CustomAuthorizerName: 'authorizer' } };
  } };
  const bridge = new DysonBridge(config, (url, options) => {
    const client = new Client();
    connections.push({ url, options, client });
    return client;
  }, { info() {}, warn() {}, error() {} }, cloud);
  bridge.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connections[1].url, 'wss://aws.example/mqtt');
  assert.equal(connections[1].options.wsOptions.headers['X-Amz-CustomAuthorizer-Signature'], 'signature');
  const device = connections[1].client;
  device.emit('connect');
  assert.deepEqual(device.subscriptions[0][0], '527M/AB1-CD/status/current');
  assert.equal(bridge.devices.get('AB1-CD').online, false);
  device.emit('message', '527M/AB1-CD/status/current', Buffer.from(JSON.stringify({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON' } })));
  assert.equal(bridge.devices.get('AB1-CD').online, true);
  bridge.stop();
});

test('mixed cloud devices route subscriptions, state, controls, and reconnects by type', async () => {
  const clients = [];
  let credentialCalls = 0;
  const config = { mode: 'cloud', dysonCloud: { token: 'token' }, mqttUrl: 'mqtt://broker', topicPrefix: 'house/dyson', pollIntervalSeconds: 0,
    devices: [{ serial: 'AIR-1', name: 'Fan', productType: '438' }, { serial: 'ROBOT-1', name: 'Robot', productType: '277' }] };
  const cloud = { async iotCredentials(_token, serial) {
    credentialCalls++;
    return { Endpoint: 'aws.example', IoTCredentials: { ClientId: serial, TokenKey: 'token', TokenValue: 'value', TokenSignature: 'signature', CustomAuthorizerName: 'auth' } };
  } };
  const bridge = new DysonBridge(config, () => { const client = new Client(); clients.push(client); return client; }, { info() {}, warn() {}, error() {} }, cloud);
  try {
    bridge.start();
    await new Promise(resolve => setImmediate(resolve));
    const [broker, air, robot] = clients;
    broker.emit('connect'); air.emit('connect'); robot.emit('connect');
    assert.deepEqual(robot.subscriptions[0], ['277/ROBOT-1/status']);
    assert.deepEqual(robot.published.map(item => JSON.parse(item.payload).msg), ['REQUEST-CURRENT-STATE']);
    assert.equal(air.published.length, 3);
    assert.deepEqual(broker.published.map(item => item.topic), [
      'house/dyson/bridge/availability', 'house/dyson/AIR-1/availability', 'house/dyson/ROBOT-1/availability'
    ]);
    const send = data => robot.emit('message', '277/ROBOT-1/status', Buffer.from(JSON.stringify(data)));
    send({ msg: 'CURRENT-STATE', state: 'FULL_CLEAN_RUNNING', batteryChargeLevel: 72 });
    send({ msg: 'STATE-CHANGE', oldstate: 'FULL_CLEAN_RUNNING', newstate: 'FULL_CLEAN_PAUSED', newActiveFaults: [] });
    const state = JSON.parse(broker.published.findLast(item => item.topic === 'house/dyson/ROBOT-1/state').payload);
    assert.equal(state.state, 'paused'); assert.equal(state.battery_level, 72);
    assert.equal(bridge.devices.get('ROBOT-1').online, true);
    assert.ok(broker.published.some(item => item.topic === 'house/dyson/ROBOT-1/faults'));
    broker.emit('message', 'house/dyson/ROBOT-1/set/vacuum', Buffer.from('start'));
    assert.equal(JSON.parse(robot.published.at(-1).payload).msg, 'RESUME');
    const count = robot.published.length;
    broker.emit('message', 'house/dyson/ROBOT-1/set/vacuum', Buffer.from('start'), { retain: true });
    broker.emit('message', 'house/dyson/ROBOT-1/set/power', Buffer.from('ON'));
    assert.equal(robot.published.length, count);
    broker.emit('message', 'house/dyson/AIR-1/set/power', Buffer.from('OFF'));
    assert.deepEqual(JSON.parse(air.published.at(-1).payload).data, { fpwr: 'OFF' });
    broker.emit('connect');
    assert.equal(JSON.parse(broker.published.findLast(item => item.topic === 'house/dyson/ROBOT-1/state').payload).state, 'paused');
    send({ msg: 'GONE-AWAY' });
    assert.equal(broker.published.findLast(item => item.topic === 'house/dyson/ROBOT-1/availability').payload, 'offline');
    robot.emit('close');
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(credentialCalls, 3);
    assert.ok(broker.published.every(item => item.topic.startsWith('house/dyson/')));
    clients[3].emit('connect');
    assert.deepEqual(clients[3].subscriptions[0], ['277/ROBOT-1/status']);
  } finally { bridge.stop(); }
});
