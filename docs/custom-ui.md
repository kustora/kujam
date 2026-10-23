# Board UI: Built-in, Framework Wrappers, or Your Own

A guide for apps that place UI over the board (BOARD-1410). There are three levels, and they can be mixed: for example, your own toolbar with the built-in minimap and command palette.

| Level                  | How                                                     | Good for                                    |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------- |
| 1. Built-in UI         | `mountDefaultUi({ board, container })` from `@kujam/ui` | Prototypes and apps without a design system |
| 2. Framework wrappers  | `<Toolbar board={board} />` from `@kujam/react` / `vue` | Placing built-in components in your layout  |
| 3. Your own components | Hooks/composables + the board API                       | Your own design system                      |

The packages keep no hidden UI state. Everything the built-in UI uses (active tool, history, camera, selection, element actions, shortcuts) is available through the board's public API, so your own components can match the built-in UI.

## 1. Built-in UI

```ts
import { mountRenderer } from '@kujam/renderer';
import { mountDefaultUi } from '@kujam/ui';

const view = mountRenderer(board, container);
const ui = mountDefaultUi({ board, container });
// later
ui.unmount();
view.unmount();
```

`mountDefaultUi` installs and positions the toolbar, zoom, undo/redo, selection toolbar, minimap, command palette, context menu, presence bar, and the shortcut help panel (`?`). Colors are set through `--kujam-ui-*` CSS properties (see `uiToken`).

## 2. React and Vue wrappers

The wrappers render the built-in elements with typed props and pass `board` as a DOM property. The adapters do not import `@kujam/ui`, because adapters may only depend on core and the renderer (BOARD-106). Register the elements once in your app:

```ts
import { defineUiElements } from '@kujam/ui';

defineUiElements(); // once, on the client
```

Without this step, the tags stay unknown elements and the wrappers log a console warning.

### React

```tsx
import { Board, CommandPalette, Minimap, ShortcutHelp, Toolbar, ZoomControl } from '@kujam/react';

export function Editor({ board }: { board: CoreBoard }) {
  const help = useRef<UiElementRef>(null);
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Board board={board} />
      <Toolbar board={board} className="editor-toolbar" />
      <ZoomControl board={board} style={{ position: 'absolute', right: 16, bottom: 16 }} />
      <Minimap board={board} />
      <CommandPalette board={board} source={mySource} />
      <ShortcutHelp board={board} ref={help} />
      <button onClick={() => (help.current as ShortcutHelpElement | null)?.open()}>?</button>
    </div>
  );
}
```

Available components: `Toolbar`, `ZoomControl`, `HistoryControl`, `SelectionToolbar`, `Minimap`, `CommandPalette` (`source` prop), `ContextMenu`, `PresenceBar`, and `ShortcutHelp`. They all accept `board`, `className`, `style`, and `id`, and their `ref` points at the DOM element. For methods such as `open()`, cast to the element type from `@kujam/ui` (`ShortcutHelpElement`, `CommandPaletteElement`, `ContextMenuElement`). During SSR, the wrappers render only an empty tag.

### Vue

```vue
<script setup lang="ts">
import { Board, Minimap, ShortcutHelp, Toolbar } from '@kujam/vue';
const help = ref<{ element: ShortcutHelpElement | null }>();
</script>

<template>
  <div class="editor">
    <Board :board="board" />
    <Toolbar :board="board" class="editor-toolbar" />
    <Minimap :board="board" />
    <ShortcutHelp ref="help" :board="board" />
    <button @click="help?.element?.open()">?</button>
  </div>
</template>
```

`class` and `style` are passed to the element. Component instances have an `element` property. Templates need no `isCustomElement` setting, because the wrappers create the elements through render functions.

## 3. Your own UI with hooks

The sketches below use React. The Vue composables in `@kujam/vue` have the same names (`useTool`, `useHistory`, `useCamera`, `useSelection`, `useBoardEvent`) and return `Ref`s.

### Toolbar

`buildToolbarItems(board)` from `@kujam/ui` is a plain function with no DOM. It returns the built-in tools and plugin items (`toolbarItems`) with translated labels and formatted shortcuts, so your own toolbar still follows plugins and user key bindings:

```tsx
import { useTool } from '@kujam/react';
import { buildToolbarItems } from '@kujam/ui';

function MyToolbar({ board }: { board: CoreBoard }) {
  const tool = useTool(board);
  const items = useMemo(() => buildToolbarItems(board), [board]);
  return (
    <div role="toolbar" aria-label={board.t('toolbar')}>
      {items.map((item) => (
        <button
          key={item.id}
          aria-pressed={item.toolId === tool}
          aria-label={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
          onClick={() =>
            item.toolId ? board.setTool(item.toolId) : item.commandId && board.run(item.commandId)
          }
        >
          <MyIcon name={item.icon} />
        </button>
      ))}
    </div>
  );
}
```

Without `@kujam/ui`, the same sources are available directly: `board.tools.list()`, `board.keybindings.forTarget('tool:draw')`, and `board.keybindings.format(shortcut)`.

### Undo, redo, and zoom

```tsx
function MyHistory({ board }: { board: CoreBoard }) {
  const { canUndo, canRedo } = useHistory(board);
  return (
    <>
      <button disabled={!canUndo} onClick={() => board.undo()}>{board.t('undo')}</button>
      <button disabled={!canRedo} onClick={() => board.redo()}>{board.t('redo')}</button>
    </>
  );
}

function MyZoom({ board }: { board: CoreBoard }) {
  const zoom = useCamera(board, (camera) => camera.zoom);
  const step = (direction: 1 | -1) =>
    board.camera.zoomTo(nextZoomStep(zoom, direction, board.camera.zoomRange));
  return (
    <>
      <button onClick={() => step(-1)}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button onClick={() => step(1)}>+</button>
      <button onClick={() => board.camera.zoomToFit()}>{board.t('zoomToFit')}</button>
    </>
  );
}
```

### Selection toolbar and element actions

`useSelection(board)` gives the selected IDs. Each element's contextual actions (built-in and from plugins, BOARD-1205) are read with `board.getActions(ids)` and run with `board.runAction(action, element)`, which checks permissions. The toolbar follows the selection box on screen: convert the selection bounds to screen coordinates with `board.camera.boardToScreen`, and update when the camera changes (`useCamera`).

### Context menu

The renderer only sends menu data (BOARD-912). Handle it through the `onContextMenu` option of `mountRenderer`, or with `useBoardEvent(board, 'contextmenu', handler)`. The event carries `items` (element actions and general commands), the `client` position to place the menu, and `targetId`.

### Shortcut help panel

`buildShortcutHelp(board)` from `@kujam/ui` returns `{ tools, commands }`, each holding formatted `{ target, label, shortcuts }` entries. Call it every time the panel opens so changes made with `board.keybindings.set(...)` show up. Without `@kujam/ui`, group the result of `board.keybindings.list()` yourself.

### Accessibility

The built-in UI meets `docs/a11y-checklist.md`. When you replace it, keep these points:

- tool buttons have a name that includes the shortcut (for example "Pen (P)") and `aria-pressed`;
- the toolbar uses `role="toolbar"` with arrow-key navigation;
- dialogs (palette, shortcut help) use `role="dialog"` and `aria-modal`, close with Esc, and return focus;
- touch targets are at least 24 × 24 CSS px;
- text comes from `board.t(key)` so it follows `board.locale` and the app's dictionaries (BOARD-1909).

The renderer already makes screen reader announcements for board actions (elements created or deleted, collaborators joining) (BOARD-1903). Add messages from your own UI with `view.announce(message)`.
