import { defineConfig } from '@playwright/test';

const baseURL = process.env.CHANGAN_BASE_URL || 'http://127.0.0.1:5175';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [`--use-angle=${process.env.CHANGAN_ANGLE || (process.platform === 'win32' ? 'd3d11' : 'swiftshader')}`],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.CHANGAN_BASE_URL ? undefined : {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
