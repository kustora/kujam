---
'@kujam/core': minor
---

Snap ke elemen lain dan grid saat menyeret (BOARD-407).

- `computeSnap(moving, targets, { threshold, grid })`: fungsi murni yang mencocokkan titik snap seleksi yang digeser dengan titik target dan grid, terpisah per sumbu x dan y. Kandidat terdekat dalam ambang menang; bila seri, elemen mengalahkan grid. Hasilnya berisi offset dan `guides` (garis panduan berkoordinat papan untuk overlay).
- `snapTranslation(board, elements, delta, { modifiers })`: snap ke tepi, titik tengah tepi, dan pusat elemen yang terlihat di viewport pada page yang sama, serta ke grid. Ambang dalam piksel layar dikonversi dengan zoom kamera.
- Pengaturan papan lewat `createBoard({ snap })`, `board.snapOptions`, dan `board.setSnapOptions(patch)`: `enabled`, `grid` (bawaan 8, `null` untuk mematikan), dan `threshold` (bawaan 8 px).
- Ctrl/Cmd saat menyeret mematikan snap sementara (`isSnapSuppressed`).
