---
'@kujam/core': minor
'@kujam/shapes': minor
---

`defineBrush` dan registri kuas coretan (BOARD-603).

- `defineBrush({ id, label?, strokeOptions?, blend? })` memvalidasi dan membekukan kuas. `strokeOptions` memetakan opsi perfect-freehand (`size`, `thinning`, `smoothing`, `streamline`, `taper`, `simulatePressure`) dengan rentang yang diperiksa; kunci lain dibuang. `blend` adalah salah satu `BRUSH_BLEND_MODES` (mode campur Canvas, bawaan `'source-over'`). Definisi tidak valid melempar `BrushError` berkode `invalid-brush`.
- `board.brushes` (`register`, `get`, `list`, `resolve`): kuas dari `brushes` milik plugin didaftarkan saat pemasangan; ID kuas yang dipakai dua plugin melempar `BrushError` berkode `duplicate-brush`. `resolve(id)` mengembalikan kuas terdaftar, atau kuas pena (`DEFAULT_BRUSH_ID`) untuk ID yang tidak dikenal, sehingga coretan dari plugin yang tidak terpasang tetap tergambar dan ID kuasnya tetap tersimpan.
- `ElementContext.resolveBrush(id)` dan parameter opsional kelima `ctx` di `render.canvas`, agar elemen bisa membaca registri kuas board.
- `@kujam/shapes`: kuas bawaan `penBrush` (`pen`) dan `highlighterBrush` (`highlighter`, `multiply`) dipasang lewat `defaultElements`. Elemen `draw` memakai mode campur kuasnya; gambar perfect-freehand menyusul di BOARD-1002.
