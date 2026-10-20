# Content Security Policy (`BOARD-2006`)

Package `@kujam/*` berjalan dengan Content Security Policy (CSP) ketat: **tanpa `unsafe-eval`** dan **tanpa `unsafe-inline`** untuk script maupun style. Tidak ada package (begitu juga dependensinya: `yjs`, `lib0`, `y-protocols`, `y-indexeddb`, `perfect-freehand`) yang memakai `eval`, `new Function`, atau script inline.

## Kebijakan yang disarankan

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' blob: data:;
  connect-src 'self' wss://sync.contoh.id https://api.contoh.id;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none'
```

Sesuaikan direktif dengan fitur yang dipakai:

| Direktif      | Kebutuhan                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`  | Cukup `'self'` (atau origin CDN tempat bundel aplikasi). Tidak perlu `unsafe-eval` maupun `unsafe-inline`.                                                                                        |
| `style-src`   | Cukup `'self'`. Lihat [Style](#style) untuk browser lama.                                                                                                                                         |
| `img-src`     | `blob:` untuk gambar yang di-drop atau ditempel (object URL, `BOARD-908`); `data:` hanya bila dokumen menyimpan gambar raster sebagai `data:` URL. Tambahkan origin `AssetResolver` bila berbeda. |
| `connect-src` | Endpoint `@kujam/sync-yjs` (WebSocket `wss:`, mis. Hocuspocus) dan `@kujam/storage-http`.                                                                                                         |
| `font-src`    | Hanya bila aplikasi memuat font Inter sendiri; UI memakai font sistem sebagai cadangan.                                                                                                           |

## Style

- **`@kujam/ui`** memasang style setiap komponen sebagai _Constructable Stylesheet_ (`shadowRoot.adoptedStyleSheets`), satu lembar per jenis komponen dan dipakai bersama. CSP tidak berlaku untuk lembar ini, jadi `style-src 'self'` cukup. Browser tanpa `adoptedStyleSheets` (Safari < 16.4, Firefox < 101, Chrome < 73) jatuh ke elemen `<style>` di shadow root, yang **diblokir** kebijakan ketat. Untuk browser tersebut tambahkan `style-src 'unsafe-inline'`.
- **`@kujam/renderer`**, **`@kujam/shapes`**, dan editor teks hanya mengatur style lewat CSSOM (`el.style.left = …`, `style.setProperty`), yang tidak dibatasi `style-src-attr`. Tidak ada atribut `style` dari markup atau `setAttribute('style', …)`; HTML tempelan disanitasi dan atribut `style`-nya dibuang (`BOARD-2001`).
- Elemen kustom yang merender HTML (`render.html`) adalah tanggung jawab plugin: ikuti aturan yang sama (CSSOM, bukan atribut `style` atau `<style>`).

## Pengujian

`e2e/csp.spec.ts` membuka playground dengan `?csp=1`. Server dev lalu mengirim kebijakan ketat di atas (dengan nonce hanya untuk `<style>` milik playground dan tag yang disuntikkan Vite) dan tes gagal bila ada pelanggaran CSP dari package:

```bash
pnpm test:e2e e2e/csp.spec.ts
```

Catatan: WebKit melaporkan `style-src-attr` untuk shadow tree bawaan setiap elemen `<select>`. Package tidak memakai `<select>`; laporan dari shell playground diabaikan oleh tes.
