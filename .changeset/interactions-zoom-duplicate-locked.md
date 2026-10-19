---
'@kujam/core': minor
'@kujam/shapes': minor
'@kujam/renderer': minor
'@kujam/ui': patch
---

Interaksi bawaan 0.1 (BOARD-901 sampai BOARD-904).

- `@kujam/core`: perintah `camera.zoom-in`, `camera.zoom-out` (`Mod+=`, `Mod++`, `Mod+-`), dan `camera.zoom-reset` (`Mod+0`) di `defaultCommands`. `ZOOM_STEPS` dan `nextZoomStep` kini diekspor dari core.
- `@kujam/shapes`: Alt+seret di tool pilih memindahkan salinan seleksi (dengan turunan dan binding internal) sebagai satu langkah undo. Klik elemen terkunci memilihnya tanpa handle; seret dari elemen terkunci menggambar kotak seleksi.
- `@kujam/renderer`: elemen terkunci yang terpilih digambar dengan outline putus-putus tanpa handle.
- `@kujam/ui`: `ZOOM_STEPS` dan `nextZoomStep` diekspor ulang dari core; tombol zoom menampilkan pintasannya.
