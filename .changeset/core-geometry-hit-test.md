---
'@kujam/core': minor
'@kujam/shapes': minor
---

Pustaka geometri dan hit-test (BOARD-403, BOARD-404).

- Primitif baru `path(points, width?, closed?)` untuk coretan, menerima titik `{ x, y }` atau tuple `[x, y, tekanan]`. Elemen `draw` di `@kujam/shapes` kini memakai `path`.
- Transformasi: `rotatePoint`, `localToBoard`, `boardToLocal`, dan tipe `ElementTransform` (record elemen bisa langsung dipakai).
- Operasi: `geometryBounds` (tepat untuk elips berotasi), `containsPoint` dengan toleransi, `distanceToEdge`, `intersectsBox`, `containedInBox`, `intersectsPolygon` (lasso), dan `snapPoints` (sudut, tepi, tengah). Semua bekerja di koordinat lokal, atau koordinat papan bila `element` diberikan.
- `toBoardTolerance(px, zoom)` mengubah toleransi piksel layar ke satuan papan.
- `board.hitTest(point, { tolerance, pageId, includeLocked })` memakai indeks spasial dan mengembalikan elemen teratas sesuai urutan gambar: saudara menurut index lapisan, anak frame atau grup di atas kontainernya. Elemen `locked` dilewati kecuali `includeLocked`. `tolerance` dalam piksel layar, dikonversi dengan zoom kamera.
- `computeElementAABB` kini memakai pustaka yang sama, sehingga AABB elips berotasi lebih rapat, dan geometri yang tidak dikenal jatuh ke kotak `w × h` elemen.
- Cakupan tes `geometry.ts` 100% dan dijaga lewat ambang coverage.
