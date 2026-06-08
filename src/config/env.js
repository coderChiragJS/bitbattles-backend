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

  // DynamoDB — region + table prefix; endpoint is optional (DynamoDB Local).
  AWS_REGION: z.string().default('ap-south-1'),
  DYNAMO_TABLE_PREFIX: z.string().default('bb_dev_'),
  DYNAMO_ENDPOINT: z.string().url().optional(),

  // Auth. JWT_SECRET ships with an insecure dev default; production is forced
  // to override it (see refine below).
  JWT_SECRET: z.string().min(16).default('dev-insecure-secret-change-me-now'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

// Never let the insecure dev secret reach production.
if (raw.NODE_ENV === 'production' && raw.JWT_SECRET === 'dev-insecure-secret-change-me-now') {
  console.error('JWT_SECRET must be set to a strong value in production.');
  process.exit(1);
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
