/**
 * Parsed + validated environment. Import `env` anywhere instead of touching
 * process.env directly. Fails fast (exits) if required vars are malformed.
 * See PLAN.md §8 for the full list.
 */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  // Comma-separated allowed CORS origins (admin Vite + Expo dev server).
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8081'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
