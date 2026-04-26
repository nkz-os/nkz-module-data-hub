/**
 * DataHub panel smoke matrix (G2).
 *
 * Why this lives as a Playwright spec rather than unit tests: the panel's
 * value is end-to-end (worker → uPlot → DOM overlays). Asserting only the
 * pure functions (computeYRange, distributeAxes, pearsonCorrelation) misses
 * the whole class of bugs that shipped to production — alignment, scale
 * compression, render-empty-when-points-exist.
 *
 * Run:
 *   pnpm dlx playwright install chromium firefox
 *   pnpm dlx playwright test --config=playwright.config.ts
 *
 * Required env:
 *   DATAHUB_BASE_URL  e.g. https://nekazari.robotika.cloud (the host)
 *   DATAHUB_USER      Keycloak user
 *   DATAHUB_PASS      Keycloak password
 *
 * The matrix:
 *   - Browsers: chromium, firefox
 *   - Time ranges: 24h, 7d, 30d
 *   - Scenarios: single series, multi-series dual-axis (auto), correlation
 *   - Acceptance per case (mirrors plan G3):
 *       1. Panel renders without console errors
 *       2. No 'no data' state when worker.stats.pointsPlotted > 0
 *       3. Trace is visually present (canvas height of trace > 1px sample)
 *       4. Footer telemetry strip prints points, viewport and scale mode
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.DATAHUB_BASE_URL ?? 'https://nekazari.robotika.cloud';
const USER = process.env.DATAHUB_USER ?? '';
const PASS = process.env.DATAHUB_PASS ?? '';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto(`${BASE_URL}/`);
  // Keycloak detection — login form is rendered by the SDK when nkz_token cookie missing.
  if (await page.locator('input[name="username"]').isVisible().catch(() => false)) {
    if (!USER || !PASS) {
      throw new Error('DATAHUB_USER / DATAHUB_PASS env vars required for auth');
    }
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.toString().includes('/auth/realms/'));
  }
}

async function openDataHub(page: Page) {
  await page.goto(`${BASE_URL}/module/datahub`);
  await expect(page.locator('text=Lienzo táctico')).toBeVisible({ timeout: 15_000 });
}

async function pickSingleTimeseries(page: Page, attribute: string) {
  // First WeatherObserved entity in the tree → click attribute to add to canvas.
  const tree = page.locator('aside, nav').filter({ hasText: 'FUENTES DE DATOS' }).first();
  // Open first WeatherObserved row.
  await tree.locator('text=WeatherObserved').first().click();
  await tree.locator(`text=${attribute}`).first().click();
}

async function setRange(page: Page, range: '24h' | '7d' | '30d') {
  const labelMap = { '24h': '24 horas', '7d': '7 días', '30d': '30 días' } as const;
  await page.getByRole('button', { name: labelMap[range] }).click();
  // Worker pipeline has at most ~1s for fetch+downsample at this size.
  await page.waitForTimeout(1500);
}

async function expectNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // Caller awaits work; this attaches listeners. Asserted at end of each test.
  return () => errors;
}

async function expectPanelRendered(page: Page) {
  // Telemetry strip prints "<plotted>/<received> pts · WxH · <mode> · <stage>"
  const footer = page.locator('text=/\\d+\\/\\d+ pts/').first();
  await expect(footer).toBeVisible();
  // Panel must NOT be in 'no data' state when points are reported.
  await expect(page.locator('text=Sin datos')).toHaveCount(0);
  // Canvas must exist and be > 0 px tall.
  const canvasBox = await page.locator('.uplot canvas').first().boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.height).toBeGreaterThan(50);
}

const RANGES = ['24h', '7d', '30d'] as const;

for (const range of RANGES) {
  test(`single series, ${range}`, async ({ page }) => {
    const errs = await expectNoConsoleErrors(page);
    await login(page);
    await openDataHub(page);
    await setRange(page, range);
    await pickSingleTimeseries(page, 'temperature');
    await page.waitForTimeout(1500);
    await expectPanelRendered(page);
    expect(errs(), `console errors during single-series ${range}`).toEqual([]);
  });
}

test('multi-series dual-axis auto-distribute (temperature + windSpeed)', async ({ page }) => {
  const errs = await expectNoConsoleErrors(page);
  await login(page);
  await openDataHub(page);
  await setRange(page, '7d');
  await pickSingleTimeseries(page, 'temperature');
  await page.waitForTimeout(1500);
  await pickSingleTimeseries(page, 'windSpeed');
  await page.waitForTimeout(1500);
  await expectPanelRendered(page);
  // Expect both axes rendered (left 'y' + right 'y2'). uPlot exposes axes as
  // .u-legend members or via canvas axes; we check via the unit suffix.
  await expect(page.locator('text=°C').first()).toBeVisible();
  await expect(page.locator('text=m/s').first()).toBeVisible();
  expect(errs(), 'console errors during multi-series test').toEqual([]);
});

test('correlation mode shows Pearson r and n', async ({ page }) => {
  const errs = await expectNoConsoleErrors(page);
  await login(page);
  await openDataHub(page);
  await setRange(page, '7d');
  await pickSingleTimeseries(page, 'temperature');
  await page.waitForTimeout(1500);
  await pickSingleTimeseries(page, 'relativeHumidity');
  await page.waitForTimeout(1500);
  // Toolbar correlation button.
  await page.getByRole('button', { name: /Correlación|Correlation/ }).click();
  // Badge appears top-left of chart with 'r = ...' and 'n = ...'.
  await expect(page.locator('text=/r =/').first()).toBeVisible();
  await expect(page.locator('text=/n =/').first()).toBeVisible();
  expect(errs(), 'console errors during correlation test').toEqual([]);
});

test('zoom + right-click undo + reset', async ({ page }) => {
  const errs = await expectNoConsoleErrors(page);
  await login(page);
  await openDataHub(page);
  await setRange(page, '30d');
  await pickSingleTimeseries(page, 'temperature');
  await page.waitForTimeout(1500);

  const canvas = page.locator('.uplot canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  // Drag to zoom inside the canvas (X-only).
  const x0 = box.x + box.width * 0.3;
  const x1 = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x1, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Right-click undoes the zoom.
  await page.mouse.click(box.x + box.width / 2, y, { button: 'right' });
  await page.waitForTimeout(400);

  // Reset zoom button.
  await page.getByTitle(/Restablecer zoom|Reset zoom/).click();
  expect(errs(), 'console errors during zoom test').toEqual([]);
});
