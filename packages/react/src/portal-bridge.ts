/**
 * React portal bridge connecting `@kujam/renderer` HTML layer lifecycle
 * with React components via React Portals (BOARD-1304).
 */

import type { ComponentType } from 'react';
import type {
  Board as CoreBoard,
  ElementHtmlView,
  ElementRecord,
} from '@kujam/core';

/**
 * Status of external data for an element.
 *
 * @public
 */
export type ElementDataStatus = 'loading' | 'ready' | 'forbidden' | 'not-found' | 'error';

/**
 * Typed props received by custom React element components (BOARD-1304).
 *
 * @public
 */
export interface CustomElementComponentProps<P = Record<string, unknown>, D = unknown> {
  readonly element: ElementRecord<P>;
  readonly data: D | undefined;
  readonly status: ElementDataStatus;
  readonly board: CoreBoard;
}

/**
 * Custom React component type for element rendering.
 *
 * @public
 */
export type CustomElementComponent<P = any, D = any> = ComponentType<
  CustomElementComponentProps<P, D>
>;

/**
 * Internal portal entry representing a mounted custom element.
 */
export interface PortalEntry {
  readonly id: string;
  readonly host: HTMLElement;
  component: CustomElementComponent;
  element: ElementRecord<any>;
  data: unknown;
  status: ElementDataStatus;
  readonly board: CoreBoard;
}

/**
 * Registry mapping host DOM elements and boards to their active PortalBridge.
 */
const portalBridgesByHost = new WeakMap<Element, PortalBridge>();
const portalBridgesByBoard = new WeakMap<CoreBoard, PortalBridge>();

/**
 * Traverses up the DOM hierarchy from a host node to find its owning PortalBridge.
 */
export function findPortalBridge(node: Element): PortalBridge | null {
  let curr: Element | null = node;
  while (curr) {
    const bridge = portalBridgesByHost.get(curr);
    if (bridge) return bridge;
    curr = curr.parentElement;
  }
  return null;
}

/**
 * Looks up the PortalBridge associated with a board instance.
 */
export function getPortalBridgeForBoard(board: CoreBoard): PortalBridge | null {
  return portalBridgesByBoard.get(board) ?? null;
}

/**
 * Sets the active bridge for a host DOM container and board.
 */
export function registerPortalBridge(
  host: Element,
  board: CoreBoard,
  bridge: PortalBridge,
): () => void {
  portalBridgesByHost.set(host, bridge);
  portalBridgesByBoard.set(board, bridge);
  return () => {
    portalBridgesByHost.delete(host);
    portalBridgesByBoard.delete(board);
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
 * Manages the collection of active React portals for a `<Board>`.
 */
export class PortalBridge {
  private readonly entries = new Map<string, PortalEntry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly PortalEntry[] = [];

  constructor(
    readonly board: CoreBoard,
    private readonly elementsGetter: () => Readonly<Record<string, CustomElementComponent>> | undefined,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly PortalEntry[] => {
    return this.snapshot;
  };

  private notify(): void {
    this.snapshot = Array.from(this.entries.values());
    for (const listener of this.listeners) {
      listener();
    }
  }

  getComponent(type: string): CustomElementComponent | undefined {
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
    el: ElementRecord<any>,
    data: unknown,
    fallbackComponent?: CustomElementComponent,
  ): ElementHtmlView<any, any> {
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

    const entry: PortalEntry = {
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
      update: (nextEl: ElementRecord<any>, nextData: unknown) => {
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
