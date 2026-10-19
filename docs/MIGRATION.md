# Panduan Migrasi per Rilis (`@kujam/*`)

Dokumen ini mencatat panduan migrasi antarrilis untuk seluruh keluarga package `@kujam/*` (`BOARD-2206`).

## Kebijakan Versi dan Perubahan *Breaking*

1. **Versi Serentak (*Fixed Versioning*, `BOARD-110`):**
   Semua package `@kujam/*` selalu diterbitkan dengan nomor versi yang sama. Saat menaikkan versi, perbarui seluruh dependensi `@kujam/*` di `package.json` ke versi target yang sama.
2. **Aturan Fase `0.x` vs `1.0+` (`BOARD-2301`):**
   - Sebelum `1.0.0`, perubahan yang memecah API (*breaking change*) boleh hadir di rilis minor (`0.N.0`), tetapi **wajib**:
     1. Didahului peringatan `@deprecated` + `deprecate(message)` minimal **satu rilis minor penuh** sebelum API lama dihapus.
     2. Memiliki bagian **`### [Breaking] ...`** di dokumen ini lengkap dengan blok kode **`#### Sebelum`** dan **`#### Sesudah`**.
   - Setelah `1.0.0`, perubahan yang memecah API hanya boleh terjadi di rilis mayor (`2.0.0`, dst.).
3. **Migrasi Skema Dokumen (`schemaVersion`) vs Migrasi Kode:**
   - Perubahan pada bentuk data `BoardDocument` atau `props` elemen ditangani otomatis saat runtime oleh `board.loadDocument(doc)` / `migrateSchema` / `defineElement({ migrate })`.
   - Dokumen ini berfokus pada perubahan kontrak kode TypeScript/JavaScript yang dipanggil aplikasi pemakai.

---

## Rilis `0.1.0` (Fondasi Awal)

### [Breaking] Penyatuan Scope Package `@board/*` menjadi `@kujam/*` (ADR-001)

Pada draf PRD awal dan prototipe pra-`0.1.0`, package menggunakan scope sementara `@board/*`. Sejak rilis `0.1.0` (`BOARD-001`), seluruh package resmi menggunakan scope `@kujam/*`.

#### Sebelum

```ts
import { createBoard, defineElement } from '@board/core';
import { mountRenderer } from '@board/renderer';
import { shapesPlugin } from '@board/shapes';
```

#### Sesudah

```ts
import { createBoard, defineElement } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { shapesPlugin } from '@kujam/shapes';
```

---

### [Breaking] Model Teks Kaya Kanonikal (`RichTextBlock[]`) Menggantikan HTML Mentah di Props (ADR-008)

Untuk menjamin keamanan XSS dan konsistensi render di Canvas 2D maupun DOM tanpa ketergantungan *sanitizer* eksternal, properti teks pada elemen `sticky`, `text`, dan `geo` menyimpan array `RichTextBlock[]` terstruktur (atau string polos yang dinormalisasi via `normalizeRichText`), bukan string HTML mentah.

#### Sebelum

```ts
board.create({
  type: 'sticky',
  x: 100,
  y: 100,
  w: 200,
  h: 200,
  props: {
    html: '<p>Catatan <b>penting</b></p>',
    color: 'yellow',
  },
});
```

#### Sesudah

```ts
import { htmlToRichText } from '@kujam/shapes';

board.create({
  type: 'sticky',
  x: 100,
  y: 100,
  w: 200,
  h: 200,
  props: {
    text: htmlToRichText('<p>Catatan <b>penting</b></p>'),
    color: 'yellow',
  },
});
```

---

## Template Entri *Breaking Change* untuk Rilis Berikutnya (`0.2.0` – `1.0.0`)

Setiap perubahan *breaking* baru wajib menambahkan subbagian dengan format berikut (diverifikasi otomatis oleh `tooling/check-migration-docs.mjs`):

```markdown
### [Breaking] <Judul Singkat Perubahan API> (<ID Tiket>)

Penjelasan singkat alasan perubahan, API lama yang dihapus/diubah, dan versi saat `deprecate()` pertama kali ditambahkan.

#### Sebelum

\`\`\`ts
// Contoh kode sebelum migrasi
\`\`\`

#### Sesudah

\`\`\`ts
// Contoh kode sesudah migrasi
\`\`\`
```
