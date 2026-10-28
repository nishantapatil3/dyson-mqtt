import { createDecipheriv } from 'node:crypto';
import { manifestDeviceSupported } from './device-types.js';

const GLOBAL_API = 'https://appapi.cp.dyson.com';
const CHINA_API = 'https://appapi.cp.dyson.cn';

export function decodeLocalCredentials(encoded) {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encoded, 'base64')), decipher.final()]).toString('utf8'));
  if (typeof decoded.apPasswordHash !== 'string' || !decoded.apPasswordHash) throw new Error('Invalid local credentials');
  return decoded.apPasswordHash;
}

export class DysonCloud {
  constructor(china = false, fetcher = fetch) {
    this.base = china ? CHINA_API : GLOBAL_API;
    this.fetcher = fetcher;
  }

  async request(path, body, token) {
    const response = await this.fetcher(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'dyson-mqtt/0.1.0',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Dyson API returned HTTP ${response.status}`);
    return response.json();
  }

  async begin(email) {
    await this.request('/v1/provisioningservice/application/ios/version');
    const result = await this.request('/v3/userregistration/email/auth', { email });
    if (!result.challengeId) throw new Error('Dyson did not return an email challenge');
    return result.challengeId;
  }

  async verify(challengeId, email, password, otpCode) {
    const result = await this.request('/v3/userregistration/email/verify', { challengeId, email, password, otpCode });
    if (!result.token) throw new Error('Dyson did not return an access token');
    return result.token;
  }

  async devices(token) {
    const result = await this.request('/v3/manifest', undefined, token);
    if (!Array.isArray(result)) throw new Error('Dyson returned an unexpected device list');
    return result.filter(manifestDeviceSupported)
      .map(device => ({
        serial: device.serialNumber,
        name: device.name || device.productName || device.serialNumber,
        productType: device.connectedConfiguration.mqtt.mqttRootTopicLevel
      }));
  }

  async iotCredentials(token, serial) {
    const result = await this.request('/v2/authorize/iot-credentials', { Serial: serial }, token);
    const credentials = result?.IoTCredentials;
    if (!result?.Endpoint || !credentials?.ClientId || !credentials?.TokenKey || !credentials?.TokenValue || !credentials?.TokenSignature || !credentials?.CustomAuthorizerName) {
      throw new Error('Dyson returned incomplete cloud MQTT credentials');
    }
    return result;
  }
}
