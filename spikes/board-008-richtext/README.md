# Spike BOARD-008: Model rich text dan editor

Prototipe **sekali buang** untuk [ADR-008](../../docs/adr/ADR-008-rich-text-model.md).

- `src/model.ts`: format delta (identik dengan `Y.Text` dan Quill), skema validasi, normalisasi, dan teks polos. Titik awal BOARD-1003a.
- `src/editors/`: editor minimal (Quill, Lexical, ProseMirror) untuk mengukur ukuran. `quill.ts` adalah titik awal BOARD-1003b.
- `paste.mjs`: uji Quill di Chromium dan WebKit: ketik, tempel HTML jahat, dan IME lewat CDP.

```bash
cd spikes/board-008-richtext
pnpm test       # tes model, termasuk round-trip dan edit bersamaan Y.Text
pnpm size       # ukuran bundle editor
pnpm paste      # uji browser (butuh: pnpm exec playwright install chromium webkit)
pnpm dev        # lab editor manual di http://localhost:5208 (untuk uji IME manual)
```

Folder ini boleh dihapus setelah BOARD-1003 selesai.
