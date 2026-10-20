---
'@kujam/sync-yjs': patch
---

State presence dari peer kini divalidasi sebelum dipakai (BOARD-2009, ADR-009 T2). `sanitizePresenceState` memeriksa setiap field: nama dipotong menjadi 64 karakter tanpa karakter kontrol atau bidi, warna harus hex, koordinat kursor dan kamera harus berhingga, seleksi maksimal 1.000 ID, coretan live maksimal 5.000 titik, dan avatar harus URL yang aman. Field tidak valid diabaikan satu per satu tanpa menyembunyikan peer, dan metadata tambahan dipertahankan hanya bila berupa nilai primitif kecil. Batasnya bisa diatur lewat `presenceLimits` di `createYjsSyncAdapter` (atau `limits` di `createYjsPresence`). Ekspor baru: `sanitizePresenceState`, `DEFAULT_PRESENCE_LIMITS`, `PresenceLimits`.
