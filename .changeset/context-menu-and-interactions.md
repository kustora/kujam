---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/ui': patch
'@kujam/vue': patch
---

Menu klik kanan (context menu) dan komponen `<kujam-context-menu>` (BOARD-912, BOARD-1408):

- Core: Interface `ContextMenuEvent`, tipe `ContextMenuItem`, fungsi `buildContextMenuItems`, dan helper `createContextMenuEvent` dengan fallback clipboard in-memory saat Clipboard API browser tidak tersedia.
- Renderer: Deteksi klik kanan (button 2), event browser DOM `contextmenu` dengan auto-selection elemen yang diklik kanan, timer long-press (500ms) untuk input sentuh/pena, serta opsi `onContextMenu` pada renderer.
- UI: Komponen bawaan `<kujam-context-menu>` (`ContextMenuElement`) dengan Shadow DOM, CSS tokens, keyboard navigation (ArrowUp/Down, Home, End, Esc), auto-clamping ke batas viewport, dismiss otomatis saat klik luar atau pergeseran kamera, dan integrasi ke `mountDefaultUi`.
