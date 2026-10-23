/**
 * System clipboard for copy, cut, and paste of board content (BOARD-906).
 *
 * Listens to the native `copy`, `cut`, and `paste` events on the view root, so Ctrl/Cmd+C, X, V
 * and the browser menu work without extra permissions, between tabs, and between boards. Events
 * from text inputs and the inline text editor are left to the browser.
 *
 * Copy writes three formats:
 *
 * - {@link CLIPBOARD_MIME_TYPE}: the board JSON (same browser, including other tabs);
 * - `text/html`: the plain text, with the board JSON in a data attribute, as fallback where custom
 *   types do not cross (other origins in Safari, other browsers);
 * - `text/plain`: the elements' `export.text`, or the board JSON when they have no text.
 *
 * Paste reads them in that order and places the content at the cursor when it is over the view,
 * otherwise at the viewport center.
 */

import {
  CLIPBOARD_MIME_TYPE,
  createElementFromUrl,
  insertContent,
  isSafeUrl,
  parseClipboard,
  serializeClipboard,
  type Board,
  type BoardDocument,
  type ElementRecord,
  type Point,
} from '@kujam/core';
import { insertImageFiles, isImageFile } from './drag-drop.js';

/** Data attribute carrying the board JSON in the `text/html` fallback. */
const HTML_ATTRIBUTE = 'data-kujam-clipboard';
const HTML_PATTERN = new RegExp(`${HTML_ATTRIBUTE}="([A-Za-z0-9+/=]*)"`);

/**
 * Options for {@link attachClipboard}.
 *
 * @internal
 */
export interface ClipboardOptions {
  /** Called when pasted board content is rejected (read-only, limits, permission, invalid). */
  readonly onError?: (error: unknown) => void;
  /**
   * Maximum character length for short plain text to become a sticky note (BOARD-907).
   * Defaults to 120.
   */
  readonly shortTextThreshold?: number;
  /**
   * Hook called when a URL is pasted (BOARD-907). When returning `true`, the URL is treated as handled.
   * Runs before the plugins' `onPasteUrl` hooks (BOARD-1209), which run when it returns `false`.
   */
  readonly onPasteUrl?: (url: string, point: Point, board: Board) => boolean | Promise<boolean>;
}

function isTextInput(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function toBase64(win: Window & typeof globalThis, text: string): string {
  const bytes = new win.TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return win.btoa(binary);
}

function fromBase64(win: Window & typeof globalThis, data: string): string | null {
  try {
    const binary = win.atob(data);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new win.TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Builds the `text/html` fallback: the plain text for rich-text targets, plus the board JSON.
 *
 * @internal
 */
export function clipboardHtml(win: Window & typeof globalThis, json: string, text: string): string {
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  return `<div ${HTML_ATTRIBUTE}="${toBase64(win, json)}">${body}</div>`;
}

/**
 * Reads board content from clipboard data, trying the custom type, the HTML fallback, then text.
 * Returns `null` when the clipboard holds no board content.
 *
 * @internal
 */
export function readClipboardContent(
  win: Window & typeof globalThis,
  data: Pick<DataTransfer, 'getData'>,
): BoardDocument | null {
  const custom = parseClipboard(data.getData(CLIPBOARD_MIME_TYPE));
  if (custom) return custom;
  const match = HTML_PATTERN.exec(data.getData('text/html'));
  if (match) {
    const json = fromBase64(win, match[1]!);
    const fromHtml = json === null ? null : parseClipboard(json);
    if (fromHtml) return fromHtml;
  }
  return parseClipboard(data.getData('text/plain'));
}

/**
 * Attaches copy, cut, and paste handling to the view root (BOARD-906).
 *
 * @returns Detach callback.
 * @internal
 */
export function attachClipboard(
  board: Board,
  root: HTMLElement,
  options: ClipboardOptions = {},
): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  /** Last pointer position over the view, in client coordinates; `null` when outside. */
  let pointer: { clientX: number; clientY: number } | null = null;

  /**
   * Whether a clipboard event is meant for this view. Browsers fire `copy`, `cut`, and `paste` at
   * the element holding the text selection, or at the body when nothing is selected, even while
   * focus is inside the board. So the listeners sit on the document and take events aimed inside
   * the view, or aimed at the body while this view has focus (several views on a page each own
   * only their focused one).
   */
  function forThisView(e: ClipboardEvent): boolean {
    const target = e.target as Node | null;
    if (target && root.contains(target)) return true;
    const aimedAtPage = target === doc.body || target === doc.documentElement || target === doc;
    return aimedAtPage && root.contains(doc.activeElement);
  }

  function handles(e: ClipboardEvent): boolean {
    return !!win && !!e.clipboardData && forThisView(e) && !isTextInput(e.target);
  }

  function write(e: ClipboardEvent): boolean {
    const payload = serializeClipboard(board);
    if (!payload || !win) return false;
    const data = e.clipboardData!;
    data.setData(CLIPBOARD_MIME_TYPE, payload.json);
    data.setData('text/html', clipboardHtml(win, payload.json, payload.text));
    data.setData('text/plain', payload.text || payload.json);
    e.preventDefault();
    return true;
  }

  function pasteTarget(): Point {
    const { width, height } = board.camera.viewport;
    if (pointer && typeof root.getBoundingClientRect === 'function') {
      const rect = root.getBoundingClientRect();
      const screen = { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top };
      if (screen.x >= 0 && screen.y >= 0 && screen.x <= width && screen.y <= height) {
        return board.camera.screenToBoard(screen);
      }
    }
    return board.camera.screenToBoard({ x: width / 2, y: height / 2 });
  }

  function onCopy(e: ClipboardEvent): void {
    if (handles(e)) write(e);
  }

  function onCut(e: ClipboardEvent): void {
    if (!handles(e) || board.readOnly) return;
    if (!write(e)) return;
    // Same rule as `element.delete`, without requiring the default commands plugin.
    const ids = board.selection.filter((id) => board.getElement(id)?.locked === false);
    board.delete(ids, { label: 'clipboard.cut' });
  }

  function onPaste(e: ClipboardEvent): void {
    if (!handles(e)) return;
    const content = readClipboardContent(win!, e.clipboardData!);
    if (content) {
      e.preventDefault();
      try {
        const result = insertContent(board, content, { at: pasteTarget() });
        board.select(result.rootIds);
      } catch (error) {
        options.onError?.(error);
      }
      return;
    }

    const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : [];
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length > 0) {
      e.preventDefault();
      insertImageFiles(board, imageFiles, pasteTarget()).catch((error) => {
        options.onError?.(error);
      });
      return;
    }

    const text = e.clipboardData?.getData('text/plain');
    if (!text || text.trim() === '' || board.readOnly) {
      return;
    }

    e.preventDefault();
    const target = pasteTarget();
    const trimmed = text.trim();

    function insertElement(params: {
      type: string;
      w: number;
      h: number;
      props: Record<string, unknown>;
    }): void {
      try {
        let newEl: ElementRecord | undefined;
        board.history.batch('clipboard.paste', () => {
          newEl = board.create({
            type: params.type,
            x: target.x,
            y: target.y,
            w: params.w,
            h: params.h,
            props: params.props,
          });
        });
        if (newEl) {
          board.select([newEl.id]);
        }
      } catch (error) {
        options.onError?.(error);
      }
    }

    if (isSafeUrl(trimmed, ['https:', 'http:'])) {
      /** Plugin `onPasteUrl` hooks (BOARD-1209), then the URL as plain text. */
      const pasteUrl = (): void => {
        if (board.disposed || board.readOnly) return;
        try {
          const created = createElementFromUrl(board, trimmed, target);
          if (created) {
            board.select([created.id]);
            return;
          }
        } catch (error) {
          options.onError?.(error);
          return;
        }
        insertElement({
          type: 'text',
          w: 280,
          h: 100,
          props: { text: trimmed },
        });
      };
      if (options.onPasteUrl) {
        try {
          const handled = options.onPasteUrl(trimmed, target, board);
          if (handled instanceof Promise) {
            handled
              .then((resolved) => {
                if (!resolved) pasteUrl();
              })
              .catch((error) => {
                options.onError?.(error);
              });
            return;
          }
          if (handled) {
            return;
          }
        } catch (error) {
          options.onError?.(error);
          return;
        }
      }
      pasteUrl();
      return;
    }

    const isMultiLine = trimmed.includes('\n');
    const threshold = options.shortTextThreshold ?? 120;
    const isShort = !isMultiLine && trimmed.length <= threshold;

    if (isShort) {
      insertElement({
        type: 'sticky',
        w: 200,
        h: 200,
        props: { text: trimmed, color: 'yellow' },
      });
    } else {
      insertElement({
        type: 'text',
        w: 280,
        h: 100,
        props: { text: trimmed },
      });
    }
  }

  function onPointerMove(e: PointerEvent): void {
    pointer = { clientX: e.clientX, clientY: e.clientY };
  }

  function onPointerLeave(): void {
    pointer = null;
  }

  doc.addEventListener('copy', onCopy);
  doc.addEventListener('cut', onCut);
  doc.addEventListener('paste', onPaste);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', onPointerLeave);

  return () => {
    doc.removeEventListener('copy', onCopy);
    doc.removeEventListener('cut', onCut);
    doc.removeEventListener('paste', onPaste);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerleave', onPointerLeave);
  };
}
