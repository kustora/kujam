# @kujam/example-hocuspocus-server

Contoh server kolaborasi realtime berbasis **Hocuspocus** (Yjs WebSocket) untuk dokumen papan tulis `@kujam/*` (BOARD-1510).

## Fitur Utama

1. **Otorisasi Fleksibel (`onAuthenticate`)**:
   - Memeriksa token otentikasi dari klien via query / token Hocuspocus.
   - Menentukan identitas pengguna (`id`, `name`) dan perizinan mode baca saja (`readOnly: boolean`).
   - Mendukung token mock (`"editor"`, `"viewer"`, atau `"mock:<id>:<role>:<name>"`), delegasi ke endpoint HTTP eksternal (`AUTH_ENDPOINT`), atau verifier kustom.

2. **Mode Baca Saja per Koneksi (`readOnly: true`)**:
   - Koneksi peninjau (viewer) otomatis diberi bendera `readOnly: true`.
   - Mutasi dokumen dari klien baca-saja langsung ditolak di tingkat server (tidak diterapkan ke CRDT Y.Doc).
   - Pengguna baca-saja tetap dapat menerima pembaruan dokumen remote dan menyiarkan kursor/kamera lewat awareness tanpa mencemari dokumen.

3. **Persistensi SQLite State Biner Yjs**:
   - Menyimpan dan memuat snapshot biner Yjs (`Uint8Array`) secara efisien via `better-sqlite3`.
   - Menggunakan utilitas konversi biner BOARD-1513 (`yDocToUpdate` dan `onLoadDocument`).
   - Mendukung in-memory (`:memory:`) untuk testing dan file disk (`./data/kujam.sqlite`) dengan write-ahead log (WAL) untuk produksi.

4. **Validasi Dokumen Server (`onChange`)**:
   - Mengonversi `Y.Doc` ke representasi kanonikal `BoardDocument` menggunakan `yDocToDocument` (`@kujam/sync-yjs`).
   - Memvalidasi konsistensi dokumen, batas ukuran (elemen, byte, dll.), dan skema properti elemen memakai `validateDocument` (`@kujam/core`).
   - Memancarkan callback `onValidationError` bila ditemukan rekaman atau format yang tidak valid.

---

## Menjalankan Secara Lokal

### Menggunakan pnpm

```bash
# 1. Masuk ke direktori contoh
cd examples/hocuspocus-server

# 2. Jalankan server dalam mode development
pnpm dev

# Atau build dan jalankan versi bundle
pnpm build
pnpm start
```

### Variabel Lingkungan (Environment Variables)

| Variabel            | Bawaan                | Keterangan                                                                      |
| ------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `PORT`              | `1234`                | Port HTTP & WebSocket server                                                    |
| `DATABASE_PATH`     | `./data/kujam.sqlite` | Lokasi file database SQLite (atau `:memory:`)                                   |
| `DEBOUNCE_MS`       | `2000`                | Jeda debounce penyimpanan ke SQLite (milidetik)                                 |
| `AUTH_ENDPOINT`     | _(kosong)_            | URL endpoint HTTP eksternal untuk verifikasi token                              |
| `ALLOW_MOCK_TOKENS` | _(kosong)_            | `true` untuk menerima token mock walau `NODE_ENV=production` (hanya demo lokal) |

---

## Menjalankan dengan Docker Compose

Untuk menjalankan server kolaborasi dalam kontainer Docker:

```bash
cd examples/hocuspocus-server
docker compose up -d
```

Server akan tersedia di `ws://localhost:1234` dengan direktori persistensi `./data` dimuat ke dalam kontainer.

Untuk menghentikan kontainer:

```bash
docker compose down
```

---

## Keamanan (BOARD-2009, BOARD-2010)

Server ini memasang penjagaan terhadap klien jahat (lihat `docs/adr/ADR-009-threat-model.md`, T2 dan T4):

- **Dokumen tetap valid.** Setiap perubahan divalidasi; record yang tidak valid dikembalikan ke versi valid terakhirnya (atau dihapus bila belum pernah valid), dan elemen di atas `maxElements` dibuang. Perbaikan ini tersebar ke semua klien.
- **Identitas tidak bisa dipalsukan.** `user` di awareness setiap koneksi diganti dengan identitas hasil `onAuthenticate`, dan satu koneksi hanya boleh menulis client ID miliknya sendiri.
- **Batas pesan.** Pesan di atas 10 MB ditolak dan koneksi yang mengirim lebih dari 300 pesan per detik diputus (`guardLimits`).
- **Token mock khusus pengembangan.** Dengan `NODE_ENV=production`, server menolak start bila hanya memakai token mock, kecuali `ALLOW_MOCK_TOKENS=true` (dipakai `docker-compose.yml` untuk demo lokal).

## Format Token Otentikasi

### 1. Token Mock Bawaan

- `"editor"`: Mendapat hak tulis penuh (`readOnly: false`) sebagai pengguna `user-editor`.
- `"viewer"` atau `"readonly"`: Mendapat hak baca saja (`readOnly: true`) sebagai pengguna `user-viewer`.
- `"mock:<id>:<role>:<name>"`:
  - Contoh: `"mock:usr-1:editor:Alice"` -> Pengguna `usr-1` (Alice) dengan hak edit.
  - Contoh: `"mock:usr-2:viewer:Bob"` -> Pengguna `usr-2` (Bob) dengan hak baca saja.

### 2. Endpoint HTTP Eksternal

Jika `AUTH_ENDPOINT` disetel, server akan mengirimkan permintaan POST:

```json
{
  "token": "<token-klien>",
  "documentName": "board-123"
}
```

Endpoint diharapkan merespons dengan:

```json
{
  "user": {
    "id": "user-456",
    "name": "Budi Santoso"
  },
  "readOnly": false
}
```

---

## Contoh Koneksi Klien (Frontend)

Menggunakan `@hocuspocus/provider`:

```typescript
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const doc = new Y.Doc();

const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: 'my-whiteboard',
  document: doc,
  token: 'mock:usr-1:editor:Alice',
  onAuthenticated: () => {
    console.log('Tersambung dan terotentikasi!');
  },
  onAuthenticationFailed: ({ reason }) => {
    console.error('Otentikasi ditolak:', reason);
  },
});
```

---

## Uji Realtime: Setiap Tab Jadi Pengguna

Skenario `realtime` di playground menyambungkan satu papan penuh ke server ini. Setiap tab browser otomatis menjadi pengguna berbeda (nama dan warna acak):

```bash
pnpm --filter @kujam/example-hocuspocus-server dev   # ws://<host>:1234
pnpm playground
# buka /s/realtime di beberapa tab (opsional: ?room=nama&server=ws://...&role=viewer)
```

- Identitas disimpan di `sessionStorage`: reload tab mempertahankan pengguna, tab baru mendapat pengguna baru. Tab hasil "Duplikat" dideteksi lewat `BroadcastChannel` dan diberi pengguna baru.
- Tombol **Buka tab baru (pengguna baru)** dan **Ganti identitas** ada di panel kiri, bersama status koneksi dan daftar pengguna di room.
- Server bawaan `ws://<host halaman>:1234`, jadi perangkat lain di jaringan yang sama (tombol "Perangkat lain (QR)") ikut tersambung ke server di mesin pengembang.
- `?role=viewer` masuk baca-saja: server menolak update dokumen dari tab itu, kursor tetap terlihat.
- Bila server dimatikan, status papan menjadi `connecting` dan tersambung lagi otomatis saat server hidup; perubahan selama terputus dikirim ulang.

## Mencoba dengan Lab Sinkronisasi Playground

Lab `sync-lab` di playground (BOARD-2410) bisa memakai server ini sebagai transport:

```bash
pnpm --filter @kujam/example-hocuspocus-server dev   # ws://127.0.0.1:1234
pnpm playground
# buka /s/sync-lab?transport=hocuspocus (opsional: &server=ws://...&room=nama&peers=3)
```

Setiap papan memakai token mock `mock:<id>:editor:<nama>`. Dengan `peers=1&peer=<0|1|2>`, beberapa jendela browser masing-masing menjadi satu pengguna.
