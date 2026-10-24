---
'@kujam/export': patch
---

Excalidraw JSON import (BOARD-1706): `excalidrawToDocument(input, options?)` converts a `.excalidraw` file or an `excalidraw/clipboard` payload into a board document, and `importExcalidraw(board, input, options?)` imports it into the current page as one undo step through `importJSON`. Rectangles, ellipses, and diamonds become `geo` shapes (bound text becomes their label), and `text`, `freedraw`, `line`, `image` (with a data URL asset), `frame`, and `magicframe` map to their built-in counterparts. Arrows become `connector`s with their bindings, or a `line` when they are free and have more than two points. `groupIds` become nested `group` elements, and colors map to the nearest theme color key. Elements that cannot be mapped are listed in `unsupported` with a reason, never dropped silently. Only the file format is read; no Excalidraw code is used.
