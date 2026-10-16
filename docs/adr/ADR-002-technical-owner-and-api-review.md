# ADR-002: Pemilik Teknis Package dan Proses Review API

- **Status:** Disetujui
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-002, BOARD-101c
- **Pemilik:** @riziq

## Konteks

Untuk menjaga agar permukaan API `@kujam/*` tetap stabil, agnostik terhadap domain aplikasi pemakai (Tayang), dan konsisten antar package, diperlukan aturan kepemilikan teknis dan proses review API publik.

## Keputusan

1. **Pemilik Teknis:** `@riziq` ditetapkan sebagai pemilik teknis utama keluarga package `@kujam/*` (tercatat di `.github/CODEOWNERS`).
2. **Aturan Review API:**
   - Setiap simbol yang diekspor dari entry point package wajib memiliki tag rilis TSDoc (`@public`, `@beta`, atau `@internal`).
   - Perubahan pada simbol `@public` wajib disetujui pemilik teknis.
   - Perubahan pada simbol `@internal` cukup disetujui satu reviewer.
   - Tidak boleh ada istilah spesifik domain Tayang (`post`, `task`, `brand`, `approval`, `campaign`, `kampanye`, `tayang`) di dalam `packages/*/src`.

