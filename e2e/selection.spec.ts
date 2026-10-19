/**
 * BOARD-902: selection with click, Shift+click, selection box, and Alt+selection box (PRD
 * interaction table), plus locked elements.
 */
import { expect, test } from '@playwright/test';
import {
  click,
  drag,
  line,
  openBoard,
  pointerStream,
  seed,
  snapshot,
  sticky,
} from './support/board.js';

test.describe('mouse', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    // a and b side by side, c below a.
    await seed(page, [sticky('a', 96, 96), sticky('b', 400, 96), sticky('c', 96, 400)]);
  });

  test('click selects, clicking empty space clears', async ({ page }) => {
    await click(page, { x: 196, y: 196 });
    expect((await snapshot(page)).selection).toEqual(['a']);
    await click(page, { x: 500, y: 196 });
    expect((await snapshot(page)).selection).toEqual(['b']);
    await click(page, { x: 900, y: 600 });
    expect((await snapshot(page)).selection).toEqual([]);
  });

  test('Shift+click adds to and removes from the selection', async ({ page }) => {
    await click(page, { x: 196, y: 196 });
    await click(page, { x: 500, y: 196 }, { modifiers: ['Shift'] });
    expect((await snapshot(page)).selection).toEqual(['a', 'b']);
    await click(page, { x: 196, y: 196 }, { modifiers: ['Shift'] });
    expect((await snapshot(page)).selection).toEqual(['b']);
  });

  test('a selection box selects fully covered elements', async ({ page }) => {
    await drag(page, [
      { x: 60, y: 60 },
      { x: 640, y: 340 },
    ]);
    expect((await snapshot(page)).selection).toEqual(['a', 'b']);
  });

  test('Alt+selection box selects touched elements', async ({ page }) => {
    await drag(
      page,
      [
        { x: 60, y: 60 },
        { x: 150, y: 450 },
      ],
      { modifiers: ['Alt'] },
    );
    expect((await snapshot(page)).selection).toEqual(['a', 'c']);
  });

  test('Shift+selection box adds to the selection', async ({ page }) => {
    await click(page, { x: 196, y: 196 });
    await drag(
      page,
      [
        { x: 360, y: 60 },
        { x: 640, y: 340 },
      ],
      { modifiers: ['Shift'] },
    );
    expect((await snapshot(page)).selection).toEqual(['a', 'b']);
  });
});

test('locked elements are not boxed, but a click selects them to unlock from the toolbar', async ({
  page,
}) => {
  await openBoard(page, { query: { ui: '1', locale: 'en' } });
  await seed(page, [sticky('a', 96, 96), sticky('b', 400, 96)]);
  await page.evaluate(() => window.__board!.update('b', { locked: true }));

  await drag(page, [
    { x: 60, y: 60 },
    { x: 640, y: 340 },
  ]);
  expect((await snapshot(page)).selection).toEqual(['a']);

  // Dragging from a locked element draws a selection box and leaves it in place.
  await drag(
    page,
    [
      { x: 500, y: 196 },
      { x: 250, y: 150 },
    ],
    { modifiers: ['Alt'] },
  );
  const boxed = await snapshot(page);
  expect(boxed.selection).toEqual(['a']);
  expect(boxed.elements.find((el) => el.id === 'b')).toMatchObject({ x: 400, y: 96 });

  await click(page, { x: 500, y: 196 });
  expect((await snapshot(page)).selection).toEqual(['b']);
  await page.locator('kujam-selection-toolbar [data-action="lock"]').click();
  expect((await snapshot(page)).elements.find((el) => el.id === 'b')?.locked).toBe(false);
});

test('@touch tapping selects, tapping empty space clears', async ({ page }) => {
  await openBoard(page);
  await seed(page, [sticky('a', 96, 96)]);
  await pointerStream(page, 'touch', [[{ x: 196, y: 196 }]]);
  expect((await snapshot(page)).selection).toEqual(['a']);
  await pointerStream(page, 'touch', [[{ x: 700, y: 500 }]]);
  expect((await snapshot(page)).selection).toEqual([]);
  // A one-finger drag on an element moves it.
  await pointerStream(page, 'touch', [line({ x: 196, y: 196 }, { x: 296, y: 196 })]);
  expect((await snapshot(page)).elements[0]).toMatchObject({ x: 196, y: 96 });
});
