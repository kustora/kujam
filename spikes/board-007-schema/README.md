# Spike BOARD-007: Skema validasi props

Prototipe **sekali buang** untuk [ADR-007](../../docs/adr/ADR-007-props-schema-validation.md). Isinya tiga skema yang sama (sticky, kartu, coretan) ditulis di empat kandidat:

- mini-lib: `src/mini.ts`
- Valibot
- Zod Mini
- Zod

```bash
cd spikes/board-007-schema
pnpm size        # ukuran bundle minify, gzip, brotli
pnpm bench       # kecepatan validasi dan contoh bentuk error
pnpm typecheck   # uji inferensi tipe (src/types.test-d.ts)
```

`src/mini.ts` adalah titik awal BOARD-203. Folder ini boleh dihapus setelah BOARD-203 selesai.
