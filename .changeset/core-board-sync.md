---
'@kujam/core': minor
---

`board.sync` (beta): adapter yang sedang terpasang lewat `attachSync`, atau `undefined`. Event papan baru `sync` (`{ adapter }`) dipancarkan saat adapter dipasang (sebelum `connect`, sehingga listener menerima perubahan status pertama) dan saat dilepas (setelah `disconnect`, termasuk lewat `board.dispose()`). Melepas attachment lama tidak menghapus adapter yang lebih baru.
