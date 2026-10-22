/**
 * BOARD-2412: live plugin lab. Code typed in the editor is transpiled in the browser and
 * re-installed on the board without a page reload; broken code shows in the issue panel and the
 * board keeps the last working version.
 */
import { expect, test, type Page } from '@playwright/test';
import { click, nextFrame, openBoard } from './support/board.js';

declare global {
  interface Window {
    /** Marks a board instance, to tell whether a re-install swapped it. */
    __labMark?: unknown;
  }
}

const STAMP = `import { defineTool, definePlugin } from '@kujam/core';
export default definePlugin({
  id: 'e2e.stamp',
  tools: [defineTool({
    id: 'e2e.stamp',
    initial: 'idle',
    states: {
      idle: {
        onPointerDown(ctx, e) {
          ctx.board.create({ type: 'geo', x: e.point.x - 20, y: e.point.y - 20, w: 40, h: 40, props: { geo: 'star' } });
        },
      },
    },
  })],
});
`;

/** Replaces the editor content as if typed, which triggers the debounced re-install. */
async function typeSource(page: Page, source: string): Promise<void> {
  await page.locator('.plugin-lab-editor .cm-content').fill(source);
}

function markBoard(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.__labMark = window.__board;
  });
}

function sameBoard(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__labMark === window.__board && !window.__board!.disposed);
}

test.describe('BOARD-2412: live plugin lab', () => {
  test('re-installs edited code without reloading, and survives broken code', async ({ page }) => {
    await openBoard(page, { scenario: 'plugin-lab', query: { example: 'brush' } });
    await expect(page.locator('.plugin-lab-status')).toContainText('lab.crayon-brush');
    expect(await page.evaluate(() => !!window.__board!.brushes.get('lab.crayon'))).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    // Broken code: compile error in the panel, same board still running.
    await markBoard(page);
    await typeSource(page, 'export const = ;');
    await expect(page.locator('.plugin-lab-issue[data-kind="compile"]')).toBeVisible();
    await expect(page.locator('.plugin-lab-status')).toHaveAttribute('data-state', 'error');
    expect(await sameBoard(page)).toBe(true);

    // Working code: a new board with the new tool, same page.
    await typeSource(page, STAMP);
    await expect(page.locator('.plugin-lab-status')).toContainText('e2e.stamp');
    expect(await sameBoard(page)).toBe(false);
    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    ).toBe(true);

    await page.evaluate(() => window.__board!.setTool('e2e.stamp'));
    await click(page, { x: 200, y: 200 });
    await nextFrame(page);
    const stars = await page.evaluate(
      () =>
        Object.values(window.__board!.getDocument().records).filter(
          (r) => r.kind === 'element' && r.type === 'geo',
        ).length,
    );
    expect(stars).toBe(1);
  });

  test('runtime errors of a tool show in the panel and the board keeps working', async ({
    page,
  }) => {
    await openBoard(page, { scenario: 'plugin-lab', query: { example: 'broken' } });
    await expect(page.locator('.plugin-lab-status')).toContainText('lab.broken');
    await page.evaluate(() => window.__board!.setTool('lab.faulty'));
    await click(page, { x: 200, y: 200 });
    await expect(
      page.locator('.plugin-lab-issue[data-kind="runtime"]', { hasText: 'Tool sengaja gagal' }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.__board!.disposed)).toBe(false);
  });
});
