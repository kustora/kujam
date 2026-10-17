---
'@kujam/core': minor
---

Hook izin `permissions(action, element, user)` (BOARD-212).

- Hook izin aplikasi (`createBoard({ permissions })`) dan hook dari plugin (`definePlugin({ permissions })`) digabung dengan logika AND. Hook yang melempar exception dianggap menolak (_fail closed_).
- Diperiksa sebelum `board.create`, `board.update`, dan `board.delete`. Bila ditolak, operasi dibatalkan dan event `error` berkode `forbidden` dipancarkan. Penghapusan batch dan kaskade bersifat atomik: satu elemen ditolak berarti tidak ada yang terhapus.
- `board.can(action, element?)`: menguji izin tanpa memancarkan event, cocok untuk menonaktifkan tombol di UI.
- `board.runAction(action, element)`: menjalankan aksi kontekstual elemen dengan pemeriksaan izin `'action'`.
- `BoardUser.role` (opsional) untuk aturan berbasis peran. `board.permissions` kini mengembalikan hook gabungan.
- Dokumentasi menegaskan hook ini hanya untuk kenyamanan UI; penegakan izin wajib di server.
