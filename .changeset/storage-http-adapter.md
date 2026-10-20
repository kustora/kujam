---
'@kujam/storage-http': minor
---

Adapter penyimpanan HTTP/REST (BOARD-1604).

- `createHttpStorage({ url, headers?, fetch?, debounceMs? })`: `url` berupa fungsi `(boardId) => string | URL` (menggantikan `baseUrl`), `headers` boleh objek atau fungsi async yang dipanggil di setiap request (untuk token yang di-refresh), dan `fetch` kustom (bawaan `globalThis.fetch`, dicari saat request).
- `load` memakai `GET` dan `save` memakai `PUT`; dokumen JSON dikirim sebagai `application/json`, update biner (`Uint8Array`) sebagai `application/octet-stream`. `404`, `204`, dan body kosong dimuat sebagai `null`.
- Respons gagal ditolak dengan `HttpStorageError` (`kind`, `status`, `operation`, `boardId`, `retryable`, `response`). `401` (`unauthorized`) tetap dicoba ulang oleh `attachStorage`; `403` (`forbidden`) dan `409`/`412` (`conflict`) memakai `retryable: false` sehingga tidak dicoba ulang.
- Event adapter `storage.on('unauthorized' | 'forbidden' | 'conflict', listener)` dipancarkan saat load maupun save, sebelum operasi ditolak.
- Deteksi konflik versi lewat `ETag`: ETag dari load/save terakhir dikirim sebagai `If-Match`. `getVersion(boardId)` dan `setVersion(boardId, etag | null)` untuk menyelesaikan konflik (`null` menimpa versi server pada simpan berikutnya).
