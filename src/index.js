import { loadConfig } from './config.js';
import { DysonBridge } from './bridge.js';

try {
  const bridge = new DysonBridge(await loadConfig());
  bridge.start();
  process.once('SIGINT', () => { bridge.stop(); process.exit(0); });
  process.once('SIGTERM', () => { bridge.stop(); process.exit(0); });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
