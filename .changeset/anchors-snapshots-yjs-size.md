---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/sync-yjs': patch
---

Anchor komentar, snapshot versi, dan pengendalian ukuran dokumen Yjs (BOARD-1211, BOARD-1511, BOARD-1515):

- `@kujam/core` (BOARD-1211): Tipe `Anchor` (`{ kind: 'point', x, y, pageId? }` atau `{ kind: 'element', elementId, offset }`) dan API `board.anchors`: `resolve`, `toScreen`, `fromPoint`, `forElement`, `track`/`untrack`/`get`/`list`, serta mode "tempatkan anchor" `place()` (satu klik di papan mengembalikan anchor, Esc/ganti tool membatalkan, tool sebelumnya dipulihkan, juga berjalan di papan baca saja). Event `anchor` (`move`, `remove`, `restore`) untuk anchor yang dilacak saat elemennya berpindah, dihapus, atau kembali (lokal, remote, undo, `loadDocument`). Helper `isAnchor` dan konstanta `ANCHOR_PLACE_TOOL_ID`. Package tetap tidak membuat sistem komentar.
- `@kujam/renderer` (BOARD-1211): Lapisan slot `layers.anchors` di atas overlay dan `view.mountAnchor(element, anchor)` untuk pin aplikasi yang ikut kamera dan elemen, tetap berukuran layar, serta tersembunyi saat elemennya hilang atau berada di halaman lain.
- `@kujam/sync-yjs` (BOARD-1511): `adapter.encodeSnapshot()`, `adapter.previewSnapshot(bytes)` (pratinjau baca saja tanpa memulihkan), dan `adapter.restoreSnapshot(bytes)` yang memulihkan papan sebagai satu perubahan lokal baru: tersinkron ke semua peer, satu langkah undo, tidak menghapus riwayat orang lain, dan ditolak pada klien baca saja. Helper mandiri `encodeSnapshot` dan `decodeSnapshot`.
- `@kujam/sync-yjs` (BOARD-1515): `compactUpdate(updates)` memadatkan log update Yjs dengan encode ulang state pada `Y.Doc` ber-GC tanpa mengubah identitas CRDT. Dokumentasi garbage collection dan pemadatan berkala di server contoh, plus benchmark 10.000 operasi edit.
