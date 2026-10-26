import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHost } from '../src/web-access.js';

test('setup UI accepts loopback and local network hosts', () => {
  for (const host of ['localhost:3100', '127.0.0.1:3100', '192.168.1.20:3100', '10.0.0.20:3100', '172.16.0.2:3100', '172.31.255.2:3100', 'rpi.local:3100', '[::1]:3100', '[fd12::1]:3100', '[fe80::1]:3100']) {
    assert.equal(isLocalHost(host), true, host);
  }
});

test('setup UI rejects public and malformed hosts', () => {
  for (const host of ['', 'example.com:3100', '8.8.8.8:3100', '172.15.0.1:3100', '172.32.0.1:3100', '[2001:4860::1]:3100', 'localhost@evil.example', 'localhost/path', 'localhost?query', 'localhost#fragment']) {
    assert.equal(isLocalHost(host), false, host);
  }
});
