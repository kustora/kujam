---
'@kujam/core': patch
'@kujam/ui': patch
---

Daftar Avatar Presence dan Indikator Status Koneksi (BOARD-1407):
- `BOARD-1407`: Komponen Web Component `<kujam-presence-bar>` di `@kujam/ui`.
  - Menampilkan daftar avatar collaborator aktif dari `board.sync.presence.peers` (latar warna peer, avatar foto atau inisial nama, serta tooltip nama pengguna).
  - Interaksi follow: klik avatar memicu `board.camera.follow(userId)` dengan animasi transisi halus; klik kembali pada user yang sama membatalkan follow (`board.camera.unfollow()`).
  - Indikator visual cincin fokus dan badge aktif saat sedang mengikuti kolaborator remote.
  - Indikator visual status koneksi (`offline`, `connecting`, `synced`, `error`) dengan dot berwarna dan label teks yang dapat diterjemahkan (i18n).
  - Terintegrasi di `mountDefaultUi` pada pojok kanan atas kanvas.
