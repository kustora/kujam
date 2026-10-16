# ADR-001: Nama Package, Scope npm, dan Struktur Monorepo

- **Status:** Disetujui
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-001, BOARD-101
- **Pemilik:** @riziq

## Konteks

PRD Package Canvas Jam memakai `@board/*` sebagai nama sementara untuk keluarga package whiteboard agnostik. Sebelum inisialisasi monorepo (`BOARD-101`), kita perlu menetapkan nama scope npm final dan struktur repositori.

## Keputusan

1. **Scope npm:** Menggunakan **`@kujam/*`**, selaras dengan konvensi penamaan ekosistem internal Kustora (seperti `@kubuild/*`).
2. **Daftar 12 Package Inti & Pendukung:**
   - `@kujam/core` — Inti TypeScript murni tanpa DOM dan tanpa dependensi runtime
   - `@kujam/renderer` — Renderer Canvas 2D + lapisan HTML + overlay
   - `@kujam/shapes` — Elemen dan tool bawaan (sticky, coretan, teks, geometri, konektor, frame, gambar, grup)
   - `@kujam/sync-yjs` — Adapter sinkronisasi Yjs, awareness presence, dan UndoManager per pengguna
   - `@kujam/storage-memory` — Adapter penyimpanan in-memory
   - `@kujam/storage-indexeddb` — Adapter penyimpanan IndexedDB
   - `@kujam/storage-http` — Adapter penyimpanan REST/HTTP
   - `@kujam/ui` — Komponen UI Web Components tanpa framework
   - `@kujam/react` — Adapter komponen dan hooks React
   - `@kujam/vue` — Adapter komponen dan composables Vue
   - `@kujam/export` — Eksportir PNG, SVG, PDF, teks polos, dan JSON
   - `@kujam/server` — Utilitas Node.js (validasi dokumen, migrasi, ekstraksi referensi, thumbnail)
3. **Struktur Monorepo:** Monorepo khusus package whiteboard menggunakan **pnpm workspaces + Turborepo**, dengan `packages/*`, `apps/playground` (Vite), dan `examples/{vanilla,react,vue}`.

## Konsekuensi

- Seluruh referensi `@board/*` di implementasi kode menggunakan `@kujam/*`.
- Aturan lint `BOARD-106` (arah impor & bebas DOM di `@kujam/core`) dan `BOARD-107` (larangan istilah domain Tayang di `packages/*/src`) ditegakkan otomatis sejak commit pertama.
