# kujam

**A collaborative whiteboard you can embed in any app.** A DOM-free TypeScript core, a Canvas 2D renderer with an HTML layer for custom elements, realtime collaboration over Yjs, and thin adapters for React, Vue, or plain JavaScript.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![Status: 0.x](https://img.shields.io/badge/status-0.x%20pre--release-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)

kujam knows nothing about your domain. There is no notion of a "post", "task", or "card" inside it. Your app plugs in its own elements with `defineElement`, and kujam takes care of the canvas, selection, undo, collaboration, accessibility, and export. Built by [Kustora](https://kustora.id), and first used for the Jam Tayang canvas.

---

## Contents

- [Features](#features)
- [Status](#status)
- [Packages](#packages)
- [Quick start](#quick-start)
- [React and Vue](#react-and-vue)
- [Custom elements](#custom-elements)
- [Realtime collaboration](#realtime-collaboration)
- [Storage and export](#storage-and-export)
- [Architecture](#architecture)
- [Examples and playground](#examples-and-playground)
- [Documentation](#documentation)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

- **Built-in elements:** sticky notes, freehand strokes (perfect-freehand), rich text, 8 geometric shapes, connectors with elbow routing, frames, images, and groups.
- **Custom elements from your app:** rendered as HTML (or React/Vue components) that follow the camera, with data from your own resolvers. Elements store only an ID; their content is always read from its source.
- **Realtime collaboration:** Yjs with presence (cursors, selections, live strokes), follow mode, per-user undo, read-only mode, automatic reconnection, and short offline periods through IndexedDB.
- **Complete interaction:** selection, transforms, snapping, lasso, copy and paste across boards and from the system clipboard, drag and drop, command palette, minimap, context menu, and keyboard shortcuts.
- **Touch and stylus:** pinch, two-finger pan, pen pressure, and the stylus eraser button (tested in WebKit and iPad emulation).
- **Accessibility:** keyboard navigation on the canvas, an accessibility tree for screen readers, live regions, `prefers-reduced-motion`, and axe-core audits in CI.
- **Export:** PNG, SVG, PDF, plain text, JSON, and thumbnails, in the browser and in Node.
- **Secure by default:** no `innerHTML` in package code (enforced by lint), sanitized URLs, validated peer data, and size limits on Yjs updates.
- **i18n:** English and Indonesian built in; plugins and apps can add their own dictionaries.

## Status

kujam is **0.x and not published to npm yet**. Each package's public API is tracked by an [API Extractor](https://api-extractor.com) report and every change is recorded with [Changesets](./.changeset), but breaking changes can still land in minor releases. See the [changelog](./CHANGELOG.md) and the [migration guide](./docs/MIGRATION.md).

Until the first npm release, use kujam from source: clone this repository, or add it as a git submodule and include `packages/*` in your pnpm workspace.

## Packages

All packages are released together under one version number.

| Package                    | What it does                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@kujam/core`              | Document model, transactions, undo/redo, selection, camera, tools, plugins. No DOM, no runtime dependencies |
| `@kujam/renderer`          | Canvas 2D renderer, HTML layer for custom elements, overlay, pointer/touch/pen input                        |
| `@kujam/shapes`            | Built-in elements and tools, inline text editor                                                             |
| `@kujam/ui`                | Toolbar, contextual toolbar, minimap, command palette, context menu (Web Components)                        |
| `@kujam/react`             | `<Board>` component, hooks, and React custom elements through portals                                       |
| `@kujam/vue`               | `<Board>` component, composables, and Vue custom elements through Teleport                                  |
| `@kujam/sync-yjs`          | Yjs sync, presence, per-user undo, offline persistence, version snapshots                                   |
| `@kujam/storage-memory`    | In-memory storage (tests)                                                                                   |
| `@kujam/storage-indexeddb` | IndexedDB storage (demos and offline use without Yjs)                                                       |
| `@kujam/storage-http`      | REST storage with ETag/If-Match, retries, and conflict detection                                            |
| `@kujam/export`            | PNG, SVG, PDF, text, JSON, and thumbnail export                                                             |
| `@kujam/server`            | Node utilities: JSON/Yjs document validation, migrations, reference extraction, thumbnail rendering         |

## Quick start

A complete board in plain JavaScript: built-in elements and tools, the text editor, the default UI, and autosave to IndexedDB.

```html
<div id="board" style="position: relative; width: 100vw; height: 100vh"></div>
```

```ts
import { attachStorage, createBoard, defaultCommands } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { createIndexedDbStorage } from '@kujam/storage-indexeddb';
import { mountDefaultUi } from '@kujam/ui';

const board = createBoard({
  locale: 'en',
  plugins: [defaultCommands, defaultElements, defaultTools],
});
board.setTool('select');

const container = document.getElementById('board')!;
const view = mountRenderer(board, container, { theme: 'light' });
attachTextEditor(view);
mountDefaultUi({ board, container });

// Load from IndexedDB, then save automatically after every change.
attachStorage(board, createIndexedDbStorage({ databaseName: 'my-app' }), { boardId: 'board-1' });
```

## React and Vue

The adapters take a `board` you create yourself, so board state can be used outside components. Hooks only re-render when the selected value changes.

```tsx
import { createBoard } from '@kujam/core';
import { Board, useHistory, useTool } from '@kujam/react';
import { defaultElements, defaultTools } from '@kujam/shapes';
import { useMemo } from 'react';

export function Whiteboard() {
  const board = useMemo(() => createBoard({ plugins: [defaultElements, defaultTools] }), []);
  const tool = useTool(board);
  const { canUndo, undo } = useHistory(board);

  return (
    <div style={{ position: 'relative', height: 600 }}>
      <Board board={board} theme="light" />
      <button aria-pressed={tool === 'sticky'} onClick={() => board.setTool('sticky')}>
        Sticky
      </button>
      <button disabled={!canUndo} onClick={undo}>
        Undo
      </button>
    </div>
  );
}
```

Vue has the same API: `<Board :board="board" />` and the `useTool`, `useHistory`, `useCamera`, and `useSelection` composables from `@kujam/vue`. Both are SSR-safe in Next.js and Nuxt; see [docs/ssr-nextjs-nuxt.md](./docs/ssr-nextjs-nuxt.md).

## Custom elements

A custom element stores only an ID. Its data comes from a resolver your app provides, so the board always matches the source of truth and can be refreshed with `board.invalidate(resolver, id)`.

```ts
import { createBoard, defineElement, definePlugin, rect, schema, string } from '@kujam/core';

type Contact = { name: string };

const contactCard = defineElement({
  type: 'contact-card',
  version: 1,
  props: schema({ contactId: string({ maxLength: 128 }) }),
  defaults: { contactId: '' },
  geometry: (el) => rect(el.w, el.h),
  // Data comes from the app, not from the board document.
  resolve: (el, ctx) => ctx.resolvers.contact!(el.props.contactId),
  render: {
    html(host, _el, data) {
      const name = document.createElement('strong');
      const show = (contact: unknown) => {
        name.textContent = (contact as Contact | undefined)?.name ?? '';
      };
      show(data);
      (host as HTMLElement).append(name);
      return {
        update: (_next, nextData) => show(nextData),
        destroy: () => name.remove(),
      };
    },
  },
});

const board = createBoard({
  plugins: [definePlugin({ id: 'contacts', elements: [contactCard] })],
  resolvers: { contact: (id) => fetch(`/api/contacts/${id}`).then((r) => r.json()) },
});
```

Custom elements can also draw a compact canvas version for far zoom levels and exports (`render.canvas`), add actions to the contextual toolbar, and provide accessibility labels and export text. See the full example in [`examples/contact-card`](./examples/contact-card) and the contract in [docs/custom-elements.md](./docs/custom-elements.md). In React and Vue, an element can be a regular component (`defineReactElement`, `defineVueElement`).

## Realtime collaboration

`@kujam/sync-yjs` binds a board to a `Y.Doc`. Your app picks the provider: Hocuspocus, y-websocket, or WebRTC.

```ts
import { attachSync } from '@kujam/core';
import { createYjsSyncAdapter } from '@kujam/sync-yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

const provider = new HocuspocusProvider({ url: 'wss://sync.example.com', name: 'board-1' });

const adapter = createYjsSyncAdapter({
  doc: provider.document,
  awareness: provider.awareness!,
  user: { id: 'u-1', name: 'Ayu', color: '#2563eb' },
});
const sync = attachSync(board, adapter);
```

A sample Hocuspocus server with authentication, read-only enforcement, document validation, and SQLite persistence lives in [`examples/hocuspocus-server`](./examples/hocuspocus-server).

## Storage and export

Without Yjs, `attachStorage` loads and saves JSON documents through the memory, IndexedDB, or HTTP adapter. Documents are versioned and migrated automatically on load.

```ts
import { exportPNG, exportSVG, exportText } from '@kujam/export';

const png = await exportPNG(board, { scale: 2 }); // png.data is a Blob
const svg = await exportSVG(board, { frameId: 'frame-1', padding: 24 });
const text = exportText(board);
```

On the server, `@kujam/server` validates JSON and binary Yjs documents, runs migrations, extracts custom element references (for example, to index which boards show a given record), and renders thumbnails without a browser.

## Architecture

```text
      ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
      │  react  │  │   vue   │  │   ui    │  │ export  │
      └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
           └────────────┴──────┬─────┴────────────┘
                         ┌─────▼─────┐
 ┌────────┐ ┌──────────┐ │ renderer  │ ┌───────────┐ ┌────────┐
 │ shapes │ │ sync-yjs │ └─────┬─────┘ │ storage-* │ │ server │
 └───┬────┘ └────┬─────┘       │       └─────┬─────┘ └───┬────┘
     └───────────┴─────────────┼─────────────┴───────────┘
                         ┌─────▼─────┐
                         │   core    │  no DOM, no runtime dependencies
                         └───────────┘
```

These rules are enforced by typecheck, lint, and tests, not just by convention:

- **`@kujam/core` is DOM-free.** It compiles without `lib: ["DOM"]` and is tested in plain Node, so it runs on servers and in Web Workers.
- **Imports go one way.** Inner layers never import outer ones; each package has an allow-list of imports in `eslint.config.mjs`.
- **Domain-agnostic.** Lint rejects application domain terms in `packages/*/src`.
- **The public API is locked.** Any change to a `*.api.md` report needs a changeset.

Major design decisions are recorded as ADRs in [`docs/adr`](./docs/adr): repository name and layout, render technology (Canvas 2D + HTML, targeting 60 fps with 5,000 elements), touch and stylus scope, props schema validation, the rich text model, and the threat model.

## Examples and playground

| Folder                                                       | What it shows                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`examples/vanilla`](./examples/vanilla)                     | Plain JavaScript with IndexedDB and the default UI                                   |
| [`examples/react`](./examples/react)                         | React with a toolbar built from hooks                                                |
| [`examples/vue`](./examples/vue)                             | Vue 3 with a toolbar built from composables                                          |
| [`examples/contact-card`](./examples/contact-card)           | A custom element with a data resolver and the full contract                          |
| [`examples/hocuspocus-server`](./examples/hocuspocus-server) | A collaboration server with auth, validation, and SQLite (Docker)                    |
| [`examples/server-worker`](./examples/server-worker)         | Server utilities in a worker thread                                                  |
| [`apps/playground`](./apps/playground)                       | Development app with test scenarios, a multi-peer sync lab, and a document inspector |

## Documentation

- [Custom elements](./docs/custom-elements.md) and [custom UI](./docs/custom-ui.md)
- [SSR in Next.js and Nuxt](./docs/ssr-nextjs-nuxt.md)
- [Content Security Policy](./docs/csp.md)
- [Accessibility](./docs/accessibility.md) and the [a11y checklist](./docs/a11y-checklist.md)
- [Server-side document migration](./docs/server-migration.md)
- [Migration guide between versions](./docs/MIGRATION.md)

## Development

Requirements: Node.js 24 or later and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm build          # all packages (ESM + .d.ts via tsup and Turborepo)
pnpm playground     # http://localhost:5173, scenarios at /s/<name>
pnpm test           # Vitest; @kujam/core runs in plain Node
pnpm test:e2e       # Playwright in Chromium, Firefox, WebKit, and iPad emulation
pnpm typecheck
pnpm lint           # includes the architecture rules
pnpm api:check      # public API reports must match
```

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Discuss large changes or public API changes in an issue first.
2. Make sure `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
3. Add a changeset (`pnpm changeset`) for every change under `packages/*/src`, and update the API reports (`pnpm api:update`) when the public API changes.
4. Write code comments in English. Do not use `innerHTML` or similar APIs in package code.

By submitting a contribution, you agree that it is licensed under Apache-2.0 (section 5 of the license).

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md) to report them privately.

## License

[Apache License 2.0](./LICENSE). Copyright 2026 Kustora; see [NOTICE](./NOTICE).
