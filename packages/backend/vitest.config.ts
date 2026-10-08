import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      CVR_PROVIDER: 'datafordeler',
      DATAFORDELER_API_KEY: 'test-datafordeler-key',
      PIPEDRIVE_JWT_SECRET: 'test-secret',
    },
  },
});
