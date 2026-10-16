/* global console, process, window, document, DataTransfer, ClipboardEvent, URL */
// BOARD-008: uji Quill di browser nyata. Model editor = model kita, tempel HTML jahat tersaring,
// komposisi IME (CDP, Chromium saja) tidak terputus.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname,
  logLevel: 'error',
});
await server.listen();
const url = `http://localhost:${server.config.server.port}/`;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  GAGAL ${name}\n       ${err.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

const MALICIOUS = `<p>Halo <b>tebal</b> <i>miring</i> <span style="color:red;font-size:40px">berwarna</span></p>
<script>window.lab.xss++</script><img src=x onerror="window.lab.xss++">
<a href="javascript:window.lab.xss++">jahat</a> <a href="https://kustora.id">aman</a>
<ul><li>satu</li><li>dua<ul><li>bersarang</li></ul></li></ul><ol><li>urut</li></ol>
<table><tr><td>sel</td></tr></table><iframe src="https://evil.example"></iframe><h1>judul</h1>`;

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  console.log(`\n== ${name} ==`);
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.lab);
  const mod = 'ControlOrMeta';

  await check('mengetik dan Mod+B menghasilkan delta kanonik yang sama dengan model', async () => {
    await page.click('.ql-editor');
    await page.keyboard.type('Halo ');
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.type('tebal');
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.type(' biasa');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- butir');
    const { raw, model } = await page.evaluate(() => ({
      raw: window.lab.raw(),
      model: window.lab.model(),
    }));
    if (process.env.DEBUG) console.log('       raw', JSON.stringify(raw));
    assert.deepEqual(raw, model, 'getContents() Quill harus sudah kanonik');
    assert.deepEqual(model, [
      { insert: 'Halo ' },
      { insert: 'tebal', attributes: { bold: true } },
      { insert: ' biasa\nbutir' },
      { insert: '\n', attributes: { list: 'bullet' } },
    ]);
  });

  await check(
    'tempel HTML jahat: tidak ada eksekusi, tidak ada elemen asing, model bersih',
    async () => {
      await page.evaluate(() => window.lab.quill.setText(''));
      await page.click('.ql-editor');
      await page.evaluate((html) => {
        const dt = new DataTransfer();
        dt.setData('text/html', html);
        dt.setData('text/plain', 'cadangan');
        document
          .querySelector('.ql-editor')
          .dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
          );
      }, MALICIOUS);
      await page.waitForTimeout(300);
      const res = await page.evaluate(() => ({
        xss: window.lab.xss,
        tags: [
          ...new Set(
            [...document.querySelectorAll('.ql-editor *:not(.ql-ui)')].map((e) =>
              e.tagName.toLowerCase(),
            ),
          ),
        ].sort(),
        ui: [...document.querySelectorAll('.ql-editor .ql-ui')].map((e) => e.outerHTML).slice(0, 1),
        raw: window.lab.raw(),
        model: window.lab.model(),
        styled: document.querySelector('.ql-editor [style]')?.outerHTML ?? null,
      }));
      console.log(
        `       tag di editor (selain .ql-ui): ${res.tags.join(', ')}; contoh .ql-ui: ${res.ui[0]}`,
      );
      console.log(
        `       atribut di model: ${JSON.stringify([...new Set(res.model.flatMap((o) => Object.keys(o.attributes ?? {})))])}`,
      );
      console.log(
        `       tautan mentah Quill: ${JSON.stringify(res.raw.filter((o) => o.attributes?.link).map((o) => o.attributes.link))}`,
      );
      if (process.env.DEBUG) console.log('       model', JSON.stringify(res.model));
      assert.equal(res.xss, 0, 'skrip atau handler terpanggil');
      for (const bad of ['script', 'img', 'iframe', 'table', 'span', 'h1'])
        assert.ok(!res.tags.includes(bad), `elemen <${bad}> lolos`);
      assert.equal(res.styled, null, 'atribut style lolos');
      const links = res.model.filter((o) => o.attributes?.link).map((o) => o.attributes.link);
      assert.deepEqual(links, ['https://kustora.id']);
      assert.ok(
        !res.model.some((o) => o.insert.includes('xss')),
        'isi <script> masuk sebagai teks',
      );
      assert.equal(
        res.model.filter((o) => o.attributes?.list === 'bullet').length,
        3,
        'butir daftar hilang',
      );
      assert.ok(
        res.model.some((o) => o.attributes?.list === 'bullet' && o.attributes?.indent === 1),
        'indentasi daftar bersarang hilang',
      );
    },
  );

  if (name === 'chromium') {
    await check(
      'komposisi IME Jepang (CDP imeSetComposition) tidak terputus atau terduplikasi',
      async () => {
        await page.evaluate(() => window.lab.quill.setText(''));
        await page.click('.ql-editor');
        await page.keyboard.type('予定: ');
        const cdp = await page.context().newCDPSession(page);
        for (const step of ['k', 'か', 'かい', 'かいぎ']) {
          await cdp.send('Input.imeSetComposition', {
            text: step,
            selectionStart: step.length,
            selectionEnd: step.length,
          });
        }
        // Pilih kandidat kanji lalu commit, seperti menekan spasi lalu Enter di IME.
        await cdp.send('Input.imeSetComposition', {
          text: '会議',
          selectionStart: 2,
          selectionEnd: 2,
        });
        await cdp.send('Input.insertText', { text: '会議' });
        await page.keyboard.type(' 10:00');
        for (const step of ['ㅎ', '하', '한']) {
          await cdp.send('Input.imeSetComposition', {
            text: step,
            selectionStart: 1,
            selectionEnd: 1,
          });
        }
        await cdp.send('Input.insertText', { text: '한' });
        await page.waitForTimeout(100);
        const model = await page.evaluate(() => window.lab.model());
        assert.deepEqual(model, [{ insert: '予定: 会議 10:00한\n' }]);
      },
    );
  }
  await browser.close();
}

await server.close();
process.exit(failed ? 1 : 0);
