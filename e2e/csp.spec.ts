/**
 * BOARD-2006: The packages run under a strict Content Security Policy, without `unsafe-eval` and
 * without `unsafe-inline` for scripts and styles. The playground serves `?csp=1` pages with that
 * policy; only its own `<style>` and Vite's injected tags carry the allowed nonce.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  click,
  drag,
  focusBoard,
  nextFrame,
  openBoard,
  press,
  seed,
  snapshot,
  sticky,
} from './support/board.js';

interface Violation {
  readonly directive: string;
  readonly blocked: string;
  readonly sample: string;
  readonly source: string;
}

declare global {
  interface Window {
    __cspViolations?: Violation[];
  }
}

/** Records every CSP violation of the page, from before its first script runs. */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations!.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        sample: e.sample,
        source: `${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`,
      });
    });
  });
}

/** Violations of the page, or only those not raised by the playground shell with `packagesOnly`. */
async function violations(page: Page, { packagesOnly = false } = {}): Promise<Violation[]> {
  const all = await page.evaluate(() => window.__cspViolations ?? []);
  // WebKit reports `style-src-attr` for the user-agent shadow tree of every `<select>`, attributed
  // to the script that created it. The playground shell has selects; the packages have none.
  return packagesOnly ? all.filter((v) => !/^https?:\/\/[^/]+\/src\//.test(v.source)) : all;
}

test.describe('BOARD-2006: strict Content Security Policy', () => {
  test.beforeEach(async ({ page }) => {
    await recordViolations(page);
  });

  test('the policy is enforced: an inline <style> is blocked', async ({ page }) => {
    const response = await page.goto('/s/harness?bare=1&test=1&csp=1');
    expect(response!.headers()['content-security-policy']).toContain("style-src 'self' 'nonce-");
    await page.locator('html[data-board-ready="true"]').waitFor();

    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = 'body { outline: 1px solid red; }';
      document.head.append(style);
    });
    await expect.poll(async () => (await violations(page)).length).toBeGreaterThan(0);
    expect((await violations(page))[0]!.directive).toMatch(/^style-src/);
  });

  test('rendering the kitchen-sink fixture with the default UI raises no violations', async ({
    page,
  }) => {
    await openBoard(page, { query: { csp: '1', ui: '1', fixture: '0.1.0/kitchen-sink' } });

    // UI components are styled through adopted stylesheets, not `<style>` elements.
    const toolbar = page.locator('kujam-toolbar');
    await expect(toolbar).toBeVisible();
    const styled = await toolbar.evaluate((el) => {
      const bar = el.shadowRoot!.querySelector('[role="toolbar"]')!;
      return {
        adopted: el.shadowRoot!.adoptedStyleSheets.length,
        inline: el.shadowRoot!.querySelectorAll('style').length,
        radius: getComputedStyle(bar).borderTopLeftRadius,
      };
    });
    expect(styled).toMatchObject({ adopted: 1, inline: 0 });
    expect(styled.radius).not.toBe('0px');

    expect(await violations(page, { packagesOnly: true })).toEqual([]);
  });

  test('selection toolbar, text editor, drawing, and command palette raise no violations', async ({
    page,
  }) => {
    const root = await openBoard(page, { query: { csp: '1', ui: '1' } });
    await seed(page, [sticky('a', 120, 120)]);

    await click(page, { x: 220, y: 220 });
    await expect(page.locator('kujam-selection-toolbar')).toBeVisible();
    await click(page, { x: 220, y: 220 }, { clickCount: 2 });
    await page.keyboard.type('CSP');
    await page.keyboard.press('Escape');
    await nextFrame(page);

    await page.evaluate(() => window.__board!.setTool('draw'));
    await drag(page, [
      { x: 500, y: 150 },
      { x: 600, y: 250 },
      { x: 700, y: 150 },
    ]);
    expect((await snapshot(page)).elements.map((e) => e.type)).toEqual(['sticky', 'draw']);

    await focusBoard(page);
    await press(page, 'Mod+KeyK');
    const palette = page.locator('kujam-command-palette');
    await expect
      .poll(() => palette.evaluate((el) => (el as unknown as { isOpen: boolean }).isOpen))
      .toBe(true);
    await page.keyboard.press('Escape');

    await expect(root).toBeVisible();
    expect(await violations(page, { packagesOnly: true })).toEqual([]);
  });
});
