---
'@kujam/core': patch
---

`validateBoardRecord(record, registry?, { limits })` (beta): memvalidasi satu record dari sumber tidak tepercaya dengan aturan per record yang sama seperti `validateDocument` (struktur, props terhadap skema tipe terdaftar, batas titik coretan). Dipakai `@kujam/sync-yjs` untuk data dari peer (BOARD-2004).
