import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Forces logger to silent + matches the env contract in tests.
    env: { NODE_ENV: 'test' },
  },
});
