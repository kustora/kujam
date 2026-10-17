---
'@kujam/core': minor
---

Kamera: `zoomToFit`, `zoomToSelection`, `zoomToBounds`, dan animasi (BOARD-402).

- `board.camera.zoomToBounds(bounds, options?)` menampilkan kotak (format `BoxBounds` atau `{ x, y, w, h }`) di tengah viewport dengan padding (bawaan 32 px per sisi). `zoomToFit()` mencakup semua elemen page aktif, `zoomToSelection()` mencakup elemen terpilih. Ketiganya mengembalikan `false` bila tidak ada yang bisa dicakup atau ukuran viewport belum dilaporkan.
- Opsi `maxZoom` membatasi zoom hasil fit; bawaannya 100% untuk `zoomToFit` dan `zoomToSelection` agar konten kecil tidak diperbesar berlebihan, dan batas `zoomRange` untuk `zoomToBounds`.
- Animasi opsional lewat `animate: true` atau `{ duration, easing }` (bawaan 300 ms, ease-in-out). Pusat viewport diinterpolasi linear dan zoom secara geometris. Animasi dibatalkan oleh perubahan kamera lain, fit baru, `camera.stopAnimation()`, atau `board.dispose()`.
- `reducedMotion`: opsi `createBoard({ reducedMotion })` dan `board.camera.setReducedMotion(value)`; bila aktif, animasi langsung melompat ke tujuan. Renderer mengisinya dari `prefers-reduced-motion` (BOARD-1905).
- Opsi `createBoard({ frameScheduler })` untuk sumber frame dan waktu animasi; bawaannya `requestAnimationFrame` (atau `setTimeout` bila tidak ada) dan `performance.now()`, sehingga core tetap tanpa DOM.
