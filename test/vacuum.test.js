import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeVacuumState, vacuumCommandFromTopic, vacuumStateView } from '../src/vacuum.js';
import { deviceProtocol } from '../src/device-protocol.js';

test('robot state changes preserve battery data and normalize top-level status', () => {
  const first = mergeVacuumState({}, { msg: 'CURRENT-STATE', state: 'FULL_CLEAN_RUNNING', batteryChargeLevel: 68 });
  const next = mergeVacuumState(first, { msg: 'STATE-CHANGE', oldstate: 'FULL_CLEAN_RUNNING', newstate: 'FULL_CLEAN_PAUSED' });
  assert.deepEqual(vacuumStateView(next), { state: 'paused', battery_level: 68, dyson_state: 'FULL_CLEAN_PAUSED', product_state: next });
  assert.equal(next.msg, undefined);
  assert.equal(vacuumStateView({}).state, null);
  assert.equal(vacuumStateView({ batteryChargeLevel: 'FAIL' }).battery_level, null);
  assert.equal(vacuumStateView({ batteryChargeLevel: 101 }).battery_level, null);
  assert.equal(vacuumStateView({ batteryChargeLevel: 0 }).battery_level, 0);
  assert.equal(mergeVacuumState(next, { msg: 'CURRENT-STATE', globalPosition: [1, 2] }).state, 'FULL_CLEAN_PAUSED');
});

test('robot states map to normalized MQTT status', () => {
  for (const [status, expected] of Object.entries({
    FULL_CLEAN_RUNNING: 'cleaning', FULL_CLEAN_TRAVERSING: 'cleaning', MAPPING_RUNNING: 'cleaning',
    FULL_CLEAN_PAUSED: 'paused', FULL_CLEAN_NEEDS_CHARGE: 'returning',
    FULL_CLEAN_CHARGING: 'docked', INACTIVE_CHARGED: 'docked', INACTIVE_CHARGING: 'docked',
    FULL_CLEAN_FINISHED: 'idle', MACHINE_OFF: 'idle', FAULT_ON_DOCK: 'error'
  })) assert.equal(vacuumStateView({ state: status }).state, expected, status);
});

test('robot partial updates preserve faults and full snapshots clear omitted faults', () => {
  const faults = { BATTERY: { active: true, description: 'Low battery' } };
  const activeFaults = [{ faultCode: '23.0.3' }];
  const first = mergeVacuumState({}, { msg: 'CURRENT-STATE', state: 'FAULT_ON_DOCK', faults, activeFaults });
  const partial = mergeVacuumState(first, { msg: 'STATE-CHANGE', newstate: 'FAULT_ON_DOCK', batteryChargeLevel: 1 });
  assert.deepEqual(partial.faults, faults);
  assert.deepEqual(partial.activeFaults, activeFaults);
  assert.deepEqual(mergeVacuumState(partial, { msg: 'STATE-CHANGE', newActiveFaults: [] }).activeFaults, []);
  const cleared = mergeVacuumState(partial, { msg: 'CURRENT-STATE', state: 'INACTIVE_CHARGING' });
  assert.deepEqual(cleared.faults, {});
  assert.deepEqual(cleared.activeFaults, []);
});

test('vacuum controls use robot actions and reject fan commands and invalid actions', () => {
  const command = (value, state = {}) => vacuumCommandFromTopic('vacuum', Buffer.from(value), state);
  assert.equal(command('start').msg, 'START');
  assert.equal(command('start').fullCleanType, 'immediate');
  assert.equal(command('start')['mode-reason'], 'RAPP');
  assert.equal(command('start', { state: 'FULL_CLEAN_PAUSED' }).msg, 'RESUME');
  assert.equal(command('pause').msg, 'PAUSE');
  assert.equal(command('resume').msg, 'RESUME');
  assert.equal(command('stop').msg, 'ABORT');
  assert.equal(command('return_to_base').msg, 'ABORT');
  assert.equal(command('start', { defaultCleaningMode: 'zoneConfigured', defaultCleaningStrategy: 'auto' }).cleaningMode, 'global');
  assert.equal(command('start', { defaultCleaningStrategy: 'auto' }).cleaningStrategy, 'auto');
  assert.equal(vacuumCommandFromTopic('request', Buffer.from('STATE')).msg, 'REQUEST-CURRENT-STATE');
  assert.throws(() => vacuumCommandFromTopic('power', Buffer.from('ON')));
  for (const action of ['locate', 'clean_spot', 'toString', '{}', '']) assert.throws(() => command(action));
});

test('all supported robot types use robot topics and requests', () => {
  for (const productType of ['N223', '276', '277']) {
    const device = { serial: 'RB1-CD', name: 'Robot', productType };
    const protocol = deviceProtocol(device);
    assert.deepEqual(protocol.statusTopics, ['status']);
    assert.deepEqual(protocol.requests, ['REQUEST-CURRENT-STATE']);
  }
});
