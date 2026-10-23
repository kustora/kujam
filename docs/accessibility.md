# Accessibility in `@kujam/*` for Package Users

A guide for developers who embed the board and write plugins (BOARD-2208). It covers what the packages already provide, what custom element authors must fill in, the built-in shortcuts, and the known limitations. The per-release test checklist is in [`a11y-checklist.md`](./a11y-checklist.md).

## 1. What the packages provide

| Capability                  | Details                                                                                                                                                                                                                                                               | Ticket                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Parallel accessibility tree | Screen readers cannot read the canvas, so the renderer builds a hidden `role="list"` with one item per element, in reading order: frames (top to bottom, left to right), their contents, then loose elements. `aria-setsize` and `aria-posinset` give the real count. | BOARD-1901                  |
| Keyboard navigation         | `Tab`/`Shift+Tab` move between elements, arrows nudge, `Enter` edits, `Esc` leaves. The board is not a focus trap: `Esc` then `Tab` moves out of it.                                                                                                                  | BOARD-1902                  |
| Live region announcements   | Elements the user creates or deletes, collaborators joining or leaving, and the connection dropping or recovering are announced with throttling so they do not flood. Add app messages with `view.announce(message)`.                                                 | BOARD-1903                  |
| Reduced motion              | Follows `prefers-reduced-motion`: camera animations jump, UI transitions are turned off, and touch inertia does not run. Override with `mountRenderer(board, el, { reducedMotion })`.                                                                                 | BOARD-1905, BOARD-911       |
| Image alt text              | Image elements have an editable `alt` that flows into the accessibility tree and SVG export.                                                                                                                                                                          | BOARD-1906                  |
| Contrast and focus          | Light and dark theme tokens pass WCAG AA for UI text, and a 2 px focus ring shows on every `@kujam/ui` control.                                                                                                                                                       | BOARD-1006, BOARD-1907      |
| Language                    | All built-in text is available in `id` and `en` (`board.setLocale`), and apps can add or override dictionaries.                                                                                                                                                       | BOARD-1909                  |
| Touch targets               | Resize, rotate, line point, and connector handles have touch areas of at least 24 × 24 CSS px for fingers (WCAG 2.5.8).                                                                                                                                               | BOARD-911                   |
| `@kujam/ui` components      | Toolbars with roving tabindex and arrow navigation, menus with `role="menu"`, and dialogs (command palette, shortcut help) with `aria-modal`, focus restored on close, and `Esc`. Audited with `axe-core` in `e2e/a11y.spec.ts`.                                      | BOARD-1402–1409, BOARD-1908 |

## 2. Writing `a11y` for custom elements

Every custom element should have an `a11y` callback. Without it, screen readers only hear "Element {type}", for example "Element contact-card", which is useless to users.

```ts
const TEXT = {
  id: { card: (name: string) => `Kartu kontak: ${name}`, loading: 'Kartu kontak, memuat' },
  en: { card: (name: string) => `Contact card: ${name}`, loading: 'Contact card, loading' },
};

const contactCard = defineElement({
  type: 'contact-card',
  version: 1,
  props: schema({ refId: string() }),
  defaults: { refId: '' },
  resolve: (el, ctx) => ctx.resolvers.contact!(el.props.refId),
  a11y: (el, data, ctx) => {
    const text = ctx.locale === 'en' ? TEXT.en : TEXT.id;
    return {
      role: 'article',
      label: data ? text.card(data.name) : text.loading,
      description: data?.company,
    };
  },
});
```

Rules to follow:

- **Keep `label` short and meaningful**, starting with the kind and then the content: "Contact card: Budi Santoso", not "Card" or the whole card content. About 80 characters is enough. Extra detail goes in `description`.
- **Follow `ctx.locale`** (`'id'` or `'en'`) so the label changes with `board.setLocale`, like the built-in elements. Keep the text per language in one place, not scattered through the code.
- **Handle every data state.** `data` is `undefined` while loading. For a `forbidden` placeholder, do not leak content: "Locked card" is enough. The label updates automatically when the resolver finishes or `board.invalidate(...)` is called.
- **Pick the right `role`:** `article` for cards with content, `note` for notes, `img` for visuals without text (with a descriptive label), and `group` for containers. Do not use interactive roles (`button`, `link`) unless the element really acts that way when activated with `Enter`.
- **Put important status in the label or description**, for example "Overdue" or "Waiting for approval 2 of 3". Color alone is not enough (WCAG 1.4.1). The locked state is added automatically by the renderer.
- **The callback must be cheap and must not throw.** It runs for elements around the viewport when the document changes. If it throws, the element falls back to the default label and other elements are unaffected.
- **Interactive `render.html` content** (a button inside a card) must be reachable by keyboard and have its own name. Mark it with `data-board-interactive` (BOARD-1304) so the board does not take its clicks and keys. Main actions should also be available as contextual actions (`actions`), so they show up in the selection toolbar and the context menu, which are already accessible.
- **`export.text`** is used by search and text export. Fill it with text that matters as much as the label.

A complete example is in `examples/contact-card` and in the [custom elements](./custom-elements.md) guide.

### Your own UI components

If you replace the built-in UI (see [custom-ui.md](./custom-ui.md)), keep this behavior:

- tool button names include their shortcut (`board.keybindings.forTarget`), and buttons use `aria-pressed`;
- dialogs have `role="dialog"`, `aria-modal`, initial focus inside, `Esc` to close, and focus restored on close;
- scrollable areas can be focused with the keyboard;
- touch targets are at least 24 × 24 CSS px.

## 3. Built-in shortcuts

This list applies to `defaultTools` and `defaultCommands`. `Mod` is `⌘` on macOS and `Ctrl` elsewhere. Apps can change or remove any binding (`createBoard({ keybindings })` or `board.keybindings.set`). The bindings active on a board can always be shown by pressing `?` (the `<kujam-shortcut-help>` panel, BOARD-1409) or read with `buildShortcutHelp(board)`.

### Tools

| Tool    | Shortcut | Tool      | Shortcut  |
| ------- | -------- | --------- | --------- |
| Select  | `V`      | Connector | `L`       |
| Hand    | `H`      | Line      | `Shift+L` |
| Sticky  | `S`      | Frame     | `F`       |
| Pen     | `P`      | Eraser    | `E`       |
| Text    | `T`      | Rectangle | `R`       |
| Ellipse | `O`      |           |           |

Hold `Space` to use the Hand tool temporarily. `Esc` cancels the current interaction, then returns to the Select tool.

### Commands

| Command                          | Shortcut                         |
| -------------------------------- | -------------------------------- |
| Undo / Redo                      | `Mod+Z` / `Mod+Shift+Z`, `Mod+Y` |
| Select all / Clear selection     | `Mod+A` / `Esc`                  |
| Next / previous element          | `Tab` / `Shift+Tab`              |
| Nudge 1 px / 10 px               | Arrows / `Shift+Arrows`          |
| Edit the selected element's text | `Enter`                          |
| Duplicate                        | `Mod+D`                          |
| Delete                           | `Delete`, `Backspace`            |
| Group / Ungroup                  | `Mod+G` / `Mod+Shift+G`          |
| Lock or unlock                   | `Mod+Shift+L`                    |
| Bring forward / Send backward    | `Mod+]` / `Mod+[`                |
| Bring to front / Send to back    | `Mod+Shift+]` / `Mod+Shift+[`    |
| Zoom in / Zoom out / 100%        | `Mod+=` / `Mod+-` / `Mod+0`      |
| Zoom to fit / Zoom to selection  | `Shift+1` / `Shift+2`            |
| Cut / Copy / Paste               | `Mod+X` / `Mod+C` / `Mod+V`      |
| Command palette                  | `Mod+K`, `/`                     |
| Shortcut help                    | `?`                              |

### Touch and stylus

| Gesture                              | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Two-finger / three-finger tap        | Undo / Redo (can be turned off)              |
| Two-finger drag and pinch            | Pan and zoom the camera                      |
| Long press on an element             | Context menu                                 |
| Long press on empty space, then drag | Selection box (without a drag: context menu) |

## 4. Known limitations

We list these openly so apps can offer alternatives:

- **Visual content is not described spatially.** Screen readers hear the list of elements and their labels, not the layout ("this sticky is at the top right of that frame"). Connector relationships are not read as "A connects to B" yet.
- **Freehand strokes are only labeled "Drawing".** The shape and meaning of hand drawings cannot be known. If it matters, ask users to add text next to them.
- **Some actions still need a pointer:** creating connectors and lines, resizing and rotating elements, lasso, drawing, and the eraser. Moving, selecting, editing text, reordering layers, grouping, and other commands work with the keyboard.
- **Only 200 elements around the viewport are in the accessibility tree** at a time, for performance. The total count is still announced, and `Tab` moves the camera to the next element.
- **Windows high contrast mode (`forced-colors`) is not supported yet.** Canvas colors do not follow system colors.
- **Right-to-left (RTL) languages are not supported yet**; planned in BOARD-1910 (0.6).
- **Collaborator cursors and strokes are not announced**, only collaborators joining or leaving. Other people's activity is not read out, to avoid noise.
- **No manual screen reader testing has been done yet.** What runs today is automated `axe-core` auditing in Chromium and WebKit plus tests of the accessibility tree structure. VoiceOver (macOS, iPadOS), NVDA, and iPad with Apple Pencil have not been tested manually (BOARD-1901, BOARD-2105), so real screen reader behavior may differ from what is described here.

Accessibility issues are treated as regular bugs. An issue that makes a feature completely unusable with a keyboard or screen reader is prioritized like a functional bug.
