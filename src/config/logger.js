/**
 * Single shared pino logger. Silent during tests so vitest output stays clean.
 */
import { pino } from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
});
