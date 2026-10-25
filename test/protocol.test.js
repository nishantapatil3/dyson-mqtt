import test from 'node:test';
import assert from 'node:assert/strict';
import { commandFromTopic, mergeProductState, stateView } from '../src/protocol.js';
import { discoveryMessages } from '../src/discovery.js';

test('merges Dyson state changes using the new value', () => {
  const first = mergeProductState({}, { msg: 'CURRENT-STATE', 'product-state': { fpwr: 'OFF', fnsp: '0001' } });
  const next = mergeProductState(first, { msg: 'STATE-CHANGE', 'product-state': { fpwr: ['OFF', 'ON'] } });
  assert.deepEqual(next, { fpwr: 'ON', fnsp: '0001' });
});

test('normalizes air data and preserves raw fields', () => {
  const result = stateView({ fpwr: 'ON', fnsp: '0004', auto: 'OFF' }, { tact: '2949', hact: '0038', pm25: '0012', va10: '0005' });
  assert.equal(result.power, 'ON');
  assert.equal(result.percentage, 40);
  assert.equal(result.temperature, 21.8);
  assert.equal(result.humidity, 38);
  assert.equal(result.voc_index, 5);
  assert.equal(result.product_state.fpwr, 'ON');
});

test('supports older Link power and rejects invalid commands', () => {
  assert.deepEqual(commandFromTopic('power', Buffer.from('OFF'), { fmod: 'AUTO' }).data, { fmod: 'OFF' });
  assert.deepEqual(commandFromTopic('speed', Buffer.from('3'), { fmod: 'AUTO' }).data, { fnsp: '0003', fmod: 'FAN' });
  assert.deepEqual(commandFromTopic('humidification', Buffer.from('ON')).data, { hume: 'HUMD' });
  assert.deepEqual(commandFromTopic('percentage', Buffer.from('0')).data, { fpwr: 'OFF' });
  assert.throws(() => commandFromTopic('speed', Buffer.from('11')));
  assert.throws(() => commandFromTopic('target_temperature', Buffer.from('NaN')));
});

test('discovery uses stable identifiers and command topics', () => {
  const messages = discoveryMessages({ topicPrefix: 'dyson', discoveryPrefix: 'homeassistant' }, { serial: 'AB1-CD', name: 'Purifier', productType: '438' });
  assert.equal(messages[0][0], 'homeassistant/fan/dyson_ab1_cd/config');
  assert.equal(messages[0][1].percentage_command_topic, 'dyson/AB1-CD/set/percentage');
  assert.equal(messages[0][1].state_value_template, '{{ value_json.power }}');
  assert.equal(messages[0][1].payload_oscillation_on, 'ON');
  assert.equal(messages[0][1].device.serial_number, 'AB1-CD');
});
