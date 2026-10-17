---
'@kujam/core': minor
---

Pemuatan dan penyimpanan otomatis berdebounce lewat `StorageAdapter` (BOARD-1601).

- `attachStorage(board, adapter, { boardId })`: memuat dokumen dari `adapter.load` lalu menyimpan otomatis dengan debounce (bawaan 1.000 ms, bisa diatur lewat opsi `debounceMs` atau `adapter.debounceMs`). Penyimpanan otomatis baru aktif setelah pemuatan berhasil, sehingga gagal memuat tidak pernah menimpa data tersimpan dengan papan kosong.
- Hanya perubahan berasal `local`, `undo`, `redo`, dan `migration` yang disimpan; `remote` dan `load` tidak.
- Simpan terakhir dijalankan saat `board.dispose()` dan saat `pagehide` (target bisa diganti lewat opsi `lifecycle`).
- Event `save:start`, `save:success`, dan `save:error` di handle `StorageAttachment`, dengan coba ulang backoff eksponensial (`retry: { maxAttempts, baseDelayMs, maxDelayMs }`, bawaan 5 percobaan, 1 s sampai 30 s).
- Handle juga menyediakan `ready`, `status`, `dirty`, `flush()`, dan `detach()`.
- Event papan baru `dispose`, dipancarkan sekali di awal `board.dispose()` sebelum teardown plugin.
