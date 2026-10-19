---
'@kujam/core': patch
'@kujam/renderer': patch
'@kujam/shapes': patch
'@kujam/ui': patch
---

Menambahkan sistem i18n dengan kamus lengkap `id`/`en` (`board.t`, `board.i18n`, `createBoard({ messages })`, `definePlugin({ messages })`), sinkronisasi `prefers-reduced-motion` dan opsi `reducedMotion` di `mountRenderer`, pengamanan XSS tanpa `innerHTML` beserta aturan ESLint di seluruh package, serta audit `axe-core` di Playwright dan `docs/a11y-checklist.md` (`BOARD-1905`, `BOARD-1908`, `BOARD-1909`, `BOARD-2001`).
