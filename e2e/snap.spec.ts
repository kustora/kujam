/**
 * BOARD-904: snapping while moving, with guides; Ctrl/Cmd turns it off temporarily, and the snap
 * options turn it off for good.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  element,
  modKey,
  nextFrame,
  openBoard,
  seed,
  snapshot,
  sticky,
  toPage,
} from './support/board.js';

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  // b sits 5 units lower than a: dragging b horizontally aligns its top with a's top.
  await seed(page, [sticky('a', 96, 96), sticky('b', 496, 101)]);
});

const guides = (page: Page) =>
  page.evaluate(
    () => ((window.__board!.toolData as { guides?: unknown[] } | null)?.guides ?? []).length,
  );

/** Presses on b's center, moves by `dx` while holding `modifiers`, and returns before release. */
async function startDrag(page: Page, dx: number, modifiers: string[] = []): Promise<void> {
  const from = await toPage(page, { x: 596, y: 201 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(from.x + dx, from.y, { steps: 6 });
  await nextFrame(page);
}

test('moving snaps to aligned elements and shows guides', async ({ page }) => {
  // Without the grid, so only element snapping applies.
  await page.evaluate(() => window.__board!.setSnapOptions({ grid: null }));
  await startDrag(page, 40);
  expect(element(await snapshot(page), 'b').y).toBe(96);
  expect(await guides(page)).toBeGreaterThan(0);
  await page.mouse.up();
  await nextFrame(page);
  expect(await guides(page)).toBe(0);
  expect(element(await snapshot(page), 'b').y).toBe(96);
});

test('Ctrl/Cmd turns snapping off while held', async ({ page }) => {
  const mod = await modKey(page);
  await startDrag(page, 40, [mod]);
  expect(await guides(page)).toBe(0);
  const b = element(await snapshot(page), 'b');
  expect(b.y).toBe(101);
  expect(b.x).toBe(536);
  await page.mouse.up();
  await page.keyboard.up(mod);
});

test('snapping to elements and to the grid can be turned off through options', async ({ page }) => {
  await page.evaluate(() => window.__board!.setSnapOptions({ elements: false, grid: null }));
  await startDrag(page, 43);
  expect(await guides(page)).toBe(0);
  expect(element(await snapshot(page), 'b')).toMatchObject({ x: 539, y: 101 });
  await page.mouse.up();
});

test('grid snapping alone still applies when element snapping is off', async ({ page }) => {
  await page.evaluate(() => window.__board!.setSnapOptions({ elements: false }));
  await startDrag(page, 43);
  const { x } = element(await snapshot(page), 'b');
  // Default grid: 8 units. The left edge, center, or right edge lands on a grid line.
  expect(x).not.toBe(539);
  expect([x, x + 100, x + 200].some((v) => v % 8 === 0)).toBe(true);
  await page.mouse.up();
});
