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

| Variabel        | Bawaan                | Keterangan                                         |
| --------------- | --------------------- | -------------------------------------------------- |
| `PORT`          | `1234`                | Port HTTP & WebSocket server                       |
| `DATABASE_PATH` | `./data/kujam.sqlite` | Lokasi file database SQLite (atau `:memory:`)      |
| `DEBOUNCE_MS`   | `2000`                | Jeda debounce penyimpanan ke SQLite (milidetik)    |
| `AUTH_ENDPOINT` | _(kosong)_            | URL endpoint HTTP eksternal untuk verifikasi token |

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
