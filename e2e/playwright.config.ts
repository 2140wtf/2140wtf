import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3500';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      args: ['--disable-gpu', '--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_START_SERVER
    ? {
        command: 'npm run preview',
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
