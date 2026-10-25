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
  const config = { mode: 'cloud', dysonCloud: { token: 'saved-token', china: false }, mqttUrl: 'mqtt://broker', topicPrefix: 'dyson', discoveryPrefix: 'homeassistant', pollIntervalSeconds: 0,
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
