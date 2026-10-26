import { isIP } from 'node:net';
import { hostname } from 'node:os';

export function isLocalHost(host) {
  if (typeof host !== 'string' || !host || /[\s/@?#\\]/.test(host)) return false;
  let name;
  try { name = new URL(`http://${host}`).hostname.toLowerCase(); } catch { return false; }
  if (['localhost', hostname().toLowerCase()].includes(name) || name.endsWith('.local')) return true;
  const address = name.replace(/^\[|\]$/g, '');
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(address) === 6) return address === '::1' || /^(fc|fd|fe[89ab])/.test(address);
  return false;
}
