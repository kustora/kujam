/**
 * BOARD-104: pointer helpers for pens with pressure, checked against the draw tool.
 */
import { expect, test } from '@playwright/test';
import {
  element,
  focusBoard,
  openBoard,
  pointerStream,
  press,
  seed,
  snapshot,
  sticky,
} from './support/board.js';

test('a pen stroke keeps the pressure of each point', async ({ page }) => {
  await openBoard(page);
  await focusBoard(page);
  await press(page, 'p');
  // A wave, so simplification keeps intermediate points.
  const wave = Array.from({ length: 41 }, (_, i) => ({
    x: 100 + i * 10,
    y: 300 + Math.sin(i / 3) * 80,
    pressure: 0.2 + 0.6 * (i / 40),
  }));
  await pointerStream(page, 'pen', [wave]);
  const pressures = await page.evaluate(() => {
    const [stroke] = window.__board!.query({ type: 'draw' });
    return ((stroke?.props.points ?? []) as number[][]).map((p) => p[2]!);
  });
  expect(pressures.length).toBeGreaterThan(2);
  expect(Math.min(...pressures)).toBeLessThan(0.4);
  expect(Math.max(...pressures)).toBeGreaterThan(0.6);
});

test('@touch two-finger tap undoes, three-finger tap redoes (BOARD-911)', async ({ page }) => {
  await openBoard(page);
  await seed(page, [sticky('a', 96, 96)]);
  await page.evaluate(() => window.__board!.history.clear());
  await page.evaluate(() => window.__board!.update('a', { x: 300 }));
  expect(element(await snapshot(page), 'a').x).toBe(300);

  await pointerStream(page, 'touch', [[{ x: 600, y: 300 }], [{ x: 680, y: 300 }]]);
  expect(element(await snapshot(page), 'a').x).toBe(96);

  await pointerStream(page, 'touch', [
    [{ x: 600, y: 300 }],
    [{ x: 680, y: 300 }],
    [{ x: 760, y: 300 }],
  ]);
  expect(element(await snapshot(page), 'a').x).toBe(300);
});
