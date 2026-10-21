---
'@kujam/server': patch
'@kujam/renderer': patch
---

Migrasi dokumen massal, thumbnail Node, dan tes server di Node murni (BOARD-705, BOARD-1804, BOARD-1806):

- Server: `migrateServerDocument` (JSON dan Yjs biner, pipeline sama dengan klien) dan `migrateServerBatch` (mode dry-run, callback `onMigrated`, laporan per dokumen).
- Server: `renderThumbnail(doc, { width, plugins, canvasFactory })` menghasilkan PNG; `@napi-rs/canvas` opsional dengan error yang jelas bila tidak terpasang.
- Renderer: `CanvasRenderer.render` menerima antarmuka `CanvasLike` (bukan `HTMLCanvasElement`), sehingga bisa berjalan di Node; `CanvasRenderer` dan `CanvasLike` kini diekspor.
- Server kini boleh mengimpor `@kujam/renderer`.
