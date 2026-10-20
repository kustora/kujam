---
'@kujam/core': patch
'@kujam/sync-yjs': patch
---

Implementasi camera.follow(userId) dengan animasi transisi halus dan auto-unfollow (BOARD-1506):
- `@kujam/core`:
  - Menambahkan method `camera.follow(userId, options?)` dan `camera.unfollow()` serta properti `camera.following: string | null`.
  - Pelacakan kamera kolaborator yang berpusat pada layar (*center-compensated viewport tracking*) yang menyelaraskan titik tengah papan secara akurat lintas ukuran layar/resolusi perangkat yang berbeda.
  - Dukungan transisi perpindahan halus (*smooth camera transition animation*) dengan opsi `animate` dan opsi penyamaan zoom `syncZoom`.
  - Otomatis berhenti mengikuti (*auto-unfollow*) saat pengguna lokal melakukan interaksi manual (pan, zoom, fit) atau saat peer terputus/keluar.
  - Memancarkan event `'camera-follow'` dan `'follow'` (`CameraFollowEvent`) saat status target follow berubah.
- `@kujam/sync-yjs`:
  - Menyertakan dimensi viewport pada state kamera ephemeral awareness sehingga adapter follower dapat mengompensasi perbedaan rasio dan resolusi layar secara presisi.
