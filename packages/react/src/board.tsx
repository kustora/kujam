/**
 * React `<Board>` component (BOARD-1302, BOARD-1304).
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import {
  object,
  rect,
  type Board as CoreBoard,
  type ElementContext,
  type ElementHtmlHost,
  type ThemeDefinition,
  type ThemeMode,
} from '@kujam/core';
import { mountRenderer, type BoardBackground, type BoardView } from '@kujam/renderer';
import {
  enableInteractive,
  PortalBridge,
  registerPortalBridge,
  type CustomElementComponent,
  type CustomElementComponentProps,
  type ElementDataStatus,
  type PortalEntry,
} from './portal-bridge.js';
import { defineReactElement } from './elements.js';

export {
  type CustomElementComponent,
  type CustomElementComponentProps,
  type ElementDataStatus,
};

/**
 * Props for the React `<Board>` component.
 *
 * @public
 */
export interface BoardProps {
  /** The board to render. Changing it unmounts the old view and mounts a new one. */
  readonly board: CoreBoard;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Theme mode or definition (BOARD-1006). Applied with `board.setTheme` when it changes. */
  readonly theme?: ThemeMode | ThemeDefinition;
  /** Background pattern (BOARD-1007). Defaults to `dots`. */
  readonly background?: BoardBackground;
  /** Visual debug overlays and render stats (BOARD-802). */
  readonly debug?: boolean;
  /** Device pixel ratio for the canvases. Read when the view mounts. */
  readonly pixelRatio?: number;
  /** Called when pasted board content is rejected (BOARD-906). */
  readonly onClipboardError?: (error: unknown) => void;
  /**
   * Called with the view after it mounts, for example to call `view.mountEditor`. May return a
   * cleanup function, called before the view unmounts.
   */
  readonly onMount?: (view: BoardView) => void | (() => void);
  /**
   * Custom React components for rendering elements by element type (BOARD-1304).
   * Rendered via React Portals to preserve React context and maintain high performance.
   */
  readonly elements?: Readonly<Record<string, CustomElementComponent>>;
}

function PortalItem({ entry }: { readonly entry: PortalEntry }): ReactElement {
  const { host, component: Component, element, data, status, board } = entry;

  useLayoutEffect(() => {
    enableInteractive(host);
  });

  return (
    <Component
      element={element}
      data={data}
      status={status}
      board={board}
    />
  );
}

/**
 * Mounts `@kujam/renderer` for `board` and unmounts it on unmount (BOARD-1302, BOARD-1304).
 *
 * Safe under React 18 and 19 StrictMode: the double mount in development creates the view,
 * removes it, and creates it again, leaving one view. The component fills its parent, so give the
 * parent a size.
 *
 * Custom React elements passed via `elements` are rendered with React Portals into their respective
 * HTML host nodes, enabling seamless React Context inheritance (theme, router, queries) and
 * maintaining high performance without multiple `createRoot` instances.
 *
 * @example
 * ```tsx
 * const board = useMemo(() => createBoard({ plugins: [defaultElements, defaultTools] }), []);
 * return (
 *   <Board
 *     board={board}
 *     theme="light"
 *     elements={{ 'tayang-post': PostCard }}
 *     style={{ height: 600 }}
 *   />
 * );
 * ```
 *
 * `<Board>` never disposes the board, since the app owns it. Do not dispose it in an effect
 * cleanup of the component that created it: StrictMode runs that cleanup once in development.
 *
 * @public
 */
export function Board({
  board,
  className,
  style,
  theme,
  background,
  debug,
  pixelRatio,
  onClipboardError,
  onMount,
  elements,
}: BoardProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<BoardView | null>(null);

  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const bridge = useMemo(
    () => new PortalBridge(board, () => elementsRef.current),
    [board],
  );

  const portals = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);

  useEffect(() => {
    bridge.updateComponents();
  }, [bridge, elements]);

  // Callbacks are read through refs, so inline functions neither remount the view nor go stale.
  const callbacks = useRef({ onClipboardError, onMount });
  callbacks.current = { onClipboardError, onMount };
  // Options applied when the view mounts; later changes go through the effects below.
  const initial = useRef({ theme, background, debug, pixelRatio });
  initial.current = { theme, background, debug, pixelRatio };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || board.disposed) return;

    const unregisterBridge = registerPortalBridge(host, board, bridge);

    // Ensure elements from `elements` prop are registered or intercepted
    for (const [type, Component] of Object.entries(elementsRef.current ?? {})) {
      if (!board.elements.has(type)) {
        try {
          board.elements.register(
            defineReactElement({
              type,
              component: Component,
            }),
          );
        } catch {
          // Ignore if already registered
        }
      }
    }

    const origGet = board.elements.get.bind(board.elements);
    const origHas = board.elements.has.bind(board.elements);

    board.elements.get = (type: string) => {
      const existing = origGet(type);
      const reactComp = bridge.getComponent(type);
      if (!reactComp) return existing;

      if (existing) {
        return {
          ...existing,
          render: {
            ...existing.render,
            html: (elHost: ElementHtmlHost, el: any, data: any, _ctx: ElementContext) => {
              return bridge.mount(elHost as HTMLElement, el, data, reactComp);
            },
          },
        };
      }

      return {
        type,
        version: 1,
        props: object({}),
        defaults: {},
        geometry: (el: any) => rect(el.w, el.h),
        render: {
          html: (elHost: ElementHtmlHost, el: any, data: any, _ctx: ElementContext) => {
            return bridge.mount(elHost as HTMLElement, el, data, reactComp);
          },
        },
      } as any;
    };

    board.elements.has = (type: string) => {
      if (bridge.getComponent(type)) return true;
      return origHas(type);
    };

    const options = initial.current;
    const view = mountRenderer(board, host, {
      theme: options.theme,
      background: options.background,
      debug: options.debug,
      pixelRatio: options.pixelRatio,
      onClipboardError: (error) => callbacks.current.onClipboardError?.(error),
    });
    viewRef.current = view;
    const cleanup = callbacks.current.onMount?.(view);

    return () => {
      board.elements.get = origGet;
      board.elements.has = origHas;
      unregisterBridge();
      if (typeof cleanup === 'function') cleanup();
      viewRef.current = null;
      view.unmount();
    };
  }, [board, bridge]);

  useEffect(() => {
    if (theme !== undefined && !board.disposed) board.setTheme(theme);
  }, [board, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (view?.mounted) view.background = background ?? 'dots';
  }, [board, background]);

  useEffect(() => {
    const view = viewRef.current;
    if (view?.mounted) view.debug = Boolean(debug);
  }, [board, debug]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    >
      {portals.map((entry) =>
        createPortal(
          <PortalItem key={entry.id} entry={entry} />,
          entry.host,
          entry.id,
        ),
      )}
    </div>
  );
}
