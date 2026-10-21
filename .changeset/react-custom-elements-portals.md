---
'@kujam/react': patch
---

Render elemen kustom dengan komponen React via prop `elements` pada `<Board>` dan helper `defineReactElement` (BOARD-1304):

- Mendukung prop `elements` pada `<Board>` untuk merender komponen React kustom ke dalam host HTML elemen menggunakan React Portals (`createPortal`).
- Mewarisi seluruh React Context aplikasi (tema, query client, routing) ke dalam kartu kustom tanpa terputus.
- Berjalan dalam satu pohon React terpadu tanpa instans `createRoot` terpisah per elemen, menjaga performa dan efisiensi memori.
- Menyediakan tipe prop `CustomElementComponentProps` (`element`, `data`, `status`, `board`) dan helper mandiri `defineReactElement`.
