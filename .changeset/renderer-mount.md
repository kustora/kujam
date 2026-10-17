---
'@kujam/renderer': minor
---

`mountRenderer` dan kerangka tiga lapisan (BOARD-801).

- `mountRenderer(board, container, options?)` menambahkan satu elemen root berisi Canvas utama, lapisan HTML, dan Canvas overlay yang bertumpuk. Hanya Canvas utama yang menerima input; lapisan di atasnya memakai `pointer-events: none`.
- Ukuran mengikuti container lewat `ResizeObserver` (diamati pada root). Ukuran dalam piksel CSS dilaporkan ke `board.camera.setViewport`, dan ukuran backing canvas = ukuran CSS × `pixelRatio` (bawaan `devicePixelRatio` window milik container, bisa diganti lewat opsi `pixelRatio`).
- `view.requestRender()` menggabungkan permintaan render menjadi satu `requestAnimationFrame`. Perubahan dokumen, kamera, seleksi, page, dan tool otomatis meminta render.
- `view.unmount()` melepas DOM, `ResizeObserver`, semua listener board, dan frame yang tertunda; aman dipanggil berkali-kali dan berjalan otomatis saat board di-dispose.
- `view.layers`, `view.size`, `view.pixelRatio`, dan `view.mounted` tersedia untuk tiket renderer berikutnya. Semua API browser diambil dari window milik container, tanpa state bersama, sehingga beberapa board di satu halaman tidak saling memengaruhi.
- Menggambar elemen (BOARD-802), transform lapisan HTML (BOARD-804), overlay (BOARD-805), input (BOARD-806), dan batas ukuran canvas (BOARD-803) menyusul.
