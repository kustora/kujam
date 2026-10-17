/**
 * `@kujam/react` — Thin `<Board>` component adapter and hooks for React.
 *
 * @packageDocumentation
 */

import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import type { Board as CoreBoard } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';

/**
 * Props for the React `<Board>` component.
 *
 * @public
 */
export interface BoardProps {
  board: CoreBoard;
  className?: string;
  style?: CSSProperties;
}

/**
 * React `<Board>` component that mounts `@kujam/renderer` into a container element.
 *
 * @public
 */
export function Board({ board, className, style }: BoardProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const view = mountRenderer(board, el);
    return () => {
      view.unmount();
    };
  }, [board]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    />
  );
}
