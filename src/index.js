import { loadConfig } from './config.js';
import { DysonBridge } from './bridge.js';
import { createLogger } from './logger.js';

try {
  const logger = createLogger();
  const bridge = new DysonBridge(await loadConfig(), undefined, logger);
  bridge.start();
  process.once('SIGINT', () => { logger.info('Received SIGINT; stopping bridge'); bridge.stop(); process.exit(0); });
  process.once('SIGTERM', () => { logger.info('Received SIGTERM; stopping bridge'); bridge.stop(); process.exit(0); });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
