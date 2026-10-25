# @kujam/storage-http

## 0.2.0

### Minor Changes

- ee9a96c: Adapter penyimpanan HTTP/REST (BOARD-1604).

  - `createHttpStorage({ url, headers?, fetch?, debounceMs? })`: `url` berupa fungsi `(boardId) => string | URL` (menggantikan `baseUrl`), `headers` boleh objek atau fungsi async yang dipanggil di setiap request (untuk token yang di-refresh), dan `fetch` kustom (bawaan `globalThis.fetch`, dicari saat request).
  - `load` memakai `GET` dan `save` memakai `PUT`; dokumen JSON dikirim sebagai `application/json`, update biner (`Uint8Array`) sebagai `application/octet-stream`. `404`, `204`, dan body kosong dimuat sebagai `null`.
  - Respons gagal ditolak dengan `HttpStorageError` (`kind`, `status`, `operation`, `boardId`, `retryable`, `response`). `401` (`unauthorized`) tetap dicoba ulang oleh `attachStorage`; `403` (`forbidden`) dan `409`/`412` (`conflict`) memakai `retryable: false` sehingga tidak dicoba ulang.
  - Event adapter `storage.on('unauthorized' | 'forbidden' | 'conflict', listener)` dipancarkan saat load maupun save, sebelum operasi ditolak.
  - Deteksi konflik versi lewat `ETag`: ETag dari load/save terakhir dikirim sebagai `If-Match`. `getVersion(boardId)` dan `setVersion(boardId, etag | null)` untuk menyelesaikan konflik (`null` menimpa versi server pada simpan berikutnya).

### Patch Changes

- 99e743c: Open source di bawah lisensi Apache-2.0: setiap package menyertakan `LICENSE` dan `NOTICE` di tarball npm, serta `license`, `repository`, `homepage`, dan `bugs` di `package.json`. Package dipublikasikan dengan akses publik. Komentar JSDoc tema dan warna tidak lagi merujuk dokumen design system internal; nilai token tidak berubah.
- Updated dependencies [2b2f16a]
- Updated dependencies [d50bfa6]
- Updated dependencies [67cb589]
- Updated dependencies [6348589]
- Updated dependencies [c197881]
- Updated dependencies [903766d]
- Updated dependencies [0d85a42]
- Updated dependencies [c49d99c]
- Updated dependencies [bd12697]
- Updated dependencies [b51d845]
- Updated dependencies [5efe9cd]
- Updated dependencies [5ac555e]
- Updated dependencies [0106e46]
- Updated dependencies [e20dbd7]
- Updated dependencies [3a8d206]
- Updated dependencies [01285d2]
- Updated dependencies [51b29c9]
- Updated dependencies [3a8d206]
- Updated dependencies [ef8e020]
- Updated dependencies [7adf898]
- Updated dependencies [bc07ee4]
- Updated dependencies [efaf321]
- Updated dependencies [e95a3cd]
- Updated dependencies [a83b660]
- Updated dependencies [0b11ca5]
- Updated dependencies [f927d7a]
- Updated dependencies [b73f4a4]
- Updated dependencies [b3442b8]
- Updated dependencies [2eb9463]
- Updated dependencies [4266b56]
- Updated dependencies [ee9a96c]
- Updated dependencies [f43f589]
- Updated dependencies [ca67ac1]
- Updated dependencies [f44ed04]
- Updated dependencies [38bbf01]
- Updated dependencies [796a735]
- Updated dependencies [9628238]
- Updated dependencies [45f4392]
- Updated dependencies [0f37059]
- Updated dependencies [2b2f16a]
- Updated dependencies [47f4815]
- Updated dependencies [9099554]
- Updated dependencies [45efc0d]
- Updated dependencies [4c8f116]
- Updated dependencies [25afdd9]
- Updated dependencies [2b2f16a]
- Updated dependencies [afb001d]
- Updated dependencies [374e083]
- Updated dependencies [99e743c]
- Updated dependencies [0a31d08]
- Updated dependencies [32fe211]
- Updated dependencies [fcc4ef9]
- Updated dependencies [ed73de0]
- Updated dependencies [20679c8]
- Updated dependencies [253a82c]
- Updated dependencies [1413dfd]
- Updated dependencies [434e8ad]
- Updated dependencies [d224253]
- Updated dependencies [374785f]
- Updated dependencies [c8ff07c]
- Updated dependencies [111e811]
- Updated dependencies [4536acf]
- Updated dependencies [374785f]
- Updated dependencies [4536acf]
- Updated dependencies [14a905d]
- Updated dependencies [9632069]
- Updated dependencies [202a842]
- Updated dependencies [5f94a1f]
  - @kujam/core@0.2.0
