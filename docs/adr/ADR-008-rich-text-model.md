# ADR-008: Model Rich Text dan Editor untuk Sticky dan Teks

- **Status:** Diusulkan
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-008 (memblokir BOARD-1003; masukan untuk BOARD-1001, BOARD-1503, BOARD-2001, BOARD-2002)
- **Pemilik:** @riziq

## Konteks

Elemen teks mendukung rich text sederhana: tebal, miring, daftar, dan tautan. Sticky memakai format yang sama. PRD dan backlog menetapkan:

- Rich text disimpan sebagai **struktur, tidak pernah HTML** (BOARD-2001).
- Teks diedit lewat `contenteditable` di lapisan HTML. Saat tidak diedit, teks digambar di canvas.
- Di 0.2, teks dipetakan ke **`Y.Text`** agar dua orang bisa mengetik di elemen yang sama tanpa saling menimpa, dengan posisi kursor tetap terjaga (BOARD-1503).
- Risiko di PRD: editor teks di atas canvas rumit (IME, seleksi, salin-tempel), terutama untuk bahasa yang memakai IME.

## Metode

Prototipe ada di [`spikes/board-008-richtext/`](../../spikes/board-008-richtext/README.md):

- **`src/model.ts`:** format, skema validasi (memakai `@kujam/core` dari ADR-007), normalisasi, dan konversi ke teks polos. Ada 16 tes Vitest, termasuk round-trip lewat `yjs` 13.6 sungguhan dan edit bersamaan dua klien.
- **`src/editors/*`:** editor minimal dengan fitur yang sama (tebal, miring, tautan, daftar) untuk Quill 2.0.3, Lexical 0.52, dan ProseMirror. Ukurannya diukur dengan esbuild (kondisi `production`, minify, gzip 9).
- **`paste.mjs`:** uji Quill di Chromium dan WebKit lewat Playwright. Isinya: ketik dan Mod+B, tempel HTML jahat, dan komposisi IME Jepang serta Korea lewat CDP `Input.imeSetComposition` (Chromium).

## Hasil

### Ukuran editor (minify + gzip)

| Editor                                   | Lisensi                                      |        gzip | Model internal                    | Binding Yjs resmi                  |
| ---------------------------------------- | -------------------------------------------- | ----------: | --------------------------------- | ---------------------------------- |
| **Quill 2 (core, tanpa tema)**           | BSD-3-Clause (dependensi MIT dan Apache-2.0) | **44,9 KB** | Delta datar, sama dengan `Y.Text` | `y-quill` ke `Y.Text`              |
| ProseMirror                              | MIT                                          |     61,1 KB | Pohon node                        | `y-prosemirror` ke `Y.XmlFragment` |
| Lexical                                  | MIT                                          |     79,9 KB | Pohon node                        | `@lexical/yjs` ke `Y.XmlText`      |
| (Yjs + y-quill, milik `@kujam/sync-yjs`) | MIT                                          |     28,8 KB |                                   |                                    |

`contenteditable` mentah dengan normalisasi sendiri tidak dibangun, sehingga ukurannya tidak diukur. Perkiraan kami sekitar 8 sampai 15 KB, tetapi seluruh penanganan IME, Android, dan tempel harus ditulis sendiri.

### Uji browser Quill (Chromium dan WebKit)

| Uji                                                                                                        | Hasil                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getContents()` Quill setelah mengetik, Mod+B, dan "- " untuk daftar                                       | Sudah identik dengan bentuk kanonik model kita, tanpa konversi                                                                                                                                                                                        |
| Tempel HTML berisi `<script>`, `<img onerror>`, `javascript:` href, `style`, `<table>`, `<iframe>`, `<h1>` | Tidak ada eksekusi. Editor hanya berisi `p`, `strong`, `em`, `a`, `ol`, `li` (plus penanda `.ql-ui` milik Quill). Model hanya beratribut `bold`, `italic`, `link`, `list`. `javascript:` diubah Quill menjadi `about:blank`, lalu dibuang normalisasi |
| Isi `<script>` dan `<style>`                                                                               | Awalnya masuk sebagai teks biasa. Setelah ditambah matcher clipboard yang membuang `SCRIPT`, `STYLE`, `TEMPLATE`, dan `NOSCRIPT`, isinya hilang                                                                                                       |
| Daftar bersarang dari HTML luar                                                                            | Butir tetap ada, tetapi indentasi hilang (menjadi datar). Keterbatasan yang diterima                                                                                                                                                                  |
| Komposisi IME Jepang (かいぎ ke 会議) dan Korea (ㅎ ke 하 ke 한), CDP Chromium                             | Teks utuh, tidak terputus, tidak terduplikasi                                                                                                                                                                                                         |
| `eval` / `new Function` di bundle ESM kita                                                                 | Tidak ada (hanya ada di berkas UMD `dist` yang tidak dipakai)                                                                                                                                                                                         |

## Keputusan

### 1. Format penyimpanan: delta datar yang identik dengan delta `Y.Text`

```ts
type RichText = Array<{
  insert: string;
  attributes?: {
    bold?: true;
    italic?: true;
    link?: string; // http, https, mailto
    list?: 'bullet' | 'ordered'; // hanya pada "\n"
    indent?: 1 | 2 | 3; // hanya pada "\n" yang punya list
  };
}>;
// Contoh: "Rencana" lalu dua butir daftar
[
  { insert: 'Rencana\nide ' },
  { insert: 'satu', attributes: { bold: true } },
  { insert: '\n', attributes: { list: 'bullet' } },
  { insert: 'ide dua' },
  { insert: '\n', attributes: { list: 'bullet' } },
];
```

Aturan bentuk kanonik (`normalizeRichText`, tidak pernah melempar exception):

- Atribut blok (`list`, `indent`) hanya menempel pada `\n` penutup baris. Atribut inline (`bold`, `italic`, `link`) tidak pernah menempel pada `\n`.
- Dokumen selalu diakhiri `\n`. Dokumen kosong adalah `[{ insert: '\n' }]`.
- Op bersebelahan dengan atribut sama digabung. Bentuk ini sama dengan keluaran `Y.Text.toDelta()` dan `Quill.getContents()`, sehingga ketiganya dapat dipertukarkan tanpa konversi.
- Yang dibuang:
  - atribut yang tidak dikenal;
  - nilai atribut yang salah (misalnya `bold: false`);
  - embed (insert bukan string);
  - karakter kontrol selain `\n` dan `\t`.
- CRLF diubah menjadi LF.
- Tautan hanya `http:`, `https:`, dan `mailto:`. Aturan lengkapnya mengikuti BOARD-2002.
- Batas: 20.000 karakter per elemen dan panjang tautan 2.048.

Data dari peer atau server diperiksa dulu dengan skema struktural (`richTextSchema`, ADR-007), lalu dinormalisasi. Edit bersamaan di Yjs bisa menghasilkan bentuk yang tidak kanonik, misalnya tebal yang melintasi `\n`. Normalisasi membereskannya tanpa mengubah teks, dan hal ini sudah diuji.

**Alasan memilih format datar, bukan pohon blok:** `Y.Text` memakai delta datar. Format pohon (seperti ProseMirror atau Lexical) harus memakai `Y.XmlFragment` atau `Y.XmlText`, yang bertentangan dengan PRD dan BOARD-1503, atau memerlukan lapisan konversi yang rawan saat ada edit bersamaan.

### 2. Editor: Quill 2 (core, tanpa tema), dimuat saat dibutuhkan

- Dipakai hanya selama elemen diedit. Saat tidak diedit, teks digambar di canvas dari delta (BOARD-1003a).
- Dimuat dengan `import()` pada edit pertama, sehingga 45 KB-nya tidak masuk anggaran awal `core` + `renderer` + `shapes` (90 KB). Lazy chunk ini tetap dicatat di anggaran bundle BOARD-2103.
- Format yang didaftarkan hanya `bold`, `italic`, `link`, dan `list`. Clipboard Quill menyaring tempelan ke format tersebut, ditambah matcher yang membuang `SCRIPT`, `STYLE`, `TEMPLATE`, dan `NOSCRIPT`. Hasil `getContents()` tetap melewati `normalizeRichText` sebelum disimpan.
- Toolbar dan UI tautan milik `@kujam/ui`, bukan tema Quill. Kami menyediakan CSS minimal sendiri, tanpa `quill.snow.css`.
- **Undo:** riwayat Quill hanya berlaku di dalam satu sesi edit. Saat keluar dari edit, seluruh perubahan menjadi satu langkah undo papan (BOARD-301). Di 0.2, `y-quill` dan UndoManager Yjs mengambil alih (BOARD-1503).
- Shortcut papan dimatikan selama `isComposing` atau selama editor fokus. Esc keluar dari edit hanya bila sedang tidak ada komposisi IME.
- Quill menjadi dependensi `@kujam/shapes`, bukan `@kujam/core`. Core tetap tanpa dependensi dan tanpa DOM.

### 3. Daftar kasus IME yang wajib diuji (BOARD-1003d, setiap rilis)

Otomatis di CI (Chromium, CDP `Input.imeSetComposition` dan `Input.insertText`):

1. Komposisi Jepang (romaji ke kana ke kanji) di awal, tengah, dan akhir run tebal.
2. Komposisi Korea dengan perakitan suku kata per ketukan (ㅎ ke 하 ke 한), termasuk Backspace yang mengurai suku kata.
3. Komposisi di dalam butir daftar; Enter yang meng-commit komposisi tidak boleh membuat butir baru.
4. Satu komposisi sama dengan satu langkah undo.

Manual (macOS Safari, Chrome, dan Firefox; Windows Chrome dan Edge; Android Chrome):

| No  | Kasus                                                                                                                                                                    | Yang diperiksa                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 1   | **Jepang** (Kotoeri atau Google Japanese Input): konversi dengan Spasi, ubah segmen dengan Shift+panah, Enter commit, Esc batal                                          | Esc membatalkan komposisi, bukan keluar dari mode edit; tidak ada karakter ganda |
| 2   | **Cina Pinyin** (macOS, Microsoft Pinyin, Sogou): pilih kandidat dengan angka 1 sampai 9, Shift beralih ke huruf latin, tanda baca lebar penuh                           | Angka saat memilih kandidat tidak memicu shortcut papan                          |
| 3   | **Cina Zhuyin dan Cangjie** (Taiwan): tombol nada, pilih kandidat                                                                                                        | Sama dengan nomor 2                                                              |
| 4   | **Korea** dua-beolsik: mengetik di akhir baris lalu Enter, lalu klik di luar saat suku kata belum selesai                                                                | Suku kata terakhir tidak terduplikasi atau hilang (kelas bug Safari dan Chrome)  |
| 5   | **Vietnam Telex** (penggantian karakter tanpa `compositionstart` di sebagian IME)                                                                                        | Diakritik benar, kursor tidak melompat                                           |
| 6   | **Android Gboard**: setiap kata adalah komposisi (`keyCode` 229), koreksi otomatis (`insertReplacementText`), ketik geser, ketuk saran, Backspace pada kata terkomposisi | Teks dan seleksi sesuai; tidak ada huruf ganda                                   |
| 7   | **Dead key** (Option+e lalu e menjadi é; keyboard internasional) dan pemilih emoji (Ctrl+Cmd+Spasi, Win+.)                                                               | Karakter masuk utuh termasuk emoji gabungan (ZWJ)                                |
| 8   | **Shortcut saat komposisi**: Mod+B, Mod+I, Tab, Esc, Delete                                                                                                              | Diabaikan papan selama `isComposing`                                             |
| 9   | **(0.2) Edit remote saat komposisi**: peer menyisipkan teks sebelum kursor                                                                                               | Komposisi tidak terputus, kursor tetap di posisi yang benar (BOARD-1503)         |
| 10  | **(Ditunda) iOS dan iPadOS**: koreksi otomatis, dikte, QuickType                                                                                                         | Ikut penundaan uji iPad (BOARD-2105)                                             |

## Alternatif yang ditolak

- **`contenteditable` mentah dengan normalisasi sendiri.** Bundle terkecil, tetapi seluruh risiko IME, Android, seleksi, dan tempel (risiko teratas PRD untuk editor teks) jatuh ke tim. Waktu yang dibutuhkan melampaui estimasi BOARD-1003 (8 SP).
- **ProseMirror.** Terawat aktif dan matang, 61 KB. Modelnya pohon dan binding Yjs-nya ke `Y.XmlFragment`, bukan `Y.Text`. Ini pilihan cadangan bila Quill bermasalah, dengan konsekuensi format penyimpanan harus ditinjau ulang.
- **Lexical.** Terbesar (80 KB), modelnya pohon, dan binding Yjs-nya ke `Y.XmlText`.
- **Slate, Tiptap, Editor.js, dan Pell.** Slate bergantung pada React (tidak agnostik). Tiptap dibangun di atas ProseMirror sehingga lebih besar. Editor.js berbasis blok dan berat. Pell keluarannya HTML.

## Risiko dan tindak lanjut

- **Perawatan Quill 2.** Rilis terakhir 2.0.3. Quill dikunci di versi minor, dan BOARD-1003d menjalankan uji IME di setiap rilis. Bila Quill bermasalah serius, beralih ke ProseMirror dengan meninjau ulang format penyimpanan (lihat alternatif).
- **Firefox belum diuji otomatis** karena build Firefox Playwright gagal di macOS 27 (sama dengan BOARD-003). Uji tempel dan IME Firefox dilakukan manual.
- **Uji IME otomatis hanya mensimulasikan komposisi lewat CDP**, bukan IME sistem operasi. Daftar manual di atas tetap wajib.
- Kode prototipe `src/model.ts` dipindah ke `@kujam/shapes` di BOARD-1003a, dan `src/editors/quill.ts` ke BOARD-1003b. Folder spike boleh dihapus setelah BOARD-1003 selesai.
