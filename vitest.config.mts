import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    environment: 'node',
    globalSetup: ['tests/e2e/support/global-setup.ts'],
    // One server and one database for the whole suite, and every file resets
    // the booking tables before each test, so files must not run side by side.
    fileParallelism: false,
    // The first request to each route waits for next dev to compile it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
