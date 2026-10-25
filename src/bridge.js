import mqtt from 'mqtt';
import { createHash } from 'node:crypto';
import { commandFromTopic, mergeProductState, parseMessage, stateView } from './protocol.js';
import { discoveryMessages } from './discovery.js';
import { DysonCloud } from './dyson-cloud.js';

const REQUESTS = ['REQUEST-CURRENT-STATE', 'REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA', 'REQUEST-CURRENT-FAULTS'];

export class DysonBridge {
  constructor(config, connect = mqtt.connect, logger = console, cloud = null) {
    this.config = config;
    this.connect = connect;
    this.logger = logger;
    this.devices = new Map(config.devices.map(device => [device.serial, { config: device, product: {}, sensors: {}, online: false }]));
    this.clients = new Map();
    this.stopped = false;
    this.cloud = cloud ?? (config.mode === 'cloud' ? new DysonCloud(config.dysonCloud.china === true) : null);
  }

  publish(topic, payload, retain = true) {
    if (!this.broker?.connected) return;
    this.broker.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain, qos: 0 }, error => {
      if (error) this.logger.error(`Publish failed for ${topic}: ${error.message}`);
    });
  }

  base(serial) { return `${this.config.topicPrefix}/${serial}`; }

  start() {
    const { config } = this;
    this.broker = this.connect(config.mqttUrl, {
      clientId: `dyson-mqtt-${process.pid}`,
      will: { topic: `${config.topicPrefix}/bridge/availability`, payload: 'offline', qos: 0, retain: true }
    });
    this.broker.on('connect', () => {
      this.logger.info('Connected to MQTT broker');
      this.broker.subscribe(`${config.topicPrefix}/+/set/+`, error => {
        if (error) this.logger.error(`Broker subscribe failed: ${error.message}`);
      });
      this.publish(`${config.topicPrefix}/bridge/availability`, 'online');
      for (const [serial, device] of this.devices) {
        for (const [topic, discovery] of discoveryMessages(config, device.config)) this.publish(topic, discovery);
        this.publish(`${this.base(serial)}/availability`, device.online ? 'online' : 'offline');
        if (device.online) this.publish(`${this.base(serial)}/state`, stateView(device.product, device.sensors));
      }
    });
    this.broker.on('message', (topic, payload, packet) => {
      if (!packet?.retain) this.handleCommand(topic, payload);
    });
    this.broker.on('error', error => this.logger.error(`Broker: ${error.message}`));
    for (const [serial, device] of this.devices) this.connectDevice(serial, device);
  }

  connectDevice(serial, device) {
    const details = device.config;
    if (this.config.mode === 'cloud') {
      this.connectCloudDevice(serial, device);
      return;
    }
    const client = this.connect(`mqtt://${details.host}:${details.port}`, {
      username: serial, password: details.password,
      protocolId: 'MQIsdp', protocolVersion: 3,
      reconnectPeriod: 5000, connectTimeout: 10000,
      clientId: `dyson-${createHash('sha256').update(serial).digest('hex').slice(0, 16)}`
    });
    this.clients.set(serial, client);
    client.on('connect', () => {
      device.online = true;
      this.logger.info(`Connected to Dyson ${serial}`);
      const root = `${details.productType}/${serial}`;
      client.subscribe([`${root}/status/current`, `${root}/status/connection`, `${root}/status/faults`], error => {
        if (error) this.logger.error(`Dyson ${serial} subscribe failed: ${error.message}`);
        else this.requestState(serial);
      });
      this.publish(`${this.base(serial)}/availability`, 'online');
    });
    client.on('message', (topic, payload) => this.handleDeviceMessage(serial, topic, payload));
    client.on('close', () => {
      if (device.online) {
        device.online = false;
        this.publish(`${this.base(serial)}/availability`, 'offline');
        this.logger.warn(`Dyson ${serial} disconnected`);
      }
    });
    client.on('error', error => this.logger.error(`Dyson ${serial}: ${error.message}`));
    if (this.config.pollIntervalSeconds) {
      device.poller = setInterval(() => this.requestState(serial), this.config.pollIntervalSeconds * 1000);
      device.poller.unref?.();
    }
  }

  async connectCloudDevice(serial, device) {
    if (this.stopped) return;
    try {
      const { Endpoint, IoTCredentials: auth } = await this.cloud.iotCredentials(this.config.dysonCloud.token, serial);
      if (this.stopped) return;
      const headers = {
        [auth.TokenKey]: auth.TokenValue,
        'X-Amz-CustomAuthorizer-Name': auth.CustomAuthorizerName,
        'X-Amz-CustomAuthorizer-Signature': auth.TokenSignature
      };
      const client = this.connect(`wss://${Endpoint}/mqtt`, {
        clientId: auth.ClientId,
        protocolId: 'MQIsdp', protocolVersion: 3,
        wsOptions: { headers },
        reconnectPeriod: 0, connectTimeout: 10000
      });
      this.clients.set(serial, client);
      client.on('connect', () => {
        device.retryDelay = 1000;
        this.logger.info(`Connected to Dyson cloud for ${serial}`);
        const root = `${device.config.productType}/${serial}`;
        client.subscribe([`${root}/status/current`, `${root}/status/connection`, `${root}/status/faults`], { qos: 1 }, error => {
          if (error) this.logger.error(`Dyson ${serial} subscribe failed: ${error.message}`);
          else this.requestState(serial);
        });
      });
      client.on('message', (topic, payload) => this.handleDeviceMessage(serial, topic, payload));
      client.on('error', error => this.logger.error(`Dyson cloud ${serial}: ${error.message}`));
      client.on('close', () => this.cloudDisconnected(serial, device));
      if (this.config.pollIntervalSeconds && !device.poller) {
        device.poller = setInterval(() => this.requestState(serial), this.config.pollIntervalSeconds * 1000);
        device.poller.unref?.();
      }
    } catch (error) {
      this.logger.error(`Dyson cloud credentials for ${serial}: ${error.message}`);
      this.cloudDisconnected(serial, device);
    }
  }

  cloudDisconnected(serial, device) {
    if (this.stopped) return;
    this.clients.delete(serial);
    if (device.online) {
      device.online = false;
      this.publish(`${this.base(serial)}/availability`, 'offline');
    }
    if (device.retryTimer) return;
    const delay = device.retryDelay ?? 1000;
    device.retryDelay = Math.min(delay * 2, 60000);
    this.logger.warn(`Dyson cloud ${serial} disconnected; retrying in ${delay} ms`);
    device.retryTimer = setTimeout(() => {
      device.retryTimer = undefined;
      this.connectCloudDevice(serial, device);
    }, delay);
    device.retryTimer.unref?.();
  }

  requestState(serial) {
    const client = this.clients.get(serial);
    const device = this.devices.get(serial);
    if (!client?.connected) return;
    const topic = `${device.config.productType}/${serial}/command`;
    for (const msg of REQUESTS) client.publish(topic, JSON.stringify({ msg, time: new Date().toISOString() }));
  }

  handleDeviceMessage(serial, topic, payload) {
    const device = this.devices.get(serial);
    const message = parseMessage(payload);
    if (!message) { this.logger.warn(`Ignoring invalid JSON from Dyson ${serial}`); return; }
    if (this.config.mode === 'cloud') {
      if (message.msg === 'GOODBYE' || message.msg === 'GONE-AWAY') {
        device.online = false;
        this.publish(`${this.base(serial)}/availability`, 'offline');
      } else if (!device.online && ['HELLO', 'IM-BACK', 'CURRENT-STATE', 'STATE-CHANGE', 'ENVIRONMENTAL-CURRENT-SENSOR-DATA'].includes(message.msg)) {
        device.online = true;
        this.publish(`${this.base(serial)}/availability`, 'online');
      }
    }
    if (message.msg === 'CURRENT-STATE' || message.msg === 'STATE-CHANGE') {
      device.product = mergeProductState(device.product, message);
    } else if (message.msg === 'ENVIRONMENTAL-CURRENT-SENSOR-DATA' && message.data && typeof message.data === 'object') {
      device.sensors = { ...device.sensors, ...message.data };
    } else if (message.msg === 'CURRENT-FAULTS' || message.msg === 'FAULTS-CHANGE') {
      this.publish(`${this.base(serial)}/faults`, message);
    }
    if (message.msg === 'CURRENT-STATE' || message.msg === 'STATE-CHANGE' || message.msg === 'ENVIRONMENTAL-CURRENT-SENSOR-DATA') {
      this.publish(`${this.base(serial)}/state`, stateView(device.product, device.sensors));
    }
    this.publish(`${this.base(serial)}/raw/${message.msg.toLowerCase().replace(/[^a-z0-9-]/g, '_')}`, message, false);
  }

  handleCommand(topic, payload) {
    const parts = topic.split('/');
    const prefix = this.config.topicPrefix.split('/');
    if (parts.length !== prefix.length + 3 || parts.slice(0, prefix.length).join('/') !== this.config.topicPrefix || parts[prefix.length + 1] !== 'set') return;
    const serial = parts[prefix.length];
    const command = parts[prefix.length + 2];
    const device = this.devices.get(serial);
    const client = this.clients.get(serial);
    if (!device || !client?.connected) return;
    try {
      const message = commandFromTopic(command, payload, device.product);
      client.publish(`${device.config.productType}/${serial}/command`, JSON.stringify(message), error => {
        if (error) this.logger.error(`Dyson ${serial} command failed: ${error.message}`);
      });
    } catch (error) {
      this.logger.warn(`Dyson ${serial}: ${error.message}`);
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const [serial, device] of this.devices) {
      if (device.poller) clearInterval(device.poller);
      if (device.retryTimer) clearTimeout(device.retryTimer);
      this.publish(`${this.base(serial)}/availability`, 'offline');
    }
    this.publish(`${this.config.topicPrefix}/bridge/availability`, 'offline');
    for (const client of this.clients.values()) client.end(true);
    this.broker?.end(false);
  }
}
