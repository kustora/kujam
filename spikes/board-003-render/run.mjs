/* global process, console, URL, URLSearchParams, window */
// BOARD-003: menjalankan halaman bench di Chromium, Firefox, dan WebKit (Playwright) secara headed
// agar GPU aktif seperti pemakaian nyata. Hasil ditulis ke results/ oleh server Vite.
//
// Pemakaian: node run.mjs [chromium firefox webkit] [--uncapped] [--throttle=4] [--only=canvas/] [--dur=6000]
//   --uncapped   Matikan batas vsync (Chromium, Firefox) agar fps menunjukkan kapasitas sebenarnya.
//   --throttle=N Perlambat CPU N kali lewat CDP (Chromium saja), pengganti laptop kelas menengah.
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v = '1'] = a.slice(2).split('=');
      return [k, v];
    }),
);
const { uncapped, throttle, ...pageFlags } = flags;
const names = args.filter((a) => !a.startsWith('--'));
const engines = { chromium, firefox, webkit };
const selected = names.length ? names : Object.keys(engines);

const launchOptions = {
  chromium: uncapped ? { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] } : {},
  firefox: uncapped ? { firefoxUserPrefs: { 'layout.frame_rate': 0 } } : {},
  webkit: {},
};

const server = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname,
});
await server.listen();
const base = `http://localhost:${server.config.server.port}/`;

for (const name of selected) {
  if (uncapped && name === 'webkit')
    console.log(
      'catatan: WebKit tidak punya opsi mematikan vsync; hasilnya tetap terbatas refresh.',
    );
  const browser = await engines[name].launch({ headless: false, ...launchOptions[name] });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  if (throttle && name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(throttle) });
  }
  const label = [
    'pw',
    name,
    uncapped && 'uncapped',
    throttle && name === 'chromium' && `cpu${throttle}x`,
  ]
    .filter(Boolean)
    .join('-');
  const query = new URLSearchParams({ auto: '1', label, ...pageFlags });
  console.log(`\n== ${label} ==`);
  page.on('pageerror', (err) => console.error(`[${name}]`, err.message));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__bench?.done, null, { timeout: 600_000, polling: 1000 });
  const result = await page.evaluate(() => window.__bench);
  if (result.error) console.error(result.error);
  else
    for (const s of result.report.scenarios)
      console.log(
        `${s.name.padEnd(24)} ${String(s.avgFps).padStart(6)} fps  p95 ${s.frameMs.p95} ms  skrip p95 ${s.scriptMs.p95} ms  >20ms ${s.longFramePct}%`,
      );
  await browser.close();
}

await server.close();
