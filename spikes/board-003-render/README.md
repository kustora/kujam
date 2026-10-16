# Spike BOARD-003: Benchmark teknologi render

Prototipe **sekali buang** untuk [ADR-003](../../docs/adr/ADR-003-render-technology.md). Bukan kode produksi, jadi jangan diimpor dari package `@kujam/*`. Folder ini boleh dihapus setelah BOARD-2101 mengambil alih skenarionya.

Isi `src/main.ts`:

- 5.000 elemen deterministik: kotak sticky berteks dan coretan.
- 300 kartu HTML.
- Beberapa mode render: `canvas`, `canvas-nocull`, `svg`, dan `canvas+html` dengan varian LOD, culling, sembunyikan HTML saat zoom, dan tanpa `will-change`.
- Jalur kamera yang sama untuk setiap mode.

## Menjalankan otomatis (Playwright)

```bash
pnpm --filter @kujam/spike-board-003-render exec playwright install chromium webkit
cd spikes/board-003-render
node run.mjs chromium webkit          # vsync aktif, seperti pemakaian nyata
node run.mjs chromium --throttle=4    # CPU 4x lebih lambat (pengganti laptop kelas menengah)
node run.mjs chromium --uncapped      # vsync dimatikan untuk melihat sisa kapasitas
node run.mjs webkit --only=html       # hanya skenario yang namanya diawali "html"
node report.mjs                       # ringkas results/*.json menjadi tabel Markdown
```

## Menjalankan manual (Safari, Firefox, iPad)

```bash
pnpm --filter @kujam/spike-board-003-render dev   # http://localhost:5199, juga terbuka di LAN
```

- **Desktop:** buka `http://localhost:5199/?auto=1&label=safari-mac` (atau `firefox-mac`), lalu jangan sentuh jendela sekitar 3 menit.
- **iPad:** buka `http://<ip-mac>:5199/?auto=1&label=safari-ipad9`. Matikan Low Power Mode dan biarkan layar tetap menyala.
- Hasil dikirim ke server dev dan tersimpan di `results/<label>.json`.
- Parameter tambahan:
  - `n`: jumlah elemen, bawaan 5000.
  - `cards`: jumlah kartu, bawaan 300.
  - `dur`: durasi per skenario dalam ms, bawaan 6000.
  - `only`: awalan nama skenario.
