/**
 * React `<Board>` component (BOARD-1302).
 */

import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import type { Board as CoreBoard, ThemeDefinition, ThemeMode } from '@kujam/core';
import { mountRenderer, type BoardBackground, type BoardView } from '@kujam/renderer';

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
}

/**
 * Mounts `@kujam/renderer` for `board` and unmounts it on unmount (BOARD-1302).
 *
 * Safe under React 18 and 19 StrictMode: the double mount in development creates the view,
 * removes it, and creates it again, leaving one view. The component fills its parent, so give the
 * parent a size.
 *
 * @example
 * ```tsx
 * const board = useMemo(() => createBoard({ plugins: [defaultElements, defaultTools] }), []);
 * return <Board board={board} theme="light" style={{ height: 600 }} />;
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
}: BoardProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<BoardView | null>(null);

  // Callbacks are read through refs, so inline functions neither remount the view nor go stale.
  const callbacks = useRef({ onClipboardError, onMount });
  callbacks.current = { onClipboardError, onMount };
  // Options applied when the view mounts; later changes go through the effects below.
  const initial = useRef({ theme, background, debug, pixelRatio });
  initial.current = { theme, background, debug, pixelRatio };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || board.disposed) return;
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
      if (typeof cleanup === 'function') cleanup();
      viewRef.current = null;
      view.unmount();
    };
  }, [board]);

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
    />
  );
}
