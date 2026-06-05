/**
 * Server bootstrap: build the app and start listening. Kept deliberately thin
 * and deploy-agnostic — when we choose EC2 vs Lambda later, only this file (or
 * a sibling entry) changes; app.js stays untouched.
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
