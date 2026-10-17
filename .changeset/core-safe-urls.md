---
'@kujam/core': minor
'@kujam/shapes': minor
---

Validasi URL tautan dan gambar (BOARD-2002).

- `isSafeUrl(url, allowedSchemes?)` dan `sanitizeUrl(url, allowedSchemes?)`: bawaan hanya `https:` dan `http:` (`DEFAULT_URL_SCHEMES`); pemakai bisa menambah skema, dengan atau tanpa titik dua. URL harus absolut; URL relatif dan tanpa skema ditolak. Batas panjang bawaan 2048 (`MAX_URL_LENGTH`).
- `javascript:`, `vbscript:`, `file:`, dan `about:` selalu ditolak walau didaftarkan, termasuk variasi huruf besar, spasi atau karakter kontrol di depan, tab dan baris baru di tengah, serta skema yang di-encode (`%6Aavascript:`, `&#106;avascript:`). `data:` hanya untuk gambar raster base64 (png, jpeg, gif, webp, avif) bila `data:` didaftarkan; SVG ditolak.
- `safeLinkAttributes(url)` mengembalikan `{ href, target: '_blank', rel: 'noopener noreferrer' }` (`SAFE_LINK_REL`) untuk renderer dan UI, atau `null` bila URL tidak aman.
- Primitif skema baru `url({ schemes?, maxLength? })` dengan kode issue `unsafe_url` (ADR-007), agar elemen kustom memakai aturan yang sama.
- `@kujam/shapes`: atribut `link` rich text kini divalidasi dengan `url()` dan hanya menerima `https:`, `http:`, dan `mailto:` (`LINK_URL_SCHEMES`, ADR-008).
