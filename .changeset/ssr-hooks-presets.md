---
'@kujam/core': patch
'@kujam/react': patch
'@kujam/vue': patch
---

Hook `onDocumentSaved`, resize preset handler, dan dukungan SSR aman untuk Next.js dan Nuxt (BOARD-1210, BOARD-1213, BOARD-1308):

- Core: Hook `onDocumentSaved` pada plugin yang dipanggil setelah storage adapter berhasil menyimpan dokumen dengan snapshot dokumen (diisolasi sehingga error tidak membatalkan penyimpanan), metode `board.notifyDocumentSaved(doc)`, dan kode error `'plugin-error'`.
- Core: Helper `createPresetResizeHandler(presets)` untuk memetakan dimensi resize ke preset ukuran diskrit (seperti `'s'`, `'m'`, `'l'`), serta pengujian komprehensif mode `fixed-ratio`, `none`, dan fungsi kustom.
- React: Dukungan SSR aman dengan `getServerSnapshot` pada `useSyncExternalStore` di `<Board>` sehingga rendering di server (Node/Next.js) tidak melempar error dan renderer hanya dipasang di klien (`useEffect`).
- Vue: Verifikasi SSR aman di server (Node/Nuxt) dengan pengujian `vue/server-renderer` dan renderer hanya dipasang di klien (`onMounted`).
- Docs: Panduan `docs/ssr-nextjs-nuxt.md` untuk integrasi Next.js App/Pages Router dan Nuxt 3.
