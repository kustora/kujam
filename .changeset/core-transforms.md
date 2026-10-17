---
'@kujam/core': minor
---

Transformasi elemen sebagai fungsi murni: pindah, resize, dan rotasi (BOARD-406).

- `moveElements`, `resizeElements(elements, handle, start, current, { keepRatio, registry })`, dan `rotateElements(elements, start, current, { snap, center, registry })` mengembalikan `TransformResult` (`x`, `y`, `w`, `h`, `rotation`, `flipX`, `flipY`) tanpa mengubah papan, sehingga tool bisa menghitung ulang dari snapshot awal di setiap gerakan pointer.
- 8 handle (`RESIZE_HANDLES`): satu elemen di-resize dalam bingkai berotasinya sendiri dengan handle seberang tetap; banyak elemen diskalakan lewat batas gabungan seleksi (`selectionFrame`), dan `transformHandles` memberi posisi handle beserta handle rotasi.
- Mode resize dari definisi elemen (`free`, `fixed-ratio`, `none`, atau fungsi kustom) dan ukuran minimum per tipe lewat field baru `minSize` di `defineElement` (bawaan 1 × 1).
- Shift: `keepRatio` untuk resize, `snap: ROTATION_SNAP_DEGREES` (15 derajat) untuk rotasi. Resize melewati nol membalik kotak dan melaporkan `flipX`/`flipY`.
