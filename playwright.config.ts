/**
 * Playwright E2E and visual tests in Chromium, Firefox, and WebKit (BOARD-104).
 *
 * Tests open playground scenario routes in test mode (`?bare=1&test=1`, BOARD-2415), so there is
 * a single test page to maintain. Screenshot baselines live in `e2e/__screenshots__/`, per browser
 * and per OS, since font rendering differs between platforms.
 *
 * - `pnpm test:e2e`: all browsers.
 * - `pnpm test:e2e --project=webkit`: one browser.
 * - `pnpm test:e2e:update`: rewrite the screenshot baselines of the current OS.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.KUJAM_E2E_PORT ?? 5199);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{projectName}/{platform}/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: {
      // Anti-aliasing differs slightly between runs and GPUs.
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    // iPad emulation (touch, WebKit): only tests tagged `@touch` (ADR-004).
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'] }, grep: /@touch/ },
  ],
  webServer: {
    command: `pnpm --filter @kujam/playground exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/s/harness?bare=1`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
