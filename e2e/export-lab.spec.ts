/**
 * BOARD-2413: export lab. The preview follows the format, scope, and options, and the result
 * downloads with a matching file name.
 */
import { expect, test } from '@playwright/test';
import { openBoard } from './support/board.js';

test('previews PNG, SVG, text, and JSON for the board, the selection, and a frame', async ({
  page,
}) => {
  await openBoard(page, { scenario: 'export-lab', query: { bare: '0' } });
  const meta = page.getByTestId('export-meta');
  const preview = page.getByTestId('export-preview');

  await expect(meta).toContainText(/^PNG · .* px/);
  await expect(preview.locator('img')).toBeVisible();
  // Scale 2 by default: the image is twice the board units of its content.
  const png = await preview.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(png).toBeGreaterThan(400);

  await page.getByTestId('export-format').selectOption('svg');
  await expect(meta).toContainText(/^SVG · /);
  await expect(preview.locator('details pre')).toContainText('<svg');

  await page.getByTestId('export-format').selectOption('text');
  await expect(meta).toContainText(/^Teks · /);
  await expect(preview.locator('pre')).toContainText('Retro Sprint');

  // A frame exports only its own content.
  const frameValue = await page
    .getByTestId('export-scope')
    .locator('option', { hasText: 'Frame: Rencana' })
    .getAttribute('value');
  await page.getByTestId('export-scope').selectOption(frameValue!);
  await expect(preview.locator('pre')).toContainText('Langkah 1');
  await expect(preview.locator('pre')).not.toContainText('Retro Sprint');
  expect(new URL(page.url()).searchParams.get('scope')).toBe('frame');

  // An empty selection explains itself; selecting an element exports it as JSON.
  await page.getByTestId('export-format').selectOption('json');
  await page.getByTestId('export-scope').selectOption('selection');
  await expect(meta).toContainText('Seleksi kosong');
  await page.evaluate(() => {
    const board = window.__board!;
    const sticky = board.query({ type: 'sticky' })[0]!;
    board.select([sticky.id]);
  });
  await expect(meta).toContainText(/^JSON · /);
  const doc = JSON.parse((await preview.locator('pre').textContent())!) as {
    records: Record<string, { kind: string }>;
  };
  const elements = Object.values(doc.records).filter((r) => r.kind === 'element');
  expect(elements).toHaveLength(1);

  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  expect((await download).suggestedFilename()).toBe('kujam-seleksi.json');
});

test('PNG options: transparent background and padding change the image', async ({ page }) => {
  await openBoard(page, { scenario: 'export-lab', query: { bare: '0', scale: '1' } });
  const meta = page.getByTestId('export-meta');
  const img = page.getByTestId('export-preview').locator('img');
  await expect(meta).toContainText(/^PNG · /);
  const width = async (): Promise<number> =>
    img.evaluate(async (el: HTMLImageElement) => {
      await el.decode();
      return el.naturalWidth;
    });
  const before = await width();

  await page.getByTestId('export-padding').fill('100');
  await page.getByTestId('export-padding').dispatchEvent('change');
  await expect.poll(width).toBe(before - 2 * 16 + 2 * 100);

  await page.getByTestId('export-bg').selectOption('transparent');
  await expect(meta).toContainText(/^PNG · /);
  const corner = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const canvas = document.createElement('canvas');
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(corner).toBe(0);
});
