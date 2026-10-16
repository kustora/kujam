# ADR-007: Skema Validasi Props (Mini-lib Sendiri)

- **Status:** Diusulkan
- **Tanggal:** 2026-10-16
- **Tiket:** BOARD-007 (memblokir BOARD-203, jalur kritis MVP)
- **Pemilik:** @riziq

## Konteks

Setiap tipe elemen mendaftarkan skema `props`, misalnya `schema({ postId: string(), size: enumOf(['s', 'm', 'l']) })` di contoh `defineElement` pada PRD. Skema ini dipakai untuk dua hal:

1. **Validasi runtime.** Data dari server atau peer yang tidak valid ditolak dan dilaporkan lewat event `error`, tanpa membuat papan crash.
2. **Tipe TypeScript.** Developer plugin menulis skema sekali dan otomatis mendapat tipe `props`.

Batasan dari PRD dan backlog:

- `@kujam/core` tanpa dependensi runtime (library kecil boleh dibundel) dan di bawah 40 KB gzip.
- Ukuran validator di bawah 3 KB gzip (BOARD-203).
- Error berisi path dan pesan, tanpa melempar exception.
- Package berjalan dengan CSP ketat tanpa `unsafe-eval` (BOARD-2006).
- Data dari peer dibatasi ukurannya (BOARD-2004), misalnya 5.000 titik per coretan.

## Metode

Prototipe ada di [`spikes/board-007-schema/`](../../spikes/board-007-schema/). Tiga skema yang sama persis ditulis di empat kandidat:

- **Sticky:** 9 field yang memakai semua primitif.
- **Kartu:** 2 field.
- **Coretan:** array titik bersarang, sampai 5.000 titik.

Kandidatnya:

- **mini**: prototipe mini-lib sendiri (`src/mini.ts`, sekitar 200 baris).
- **Valibot** 1.5.0.
- **Zod Mini** 4.6.7 (`zod/mini`).
- **Zod** 4.6.7, sebagai pembanding.

Ukuran diukur dengan esbuild (bundle, minify, tree-shaking), lalu gzip level 9. Kecepatan diukur di Node 20, M4, median dari 15 run. Inferensi tipe diuji dengan `tsc` memakai pola `Expect<Equal<...>>`, termasuk uji negatif untuk memastikan tesnya benar-benar bisa gagal.

## Hasil

|                                                              |            mini |                      Valibot |                  Zod Mini |                       Zod |
| ------------------------------------------------------------ | --------------: | ---------------------------: | ------------------------: | ------------------------: |
| Bundle gzip, termasuk 3 skema (B)                            |       **1.211** |                        2.196 |                     6.724 |                    93.217 |
| Bundle minify (B)                                            |           2.910 |                        6.880 |                    20.336 |                   454.565 |
| 5.000 sticky valid (ms)                                      |         **1,5** |                          2,5 |                       3,5 |            1,1 sampai 1,6 |
| 5.000 coretan x 50 titik (ms)                                |         **7,3** |                         21,2 |                      13,2 |                      18,3 |
| 5.000 sticky tidak valid (ms)                                |         **1,8** |                          3,0 |                       5,9 |                       7,2 |
| Inferensi tipe sesuai harapan (termasuk kunci opsional `?:`) |              ya |                           ya |                        ya |                        ya |
| Tanpa `eval` / `new Function` (aman untuk CSP ketat)         |              ya |                           ya | tidak (JIT, ada fallback) | tidak (JIT, ada fallback) |
| Issue berisi nilai input                                     |           tidak | ya (`input`, `path[].input`) |                     tidak |                     tidak |
| Nilai keluaran                                               | objek yang sama |                 salinan baru |              salinan baru |              salinan baru |

Contoh error mini untuk `{ ...sticky, fontSize: NaN, extra: 1, tags: ['a', 2] }`:

```json
{
  "ok": false,
  "issues": [
    { "path": ["fontSize"], "code": "type", "message": "expected finite number, got NaN" },
    { "path": ["tags", 1], "code": "type", "message": "expected string, got number" },
    { "path": ["extra"], "code": "unknown_key", "message": "unknown key" }
  ]
}
```

Catatan:

- **Ukuran:** mini sudah termasuk ketiga skema contoh. Bagian library-nya sendiri kira-kira 1 KB gzip, jadi masih ada ruang untuk primitif tambahan di bawah batas 3 KB.
- **Zod v4 dan CSP:** Zod menghasilkan validator lewat `new Function`. Di bawah CSP tanpa `unsafe-eval` ia jatuh ke mode runtime, tetapi percobaan itu tetap memicu laporan `securitypolicyviolation` kecuali `jitless` diatur secara global. Mini dan Valibot tidak memakai `eval` sama sekali.
- **Valibot dan data sensitif:** issue Valibot membawa nilai input lengkap, termasuk objek induk di setiap segmen path. Bila issue diteruskan apa adanya ke event `error` dan dicatat pemakai, isi papan bisa ikut ke log.

## Keputusan

**Membuat mini-lib validator sendiri di `@kujam/core`**, berdasarkan prototipe `spikes/board-007-schema/src/mini.ts`. Implementasi produksinya di BOARD-203.

### Primitif awal

`string`, `number`, `boolean`, `literal`, `enumOf`, `array`, `object` (dengan alias `schema` untuk props tingkat atas, sesuai PRD), `optional`, dan `nullable`.

Opsi kecil yang langsung disertakan karena dibutuhkan untuk batas keamanan (BOARD-2004):

| Primitif | Opsi                     |
| -------- | ------------------------ |
| `string` | `minLength`, `maxLength` |
| `number` | `min`, `max`, `int`      |
| `array`  | `maxLength`              |

### Semantik

- **Validator, bukan parser.** Nilai tidak diubah: tidak ada transform, coercion, atau default. Default tetap milik `defineElement({ defaults })`. Hasil sukses mengembalikan objek yang sama, tanpa salinan, sehingga cocok dengan snapshot immutable di store (BOARD-204).
- **Tidak melempar exception.** Hasilnya `{ ok: true, value } | { ok: false, issues }`. Setiap issue berisi `path`, `code`, dan `message`.
- **`code` adalah kontrak publik, `message` tidak.** Pesan berbahasa Inggris dan hanya untuk developer. UI yang perlu teks lokal memetakan `code`.
- **Issue tidak membawa nilai input,** supaya isi papan tidak bocor ke log atau telemetri pemakai.
- **Objek ketat:** kunci yang tidak dikenal ditolak (`unknown_key`). Elemen dari versi plugin yang lebih baru ditangani lewat `version` dan `migrate` di `defineElement` (BOARD-702) serta mode baca saja untuk versi lebih baru (BOARD-703), bukan dengan melonggarkan skema.
- **Hanya nilai yang aman untuk JSON:** `number` wajib finite (tolak `NaN` dan `Infinity`), dan `optional` berarti kunci boleh tidak ada.
- **Kerja dibatasi:** validasi berhenti setelah 20 issue (`too_many_issues`), supaya input jahat tidak membuat kerja tak terbatas.
- **Tanpa `eval` atau `new Function`.**

### Kandidat tambahan (diputuskan saat dibutuhkan, lewat review API pemilik)

| Kandidat              | Kebutuhan                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tuple`               | Titik coretan `[x, y, tekanan]`, bila `@kujam/shapes` menyimpannya sebagai tuple                                    |
| `url`                 | Validasi skema URL (BOARD-2002) sebagai primitif, agar elemen kustom mendapat aturan yang sama dengan elemen bawaan |
| `record`              | Peta kunci bebas, belum ada kebutuhan                                                                               |
| `union` / diskriminan | Belum ada kebutuhan; menambah ukuran dan kerumitan inferensi                                                        |

## Alternatif yang ditolak

- **Valibot dibundel.** Kandidat kedua yang kuat (2,2 KB, tanpa `eval`, inferensi bagus). Ditolak karena:
  - issue membawa nilai input;
  - keluaran selalu salinan baru;
  - validasi coretan hampir 3 kali lebih lambat;
  - API `pipe` lebih panjang untuk developer plugin.

  Bila mini-lib nanti tumbuh melewati 3 KB atau butuh union dan transform, Valibot jadi pilihan pertama untuk ditinjau ulang.

- **Zod Mini.** 6,7 KB, melewati batas 3 KB, dan memakai JIT `new Function`.
- **Zod.** 93 KB gzip, dua kali anggaran seluruh core.

## Konsekuensi

- BOARD-203 bisa dimulai. Kode prototipe dipindah ke `packages/core/src/schema.ts`, lalu ditambah tes unit (cakupan 90%), TSDoc, dan tag `@public`. Tipe internal `_check`, `_t`, dan `_opt` diberi tag `@internal` atau disembunyikan di laporan API.
- Tim memelihara sekitar 200 baris kode validasi sendiri. Tambahan primitif harus lewat review pemilik agar ukuran tetap di bawah 3 KB. Ukurannya diawasi anggaran bundle BOARD-2103.
- Folder `spikes/board-007-schema/` boleh dihapus setelah BOARD-203 selesai.
