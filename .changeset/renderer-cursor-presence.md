---
'@kujam/renderer': patch
---

Posisi kursor lokal kini dikirim ke kolaborator lewat `board.presence` (BOARD-1504, ditemukan di BOARD-2410). Sebelumnya tidak ada lapisan yang mengisi `cursor` di presence, sehingga kursor remote tidak pernah tampil. Renderer memperbarui `cursor` (koordinat papan) pada setiap `pointermove`, termasuk saat hover, dan mengosongkannya saat pointer keluar dari kanvas. Throttle tetap ditangani lapisan presence.
