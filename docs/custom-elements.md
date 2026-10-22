# Elemen Kustom: Data Luar, `render.html`, dan Keamanan

Panduan untuk penulis plugin yang membuat elemen dengan data dari aplikasi (BOARD-604, BOARD-1201, BOARD-1202, BOARD-1203, BOARD-1206). Contoh di bawah memakai kartu post generik.

## 1. Resolver di aplikasi

Aplikasi mendaftarkan fungsi pengambil data per nama. Hasilnya boleh langsung (dari cache aplikasi), berupa `Promise`, atau `ResolveError`:

```ts
const board = createBoard({
  plugins: [defaultElements, defaultTools, postPlugin],
  resolvers: {
    post: async (id) => {
      const res = await fetch(`/api/posts/${encodeURIComponent(id)}`);
      if (res.status === 403) return { status: 'forbidden' };
      if (res.status === 404) return { status: 'not-found' };
      if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
      return (await res.json()) as Post;
    },
  },
});
```

- Hasil disimpan per `(resolver, id)`. Permintaan yang sedang berjalan dipakai bersama, jadi sepuluh kartu untuk post yang sama hanya memanggil `post` sekali.
- Kegagalan (exception atau promise yang ditolak) **tidak** di-cache. Elemen menampilkan error dengan tombol "Coba lagi" (`board.reloadElementData(id)`).
- Saat data berubah di aplikasi, panggil `board.invalidate('post', id)`. Hanya elemen yang memakai post itu yang dimuat ulang dan di-update. `board.invalidate('post')` membuang seluruh cache resolver `post`.

## 2. Elemen

```ts
const postCard = defineElement({
  type: 'post-card',
  version: 1,
  props: schema({ postId: string() }),
  defaults: { postId: '' },
  // Menentukan data elemen dari props. Pasangan (resolver, id) yang dipanggil di sini dicatat,
  // sehingga invalidate hanya menyentuh elemen yang benar-benar memakainya.
  resolve: (el, ctx) => ctx.resolvers.post!(el.props.postId) as Post | Promise<Post>,
  placeholder: (reason) => ({ label: reason === 'forbidden' ? 'Post privat' : '' }),
  render: {
    html(host, el, data) {
      const title = host.ownerDocument.createElement('strong');
      const like = host.ownerDocument.createElement('button');
      like.dataset.boardInteractive = ''; // satu-satunya area yang menerima klik
      like.textContent = 'Suka';
      host.append(title, like);
      const show = (post?: Post) => {
        title.textContent = post?.title ?? ''; // textContent, bukan innerHTML
      };
      show(data);
      return { update: (_el, next) => show(next), destroy() {} };
    },
  },
});
```

Siklus hidup:

| Saat                                   | Yang terjadi                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Elemen masuk viewport                  | `resolve` dijalankan (sekali, lalu di-cache), lalu `render.html(host, el, data, ctx)`.         |
| Data sedang dimuat                     | Skeleton seukuran elemen. Ganti lewat `placeholder('loading')`.                                |
| `forbidden` / `not-found`              | `placeholder(reason)`, atau label bawaan. **Tidak pernah** menampilkan data.                   |
| `error`                                | Placeholder error dengan tombol "Coba lagi".                                                   |
| Record atau data berubah               | `update(el, data)`. Kamera bergeser atau zoom **tidak** memanggil `update`.                    |
| `invalidate` dengan resolver async     | Tampilan lama tetap terlihat sampai data baru datang, lalu `update`.                           |
| Keluar viewport, dihapus, atau unmount | `destroy()`.                                                                                   |
| Props berubah                          | `resolve` dijalankan lagi. Memindahkan atau mengubah ukuran elemen tidak memicu resolve ulang. |

`render.canvas`, `actions`, dan `a11y` menerima `data` yang sama begitu siap. Elemen canvas dengan `resolve` digambar sebagai placeholder sampai datanya siap.

### Pointer

Host elemen meneruskan event pointer ke tool papan (pilih, geser, resize) sehingga kartu HTML bisa dipilih dan dipindah seperti elemen lain. Hanya node yang ditandai `data-board-interactive` yang menerima klik dan ketikan sendiri, misalnya tombol, tautan, atau input.

### Isolasi kesalahan

Exception di `resolve`, resolver, `render.html`, `update`, `render.canvas`, `actions`, atau `a11y` hanya memengaruhi elemen itu: elemen menampilkan placeholder error dan papan memancarkan event `error` (`resolve-error`, `render-error`, `action-error`). Elemen lain tetap digambar.

### Drop target (BOARD-1208)

Elemen bisa menerima elemen lain yang dijatuhkan ke atasnya dengan tool select:

```ts
dropTarget: {
  accepts: (dropped) => dropped.type === 'item-card',
  onDrop(target, dropped, point, ctx) {
    ctx.updateProps({ itemIds: [...target.props.itemIds, String(dropped.props.itemId)] });
    ctx.removeDropped(); // tanpa ini elemen yang dijatuhkan tetap di posisi lepasnya
  },
},
```

Selama elemen yang diterima diseret di atas target, overlay menyorot target. Geser + `onDrop` menjadi satu transaksi dan satu langkah undo. `accepts` harus murah dan tanpa efek samping; error di `accepts`/`onDrop` dilaporkan sebagai event `error` `plugin-error`, dan `onDrop` yang melempar error membatalkan seluruh perubahan drop (geserannya tetap).

### Tempel URL (BOARD-1209)

Plugin bisa mengubah URL yang ditempel menjadi elemen, misalnya kartu tautan:

```ts
definePlugin({
  id: 'example.link-card',
  elements: [linkCard], // resolve: (el, ctx) => ctx.resolvers.linkPreview(el.props.url)
  onPasteUrl: (url) => ({ type: 'link-card', w: 320, h: 120, props: { url } }),
});
```

Hook wajib sinkron dan mengembalikan `ElementInput` atau `null`; plugin pertama (urutan pemasangan) yang mengembalikan elemen menang, dan tempel itu satu langkah undo. Hanya URL `http:`/`https:` yang sampai ke hook. Package **tidak** mengambil URL: metadata pratinjau diambil host (sebaiknya di server) lewat resolver, sehingga elemen langsung tampil dalam status memuat lalu terisi. Hook yang melempar error dilaporkan sebagai `plugin-error` dan plugin berikutnya dicoba; bila tidak ada yang menangani, URL ditempel sebagai teks.

## 3. Keamanan (ADR-009, T8)

Kode plugin berjalan dengan hak penuh di origin aplikasi, jadi package tidak bisa melindungi dari plugin yang berbahaya. Yang bisa (dan wajib) dicegah adalah **data** yang tidak dipercaya masuk ke DOM sebagai kode. Props elemen dan data resolver dianggap tidak dipercaya: keduanya bisa berasal dari peer kolaborasi, berkas impor, atau server.

- **Teks:** pakai `textContent` atau `createTextNode`. Jangan pernah `innerHTML`, `outerHTML`, `insertAdjacentHTML`, atau `document.write` dengan props atau data. Aturan ESLint repo ini melarangnya di package, terapkan juga di plugin.
- **Tautan dan gambar:** jalankan URL lewat `sanitizeUrl` / `isSafeUrl` dari `@kujam/core` sebelum dipasang ke `href` atau `src`; buka tautan dengan `safeLinkAttributes()` (`rel="noopener noreferrer"`).
- **Style:** atur lewat CSSOM (`el.style.color = …`), jangan menyusun atribut `style` atau `<style>` dari data. Ini juga yang membuat papan berjalan di CSP ketat (`docs/csp.md`).
- **Iframe:** jangan membuat iframe dari URL di props. Pakai elemen embed resmi `createEmbedElement({ domains })` dari `@kujam/shapes` (BOARD-1107) yang memakai `sandbox` dan daftar origin.
- **Placeholder:** `placeholder(reason)` tidak menerima data, sehingga elemen `forbidden` tidak bisa membocorkan isi yang dilarang.
- **Resolver:** periksa izin di server atau aplikasi, lalu kembalikan `{ status: 'forbidden' }`; jangan mengandalkan elemen untuk menyembunyikan data yang sudah dikirim.
