/**
 * Playwright config for the DataHub panel smoke matrix.
 *
 * Run locally:
 *   pnpm dlx playwright install chromium firefox
 *   DATAHUB_USER=... DATAHUB_PASS=... pnpm dlx playwright test
 *
 * In CI (future):
 *   - Inject creds from a sealed secret
 *   - Pin to a known production URL or a test deployment
 *   - Upload trace artifacts on failure for postmortem
 *
 * The config keeps tests serial (workers: 1) because the smoke runs against a
 * shared production-like environment; running them in parallel would cross
 * each other's panels.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: true,
    baseURL: process.env.DATAHUB_BASE_URL ?? 'https://nekazari.robotika.cloud',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
