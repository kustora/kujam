# Contoh worker server `@kujam/server`

Worker latar yang memproses papan setelah server kolaborasi menyimpan state Yjs-nya (BOARD-1805). Contoh ini dipakai sebagai acuan untuk worker indeks penempatan dan thumbnail di aplikasi.

```text
server kolaborasi ──simpan state──▶ worker.enqueue(boardId)
                                     │ (diam 2 detik)
                                     ▼
              validateServerDocument ─ tidak valid ─▶ laporan 'invalid', berhenti
                                     │
                    extractReferences ─▶ diff dengan penempatan lama ─▶ savePlacements
                                     │
                     renderThumbnail ─▶ saveThumbnail (dilewati tanpa canvas)
```

## Menjalankan

```bash
pnpm turbo run build --filter=@kujam/server...
pnpm --filter @kujam/example-server-worker start
```

Demo membuat papan berisi tiga kartu kontak di dalam frame lalu menyimpannya tiga kali berturut-turut; worker hanya memprosesnya sekali. Setelah itu satu kartu dipindah keluar frame dan satu dihapus, jadi diff penempatan terlihat. Terakhir, update Yjs yang rusak ditolak sebelum diindeks.

Thumbnail butuh canvas di Node. Pasang `@napi-rs/canvas` di contoh ini (`pnpm --filter @kujam/example-server-worker add @napi-rs/canvas`) agar `thumbnail.png` ditulis. Tanpa itu, laporan mencatat `thumbnail: skipped` dan aplikasi tetap memakai thumbnail dari klien (`createThumbnail` di `@kujam/export`, BOARD-1708).

## Memakai di server sendiri

```ts
import { createBoardWorker } from './worker.js';

const worker = createBoardWorker({
  plugins: [defaultElements, myPlugin], // definisi elemen yang sama dengan klien
  store: {
    loadState: (id) => db.boardState(id), // Uint8Array state Yjs
    loadPlacements: (id) => db.placements(id),
    savePlacements: (id, { added, removed }) => db.applyPlacementDiff(id, added, removed),
    saveThumbnail: (id, png) => storage.put(`thumbnails/${id}.png`, png),
  },
  onReport: (report) => metrics.record(report),
});

// Di hook penyimpanan server kolaborasi (misalnya onStoreDocument Hocuspocus):
worker.enqueue(documentName);
```

- **`plugins`** wajib berisi definisi elemen yang sama dengan klien. Props divalidasi dengan schema-nya, dan hanya elemen yang punya `references` yang masuk indeks (lihat `contactCard` di `examples/contact-card`).
- **Mode `strict: true`** menolak seluruh papan bila ada satu record tidak valid. Mode bawaan hanya mencatat record yang tidak valid (`invalidRecords`) dan tetap memproses sisanya.
- **Diff penempatan** membandingkan `resolver`, `id`, `elementId`, `pageId`, dan `frameId`. Kartu yang pindah frame tercatat sebagai satu penghapusan dan satu penambahan, jadi tabel tidak perlu dikosongkan lalu diisi ulang.
- **Satu papan tidak pernah diproses dua kali bersamaan**; simpanan yang datang saat proses berjalan menjadwalkan proses berikutnya.
- Panggil **`worker.flush()`** saat server dimatikan agar papan yang tertunda tidak hilang.

Fungsi `@kujam/server` lain (migrasi massal) dijelaskan di [docs/server-migration.md](../../docs/server-migration.md).
