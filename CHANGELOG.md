# Changelog (`@kujam/*`)

All packages in the `@kujam/*` family (`@kujam/core`, `@kujam/renderer`, `@kujam/shapes`, `@kujam/sync-yjs`, `@kujam/storage-memory`, `@kujam/storage-indexeddb`, `@kujam/storage-http`, `@kujam/ui`, `@kujam/react`, `@kujam/vue`, `@kujam/export`, and `@kujam/server`) are released **together (lockstep, fixed mode)** under one version number with [Changesets](./.changeset/config.json) (`BOARD-110`).

- For per-release migration notes and **Before / After** code for every breaking change during `0.x`, see the **[Migration Guide (`docs/MIGRATION.md`)](./docs/MIGRATION.md)** (`BOARD-2206`).
- Following the `BOARD-2301` policy ([ADR-002](./docs/adr/ADR-002-technical-owner-and-api-review.md)), every deprecated public API emits a one-time warning through `deprecate(message)` in development for **at least one full minor release** before it is removed.

---

## [0.1.0] — Unreleased (Local Board Foundation)

### `0.1.0` summary

- **`@kujam/core`**:
  - The `BoardDocument` schema (`schemaVersion: 1`), strict `validateDocument`, document size limits (`DEFAULT_BOARD_LIMITS`), and isolation of unknown records (`UnknownElementRecord`).
  - A transactional store (`board.transact`), typed events (`board.on`), and local undo/redo history with time-window coalescing.
  - Camera (`pan`, `zoom`, `zoomToFit`, `zoomToSelection`), an R-tree spatial index (`rbush`), hit-testing (`board.hitTest`), snapping (`computeSnap`), and multi-page management (`board.pages`).
  - Registries for elements (`defineElement`), brushes (`defineBrush`), tool state machines (`defineTool`), commands (`defineCommand`), keybindings (`Mod+...`), clipboard (`serializeClipboard` / `parseClipboard`), themes (`light` / `dark`), and plugins (`definePlugin`).
  - The `deprecate(message)` deprecation helper (warns once in development, `BOARD-2301`).
- **`@kujam/renderer`**:
  - A three-layer architecture (`mountRenderer`): the main Canvas 2D layer with dirty rects and spatial culling, a camera-transformed HTML layer with viewport virtualization, and an overlay layer for selection, transform handles, snap guides, and collaborator cursors.
  - Unified input handling (mouse, multi-finger touch, Apple Pencil / stylus with pressure and tilt, trackpad wheel / pinch), the Safari iPadOS canvas pixel limit (`SAFARI_MAX_CANVAS_PIXELS`), an accessibility tree (`A11yTree`), and per-element render error isolation (`BOARD-810`).
- **`@kujam/shapes`**:
  - Built-in elements: `sticky` (sticky notes with auto-shrinking font), `draw` (freehand strokes with `perfect-freehand`, RDP simplification, and 5,000-point chunking), `text` (canonical `RichTextBlock[]` rich text from ADR-008 plus an IME-safe inline `contenteditable` editor), `geo` (8 geometric shapes), and `connector` (straight, Bezier, and orthogonal elbow lines that avoid obstacles, with reactive `BindingRecord`s).
  - Built-in tools: `select`, `hand`, `sticky`, `draw`, `eraser` (stroke and area modes), `text`, `geo`, and `connector`.
- **`@kujam/storage-memory` & `@kujam/storage-indexeddb`**:
  - Local and in-memory storage adapters that follow the `StorageAdapter` contract, with debounced autosave and `flush()` when the tab closes.
- **`@kujam/ui`, `@kujam/react`, `@kujam/vue`**:
  - Framework-agnostic Web Components (`<kujam-toolbar>`, `<kujam-selection-toolbar>`, `<kujam-style-panel>`, `<kujam-zoom-bar>`), plus components and hooks/composables for React 18/19 and Vue 3.
- **`@kujam/export`**:
  - Validated JSON document export and import (`exportJSON`, `importJSON`).
