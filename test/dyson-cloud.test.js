import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { DysonCloud, decodeLocalCredentials } from '../src/dyson-cloud.js';

function encryptedCredentials(password) {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const cipher = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(JSON.stringify({ serial: 'AB1-CD', apPasswordHash: password })), cipher.final()]).toString('base64');
}

test('decodes Dyson local MQTT credentials', () => {
  assert.equal(decodeLocalCredentials(encryptedCredentials('device-secret')), 'device-secret');
});

test('email challenge, verification, and manifest use the account token', async () => {
  const requests = [];
  const responses = ['1.0', { challengeId: 'challenge' }, { token: 'account-token' }, [
    { category: 'ec', serialNumber: 'AB1-CD', name: 'Purifier', type: '438', connectedConfiguration: { mqtt: { mqttRootTopicLevel: '438', localBrokerCredentials: encryptedCredentials('device-secret') } } },
    { category: 'robot', serialNumber: 'RB1', connectedConfiguration: null }
  ], { Endpoint: 'example.iot.amazonaws.com', IoTCredentials: { ClientId: 'client', TokenKey: 'token', TokenValue: 'value', TokenSignature: 'signature', CustomAuthorizerName: 'authorizer' } }];
  const cloud = new DysonCloud(false, async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => responses.shift() };
  });
  const challenge = await cloud.begin('user@example.com');
  assert.equal(challenge, 'challenge');
  const token = await cloud.verify(challenge, 'user@example.com', 'account-password', '123456');
  const devices = await cloud.devices(token);
  assert.equal(devices[0].serial, 'AB1-CD');
  assert.equal(devices[0].password, undefined);
  assert.equal(devices.length, 1);
  assert.equal(requests[3].options.headers.authorization, 'Bearer account-token');
  assert.deepEqual(JSON.parse(requests[2].options.body), { challengeId: 'challenge', email: 'user@example.com', password: 'account-password', otpCode: '123456' });
  const credentials = await cloud.iotCredentials(token, 'AB1-CD');
  assert.equal(credentials.Endpoint, 'example.iot.amazonaws.com');
  assert.deepEqual(JSON.parse(requests[4].options.body), { Serial: 'AB1-CD' });
});
