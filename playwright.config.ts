import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build served by `astro preview`.
// Run `pnpm build` first (CI does), then `pnpm test:e2e`.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 14322);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /compose\.spec/ },
  ],
  webServer: {
    command: `pnpm preview --ignore-lock --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
