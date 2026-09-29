const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: /player-community\.e2e\.cjs/,
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'BXH_E2E_EMULATOR=1 node tests/e2e/static-server.cjs',
    url: 'http://127.0.0.1:4173/?bxh_e2e=1',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
