/**
 * A macOS trackpad can report a move with no button down before the button goes up. Chromium then
 * drops the pointer capture before `pointerup`; the gesture must still end as a release, not roll
 * back the drag or the selection box.
 *
 * Playwright's mouse never sends such a move, so these tests drive the Chrome DevTools Protocol.
 */
import { expect, test, type Page } from '@playwright/test';
import { element, openBoard, seed, snapshot, sticky, toPage } from './support/board.js';
import type { Point } from '../packages/core/src/index.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'Drives the Chrome DevTools Protocol');

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await seed(page, [sticky('a', 100, 100), sticky('b', 400, 100)]);
  await page.evaluate(() => window.__board!.setSnapOptions({ enabled: false }));
});

/** Presses at `from`, drags to `to`, moves once with no button down, then releases. */
async function trackpadDrag(page: Page, from: Point, to: Point): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const start = await toPage(page, from);
  const end = await toPage(page, to);
  const mouse = (type: string, p: Point, buttons: number) =>
    cdp.send('Input.dispatchMouseEvent', {
      type: type as 'mouseMoved',
      x: p.x,
      y: p.y,
      button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  await mouse('mouseMoved', start, 0);
  await mouse('mousePressed', start, 1);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    await mouse(
      'mouseMoved',
      { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t },
      1,
    );
  }
  await mouse('mouseMoved', end, 0);
  await mouse('mouseReleased', end, 0);
  await cdp.detach();
}

test('a drag released with a buttonless move keeps the moved element', async ({ page }) => {
  await trackpadDrag(page, { x: 200, y: 200 }, { x: 300, y: 260 });
  const snap = await snapshot(page);
  expect(element(snap, 'a')).toMatchObject({ x: 200, y: 160 });
  expect(snap.selection).toEqual(['a']);
});

test('a selection box released with a buttonless move keeps the selection', async ({ page }) => {
  await trackpadDrag(page, { x: 60, y: 60 }, { x: 640, y: 340 });
  expect((await snapshot(page)).selection).toEqual(['a', 'b']);
});
