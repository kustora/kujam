/**
 * BOARD-901: navigation with wheel, zoom, the hand tool, and zoom shortcuts.
 */
import { expect, test } from '@playwright/test';
import {
  drag,
  focusBoard,
  line,
  openBoard,
  pointerStream,
  press,
  seed,
  snapshot,
  sticky,
  wheel,
} from './support/board.js';

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

/** Screen position of a board point, relative to the board root. */
const screenOf = (page: import('@playwright/test').Page, p: { x: number; y: number }) =>
  page.evaluate((q) => window.__board!.camera.boardToScreen(q), p);

test('the wheel scrolls the view', async ({ page }) => {
  await wheel(page, { x: 400, y: 400 }, { y: 120 });
  await expect.poll(async () => (await snapshot(page)).camera.y).toBeGreaterThan(0);
  const { camera } = await snapshot(page);
  expect(camera.x).toBe(0);
  expect(camera.zoom).toBe(1);
});

test('Ctrl+wheel zooms around the cursor', async ({ page }) => {
  const anchor = { x: 400, y: 300 };
  const before = await screenOf(page, anchor);
  await wheel(page, anchor, { y: -100 }, { modifiers: ['Control'] });
  const { camera } = await snapshot(page);
  expect(camera.zoom).toBeGreaterThan(1);
  const after = await screenOf(page, anchor);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test('holding Space pans with the hand tool, then switches back', async ({ page }) => {
  await focusBoard(page);
  await page.keyboard.down('Space');
  expect((await snapshot(page)).tool).toBe('hand');
  await drag(page, [
    { x: 600, y: 400 },
    { x: 500, y: 300 },
  ]);
  await page.keyboard.up('Space');
  const { camera, tool } = await snapshot(page);
  expect(tool).toBe('select');
  expect(camera.x).toBeCloseTo(100, 0);
  expect(camera.y).toBeCloseTo(100, 0);
});

test('H selects the hand tool and V the select tool', async ({ page }) => {
  await focusBoard(page);
  await press(page, 'h');
  expect((await snapshot(page)).tool).toBe('hand');
  await drag(page, [
    { x: 300, y: 300 },
    { x: 350, y: 320 },
  ]);
  expect((await snapshot(page)).camera).toMatchObject({ x: -50, y: -20 });
  await press(page, 'v');
  expect((await snapshot(page)).tool).toBe('select');
});

test('Shift+1 zooms to everything and Shift+2 to the selection', async ({ page }) => {
  await seed(page, [sticky('a', 0, 0), sticky('b', 2400, 1600)]);
  await focusBoard(page);
  await press(page, 'Shift+Digit1');
  const fit = await snapshot(page);
  expect(fit.camera.zoom).toBeLessThan(1);
  const viewport = await page.evaluate(() => window.__board!.camera.getViewportBounds());
  expect(viewport.minX).toBeLessThanOrEqual(0);
  expect(viewport.maxX).toBeGreaterThanOrEqual(2600);

  await page.evaluate(() => window.__board!.select('b'));
  await press(page, 'Shift+Digit2');
  const selected = await snapshot(page);
  // Zoom to selection is capped at 100%.
  expect(selected.camera.zoom).toBe(1);
  const center = await page.evaluate(() => {
    const { width, height } = window.__board!.camera.viewport;
    return window.__board!.camera.screenToBoard({ x: width / 2, y: height / 2 });
  });
  expect(center.x).toBeCloseTo(2500, 0);
  expect(center.y).toBeCloseTo(1700, 0);
});

test('Mod+= and Mod+- step the zoom, Mod+0 resets to 100%', async ({ page }) => {
  await focusBoard(page);
  await press(page, 'Mod+Equal');
  expect((await snapshot(page)).camera.zoom).toBe(1.25);
  await press(page, 'Mod+Minus');
  await press(page, 'Mod+Minus');
  expect((await snapshot(page)).camera.zoom).toBe(0.75);
  await press(page, 'Mod+Digit0');
  expect((await snapshot(page)).camera.zoom).toBe(1);
});

test('@touch pinch zooms and one finger on empty space pans', async ({ page }) => {
  await pointerStream(page, 'touch', [
    line({ x: 380, y: 300 }, { x: 330, y: 300 }),
    line({ x: 420, y: 300 }, { x: 470, y: 300 }),
  ]);
  const pinched = await snapshot(page);
  expect(pinched.camera.zoom).toBeGreaterThan(2);

  await page.evaluate(() => window.__board!.camera.set({ x: 0, y: 0, zoom: 1 }));
  await pointerStream(page, 'touch', [line({ x: 500, y: 500 }, { x: 400, y: 450 })]);
  const panned = await snapshot(page);
  expect(panned.camera.x).toBeCloseTo(100, 0);
  expect(panned.camera.y).toBeCloseTo(50, 0);
});
