# ADR-002: Pemilik Teknis Package dan Proses Review API

- **Status:** Disetujui
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-002, BOARD-101c, BOARD-2301
- **Pemilik:** @riziq

## Konteks

Untuk menjaga agar permukaan API `@kujam/*` tetap stabil, agnostik terhadap domain aplikasi pemakai (Tayang), dan konsisten antar package, diperlukan aturan kepemilikan teknis, kebijakan tag rilis TSDoc, serta siklus peringatan *deprecation* sebelum API dihapus.

## Keputusan

1. **Pemilik Teknis:** `@riziq` ditetapkan sebagai pemilik teknis utama keluarga package `@kujam/*` (tercatat di `.github/CODEOWNERS`).
2. **Aturan Review API dan Tag Rilis TSDoc:**
   - Setiap simbol yang diekspor dari entry point package wajib memiliki tag rilis TSDoc (`@public`, `@beta`, atau `@internal`) yang ditegakkan otomatis oleh `@microsoft/api-extractor` (`ae-missing-release-tag = error`, `BOARD-111`).
   - `@public`: kontrak stabil untuk pemakai luar; perubahan pada simbol `@public` wajib disetujui pemilik teknis.
   - `@beta`: kontrak yang sudah dapat dicoba tetapi masih bisa disempurnakan sebelum `1.0` (dinilai ulang pada `BOARD-2304`).
   - `@internal`: hanya untuk koordinasi internal antar package `@kujam/*` atau utilitas pengujian; dikecualikan dari laporan API publik (`omitTrimmingComments: true`) dan cukup disetujui satu reviewer.
   - Tidak boleh ada istilah spesifik domain Tayang (`post`, `task`, `brand`, `approval`, `campaign`, `kampanye`, `tayang`) di dalam `packages/*/src`.
3. **Kebijakan Deprecation (`BOARD-2301`):**
   - **Siklus Minimal Satu Rilis Minor:** Setiap API `@public` atau `@beta` yang akan ditinggalkan/dihapus **wajib dipertahankan dan diberi peringatan minimal satu rilis minor penuh** sebelum benar-benar dihapus (misalnya: ditandai usang di `0.2.0`, baru boleh dihapus paling cepat di `0.3.0`; setelah `1.0.0`, baru boleh dihapus di rilis mayor berikutnya).
   - **Tag `@deprecated` & Helper Runtime `deprecate(message)`:**
     - Deklarasi TypeScript wajib diberi tag TSDoc `@deprecated` yang menyebutkan API pengganti dan versi target penghapusan.
     - Fungsi/method runtime yang ditinggalkan wajib memanggil helper `deprecate(message)` dari `@kujam/core`, yang mencetak `console.warn('[@kujam] Deprecated: ' + message)` **tepat satu kali per pesan unik** di mode development (`NODE_ENV !== 'production'` atau `globalThis.__KUJAM_DEV__ === true`) dan menjadi *no-op* di mode production.
   - **Pencatatan Panduan Migrasi (`BOARD-2206`):** Setiap *deprecation* maupun penghapusan (*breaking change*) wajib disertai contoh kode **sebelum dan sesudah** di `docs/MIGRATION.md` dan `CHANGELOG.md`.
