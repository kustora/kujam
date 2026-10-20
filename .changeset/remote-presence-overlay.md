---
'@kujam/renderer': patch
---

Overlay Kolaborasi Remote (BOARD-808):
- `BOARD-808`: Kursor dan seleksi orang lain di overlay.
  - Kursor berwarna dengan label nama pengguna remote, dihaluskan dengan interpolasi posisi (lerp) di antara update awareness.
  - Garis pembatas seleksi remote digambar sesuai warna collaborator dengan label nama di sudut kiri atas.
  - Goresan live remote dari awareness digambar sementara di lapisan overlay menggunakan `perfect-freehand` dengan eliminasi visual tanpa kedip (*zero-flicker deduplication*) ketika elemen permanen telah hadir di dokumen.
  - Timeout inaktivitas kursor otomatis (bawaan ~6 detik) yang memudarkan kursor bila tidak ada pergerakan terbaru.
