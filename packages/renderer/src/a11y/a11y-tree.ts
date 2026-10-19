/**
 * Parallel accessibility tree (BOARD-1901) and keyboard focus on board elements (BOARD-1902).
 *
 * The canvas has no semantics, so the renderer keeps a hidden DOM list next to it: one item per
 * element with the role and label from the element type's `a11y` callback, in the reading order
 * decided by core (`getReadingOrder`). Items sit in a camera-transformed wrapper at their
 * elements' positions, so a screen reader's cursor (and touch exploration on iPadOS) lands on the
 * element. They have no text, no background, and `pointer-events: none`, so they are invisible
 * and never take pointer input.
 *
 * Large boards: only elements near the viewport, plus the focused element, are in the DOM (at most
 * {@link A11Y_MAX_ITEMS}); `aria-setsize` and `aria-posinset` still tell assistive technology the
 * full count and position. Changed elements are patched in place on the next frame, and the
 * visible set is reconciled at most every {@link A11Y_SYNC_INTERVAL_MS}, with keyed moves only.
 *
 * Keyboard focus follows the selection: when the board has focus and one element becomes
 * selected (Tab, a click), its item receives DOM focus and the screen reader announces it. The
 * focused item shows a 2px `focus-ring` outline 2px outside the element after keyboard use.
 */

import { getReadingOrder, type Board, type ChangeEvent, type ElementRecord } from '@kujam/core';
import { a11yText } from './i18n.js';

/**
 * Maximum number of element items kept in the accessibility tree at once (BOARD-1901). The
 * focused element is always included on top.
 *
 * @beta
 */
export const A11Y_MAX_ITEMS = 200;

/** Margin around the viewport, in screen pixels, whose elements are also in the tree. */
export const A11Y_VIEWPORT_MARGIN_PX = 100;

/** Minimum time between two reconciliations of the visible set, in milliseconds. */
export const A11Y_SYNC_INTERVAL_MS = 100;

/** Focus ring width and gap in screen pixels (DESIGN.md: 2px `focus-ring`, 2px apart). */
const FOCUS_RING_PX = 2;
const DEFAULT_FOCUS_RING = '#2F6FDB';

/** Keys that stay with interactive content of custom HTML elements instead of the board. */
const NAVIGATION_KEYS = new Set([
  'Tab',
  'Enter',
  ' ',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
]);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

interface Entry {
  readonly id: string;
  /** `role="listitem"` child of the list, positioned at the element. */
  readonly item: HTMLDivElement;
  /** Focusable node with the element's role and label: `item` itself, or one child of it. */
  target: HTMLDivElement;
  role: string;
  label: string;
  description: string;
  position: number;
}

/** Shared by every view only to make `aria-describedby` IDs unique on the page. */
let helpIds = 0;

/** Visually hidden but readable (the usual "sr-only" pattern). */
function hideVisually(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  });
}

function setAttr(el: Element, name: string, value: string): void {
  if (value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  } else if (el.hasAttribute(name)) {
    el.removeAttribute(name);
  }
}

/** Options for {@link A11yTree}. */
export interface A11yTreeOptions {
  /** HTML layer of custom elements; its interactive content keeps Tab, Enter, and arrows. */
  readonly interactive?: HTMLElement;
  /** Schedules a call after `ms` milliseconds; defaults to the window's `setTimeout`. */
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

/**
 * Hidden element list and keyboard focus of one board view.
 *
 * @internal
 */
export class A11yTree {
  /** Camera-transformed `role="list"` holding one item per element. */
  readonly list: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly doc: Document;
  private readonly entries = new Map<string, Entry>();
  /** Focus targets, to find the entry of a focused node. */
  private readonly byTarget = new WeakMap<Element, Entry>();
  /** Elements whose item must be patched on the next frame. */
  private readonly dirty = new Set<string>();
  private syncHandle: unknown = null;
  private setSize = -1;
  private zoom = 1;
  /** Whether the last interaction was the keyboard (decides whether the focus ring shows). */
  private focusVisible = false;
  /** After Esc on the board, the next Tab leaves the board (BOARD-1902). */
  private exitArmed = false;
  private disposed = false;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly board: Board,
    private readonly root: HTMLElement,
    private readonly layer: HTMLDivElement,
    private readonly options: A11yTreeOptions = {},
  ) {
    const doc = root.ownerDocument;
    this.doc = doc;
    layer.style.overflow = 'hidden';

    this.help = doc.createElement('div');
    this.help.id = `kujam-a11y-help-${++helpIds}`;
    this.help.textContent = a11yText('help', board);
    hideVisually(this.help);

    this.list = doc.createElement('div');
    this.list.dataset.kujamA11yList = '';
    this.list.setAttribute('role', 'list');
    this.list.setAttribute('aria-label', a11yText('list', board));
    Object.assign(this.list.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    });
    layer.append(this.help, this.list);

    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', a11yText('roleDescription', board));
    root.setAttribute('aria-label', a11yText('board', board));
    root.setAttribute('aria-describedby', this.help.id);

    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      capture = false,
    ) => {
      target.addEventListener(type, fn, capture);
      this.offs.push(() => target.removeEventListener(type, fn, capture));
    };
    listen(layer, 'focusin', (e) => this.applyRing(this.byTarget.get(e.target as Element)));
    listen(layer, 'focusout', (e) => this.clearRing(this.byTarget.get(e.target as Element)));
    listen(
      root,
      'pointerdown',
      () => {
        this.exitArmed = false;
        this.setFocusVisible(false);
      },
      true,
    );
    listen(root, 'focusin', (e) => {
      const from = e.relatedTarget as Node | null;
      if (from && root.contains(from)) return;
      this.exitArmed = false;
      // Entering the board (Tab or Shift+Tab from outside) resumes at the selected element, like
      // a roving tabindex, so Tab continues from there and Shift+Tab walks back.
      const { selection } = board;
      if (e.target === root && selection.length === 1) {
        this.ensure(selection[0]!)?.target.focus({ preventScroll: true });
      }
    });
    this.syncCamera();
  }

  // ---------- Board events (called by the view) ----------

  /** Patches changed items on the next frame and removes deleted ones now. */
  onChange(event: ChangeEvent): void {
    let structural = false;
    for (const [id, record] of Object.entries(event.removed)) {
      if (record.kind !== 'element') continue;
      structural = true;
      this.remove(id);
    }
    for (const [id, record] of Object.entries(event.added)) {
      if (record.kind === 'element') structural = true;
      if (this.entries.has(id)) this.dirty.add(id);
    }
    for (const [id, { after }] of Object.entries(event.updated)) {
      if (after.kind !== 'element') continue;
      structural = true;
      if (this.entries.has(id)) this.dirty.add(id);
    }
    if (structural) this.scheduleSync();
  }

  /** Moves DOM focus to the newly selected element while the board has focus. */
  onSelection(ids: readonly string[]): void {
    if (this.disposed) return;
    const active = this.doc.activeElement;
    const focusedEntry = active ? this.byTarget.get(active) : undefined;
    if (active !== this.root && !focusedEntry) {
      // Focus is elsewhere (an editor, the toolbar): only keep the selection in the tree.
      this.scheduleSync();
      return;
    }
    if (ids.length === 1) {
      this.ensure(ids[0]!)?.target.focus({ preventScroll: true });
    } else if (ids.length === 0 && focusedEntry) {
      this.root.focus({ preventScroll: true });
    }
  }

  onCamera(): void {
    this.scheduleSync();
  }

  onPage(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.scheduleSync();
  }

  onTheme(): void {
    const entry = this.focusedEntry();
    if (entry) this.applyRing(entry);
  }

  /** Per-frame work: follow the camera and patch changed items. */
  frame(): void {
    if (this.disposed) return;
    this.syncCamera();
    for (const id of this.dirty) {
      const entry = this.entries.get(id);
      const el = this.board.getElement(id);
      if (entry && el) this.apply(entry, el);
    }
    this.dirty.clear();
  }

  // ---------- Keyboard (called by the input pipeline) ----------

  /**
   * Decides whether a `keydown` reaches the board. `false` leaves it to the browser: Tab right
   * after Esc (leaving the board), and navigation keys inside custom HTML content.
   */
  filterKey(e: KeyboardEvent): boolean {
    this.setFocusVisible(true);
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Tab' && plain && this.exitArmed && this.doc.activeElement === this.root) {
      this.exitArmed = false;
      return false;
    }
    const target = e.target as Element | null;
    const interactive = this.options.interactive;
    if (
      NAVIGATION_KEYS.has(e.key) &&
      interactive &&
      target &&
      target !== this.root &&
      interactive.contains(target)
    ) {
      return false;
    }
    return true;
  }

  /** Tracks Esc for the "Esc, then Tab" exit after the board handled (or ignored) a key. */
  afterKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.exitArmed = this.board.selection.length === 0;
    else if (!MODIFIER_KEYS.has(e.key)) this.exitArmed = false;
  }

  /**
   * Gives focus back to the board after an editor that had focus closed: the single selected
   * element, or the board itself.
   */
  restoreFocus(): void {
    if (this.disposed) return;
    const { selection } = this.board;
    const entry = selection.length === 1 ? this.ensure(selection[0]!) : undefined;
    (entry?.target ?? this.root).focus({ preventScroll: true });
  }

  /** Reconciles the visible set now (also used on mount). */
  syncNow(): void {
    this.cancelSync();
    if (this.disposed || this.board.disposed) return;
    const { board } = this;
    const order = getReadingOrder(board);
    const rank = (id: string) => order.indexOf(id);
    const { width, height } = board.camera.viewport;
    let ids: string[];
    if (width > 0 && height > 0) {
      const view = board.camera.getViewportBounds();
      const margin = A11Y_VIEWPORT_MARGIN_PX / board.camera.get().zoom;
      ids = board
        .query({
          inBounds: {
            minX: view.minX - margin,
            minY: view.minY - margin,
            maxX: view.maxX + margin,
            maxY: view.maxY + margin,
          },
        })
        .map((el) => el.id);
    } else {
      // No viewport yet (not laid out): start from the beginning of the reading order.
      ids = order.ids.slice(0, A11Y_MAX_ITEMS);
    }
    ids = ids.filter((id) => rank(id) >= 0).sort((a, b) => rank(a) - rank(b));
    if (ids.length > A11Y_MAX_ITEMS) ids.length = A11Y_MAX_ITEMS;
    const pinned = new Set(ids);
    let added = false;
    for (const id of this.pinnedIds()) {
      if (!pinned.has(id) && rank(id) >= 0) {
        pinned.add(id);
        ids.push(id);
        added = true;
      }
    }
    if (added) ids.sort((a, b) => rank(a) - rank(b));
    this.reconcile(ids, order.ids.length, rank);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelSync();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.entries.clear();
    this.dirty.clear();
    this.list.replaceChildren();
    for (const name of ['role', 'aria-roledescription', 'aria-label', 'aria-describedby']) {
      this.root.removeAttribute(name);
    }
  }

  // ---------- Internals ----------

  private scheduleSync(): void {
    if (this.disposed || this.syncHandle !== null) return;
    const set = this.options.setTimeout ?? ((fn, ms) => this.doc.defaultView?.setTimeout(fn, ms));
    this.syncHandle =
      set(() => {
        this.syncHandle = null;
        if (this.disposed || this.board.disposed) return;
        // During a drag the order changes every frame: wait until the interaction ends.
        if (this.interacting()) {
          this.scheduleSync();
          return;
        }
        this.syncNow();
      }, A11Y_SYNC_INTERVAL_MS) ?? null;
  }

  /** Whether the active tool is outside its initial state (dragging, drawing, resizing). */
  private interacting(): boolean {
    const { tool, toolState } = this.board;
    if (tool === null || toolState === null) return false;
    return toolState !== this.board.tools.get(tool)?.initial;
  }

  private cancelSync(): void {
    if (this.syncHandle === null) return;
    const clear =
      this.options.clearTimeout ??
      ((handle: unknown) => this.doc.defaultView?.clearTimeout(handle as number));
    clear(this.syncHandle);
    this.syncHandle = null;
  }

  /** Elements that stay in the tree regardless of the viewport: the focus and selection anchor. */
  private pinnedIds(): string[] {
    const out: string[] = [];
    const focused = this.focusedEntry();
    if (focused) out.push(focused.id);
    const anchor = this.board.selection[this.board.selection.length - 1];
    if (anchor !== undefined && anchor !== focused?.id) out.push(anchor);
    return out;
  }

  private focusedEntry(): Entry | undefined {
    const active = this.doc.activeElement;
    return active ? this.byTarget.get(active) : undefined;
  }

  private reconcile(ids: readonly string[], total: number, rank: (id: string) => number): void {
    const focused = this.focusedEntry();
    const wanted = new Set(ids);
    for (const id of [...this.entries.keys()]) if (!wanted.has(id)) this.remove(id);

    const sizeChanged = total !== this.setSize;
    this.setSize = total;
    let cursor: ChildNode | null = this.list.firstChild;
    for (const id of ids) {
      let entry = this.entries.get(id);
      const el = this.board.getElement(id);
      if (!el) continue;
      const created = !entry;
      if (!entry) {
        entry = this.create(el);
      } else if (this.dirty.delete(id)) {
        this.apply(entry, el);
      }
      if (entry.item === cursor) cursor = cursor.nextSibling;
      else this.list.insertBefore(entry.item, cursor);
      this.setPosition(entry, rank(id) + 1, sizeChanged || created);
    }
    // Moving a focused node in the DOM drops its focus in some browsers.
    if (
      focused &&
      this.entries.get(focused.id) === focused &&
      this.doc.activeElement !== focused.target
    ) {
      focused.target.focus({ preventScroll: true });
    }
  }

  /** Entry of `id`, created and inserted at its reading position when missing. */
  private ensure(id: string): Entry | undefined {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const el = this.board.getElement(id);
    if (!el || el.pageId !== this.board.pages.current) return undefined;
    const order = getReadingOrder(this.board);
    const position = order.indexOf(id) + 1;
    const entry = this.create(el);
    let before: Entry | undefined;
    for (const other of this.entries.values()) {
      if (
        other !== entry &&
        other.position > position &&
        (!before || other.position < before.position)
      ) {
        before = other;
      }
    }
    this.list.insertBefore(entry.item, before?.item ?? null);
    if (order.ids.length !== this.setSize) {
      this.setSize = order.ids.length;
      for (const other of this.entries.values()) this.setPosition(other, other.position, true);
    }
    this.setPosition(entry, position, true);
    // Keep it when the next reconciliation runs.
    this.scheduleSync();
    return entry;
  }

  private setPosition(entry: Entry, position: number, sizeChanged: boolean): void {
    if (entry.position !== position) {
      entry.position = position;
      entry.item.setAttribute('aria-posinset', String(position));
    }
    if (sizeChanged) entry.item.setAttribute('aria-setsize', String(this.setSize));
  }

  private create(el: Readonly<ElementRecord>): Entry {
    const item = this.doc.createElement('div');
    item.setAttribute('role', 'listitem');
    item.dataset.kujamA11yId = el.id;
    Object.assign(item.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    });
    const entry: Entry = {
      id: el.id,
      item,
      target: item,
      role: '',
      label: '',
      description: '',
      position: 0,
    };
    this.entries.set(el.id, entry);
    this.apply(entry, el);
    return entry;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const hadFocus = this.doc.activeElement === entry.target;
    entry.item.remove();
    this.entries.delete(id);
    this.dirty.delete(id);
    // A deleted element must not drop focus to the page body: keep it on the board.
    if (hadFocus && !this.disposed) this.root.focus({ preventScroll: true });
  }

  /** Writes the element's position, role, and label to its item (only what changed). */
  private apply(entry: Entry, el: Readonly<ElementRecord>): void {
    const { style } = entry.item;
    const left = `${el.x}px`;
    const top = `${el.y}px`;
    const width = `${Math.max(0, el.w)}px`;
    const height = `${Math.max(0, el.h)}px`;
    const transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    if (style.left !== left) style.left = left;
    if (style.top !== top) style.top = top;
    if (style.width !== width) style.width = width;
    if (style.height !== height) style.height = height;
    if (style.transform !== transform) style.transform = transform;

    const { role, label, description } = this.describe(el);
    if (role !== entry.role) {
      const hadFocus = this.doc.activeElement === entry.target;
      if (entry.target !== entry.item) entry.target.remove();
      let target = entry.item;
      if (role !== 'listitem') {
        // A list may only own list items, so other roles go on a child of the item.
        target = this.doc.createElement('div');
        target.setAttribute('role', role);
        Object.assign(target.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
        entry.item.append(target);
      }
      target.tabIndex = -1;
      // The focus ring is drawn by `applyRing`, only after keyboard use.
      target.style.outlineStyle = 'none';
      entry.target = target;
      entry.role = role;
      entry.label = '';
      entry.description = '';
      this.byTarget.set(target, entry);
      if (hadFocus) target.focus({ preventScroll: true });
    }
    if (label !== entry.label) {
      entry.label = label;
      setAttr(entry.target, 'aria-label', label);
    }
    if (description !== entry.description) {
      entry.description = description;
      setAttr(entry.target, 'aria-description', description);
    }
  }

  /** Role and label from the element type's `a11y` callback, with a localized fallback. */
  private describe(el: Readonly<ElementRecord>): {
    role: string;
    label: string;
    description: string;
  } {
    const { board } = this;
    let a11y: { role?: unknown; label?: unknown; description?: unknown } | undefined;
    try {
      a11y = board.elements.get(el.type)?.a11y?.(el as never, undefined, board.elementContext);
    } catch {
      // A failing callback only costs this element its custom label.
      a11y = undefined;
    }
    const role = typeof a11y?.role === 'string' && a11y.role.trim() ? a11y.role.trim() : 'listitem';
    const label =
      typeof a11y?.label === 'string' && a11y.label.trim()
        ? a11y.label
        : a11yText('element', board, { type: el.type });
    let description = typeof a11y?.description === 'string' ? a11y.description : '';
    if (el.locked) {
      const locked = a11yText('locked', board);
      description = description ? `${locked}. ${description}` : locked;
    }
    return { role, label, description };
  }

  private syncCamera(): void {
    const { x, y, zoom } = this.board.camera.get();
    const transform = `translate(${-x * zoom}px, ${-y * zoom}px) scale(${zoom})`;
    if (this.list.style.transform !== transform) this.list.style.transform = transform;
    if (zoom !== this.zoom) {
      this.zoom = zoom;
      const entry = this.focusedEntry();
      if (entry) this.applyRing(entry);
    }
  }

  private setFocusVisible(value: boolean): void {
    if (this.focusVisible === value) return;
    this.focusVisible = value;
    const entry = this.focusedEntry();
    if (entry) this.applyRing(entry);
  }

  /** Outline on the focused item; the list is scaled by the zoom, so widths are divided by it. */
  private applyRing(entry: Entry | undefined): void {
    if (!entry) return;
    if (!this.focusVisible || this.doc.activeElement !== entry.target) {
      this.clearRing(entry);
      return;
    }
    const zoom = this.board.camera.get().zoom || 1;
    const color = this.board.theme.selection.focusRing ?? DEFAULT_FOCUS_RING;
    const { style } = entry.target;
    style.outlineStyle = 'solid';
    style.outlineWidth = `${FOCUS_RING_PX / zoom}px`;
    style.outlineColor = color;
    style.outlineOffset = `${FOCUS_RING_PX / zoom}px`;
  }

  private clearRing(entry: Entry | undefined): void {
    if (!entry) return;
    entry.target.style.outlineStyle = 'none';
    entry.target.style.outlineOffset = '';
  }
}
