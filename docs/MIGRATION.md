# Migration Guide (`@kujam/*`)

This document collects migration notes between releases for the whole `@kujam/*` package family (`BOARD-2206`).

## Versioning and breaking change policy

1. **Fixed versioning (`BOARD-110`):**
   All `@kujam/*` packages are always published under the same version number. When upgrading, move every `@kujam/*` dependency in `package.json` to the same target version.
2. **`0.x` versus `1.0+` (`BOARD-2301`):**
   - Before `1.0.0`, breaking changes may ship in a minor release (`0.N.0`), but they **must**:
     1. Be preceded by an `@deprecated` tag and a `deprecate(message)` warning for at least **one full minor release** before the old API is removed.
     2. Have a **`### [Breaking] ...`** section in this document with **`#### Before`** and **`#### After`** code blocks.
   - After `1.0.0`, breaking changes only ship in major releases (`2.0.0` and later).
3. **Document schema migrations (`schemaVersion`) versus code migrations:**
   - Changes to the shape of `BoardDocument` data or element `props` are handled automatically at runtime by `board.loadDocument(doc)`, `migrateSchema`, and `defineElement({ migrate })`.
   - This document covers changes to the TypeScript/JavaScript contract that applications call.

---

## Release `0.1.0` (Foundation)

### [Breaking] Package scope `@board/*` renamed to `@kujam/*` (ADR-001)

Early drafts and pre-`0.1.0` prototypes used the temporary `@board/*` scope. Since `0.1.0` (`BOARD-001`), every official package uses the `@kujam/*` scope.

#### Before

```ts
import { createBoard, defineElement } from '@board/core';
import { mountRenderer } from '@board/renderer';
import { shapesPlugin } from '@board/shapes';
```

#### After

```ts
import { createBoard, defineElement } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { shapesPlugin } from '@kujam/shapes';
```

---

### [Breaking] Canonical rich text model (`RichTextBlock[]`) replaces raw HTML in props (ADR-008)

To guarantee XSS safety and consistent rendering on Canvas 2D and in the DOM without an external sanitizer, the text props of `sticky`, `text`, and `geo` elements store a structured `RichTextBlock[]` array (or plain text normalized with `normalizeRichText`) instead of a raw HTML string.

#### Before

```ts
board.create({
  type: 'sticky',
  x: 100,
  y: 100,
  w: 200,
  h: 200,
  props: {
    html: '<p>An <b>important</b> note</p>',
    color: 'yellow',
  },
});
```

#### After

```ts
import { htmlToRichText } from '@kujam/shapes';

board.create({
  type: 'sticky',
  x: 100,
  y: 100,
  w: 200,
  h: 200,
  props: {
    text: htmlToRichText('<p>An <b>important</b> note</p>'),
    color: 'yellow',
  },
});
```

---

## Template for breaking change entries in future releases (`0.2.0` to `1.0.0`)

Every new breaking change must add a subsection in this format (checked automatically by `tooling/check-migration-docs.mjs`):

```markdown
### [Breaking] <Short title of the API change> (<Ticket ID>)

Why the change was made, which old API was removed or changed, and the version in which `deprecate()` was first added.

#### Before

\`\`\`ts
// Code before the migration
\`\`\`

#### After

\`\`\`ts
// Code after the migration
\`\`\`
```
