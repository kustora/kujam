# `@kujam/*` — Monorepo Package Whiteboard Agnostik

Keluarga package whiteboard agnostik framework dari Kustora, dipakai pertama kali oleh canvas Jam Tayang: inti TypeScript murni tanpa DOM (`@kujam/core`), renderer tiga lapisan Canvas 2D + HTML + Overlay (`@kujam/renderer`), elemen dan tool bawaan (`@kujam/shapes`), sinkronisasi opsional Yjs (`@kujam/sync-yjs`), serta adapter tipis untuk React dan Vue.

## Struktur Monorepo

```text
.
├── apps/
│   └── playground/              # @kujam/playground — Aplikasi dev & debug (Vite + HMR langsung dari source)
├── packages/
│   ├── core/                    # @kujam/core — Inti tanpa DOM & 0 dependensi runtime
│   ├── renderer/                # @kujam/renderer — Canvas 2D utama, lapisan HTML, dan overlay
│   ├── shapes/                  # @kujam/shapes — Elemen bawaan (sticky, draw, text, geo, connector, frame, image, group)
│   ├── sync-yjs/                # @kujam/sync-yjs — Sinkronisasi Y.Doc, awareness presence, UndoManager per orang
│   ├── storage-memory/          # @kujam/storage-memory — Adapter penyimpanan in-memory
│   ├── storage-indexeddb/       # @kujam/storage-indexeddb — Adapter penyimpanan IndexedDB
│   ├── storage-http/            # @kujam/storage-http — Adapter penyimpanan HTTP REST
│   ├── ui/                      # @kujam/ui — Toolbar, minimap, command palette (Web Components)
│   ├── react/                   # @kujam/react — Komponen <Board> dan hooks React
│   ├── vue/                     # @kujam/vue — Komponen <Board> dan composables Vue 3
│   ├── export/                  # @kujam/export — Ekspor PNG, SVG, PDF, teks polos, dan JSON
│   └── server/                  # @kujam/server — Utilitas Node.js (validasi, migrasi, ekstraksi referensi, thumbnail)
├── examples/
│   ├── vanilla/                 # Contoh integrasi Vanilla TS
│   ├── react/                   # Contoh integrasi React
│   └── vue/                     # Contoh integrasi Vue 3
└── docs/
    ├── adr/                     # Architecture Decision Records (ADR-001, ADR-002, dst.)
    ├── MIGRATION.md             # Panduan migrasi antar versi
    └── *.md                     # CSP, SSR, elemen kustom, UI kustom, aksesibilitas, migrasi server
```

## Prasyarat

- **Node.js** `>= 20.0.0` (lihat `.nvmrc`)
- **pnpm** `>= 9.0.0` (`corepack enable`)

## Perintah Utama

```bash
# Pasang seluruh dependensi workspace
pnpm install

# Build seluruh package (ESM + .d.ts via tsup & Turborepo)
pnpm build

# Jalankan playground pengembangan (http://localhost:5173)
# Skenario: /s/empty, /s/rich-text, /s/schema-lab. Tambah ?bare=1 atau ?debug=0.
# Tombol "Perangkat lain (QR)" membuka skenario yang sama di HP/iPad satu jaringan.
pnpm playground

# Jalankan seluruh unit test (termasuk @kujam/core di environment Node murni)
pnpm test

# Jalankan hanya unit test @kujam/core di Node murni
pnpm test:core

# Jalankan pemeriksaan tipe TypeScript di seluruh workspace
pnpm typecheck

# Jalankan pemeriksaan lint arsitektur (BOARD-106 & BOARD-107)
pnpm lint
```

## Aturan Arsitektur yang Ditegakkan Otomatis

1. **Bebas DOM & Tanpa Dependensi Runtime di Inti (`BOARD-102`, `BOARD-103`, `BOARD-106`):**
   - `@kujam/core` dikompilasi dengan `lib: ["ES2022"]` (tanpa `"DOM"`), diuji di environment Node murni oleh Vitest, dan membundel utility kecil (`rbush`, `fractional-indexing`, `nanoid`) sehingga `dependencies` di `package.json` tetap kosong.
2. **Arah Impor Satu Arah (`BOARD-106`):**
   - `@kujam/core` tidak pernah mengimpor package `@kujam/*` lain.
   - `@kujam/renderer` hanya bergantung pada `@kujam/core` dan tidak mengimpor lapisan luar (`ui`, `react`, `vue`, `export`, `server`, `sync-yjs`, `storage-*`).
3. **Agnostik Domain (`BOARD-107`):**
   - ESLint menolak identifier beristilah domain aplikasi (`post`, `task`, `brand`, `approval`, `campaign`, `kampanye`, `tayang`) di dalam `packages/*/src`.

## Lisensi

[Apache License 2.0](./LICENSE). Lihat juga [NOTICE](./NOTICE).
