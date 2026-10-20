---
'@kujam/renderer': minor
'@kujam/core': patch
---

Live region untuk perubahan penting (BOARD-1903). Setiap view kini punya region `role="status"` tersembunyi yang membacakan elemen yang dibuat atau dihapus pengguna sendiri (termasuk undo/redo), kolaborator yang bergabung atau keluar, dan koneksi yang terputus, tersambung kembali, atau gagal. Pengumuman digabung dan dibatasi paling sering sekali per detik. Opsi baru `announcements: false` di `mountRenderer` mematikan pengumuman otomatis, dan `view.announce(message)` (beta) mengirim pesan aplikasi lewat region yang sama. Kamus core mendapat kunci `a11y.*` baru, dan `a11y.elementCreated` (id) kini berbunyi `{label} dibuat`.
