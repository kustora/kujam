// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLOR_KEYS,
  createBoard,
  defaultCommands,
  defineBrush,
  defineCommand,
  defineElement,
  definePlugin,
  defineTool,
  enumOf,
  number,
  object,
  STICKY_COLORS,
  string,
  type Board,
  type BoardOptions,
} from '@kujam/core';
import {
  buildToolbarItems,
  defineUiElements,
  mountDefaultUi,
  nextZoomStep,
  UI_TAGS,
  type KujamUiElement,
} from './index.js';
import { createIcon } from './icons.js';

const tool = (id: string) => defineTool({ id, initial: 'idle', states: { idle: {} } });

const builtInTools = definePlugin({
  id: 'built-in-tools',
  tools: ['select', 'hand', 'sticky', 'draw', 'rectangle', 'ellipse', 'text', 'eraser', 'geo'].map(
    tool,
  ),
  keybindings: {
    v: 'tool:select',
    h: 'tool:hand',
    s: 'tool:sticky',
    p: 'tool:draw',
    r: 'tool:rectangle',
    o: 'tool:ellipse',
    t: 'tool:text',
    e: 'tool:eraser',
  },
});

let boards: Board[] = [];

afterEach(() => {
  for (const board of boards) if (!board.disposed) board.dispose();
  boards = [];
  document.body.innerHTML = '';
});

function newBoard(options: BoardOptions = {}): Board {
  const board = createBoard({ plugins: [builtInTools], ...options });
  board.setTool('select');
  boards.push(board);
  return board;
}

function mountToolbar(board: Board, tag: string = UI_TAGS.toolbar): KujamUiElement {
  defineUiElements();
  const el = document.createElement(tag) as KujamUiElement;
  el.board = board;
  document.body.append(el);
  return el;
}

function buttons(el: KujamUiElement): HTMLButtonElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button.tool')];
}

function button(el: KujamUiElement, item: string): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-item="${item}"]`)!;
}

function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, ...init }),
  );
}

describe('BOARD-1402: buildToolbarItems', () => {
  it('lists registered built-in tools in DESIGN.md order with shortcuts', () => {
    const items = buildToolbarItems(newBoard());
    expect(items.map((i) => i.id)).toEqual([
      'select',
      'hand',
      'sticky',
      'draw',
      'shape',
      'text',
      'eraser',
    ]);
    expect(items[0]).toMatchObject({ label: 'Pilih', shortcut: 'V', toolId: 'select' });
    const shape = items.find((i) => i.id === 'shape')!;
    expect(shape.options!.map((o) => [o.toolId, o.shortcut])).toEqual([
      ['rectangle', 'R'],
      ['ellipse', 'O'],
    ]);
  });

  it('uses the board locale', () => {
    const items = buildToolbarItems(newBoard({ locale: 'en' }));
    expect(items.map((i) => i.label)).toContain('Select');
  });

  it('skips tools that are not registered and collapses a single shape variant', () => {
    const board = createBoard({
      plugins: [definePlugin({ id: 'few', tools: [tool('select'), tool('rectangle')] })],
    });
    boards.push(board);
    const items = buildToolbarItems(board);
    expect(items.map((i) => i.id)).toEqual(['select', 'rectangle']);
    expect(items[1]!.options).toBeUndefined();
  });

  it('adds plugin toolbar items after the built-ins, sorted, and drops unusable ones', () => {
    const plugin = definePlugin({
      id: 'extra',
      tools: [tool('stamp'), tool('laser')],
      commands: [defineCommand({ id: 'extra.insert', label: 'extra.insert', run: () => {} })],
      keybindings: { k: 'extra.insert' },
      toolbarItems: [
        { id: 'laser', label: 'Laser', toolId: 'laser', group: 'b' },
        { id: 'insert', label: 'Sisipkan', commandId: 'extra.insert', group: 'a', order: 2 },
        { id: 'stamp', label: 'Stempel', toolId: 'stamp', group: 'a', order: 1 },
        { id: 'missing-tool', label: 'X', toolId: 'nope' },
        { id: 'missing-command', label: 'Y', commandId: 'nope' },
        { id: 'dup', label: 'Pilih lagi', toolId: 'select' },
      ],
    });
    const items = buildToolbarItems(newBoard({ plugins: [builtInTools, plugin] }));
    const extra = items.filter((i) => i.section === 'plugins');
    expect(extra.map((i) => i.id)).toEqual(['stamp', 'insert', 'laser']);
    expect(extra[1]).toMatchObject({ commandId: 'extra.insert', shortcut: 'K', toolId: undefined });
  });
});

describe('BOARD-1401: elements', () => {
  it('defines the elements once and needs a window', () => {
    defineUiElements();
    defineUiElements();
    expect(customElements.get(UI_TAGS.toolbar)).toBeDefined();
    expect(() => defineUiElements({} as Window)).toThrow();
  });

  it('follows the board theme', () => {
    const board = newBoard();
    const el = mountToolbar(board);
    expect(el.dataset.theme).toBe('light');
    board.setTheme('dark');
    expect(el.dataset.theme).toBe('dark');
  });

  it('listens only while connected and moves to a new board', () => {
    const a = newBoard();
    const el = mountToolbar(a);
    el.remove();
    expect(el.shadowRoot!.childElementCount).toBe(0);
    a.setTool('hand');
    document.body.append(el);
    expect(button(el, 'hand').getAttribute('aria-pressed')).toBe('true');

    const b = newBoard();
    el.board = b;
    a.setTool('select');
    expect(button(el, 'hand').getAttribute('aria-pressed')).toBe('false');
    b.setTool('text');
    expect(button(el, 'text').getAttribute('aria-pressed')).toBe('true');

    el.board = null;
    expect(el.shadowRoot!.childElementCount).toBe(0);
  });

  it('clears itself when the board is disposed', () => {
    const board = newBoard();
    const el = mountToolbar(board);
    board.dispose();
    expect(el.shadowRoot!.childElementCount).toBe(0);
  });
});

describe('BOARD-1402: toolbar', () => {
  it('renders an accessible toolbar with pressed state, labels, and tooltips', () => {
    const board = newBoard();
    const el = mountToolbar(board);
    const bar = el.shadowRoot!.querySelector('[role="toolbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Alat');
    expect(button(el, 'select').getAttribute('aria-label')).toBe('Pilih (V)');
    expect(button(el, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'select').querySelector('svg')).not.toBeNull();
    const tip = button(el, 'select').nextElementSibling!;
    expect(tip.getAttribute('aria-hidden')).toBe('true');
    expect(tip.textContent).toBe('PilihV');

    button(el, 'draw').click();
    expect(board.tool).toBe('draw');
    expect(button(el, 'draw').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'select').getAttribute('aria-pressed')).toBe('false');
  });

  it('is one tab stop with roving focus', () => {
    const board = newBoard();
    const el = mountToolbar(board);
    const all = buttons(el);
    expect(all.filter((b) => b.tabIndex === 0)).toEqual([button(el, 'select')]);

    button(el, 'select').focus();
    key(button(el, 'select'), 'ArrowRight');
    expect(el.shadowRoot!.activeElement).toBe(button(el, 'hand'));
    expect(button(el, 'hand').tabIndex).toBe(0);
    expect(button(el, 'select').tabIndex).toBe(-1);

    key(button(el, 'hand'), 'End');
    expect(el.shadowRoot!.activeElement).toBe(all.at(-1));
    key(all.at(-1)!, 'ArrowRight');
    expect(el.shadowRoot!.activeElement).toBe(all[0]);
    key(all[0]!, 'ArrowLeft');
    expect(el.shadowRoot!.activeElement).toBe(all.at(-1));
    key(all.at(-1)!, 'Home');
    expect(el.shadowRoot!.activeElement).toBe(all[0]);
  });

  it('activates the last chosen shape and opens the variant menu when already active', () => {
    const board = newBoard();
    const el = mountToolbar(board);
    const shape = button(el, 'shape');
    const menu = el.shadowRoot!.querySelector<HTMLElement>('[role="menu"]')!;
    expect(shape.getAttribute('aria-haspopup')).toBe('menu');
    expect(shape.getAttribute('aria-label')).toBe('Bentuk: Kotak (R)');

    shape.click();
    expect(board.tool).toBe('rectangle');
    expect(menu.hidden).toBe(true);

    shape.click();
    expect(menu.hidden).toBe(false);
    expect(shape.getAttribute('aria-expanded')).toBe('true');
    const options = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(el.shadowRoot!.activeElement).toBe(options[0]);

    key(options[0]!, 'ArrowDown');
    expect(el.shadowRoot!.activeElement).toBe(options[1]);
    options[1]!.click();
    expect(board.tool).toBe('ellipse');
    expect(menu.hidden).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(shape);
    expect(shape.getAttribute('aria-label')).toBe('Bentuk: Elips (O)');

    // The choice is remembered after switching away.
    button(el, 'select').click();
    shape.click();
    expect(board.tool).toBe('ellipse');
  });

  it('opens the menu with ArrowUp and closes it with Escape or a click outside', () => {
    const board = newBoard();
    const el = mountToolbar(board);
    const shape = button(el, 'shape');
    const menu = el.shadowRoot!.querySelector<HTMLElement>('[role="menu"]')!;

    shape.focus();
    key(shape, 'ArrowUp');
    expect(menu.hidden).toBe(false);
    key(el.shadowRoot!.activeElement!, 'Escape');
    expect(menu.hidden).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(shape);

    key(shape, 'ArrowUp');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(menu.hidden).toBe(true);
  });

  it('runs plugin commands and disables them when unavailable', () => {
    let enabled = false;
    const runs: string[] = [];
    const plugin = definePlugin({
      id: 'extra',
      commands: [
        defineCommand({
          id: 'extra.go',
          label: 'extra.go',
          isEnabled: () => enabled,
          run: () => void runs.push('go'),
        }),
      ],
      toolbarItems: [{ id: 'go', label: 'Jalan', commandId: 'extra.go' }],
    });
    const board = newBoard({ plugins: [builtInTools, plugin] });
    const el = mountToolbar(board);
    expect(el.shadowRoot!.querySelector('[role="separator"]')).not.toBeNull();
    const go = button(el, 'go');
    expect(go.disabled).toBe(true);
    expect(go.hasAttribute('aria-pressed')).toBe(false);
    expect(go.textContent).toContain('J');

    enabled = true;
    board.select([]);
    board.clearSelection();
    board.setTool('hand');
    expect(go.disabled).toBe(false);
    go.click();
    expect(runs).toEqual(['go']);
  });
});

describe('BOARD-1401: icons', () => {
  it('builds built-in icons and rejects unknown names', () => {
    expect(createIcon(document, 'select')!.getAttribute('stroke')).toBe('currentColor');
    expect(createIcon(document, 'nope')).toBeNull();
    expect(createIcon(document, undefined)).toBeNull();
  });

  it('keeps only drawing elements and attributes from plugin markup', () => {
    const svg = createIcon(
      document,
      `<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script>` +
        `<path d="M1 1h4" onclick="alert(2)" style="x"/><a href="javascript:alert(3)"><rect x="1"/></a>` +
        `<circle cx="5" fill="url(http://evil)"/><foreignObject><div/></foreignObject></svg>`,
    )!;
    expect(svg.outerHTML).not.toMatch(/script|onload|onclick|javascript|foreignObject|url\(|style/);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M1 1h4');
    expect(svg.querySelector('circle')!.hasAttribute('fill')).toBe(false);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('BOARD-1402: mountDefaultUi', () => {
  it('floats the toolbar at the bottom center of the container and removes it', () => {
    const board = newBoard();
    const container = document.body.appendChild(document.createElement('div'));
    const ui = mountDefaultUi({ board, container });
    expect(container.style.position).toBe('relative');
    expect(ui.toolbar.parentElement).toBe(container);
    expect(ui.toolbar.style.bottom).toBe('20px');
    expect(ui.toolbar.board).toBe(board);
    expect(ui.zoom.style.right).toBe('20px');
    expect(ui.history.style.left).toBe('20px');
    expect(ui.zoom.board).toBe(board);

    ui.unmount();
    ui.unmount();
    expect(container.contains(ui.toolbar)).toBe(false);
    expect(container.childElementCount).toBe(0);
  });
});

describe('BOARD-1404: zoom control', () => {
  const range = { min: 0.1, max: 4 };

  it('steps through zoom levels within the range', () => {
    expect(nextZoomStep(1, 1, range)).toBe(1.25);
    expect(nextZoomStep(1, -1, range)).toBe(0.75);
    expect(nextZoomStep(1.1, 1, range)).toBe(1.25);
    expect(nextZoomStep(1.1, -1, range)).toBe(1);
    expect(nextZoomStep(1.0000001, 1, range)).toBe(1.25);
    expect(nextZoomStep(4, 1, range)).toBe(4);
    expect(nextZoomStep(0.1, -1, range)).toBe(0.1);
    expect(nextZoomStep(3.5, 1, { min: 0.1, max: 3.6 })).toBe(3.6);
    expect(nextZoomStep(0.12, -1, { min: 0.11, max: 4 })).toBe(0.11);
  });

  it('zooms with the buttons, shows the percentage, and disables at the limits', () => {
    const board = newBoard();
    board.camera.setViewport({ width: 800, height: 600 });
    const el = mountToolbar(board, UI_TAGS.zoom);
    const zoomIn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="zoom-in"]')!;
    const zoomOut = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="zoom-out"]')!;
    const level = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="zoom-level"]')!;
    expect(el.shadowRoot!.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Zoom');
    expect(level.textContent).toBe('100%');
    expect(level.getAttribute('aria-label')).toBe('Zoom 100%');
    expect(zoomIn.getAttribute('aria-label')).toBe('Perbesar');

    zoomIn.click();
    expect(board.camera.get().zoom).toBe(1.25);
    expect(level.textContent).toBe('125%');

    board.camera.zoomTo(4);
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    board.camera.zoomTo(0.1);
    expect(zoomOut.disabled).toBe(true);
    zoomIn.click();
    expect(board.camera.get().zoom).toBe(0.25);
  });

  it('opens a menu with 50%, 100%, 200%, and zoom to fit', () => {
    const box = defineElement({ type: 'box', version: 1, props: object({}), defaults: {} });
    const board = newBoard({
      plugins: [builtInTools, definePlugin({ id: 'box', elements: [box] })],
    });
    board.camera.setViewport({ width: 800, height: 600 });
    const el = mountToolbar(board, UI_TAGS.zoom);
    const level = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="zoom-level"]')!;
    const menu = el.shadowRoot!.querySelector<HTMLElement>('[role="menu"]')!;
    const item = (name: string) =>
      [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
        b.textContent!.startsWith(name),
      )!;

    level.click();
    expect(menu.hidden).toBe(false);
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual([
      '50%',
      '100%',
      '200%',
      'Pas ke layar',
    ]);
    // Nothing to fit on an empty page.
    expect(item('Pas ke layar').disabled).toBe(true);
    item('200%').click();
    expect(board.camera.get().zoom).toBe(2);
    expect(menu.hidden).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(level);

    board.create({ type: 'box', x: 0, y: 0, w: 4000, h: 3000 });
    level.focus();
    key(level, 'ArrowUp');
    expect(menu.hidden).toBe(false);
    expect(item('Pas ke layar').disabled).toBe(false);
    item('Pas ke layar').click();
    expect(board.camera.get().zoom).toBeLessThan(0.25);

    level.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(menu.hidden).toBe(true);
  });
});

describe('BOARD-1404: history control', () => {
  it('undoes and redoes, disabled when there is nothing to do', () => {
    const box = defineElement({ type: 'box', version: 1, props: object({}), defaults: {} });
    const board = newBoard({
      plugins: [builtInTools, definePlugin({ id: 'box', elements: [box] })],
    });
    const el = mountToolbar(board, UI_TAGS.history);
    const undo = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="undo"]')!;
    const redo = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="redo"]')!;
    expect(undo.getAttribute('aria-label')).toBe('Urungkan');
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);

    board.create({ type: 'box', x: 0, y: 0 });
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(board.query()).toHaveLength(0);
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);
    redo.click();
    expect(board.query()).toHaveLength(1);
  });

  it('shows the undo shortcut when one is bound', () => {
    const board = newBoard();
    board.commands.register(
      defineCommand({ id: 'history.undo', label: 'history.undo', run: (b) => b.undo() }),
    );
    board.keybindings.set('Mod+Z', 'history.undo');
    const el = mountToolbar(board, UI_TAGS.history);
    const undo = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-control="undo"]')!;
    expect(undo.getAttribute('aria-label')).toMatch(/^Urungkan \((⌘Z|Ctrl\+Z)\)$/);
  });

  it('BOARD-505: shows the defaultCommands shortcuts in names and tooltips', () => {
    const control = (board: Board, id: string) =>
      mountToolbar(board, UI_TAGS.history).shadowRoot!.querySelector<HTMLButtonElement>(
        `[data-control="${id}"]`,
      )!;
    const other = newBoard({ plugins: [builtInTools, defaultCommands], platform: 'other' });
    expect(control(other, 'undo').getAttribute('aria-label')).toBe('Urungkan (Ctrl+Z)');
    expect(control(other, 'undo').nextElementSibling!.textContent).toBe('UrungkanCtrl+Z');
    expect(control(other, 'redo').getAttribute('aria-label')).toMatch(/\(Ctrl\+Shift\+Z\)$/);

    const mac = newBoard({ plugins: [builtInTools, defaultCommands], platform: 'mac' });
    expect(control(mac, 'undo').getAttribute('aria-label')).toBe('Urungkan (⌘Z)');
    expect(control(mac, 'redo').getAttribute('aria-label')).toMatch(/\(⇧⌘Z\)$/);
  });
});

describe('BOARD-1402: style popovers (BOARD-1108)', () => {
  // Stand-ins for the built-in sticky and stroke elements: ui does not depend on shapes.
  const styled = definePlugin({
    id: 'styled',
    elements: [
      defineElement({
        type: 'sticky',
        version: 1,
        props: object({ color: enumOf(STICKY_COLORS) }),
        defaults: { color: 'yellow' },
      }),
      defineElement({
        type: 'draw',
        version: 1,
        props: object({ color: enumOf(COLOR_KEYS), brush: string(), thickness: number() }),
        defaults: { color: 'black', brush: 'pen', thickness: 4 },
      }),
    ],
    brushes: [
      defineBrush({ id: 'pen', label: 'brush.pen' }),
      defineBrush({ id: 'highlighter', label: 'brush.highlighter', blend: 'multiply' }),
      defineBrush({ id: 'example.marker', label: 'Spidol' }),
    ],
  });

  const styledBoard = (options: BoardOptions = {}) =>
    newBoard({ plugins: [builtInTools, styled], ...options });

  function menuOf(el: KujamUiElement, item: string): HTMLElement {
    const id = button(el, item).getAttribute('aria-controls')!;
    return el.shadowRoot!.querySelector<HTMLElement>(`#${id}`)!;
  }

  function choices(menu: HTMLElement, group: string): HTMLButtonElement[] {
    return [
      ...menu.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] [role="menuitemradio"]`),
    ];
  }

  it('lists sticky colors and pen brushes and colors only for registered elements', () => {
    const items = buildToolbarItems(styledBoard());
    const sticky = items.find((i) => i.id === 'sticky')!;
    expect(sticky.styles!.map((g) => [g.key, g.palette, g.fallback])).toEqual([
      ['color', 'sticky', 'yellow'],
    ]);
    expect(sticky.styles![0]!.options.map((o) => o.label)).toEqual([
      'Kuning',
      'Hijau',
      'Merah muda',
      'Biru',
      'Ungu',
      'Abu-abu',
    ]);
    const draw = items.find((i) => i.id === 'draw')!;
    expect(draw.styles!.map((g) => [g.key, g.palette, g.fallback])).toEqual([
      ['brush', undefined, 'pen'],
      ['color', 'colors', 'black'],
    ]);
    expect(draw.styles![0]!.options.map((o) => [o.value, o.label])).toEqual([
      ['pen', 'Pena'],
      ['highlighter', 'Stabilo'],
      ['example.marker', 'Spidol'],
    ]);
    expect(draw.styles![1]!.options).toHaveLength(COLOR_KEYS.length);

    const plain = buildToolbarItems(newBoard());
    expect(plain.every((i) => i.styles === undefined)).toBe(true);
  });

  it('chooses the next sticky color from a swatch popover', () => {
    const board = styledBoard();
    const el = mountToolbar(board);
    const sticky = button(el, 'sticky');
    const menu = menuOf(el, 'sticky');
    expect(sticky.getAttribute('aria-haspopup')).toBe('menu');
    expect(sticky.getAttribute('aria-label')).toBe('Sticky (S)');
    const dot = sticky.querySelector<HTMLElement>('.dot')!;
    expect(dot.style.background).toBe(board.theme.sticky.yellow);

    // The first click activates the tool, the second opens the popover.
    sticky.click();
    expect(board.tool).toBe('sticky');
    expect(menu.hidden).toBe(true);
    sticky.click();
    expect(menu.hidden).toBe(false);

    const group = menu.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Warna');
    const swatches = choices(menu, 'color');
    expect(swatches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Kuning',
      'Hijau',
      'Merah muda',
      'Biru',
      'Ungu',
      'Abu-abu',
    ]);
    expect(swatches.map((s) => s.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(swatches[2]!.style.getPropertyValue('--kujam-ui-swatch')).toBe(board.theme.sticky.pink);
    expect(el.shadowRoot!.activeElement).toBe(swatches[0]);

    key(swatches[0]!, 'ArrowRight');
    expect(el.shadowRoot!.activeElement).toBe(swatches[1]);
    swatches[2]!.click();
    expect(board.toolStyles.get('sticky')).toEqual({ color: 'pink' });
    expect(menu.hidden).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(sticky);
    expect(dot.style.background).toBe(board.theme.sticky.pink);
    expect(choices(menu, 'color')[2]!.getAttribute('aria-checked')).toBe('true');
  });

  it('chooses the pen brush and color, activating the pen', () => {
    const board = styledBoard({ locale: 'en' });
    board.toolStyles.set('draw', { thickness: 2 });
    const el = mountToolbar(board);
    const draw = button(el, 'draw');
    const menu = menuOf(el, 'draw');

    draw.focus();
    key(draw, 'ArrowUp');
    expect(menu.hidden).toBe(false);
    const groups = [...menu.querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Brush', 'Color']);
    const brushes = choices(menu, 'brush');
    expect(brushes.map((b) => [b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['Pen', 'true'],
      ['Highlighter', 'false'],
      ['Spidol', 'false'],
    ]);
    brushes[1]!.click();
    expect(board.tool).toBe('draw');
    // The brush starts at its own size: the remembered thickness is cleared.
    expect(board.toolStyles.get('draw')).toEqual({ brush: 'highlighter' });

    draw.click();
    const red = choices(menu, 'color').find((s) => s.getAttribute('aria-label') === 'Red')!;
    red.click();
    expect(board.toolStyles.get('draw')).toEqual({ brush: 'highlighter', color: 'red' });
    expect(draw.querySelector<HTMLElement>('.dot')!.style.background).toBe(board.theme.colors.red);
  });

  it('follows styles set elsewhere and the theme', () => {
    const board = styledBoard();
    const el = mountToolbar(board);
    const dot = button(el, 'draw').querySelector<HTMLElement>('.dot')!;
    board.toolStyles.set('draw', { color: 'blue' });
    expect(dot.style.background).toBe(board.theme.colors.blue);
    const checked = () =>
      choices(menuOf(el, 'draw'), 'color').find((s) => s.getAttribute('aria-checked') === 'true')!;
    expect(checked().getAttribute('aria-label')).toBe('Biru');

    board.setTheme('dark');
    expect(dot.style.background).toBe(board.theme.colors.blue);
    expect(checked().style.getPropertyValue('--kujam-ui-swatch')).toBe(board.theme.colors.blue);
  });
});
