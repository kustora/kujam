---
'@kujam/react': patch
'@kujam/vue': patch
---

Wrapper komponen UI untuk React dan Vue (BOARD-1410): `Toolbar`, `ZoomControl`, `HistoryControl`, `SelectionToolbar`, `Minimap`, `CommandPalette` (prop `source`), `ContextMenu`, `PresenceBar`, dan `ShortcutHelp` merender elemen `@kujam/ui` dengan prop bertipe. `board` diteruskan sebagai properti DOM dan dilepas saat unmount. React meneruskan `className`, `style`, `id`, dan `ref` ke elemen; Vue meneruskan `class` dan `style`, dengan properti `element` di instance komponen. Adapter tidak mengimpor `@kujam/ui` (aturan arah impor BOARD-106), jadi aplikasi memanggil `defineUiElements()` sekali; tanpa itu muncul peringatan di konsol. Aman untuk SSR. Panduan mengganti UI seluruhnya dengan hooks ada di `docs/custom-ui.md`.
