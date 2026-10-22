/**
 * Elements created from a pasted URL through plugin `onPasteUrl` hooks (BOARD-1209).
 *
 * Core never fetches the URL. A plugin turns it into an element (for example a link card) whose
 * `resolve` asks a host resolver for preview metadata, so the element appears immediately in its
 * loading state and fills in once the host's lookup finishes (BOARD-604).
 *
 * @packageDocumentation
 */

import type { ElementInput } from '../document/mutate.js';
import type { Point } from '../geometry/geometry.js';
import type { Board } from '../index.js';
import type { ElementRecord } from '../types.js';
import { isSafeUrl } from '../utils/url.js';

/** URL schemes passed to `onPasteUrl` hooks. */
const PASTE_URL_SCHEMES: readonly string[] = ['https:', 'http:'];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isThenable(value: unknown): boolean {
  return isPlainObject(value) && typeof value.then === 'function';
}

/**
 * Whether `text` is a single `http:` or `https:` URL that `onPasteUrl` hooks receive
 * (BOARD-1209). `javascript:` and other schemes are always rejected.
 *
 * @beta
 */
export function isPastableUrl(text: string): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return trimmed !== '' && !/\s/.test(trimmed) && isSafeUrl(trimmed, PASTE_URL_SCHEMES);
}

/**
 * Asks the installed plugins' `onPasteUrl` hooks, in installation order, for an element for
 * `url`, and creates the first one returned at `point` as one undo step labelled
 * `'clipboard.paste-url'` (BOARD-1209). The element is centered on `point` unless the hook sets
 * `x`/`y`. Neither the new element nor the selection changes when the board is read-only, `url`
 * is not a pastable `http:`/`https:` URL, or no hook claims it.
 *
 * Hooks are isolated: a hook that throws, returns a promise, or returns something that is not an
 * element input is reported as a `plugin-error` event and the next plugin is asked. When the
 * winning element is rejected on creation (props, permissions, limits), the usual `error` event
 * is emitted and `undefined` is returned without asking further plugins.
 *
 * @returns The created element, or `undefined` when no element was created.
 * @beta
 */
export function createElementFromUrl(
  board: Board,
  url: string,
  point: Point,
): Readonly<ElementRecord> | undefined {
  if (board.disposed || board.readOnly || !isPastableUrl(url)) return undefined;
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return undefined;
  const trimmed = url.trim();
  const at = Object.freeze({ x: point.x, y: point.y });

  for (const plugin of board.plugins.list()) {
    const hook = plugin.onPasteUrl;
    if (typeof hook !== 'function') continue;
    let input: unknown;
    try {
      input = hook(trimmed, at, board);
    } catch (error) {
      board.reportError(
        'plugin-error',
        `Hook onPasteUrl plugin "${plugin.id}" melempar error: ${messageOf(error)}`,
        error,
      );
      continue;
    }
    if (input === null || input === undefined) continue;
    if (isThenable(input)) {
      board.reportError(
        'plugin-error',
        `Hook onPasteUrl plugin "${plugin.id}" wajib sinkron; isi metadata lewat resolver elemen.`,
        input,
      );
      continue;
    }
    if (!isPlainObject(input) || typeof input.type !== 'string' || input.type === '') {
      board.reportError(
        'plugin-error',
        `Hook onPasteUrl plugin "${plugin.id}" wajib mengembalikan ElementInput dengan type, null, atau undefined.`,
        input,
      );
      continue;
    }

    const element = input as unknown as ElementInput;
    const w = typeof element.w === 'number' && Number.isFinite(element.w) ? element.w : 0;
    const h = typeof element.h === 'number' && Number.isFinite(element.h) ? element.h : 0;
    return board.create(
      {
        ...element,
        x: element.x ?? at.x - w / 2,
        y: element.y ?? at.y - h / 2,
      } as Parameters<Board['create']>[0],
      { label: 'clipboard.paste-url' },
    );
  }
  return undefined;
}
