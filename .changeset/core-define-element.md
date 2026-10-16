---
'@kujam/core': minor
'@kujam/shapes': minor
---

`defineElement` dan registri tipe elemen (BOARD-601).

- `@kujam/core`: `defineElement` dengan kontrak 0.1 (`type`, `version`, `props`, `defaults`, `geometry`, `resize`, `render.canvas`, `onDoubleClick`, `migrate`, `a11y`, `export.text`) dan field 0.3 bertag `@beta` (`resolve`, `render.html`, `lod`, `actions`, `placeholder`). Tipe `el.props` diinferensi dari skema props di semua callback, dan `defaults` bertipe `Partial<props>`. Definisi divalidasi saat dibuat dan saat didaftarkan.
- `@kujam/core`: `createElementRegistry()` dengan `register`, `get`, `has`, `list`, dan `validateElementProps`. Tipe ganda ditolak dengan `ElementDefinitionError` (`duplicate-type`). Registri belum tersambung ke `createBoard`.
- `@kujam/core`: primitif geometri minimal `@beta` (`rect`, `ellipse`, `polygon`, `polyline`, tipe `Geometry`) dan antarmuka `ElementCanvasContext`, subset struktural Canvas 2D tanpa tipe DOM.
- `@kujam/shapes`: elemen bawaan 0.1 (`stickyElement`, `drawElement`, `textElement`, `geoElement`) didefinisikan dengan `defineElement` dan diekspor sebagai `defaultElements`, bersama skema rich text ADR-008 (`richTextSchema`). `DEFAULT_ELEMENT_TYPES` kini hanya memuat elemen yang benar-benar tersedia (`sticky`, `draw`, `text`, `geo`).
