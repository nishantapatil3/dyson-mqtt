import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DysonBridge } from '../src/bridge.js';

class FakeClient extends EventEmitter {
  connected = true;
  published = [];
  subscriptions = [];
  publish(topic, payload, options, callback) {
    this.published.push({ topic, payload: String(payload), options });
    if (typeof options === 'function') options();
    else callback?.();
  }
  subscribe(topic, callback) { this.subscriptions.push(topic); callback?.(); }
  end() { this.connected = false; }
}

test('bridges state and valid commands between separate MQTT connections', () => {
  const clients = [];
  const config = { mqttUrl: 'mqtt://broker', topicPrefix: 'dyson', discoveryPrefix: 'homeassistant', pollIntervalSeconds: 0,
    devices: [{ name: 'Purifier', host: '192.0.2.10', port: 1883, serial: 'AB1-CD', productType: '438', password: 'secret' }] };
  const bridge = new DysonBridge(config, (_url, _options) => { const client = new FakeClient(); clients.push(client); return client; }, { info() {}, warn() {}, error() {} });
  bridge.start();
  const [broker, dyson] = clients;
  broker.emit('connect');
  dyson.emit('connect');
  assert.equal(dyson.subscriptions[0][0], '438/AB1-CD/status/current');
  assert.equal(dyson.published[0].topic, '438/AB1-CD/command');
  dyson.emit('message', '438/AB1-CD/status/current', Buffer.from(JSON.stringify({ msg: 'CURRENT-STATE', 'product-state': { fpwr: 'ON', fnsp: '0003' } })));
  const state = JSON.parse(broker.published.findLast(item => item.topic === 'dyson/AB1-CD/state').payload);
  assert.equal(state.percentage, 30);
  broker.emit('message', 'dyson/AB1-CD/set/power', Buffer.from('OFF'));
  assert.deepEqual(JSON.parse(dyson.published.at(-1).payload).data, { fpwr: 'OFF' });
  const count = dyson.published.length;
  broker.emit('message', 'dyson/AB1-CD/set/power', Buffer.from('ON'), { retain: true });
  assert.equal(dyson.published.length, count);
  broker.emit('message', 'dyson/AB1-CD/set/speed', Buffer.from('100'));
  assert.equal(dyson.published.length, count);
  dyson.emit('close');
  assert.equal(broker.published.findLast(item => item.topic === 'dyson/AB1-CD/availability').payload, 'offline');
  bridge.stop();
});

test('invalid command logs omit the payload', () => {
  const warnings = [];
  const config = { mqttUrl: 'mqtt://broker', topicPrefix: 'dyson', discoveryPrefix: 'homeassistant', pollIntervalSeconds: 0,
    devices: [{ name: 'Purifier', host: '192.0.2.10', port: 1883, serial: 'AB1-CD', productType: '438', password: 'secret' }] };
  const bridge = new DysonBridge(config, () => new FakeClient(), { info() {}, warn(message) { warnings.push(message); }, error() {} });
  bridge.start();
  bridge.handleCommand('dyson/AB1-CD/set/power', Buffer.from('private-payload'));
  assert.deepEqual(warnings, ['Rejected power command for Dyson AB1-CD']);
  bridge.stop();
});
