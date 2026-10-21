/**
 * Vue 3 teleport bridge connecting `@kujam/renderer` HTML layer lifecycle
 * with Vue components via Vue `<Teleport>` (BOARD-1305).
 */

import {
  shallowRef,
  type Component,
  type ShallowRef,
} from 'vue';
import type {
  Board as CoreBoard,
  ElementHtmlView,
  ElementRecord,
} from '@kujam/core';

/**
 * Status of external data for an element (BOARD-1305, BOARD-1306).
 *
 * @public
 */
export type ElementDataStatus = 'loading' | 'ready' | 'forbidden' | 'not-found' | 'error';

/**
 * Typed props received by custom Vue element components (BOARD-1305).
 *
 * @public
 */
export interface CustomVueElementProps<P = Record<string, unknown>, D = unknown> {
  readonly element: ElementRecord<P>;
  readonly data: D | undefined;
  readonly status: ElementDataStatus;
  readonly board: CoreBoard;
}

/**
 * Custom Vue component type for element rendering.
 *
 * @public
 */
export type CustomVueComponent<P = Record<string, unknown>, D = unknown> = Component<
  CustomVueElementProps<P, D>
>;

/**
 * Internal teleport entry representing a mounted custom element.
 */
export interface TeleportEntry {
  readonly id: string;
  readonly host: HTMLElement;
  component: Component;
  element: ElementRecord<unknown>;
  data: unknown;
  status: ElementDataStatus;
  readonly board: CoreBoard;
}

/**
 * Registry mapping host DOM elements and boards to their active TeleportBridge.
 */
const teleportBridgesByHost = new WeakMap<Element, TeleportBridge>();
const teleportBridgesByBoard = new WeakMap<CoreBoard, TeleportBridge>();

/**
 * Traverses up the DOM hierarchy from a host node to find its owning TeleportBridge.
 */
export function findTeleportBridge(node: Element): TeleportBridge | null {
  let curr: Element | null = node;
  while (curr) {
    const bridge = teleportBridgesByHost.get(curr);
    if (bridge) return bridge;
    curr = curr.parentElement;
  }
  return null;
}

/**
 * Looks up the TeleportBridge associated with a board instance.
 */
export function getTeleportBridgeForBoard(board: CoreBoard): TeleportBridge | null {
  return teleportBridgesByBoard.get(board) ?? null;
}

/**
 * Sets the active bridge for a host DOM container and board.
 */
export function registerTeleportBridge(
  host: Element,
  board: CoreBoard,
  bridge: TeleportBridge,
): () => void {
  teleportBridgesByHost.set(host, bridge);
  teleportBridgesByBoard.set(board, bridge);
  return () => {
    teleportBridgesByHost.delete(host);
    teleportBridgesByBoard.delete(board);
  };
}

/**
 * Enables pointer events on any element marked with `data-board-interactive` inside `host`.
 */
export function enableInteractive(host: HTMLElement): void {
  for (const node of host.querySelectorAll<HTMLElement>('[data-board-interactive]')) {
    if (node.style.pointerEvents !== 'auto') {
      node.style.pointerEvents = 'auto';
    }
  }
}

/**
 * Manages the collection of active Vue `<Teleport>` entries for a `<Board>`.
 */
export class TeleportBridge {
  private readonly entries = new Map<string, TeleportEntry>();
  private readonly listeners = new Set<() => void>();
  readonly entriesRef: ShallowRef<readonly TeleportEntry[]> = shallowRef([]);

  constructor(
    readonly board: CoreBoard,
    private elementsGetter: () => Readonly<Record<string, Component>> | undefined,
  ) {}

  setElementsGetter(getter: () => Readonly<Record<string, Component>> | undefined): void {
    this.elementsGetter = getter;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    this.entriesRef.value = Array.from(this.entries.values());
    for (const listener of this.listeners) {
      listener();
    }
  }

  getComponent(type: string): Component | undefined {
    return this.elementsGetter()?.[type];
  }

  updateComponents(): void {
    let changed = false;
    for (const entry of this.entries.values()) {
      const comp = this.getComponent(entry.element.type);
      if (comp && comp !== entry.component) {
        entry.component = comp;
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  mount(
    host: HTMLElement,
    el: ElementRecord<unknown>,
    data: unknown,
    fallbackComponent?: Component,
  ): ElementHtmlView<unknown, unknown> {
    const component = this.getComponent(el.type) ?? fallbackComponent;
    if (!component) {
      return {
        update() {},
        destroy() {},
      };
    }

    const dataState = this.board.getElementData(el.id);
    const status: ElementDataStatus = (dataState?.status ?? 'ready') as ElementDataStatus;
    const resolvedData =
      data !== undefined
        ? data
        : dataState?.status === 'ready'
          ? (dataState as { readonly data: unknown }).data
          : undefined;

    const entry: TeleportEntry = {
      id: el.id,
      host,
      component,
      element: el,
      data: resolvedData,
      status,
      board: this.board,
    };
    this.entries.set(el.id, entry);
    this.notify();

    const unsubData = this.board.on('data', (event) => {
      if (event.ids.includes(el.id)) {
        const nextState = this.board.getElementData(el.id);
        const existing = this.entries.get(el.id);
        if (existing) {
          existing.status = (nextState?.status ?? 'ready') as ElementDataStatus;
          if (nextState?.status === 'ready') {
            existing.data = (nextState as { readonly data: unknown }).data;
          }
          this.notify();
        }
      }
    });

    return {
      update: (nextEl: ElementRecord<unknown>, nextData: unknown) => {
        const existing = this.entries.get(el.id);
        if (existing) {
          const nextState = this.board.getElementData(nextEl.id);
          existing.element = nextEl;
          existing.data =
            nextData !== undefined
              ? nextData
              : nextState?.status === 'ready'
                ? (nextState as { readonly data: unknown }).data
                : existing.data;
          existing.status = (nextState?.status ?? 'ready') as ElementDataStatus;
          this.notify();
        }
      },
      destroy: () => {
        unsubData();
        this.entries.delete(el.id);
        this.notify();
      },
    };
  }
}
