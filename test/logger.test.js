import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';

test('logger filters messages by level and adds a timestamp', () => {
  const messages = [];
  const output = Object.fromEntries(['error', 'warn', 'info', 'debug'].map(level => [level, message => messages.push([level, message])]));
  const logger = createLogger('warn', output);
  logger.debug('hidden');
  logger.info('hidden');
  logger.warn('connection lost');
  logger.error('connection failed');
  assert.deepEqual(messages.map(([level]) => level), ['warn', 'error']);
  assert.match(messages[0][1], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z WARN connection lost$/);
  assert.throws(() => createLogger('verbose', output), /Invalid DYSON_MQTT_LOG_LEVEL/);
});
