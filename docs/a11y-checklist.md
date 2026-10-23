# Per-Release Accessibility Checklist (`BOARD-1908`)

This is the mandatory accessibility checklist to run and sign off before every `@kujam/*` release. It covers **automated audits (`axe-core`)** in CI and **manual testing** of keyboard navigation, screen readers (VoiceOver and NVDA), 200% browser zoom, and system preferences.

---

## 1. Automated audit (`axe-core` in Playwright)

Before manual testing, make sure every automated accessibility test passes with no `serious` or `critical` violations:

```bash
pnpm test:e2e e2e/a11y.spec.ts
```

- [ ] A board with `@kujam/ui` and the `0.1.0/kitchen-sink` elements (light theme, Indonesian) has no `serious` / `critical` violations.
- [ ] A board with a selected element (`<kujam-selection-toolbar>` open, dark theme, English) has no `serious` / `critical` violations.

---

## 2. Full keyboard navigation (`BOARD-1902`, `BOARD-1402`, `BOARD-1403`)

Test in desktop browsers (Chromium, Firefox, Safari) without a mouse or trackpad:

- [ ] **Entering and leaving the board (no keyboard trap):**
  - [ ] Press `Tab` from outside the board to focus the whiteboard region (`role="region"`).
  - [ ] If one element is selected when entering the board, focus goes to that element's accessibility item.
  - [ ] Press `Esc` until the selection is empty, then `Tab` to leave the board for the next control on the page (focus is not trapped in the canvas).
- [ ] **Moving between elements on the canvas:**
  - [ ] `Tab` and `Shift+Tab` move between elements in deterministic reading order (`getReadingOrder`: frames sorted by `y` then `x`, followed by their contents, then loose elements).
  - [ ] Keyboard focus shows the focus ring (a 2 px `focus-ring`, 2 px away from the element's edge).
- [ ] **Changing elements with the keyboard:**
  - [ ] The arrow keys (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`) nudge the selected element by `1px`.
  - [ ] `Shift + Arrow` nudges the selected element by `10px`.
  - [ ] `Enter` on a text, sticky, or shape element opens the text editor; `Escape` closes it and returns focus to the element on the board.
  - [ ] `Delete` / `Backspace` deletes the selected element and keeps focus inside the board (it does not fall to `document.body`).
- [ ] **Main toolbar (`<kujam-toolbar>`) and selection toolbar (`<kujam-selection-toolbar>`):**
  - [ ] The toolbar is a single tab stop (roving tabindex): `ArrowRight` / `ArrowLeft` move between buttons, `Home` / `End` jump to the first and last.
  - [ ] `ArrowUp` or `Alt+ArrowDown` on a button with a menu opens the popup menu (`role="menu"`), up/down arrows pick an option, `Enter`/`Space` activate it, and `Escape` closes the menu and returns focus to the button that opened it.

---

## 3. Screen reader: VoiceOver (macOS and iPadOS Safari) (`BOARD-1901`)

Turn on VoiceOver (`Cmd + F5` on macOS, or the Accessibility settings on iPadOS) on the playground page `/s/all-elements`:

- [ ] **Landmark and board help:**
  - [ ] The board is announced as a region with the role description "whiteboard" (`en`) or "papan tulis" (`id`) and the name "Whiteboard" / "Papan tulis".
  - [ ] The help description (`aria-describedby`) is read when focus enters the board.
- [ ] **Parallel accessibility tree (`role="list"`):**
  - [ ] The element list ("Board elements" / "Elemen papan") reports the total element count (`aria-setsize`) and position (`aria-posinset`) accurately, including when the board has more than 200 elements.
  - [ ] Every element type reads a meaningful role and label (the text of stickies, text, and shapes; the start and end points of connectors; the number of elements in a group or frame).
  - [ ] Locked elements (`locked: true`) include "Locked" / "Terkunci" in their accessible description.
- [ ] **Live region for important changes (`BOARD-1903`):**
  - [ ] Creating or deleting elements (including undo/redo) is announced, for example a yellow sticky being created or 3 elements being deleted. Other people's changes are not announced.
  - [ ] In `/s/sync-lab`, collaborators joining or leaving are announced, as are the connection dropping and reconnecting, without listing people as "left" because your own connection dropped.
  - [ ] Bursts of changes are merged into one sentence and announced at most once per second; the connection status is not announced twice by `<kujam-presence-bar>`.
- [ ] **iPadOS touch exploration:**
  - [ ] Dragging a finger over the canvas on iPadOS with VoiceOver on finds element items at the matching screen coordinates (following the camera pan/zoom transform).

---

## 4. Screen reader: NVDA (Windows Firefox and Chrome) (`BOARD-1901`, `BOARD-1902`)

Turn on NVDA on Windows and open the playground page `/s/all-elements`:

- [ ] **Focus and browse mode:**
  - [ ] When moving with `Tab` inside the board, NVDA reads the element label, role, position in the list (`X of Y`), and locked state.
  - [ ] When editing text inside an element (`contenteditable`), NVDA reads character and line changes without being disturbed by single-letter tool shortcuts (`V`, `H`, `S`, `P`, `R`, `O`, `C`, `T`, `E`).
- [ ] **UI controls (`@kujam/ui`):**
  - [ ] Every button in `<kujam-toolbar>`, `<kujam-selection-toolbar>`, `<kujam-zoom-control>`, and `<kujam-history-control>` has an accessible name that includes the tool or action name and its keyboard shortcut.
  - [ ] Active button state (`aria-pressed="true"`) and menu state (`aria-expanded`, `aria-checked`) are announced correctly.

---

## 5. 200% browser zoom, contrast, and reduced motion (`BOARD-1904`, `BOARD-1905`)

- [ ] **200% browser zoom:**
  - [ ] Set the browser zoom to **200%** on a `1280×800` viewport.
  - [ ] `<kujam-toolbar>`, `<kujam-zoom-control>`, `<kujam-history-control>`, and `<kujam-selection-toolbar>` stay fully visible, do not overlap, are not cut off at the screen edge, and every popup menu stays reachable.
  - [ ] Pointer coordinates on the canvas stay precise when drawing or selecting at 200% browser zoom.
- [ ] **Color contrast (WCAG 2.1 AA):**
  - [ ] UI text in the `light` and `dark` themes meets the minimum contrast ratio of **4.5:1**.
  - [ ] UI icons, control borders, and focus indicators meet the minimum contrast ratio of **3:1**.
- [ ] **Reduced motion (`prefers-reduced-motion`):**
  - [ ] Turn on _Reduce motion_ in the OS settings (or emulate `prefers-reduced-motion: reduce` in DevTools).
  - [ ] `camera.animateTo` / `camera.zoomToFit` move instantly without intermediate animation, and CSS transitions in `@kujam/ui` are off (`--kujam-ui-motion: 0ms`).
  - [ ] `reducedMotion: false` on `mountRenderer` or `view.reducedMotion = false` overrides the system preference when explicitly requested.

---

## 6. Release sign-off

Add a row to the table below for every new release:

| Release         | Date       | Tester     | `axe-core` (CI) | Keyboard | VoiceOver     | NVDA          | 200% zoom & reduced motion | Status           |
| :-------------- | :--------- | :--------- | :-------------- | :------- | :------------ | :------------ | :------------------------- | :--------------- |
| `0.1.0-alpha.0` | 2026-10-19 | Kujam team | Passed          | Passed   | Ready to test | Ready to test | Passed                     | Initial baseline |
