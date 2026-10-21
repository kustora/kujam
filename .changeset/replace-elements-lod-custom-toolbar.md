---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/ui': patch
---

Transformasi elemen, render ringkas Canvas LOD, dan toolbar kontekstual untuk elemen kustom (BOARD-606, BOARD-1204, BOARD-1205):

- Core: implementasi `board.replaceElements(ids, factory, options)` untuk mengganti elemen dengan posisi, ukuran, parent, dan indeks layer yang sama secara atomik dalam satu transaksi; connector bindings yang menempel dialihkan otomatis ke ID baru; riwayat undo/redo mengembalikan elemen lama dan binding persis. Mendukung factory sync dan async disertai pelacakan status transien `board.isReplacing(id)`.
- Renderer: implementasi `LodManager` dengan histeresis zoom 5% untuk beralih antara render DOM HTML dan render Canvas ringkas (`lod.compact: true`) saat zoom di bawah ambang `compactBelowZoom`; drawing context wrapper dengan helper gambar (`roundRect`, `dot`/`colorDot`, `drawText`, `drawThumbnail` dengan `ThumbnailCache`); transisi bebas kedip dalam frame loop `mountRenderer`.
- UI: `<kujam-selection-toolbar>` merender grup aksi multi-item dan tombol aksi tunggal untuk elemen kustom bersama kontrol gaya bawaan; penempatan otomatis menghindari tepi viewport dan membalik posisi ke bawah saat dekat tepi atas kanvas; terintegrasi dengan `board.runAction` dan auto-update via event `data`.
