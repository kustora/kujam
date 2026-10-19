/**
 * BOARD-104: screenshot comparisons against baselines in `e2e/__screenshots__/`.
 */
import { expect, test } from '@playwright/test';
import { boardRoot, click, nextFrame, openBoard, seed, sticky } from './support/board.js';

test('kitchen-sink fixture', async ({ page }) => {
  const root = await openBoard(page, { query: { fixture: '0.1.0/kitchen-sink' } });
  await page.evaluate(() => window.__board!.camera.zoomToFit());
  await nextFrame(page);
  await expect(root).toHaveScreenshot('kitchen-sink.png');
});

test('selection frame and handles', async ({ page }) => {
  await openBoard(page, { query: { bg: 'grid' } });
  await seed(page, [sticky('a', 120, 120)]);
  await click(page, { x: 220, y: 220 });
  await expect(boardRoot(page)).toHaveScreenshot('selection.png');
});
