/**
 * Express app factory. Builds and returns the app WITHOUT listening — so tests
 * can import it directly (supertest) and server.js owns the network bind.
 * New feature modules mount their routers here as they land (see PLAN.md §6).
 */
import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { notFound, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json());

  // --- Routes -------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Feature routers get mounted above this line.

  // --- Tail middleware (order matters) ------------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
