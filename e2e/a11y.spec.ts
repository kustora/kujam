/**
 * BOARD-1908: Automated accessibility audit with `@axe-core/playwright` on playground scenarios.
 * Any `serious` or `critical` violation fails the test and blocks CI.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { click, nextFrame, openBoard, seed, sticky } from './support/board.js';

/** Runs axe-core on the page and returns any `serious` or `critical` violations. */
async function findSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  return results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

test.describe('BOARD-1908: axe-core accessibility audit', () => {
  test('mounted board with default UI and kitchen-sink elements has no serious/critical violations (light theme)', async ({
    page,
  }) => {
    await openBoard(page, {
      query: { fixture: '0.1.0/kitchen-sink', ui: '1' },
    });
    await nextFrame(page);

    const serious = await findSeriousViolations(page);
    expect(serious).toEqual([]);
  });

  test('mounted board with active selection toolbar and dark theme has no serious/critical violations', async ({
    page,
  }) => {
    await openBoard(page, {
      query: { ui: '1', theme: 'dark', locale: 'en' },
    });
    await seed(page, [sticky('a', 120, 120)]);
    await click(page, { x: 220, y: 220 });
    await nextFrame(page);

    const serious = await findSeriousViolations(page);
    expect(serious).toEqual([]);
  });

  for (const theme of ['light', 'dark']) {
    test(`open shortcut help panel has no serious/critical violations (${theme}, BOARD-1409)`, async ({
      page,
    }) => {
      await openBoard(page, { query: { ui: '1', theme } });
      await click(page, { x: 600, y: 400 });
      await page.keyboard.press('Shift+Slash');
      await expect(page.locator('kujam-shortcut-help').getByRole('dialog')).toBeVisible();

      const serious = await findSeriousViolations(page);
      expect(serious).toEqual([]);
    });
  }
});
