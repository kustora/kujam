/**
 * BOARD-1706: the playground File I/O panel imports an Excalidraw file into the current page.
 */
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { openBoard } from './support/board.js';

test('imports an .excalidraw file through its own button, as one undo step', async ({ page }) => {
  await openBoard(page, { scenario: 'empty', query: { bare: '0' } });
  const before = await page.evaluate(() => window.__board!.query({}).length);

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-excalidraw').click();
  await (await chooser).setFiles(resolve('fixtures/excalidraw/basic.excalidraw'));

  await expect(page.getByText(/elemen Excalidraw diimpor; 1 dilewati/)).toBeVisible();
  const types = await page.evaluate(() => window.__board!.query({}).map((el) => el.type));
  expect(types.length - before).toBe(11);
  expect(types).toContain('connector');

  await page.evaluate(() => window.__board!.undo());
  expect(await page.evaluate(() => window.__board!.query({}).length)).toBe(before);
});
