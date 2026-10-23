/**
 * BOARD-906: copy on one board and paste on another, across browser tabs, through the real
 * system clipboard.
 *
 * Synthetic Cmd+C / Cmd+V from Playwright do not run the browser's copy and paste commands on
 * macOS, so the test triggers them itself: `execCommand('copy')` fires the board's own `copy`
 * handler and writes the system clipboard, and the target tab reads the system clipboard and
 * dispatches `paste` with what it found. Only `text/plain` and `text/html` survive the system
 * clipboard here, so this also proves the HTML fallback carries the board content.
 */
import { expect, test, type Page } from '@playwright/test';
import { click, openBoard, seed, snapshot, sticky } from './support/board.js';

/** Runs the browser copy (or cut) command on the focused board. */
async function copyCommand(page: Page, command: 'copy' | 'cut'): Promise<void> {
  const ok = await page.evaluate((cmd) => document.execCommand(cmd), command);
  expect(ok).toBe(true);
}

/** Pastes the system clipboard into the board, as the browser does on Cmd+V. */
async function pasteFromSystemClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const data = new DataTransfer();
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        if (type.startsWith('text/')) data.setData(type, await (await item.getType(type)).text());
      }
    }
    const root = document.querySelector<HTMLElement>('.kujam-board-root')!;
    root.focus();
    const target = document.activeElement ?? root;
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
}

test('copy in one tab, paste in another, cut back', async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are only grantable in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const source = await context.newPage();
  await openBoard(source);
  await seed(source, [sticky('a', 96, 96)]);
  await source.evaluate(() =>
    window.__board!.update('a', { props: { text: [{ insert: 'Dari tab lain\n' }] } }),
  );
  await click(source, { x: 196, y: 196 });
  expect((await snapshot(source)).selection).toEqual(['a']);
  await copyCommand(source, 'copy');
  const types = await source.evaluate(async () =>
    (await navigator.clipboard.read()).flatMap((item) => [...item.types]),
  );
  expect(types).toEqual(expect.arrayContaining(['text/plain', 'text/html']));

  const target = await context.newPage();
  await openBoard(target);
  await pasteFromSystemClipboard(target);
  await expect
    .poll(async () => (await snapshot(target)).elements.filter((el) => el.type === 'sticky').length)
    .toBe(1);
  const pasted = (await snapshot(target)).elements.find((el) => el.type === 'sticky')!;
  // A new ID, the same content, one undo step.
  expect(pasted.id).not.toBe('a');
  const props = await target.evaluate((id) => window.__board!.getElement(id)?.props, pasted.id);
  expect(JSON.stringify(props)).toContain('Dari tab lain');
  expect(await target.evaluate(() => window.__board!.history.canUndo)).toBe(true);

  // Cut in the target tab and paste back into the source tab.
  await click(target, { x: pasted.x + 20, y: pasted.y + 20 });
  await copyCommand(target, 'cut');
  await expect.poll(async () => (await snapshot(target)).elements.length).toBe(0);
  await source.bringToFront();
  await pasteFromSystemClipboard(source);
  await expect.poll(async () => (await snapshot(source)).elements.length).toBe(2);
});
