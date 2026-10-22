/**
 * Slot layer for application anchor pins, such as comment markers (BOARD-1211).
 *
 * Each pin is an application-owned DOM element placed at an anchor's screen position. Pins keep
 * their screen size (they do not scale with zoom), follow the camera, follow element anchors when
 * the element moves, and are hidden while the anchor's element is missing or on another page.
 */

import type { Anchor, Board, ChangeEvent } from '@kujam/core';
import { isAnchor } from '@kujam/core';

/**
 * Handle for an application pin mounted with `BoardView.mountAnchor` (BOARD-1211).
 *
 * @public
 */
export interface AnchorPin {
  /** Wrapper the renderer positions; the application element is its only child. */
  readonly host: HTMLDivElement;
  /** The application element passed to `mountAnchor`. */
  readonly element: HTMLElement;
  /** Current anchor. */
  readonly anchor: Anchor;
  /** Whether the pin is shown: its anchor resolves and is on the current page. */
  readonly visible: boolean;
  /** Moves the pin to another anchor, for example after the application re-anchors a comment. */
  update(anchor: Anchor): void;
  /** Removes the pin from the layer. Safe to call more than once. */
  remove(): void;
}

interface PinEntry {
  host: HTMLDivElement;
  element: HTMLElement;
  anchor: Anchor;
  visible: boolean;
  removed: boolean;
}

/** @internal */
export class AnchorLayer {
  private readonly pins = new Set<PinEntry>();

  constructor(
    private readonly board: Board,
    private readonly layer: HTMLDivElement,
  ) {}

  mount(element: HTMLElement, anchor: Anchor): AnchorPin {
    if (!element || typeof (element as Partial<HTMLElement>).appendChild !== 'function') {
      throw new TypeError('Argumen element pada mountAnchor wajib berupa elemen DOM.');
    }
    if (!isAnchor(anchor)) {
      throw new TypeError('Argumen anchor pada mountAnchor tidak valid.');
    }
    const host = this.layer.ownerDocument.createElement('div');
    host.dataset.kujamAnchor = anchor.kind;
    // Zero-size box at the anchor point: the application aligns its pin with its own CSS.
    host.style.position = 'absolute';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.pointerEvents = 'auto';
    host.appendChild(element);
    const entry: PinEntry = { host, element, anchor, visible: false, removed: false };
    this.pins.add(entry);
    this.layer.appendChild(host);
    this.position(entry);

    const pins = this.pins;
    const reposition = (target: PinEntry): void => this.position(target);
    return {
      host,
      element,
      get anchor() {
        return entry.anchor;
      },
      get visible() {
        return entry.visible;
      },
      update(next: Anchor) {
        if (entry.removed) return;
        if (!isAnchor(next))
          throw new TypeError('Argumen anchor pada AnchorPin.update tidak valid.');
        entry.anchor = next;
        host.dataset.kujamAnchor = next.kind;
        reposition(entry);
      },
      remove() {
        if (entry.removed) return;
        entry.removed = true;
        pins.delete(entry);
        host.remove();
      },
    };
  }

  /** Repositions every pin, after a camera, page, or viewport change. */
  updateAll(): void {
    for (const entry of this.pins) this.position(entry);
  }

  /** Repositions pins whose element changed. */
  onChange(event: ChangeEvent): void {
    for (const entry of this.pins) {
      const { anchor } = entry;
      if (anchor.kind !== 'element') continue;
      const id = anchor.elementId;
      if (
        Object.hasOwn(event.added, id) ||
        Object.hasOwn(event.updated, id) ||
        Object.hasOwn(event.removed, id)
      ) {
        this.position(entry);
      }
    }
  }

  dispose(): void {
    for (const entry of this.pins) {
      entry.removed = true;
      entry.host.remove();
    }
    this.pins.clear();
  }

  private position(entry: PinEntry): void {
    const resolved = this.board.anchors.resolve(entry.anchor);
    const visible =
      resolved !== null &&
      (resolved.pageId === null || resolved.pageId === this.board.pages.current);
    entry.visible = visible;
    entry.host.hidden = !visible;
    entry.host.style.display = visible ? '' : 'none';
    if (!visible) return;
    const screen = this.board.camera.boardToScreen({ x: resolved.x, y: resolved.y });
    entry.host.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
  }
}
