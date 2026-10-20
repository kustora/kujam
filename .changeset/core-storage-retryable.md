---
'@kujam/core': patch
---

`attachStorage` tidak lagi mencoba ulang simpan yang gagal dengan error ber-`retryable: false` (misalnya `403` atau konflik versi dari `@kujam/storage-http`); `save:error` melaporkan `willRetry: false` dan status menjadi `'error'`. Helper baru `isRetryableStorageError(error)` (BOARD-1604).
