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
  insertContent,
  parseClipboard,
  serializeClipboard,
  type Board,
  type BoardDocument,
  type Point,
} from '@kujam/core';

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
  const win = root.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  /** Last pointer position over the view, in client coordinates; `null` when outside. */
  let pointer: { clientX: number; clientY: number } | null = null;

  function handles(e: ClipboardEvent): boolean {
    return !!win && !!e.clipboardData && !isTextInput(e.target);
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
    // Not board content: leave it to other handlers (system paste, BOARD-907).
    if (!content) return;
    e.preventDefault();
    try {
      const result = insertContent(board, content, { at: pasteTarget() });
      board.select(result.rootIds);
    } catch (error) {
      options.onError?.(error);
    }
  }

  function onPointerMove(e: PointerEvent): void {
    pointer = { clientX: e.clientX, clientY: e.clientY };
  }

  function onPointerLeave(): void {
    pointer = null;
  }

  root.addEventListener('copy', onCopy);
  root.addEventListener('cut', onCut);
  root.addEventListener('paste', onPaste);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', onPointerLeave);

  return () => {
    root.removeEventListener('copy', onCopy);
    root.removeEventListener('cut', onCut);
    root.removeEventListener('paste', onPaste);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerleave', onPointerLeave);
  };
}
