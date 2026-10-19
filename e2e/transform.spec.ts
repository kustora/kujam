/**
 * BOARD-903: interactive move, resize, and rotate; arrow-key nudges; Alt+drag duplicates. Every
 * interaction is a single undo step.
 */
import { expect, test } from '@playwright/test';
import {
  click,
  drag,
  element,
  focusBoard,
  openBoard,
  press,
  seed,
  snapshot,
  sticky,
} from './support/board.js';

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await seed(page, [sticky('a', 100, 100), sticky('b', 500, 100)]);
  // Snapping has its own tests (BOARD-904); here positions follow the pointer exactly.
  await page.evaluate(() => window.__board!.setSnapOptions({ enabled: false }));
});

async function undo(page: import('@playwright/test').Page): Promise<void> {
  await focusBoard(page);
  await press(page, 'Mod+KeyZ');
}

test('dragging moves an element as one undo step', async ({ page }) => {
  await drag(page, [
    { x: 200, y: 200 },
    { x: 250, y: 230 },
    { x: 300, y: 260 },
  ]);
  expect(element(await snapshot(page), 'a')).toMatchObject({ x: 200, y: 160 });
  await undo(page);
  const after = await snapshot(page);
  expect(element(after, 'a')).toMatchObject({ x: 100, y: 100 });
  expect(after.canUndo).toBe(false);
});

test('the corner handle resizes, Shift keeps the ratio', async ({ page }) => {
  // Sticky notes always stay square, so this uses a rectangle.
  await seed(page, [
    { id: 'r', type: 'geo', x: 100, y: 500, w: 200, h: 100, props: { geo: 'rectangle' } },
  ]);
  await click(page, { x: 200, y: 550 });
  await drag(page, [
    { x: 300, y: 600 },
    { x: 400, y: 650 },
  ]);
  expect(element(await snapshot(page), 'r')).toMatchObject({ x: 100, y: 500, w: 300, h: 150 });

  await undo(page);
  await drag(
    page,
    [
      { x: 300, y: 600 },
      { x: 400, y: 620 },
    ],
    { modifiers: ['Shift'] },
  );
  const { w, h } = element(await snapshot(page), 'r');
  expect(w / h).toBeCloseTo(2, 5);
  expect(w).toBeGreaterThan(200);
});

test('the rotate handle rotates, Shift snaps to 15 degrees', async ({ page }) => {
  await click(page, { x: 200, y: 200 });
  // The rotate handle sits 24 px above the top edge center.
  await drag(
    page,
    [
      { x: 200, y: 76 },
      { x: 280, y: 90 },
      { x: 330, y: 140 },
    ],
    { modifiers: ['Shift'] },
  );
  const { rotation } = element(await snapshot(page), 'a');
  expect(rotation).not.toBe(0);
  expect(Math.abs(rotation % 15)).toBeLessThan(1e-6);
  await undo(page);
  expect(element(await snapshot(page), 'a').rotation).toBe(0);
});

test('arrow keys nudge by 1, Shift+arrow by 10', async ({ page }) => {
  await click(page, { x: 200, y: 200 });
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  await press(page, 'Shift+ArrowDown');
  expect(element(await snapshot(page), 'a')).toMatchObject({ x: 102, y: 110 });
  // A run of nudges is one undo step.
  await undo(page);
  expect(element(await snapshot(page), 'a')).toMatchObject({ x: 100, y: 100 });
});

test('Alt+drag moves a copy and leaves the original', async ({ page }) => {
  await drag(
    page,
    [
      { x: 200, y: 200 },
      { x: 200, y: 400 },
      { x: 200, y: 500 },
    ],
    { modifiers: ['Alt'] },
  );
  const after = await snapshot(page);
  expect(after.elements).toHaveLength(3);
  expect(element(after, 'a')).toMatchObject({ x: 100, y: 100 });
  const [copy] = after.selection;
  expect(copy).not.toBe('a');
  expect(element(after, copy!)).toMatchObject({ type: 'sticky', x: 100, y: 400, w: 200, h: 200 });

  await undo(page);
  const undone = await snapshot(page);
  expect(undone.elements.map((el) => el.id)).toEqual(['a', 'b']);
  expect(undone.canUndo).toBe(false);
});
