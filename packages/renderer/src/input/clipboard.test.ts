// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIPBOARD_MIME_TYPE,
  ContentError,
  createBoard,
  defineElement,
  definePlugin,
  object,
  rect,
  string,
  type Board,
  type ElementRecord,
} from '@kujam/core';
import { mountRenderer, type BoardView } from '../index.js';
import { clipboardHtml, readClipboardContent } from './clipboard.js';
import { drawUnknownPlaceholder } from '../layers/render-canvas.js';

const note = defineElement({
  type: 'note',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  geometry: (el) => rect(el.w, el.h),
  export: { text: (el) => el.props.text },
});
const notes = definePlugin({ id: 'notes', elements: [note] });

/** Minimal `DataTransfer` stand-in. */
class FakeDataTransfer {
  readonly store = new Map<string, string>();
  setData(type: string, value: string): void {
    this.store.set(type, value);
  }
  getData(type: string): string {
    return this.store.get(type) ?? '';
  }
}

function clipboardEvent(type: 'copy' | 'cut' | 'paste', data = new FakeDataTransfer()) {
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: data });
  return { event, data };
}

let boards: Board[] = [];
let views: BoardView[] = [];

beforeEach(() => {
  Object.assign(window, {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    devicePixelRatio: 1,
  });
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  for (const view of views) view.unmount();
  for (const board of boards) board.dispose();
  views = [];
  boards = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setup(options: Parameters<typeof createBoard>[0] = {}, onError?: (e: unknown) => void) {
  const board = createBoard({ plugins: [notes], ...options });
  boards.push(board);
  const container = document.body.appendChild(document.createElement('div'));
  const view = mountRenderer(board, container, { onClipboardError: onError });
  views.push(view);
  board.camera.setViewport({ width: 800, height: 600 });
  vi.spyOn(view.layers.root, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 50,
    right: 900,
    bottom: 650,
    width: 800,
    height: 600,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  });
  return { board, view, root: view.layers.root };
}

function addNote(board: Board, text: string, x = 0, y = 0) {
  return board.create({ type: 'note', x, y, w: 100, h: 50, props: { text } })!;
}

function copyFrom(board: Board, root: HTMLElement, ids: string[]) {
  board.select(ids);
  const { event, data } = clipboardEvent('copy');
  root.dispatchEvent(event);
  return { event, data };
}

describe('BOARD-906: copy', () => {
  it('writes board JSON, an HTML fallback, and plain text from export.text', () => {
    const { board, root } = setup();
    const a = addNote(board, 'Halo');
    const b = addNote(board, 'Dunia', 0, 100);

    const { event, data } = copyFrom(board, root, [b.id, a.id]);
    expect(event.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('Halo\nDunia');
    expect(JSON.parse(data.getData(CLIPBOARD_MIME_TYPE))).toMatchObject({
      kind: 'kujam/clipboard',
    });
    expect(data.getData('text/html')).toContain('data-kujam-clipboard="');
    expect(data.getData('text/html')).toContain('Halo<br>Dunia');
  });

  it('falls back to the board JSON as plain text when elements have no text', () => {
    const { board, root } = setup();
    const a = addNote(board, '');
    const { data } = copyFrom(board, root, [a.id]);
    expect(data.getData('text/plain')).toBe(data.getData(CLIPBOARD_MIME_TYPE));
  });

  it('leaves the event alone with nothing selected or inside a text input', () => {
    const { board, root } = setup();
    const a = addNote(board, 'x');

    const empty = clipboardEvent('copy');
    root.dispatchEvent(empty.event);
    expect(empty.event.defaultPrevented).toBe(false);

    board.select([a.id]);
    const editor = root.appendChild(document.createElement('div'));
    editor.contentEditable = 'true';
    const fromEditor = clipboardEvent('copy');
    editor.dispatchEvent(fromEditor.event);
    expect(fromEditor.event.defaultPrevented).toBe(false);
    expect(fromEditor.data.store.size).toBe(0);
  });
});

describe('BOARD-906: cut', () => {
  it('copies and deletes the unlocked selection as one undo step', () => {
    const { board, root } = setup();
    const a = addNote(board, 'a');
    const locked = addNote(board, 'locked', 200);
    board.update(locked.id, { locked: true });
    board.select([a.id, locked.id]);

    const { event, data } = clipboardEvent('cut');
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('a\nlocked');
    expect(board.getElement(a.id)).toBeUndefined();
    expect(board.getElement(locked.id)).toBeDefined();

    board.undo();
    expect(board.getElement(a.id)).toBeDefined();
  });

  it('does nothing on a read-only board', () => {
    const { board, root } = setup({ readOnly: true });
    const { event } = clipboardEvent('cut');
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(board.query()).toHaveLength(0);
  });
});

describe('BOARD-906: paste', () => {
  function pasteInto(root: HTMLElement, data: FakeDataTransfer) {
    const { event } = clipboardEvent('paste', data);
    root.dispatchEvent(event);
    return event;
  }

  it('pastes into another board with new IDs at the viewport center and selects it', () => {
    const source = setup();
    const a = addNote(source.board, 'a', 0, 0);
    const { data } = copyFrom(source.board, source.root, [a.id]);

    const target = setup();
    const event = pasteInto(target.root, data);
    expect(event.defaultPrevented).toBe(true);

    const [pasted] = target.board.query() as ElementRecord[];
    expect(pasted!.id).not.toBe(a.id);
    expect(target.board.selection).toEqual([pasted!.id]);
    const center = target.board.camera.screenToBoard({ x: 400, y: 300 });
    expect(pasted!.x + pasted!.w / 2).toBeCloseTo(center.x);
    expect(pasted!.y + pasted!.h / 2).toBeCloseTo(center.y);
  });

  it('pastes at the cursor when it is over the view', () => {
    const { board, root } = setup();
    const a = addNote(board, 'a');
    const { data } = copyFrom(board, root, [a.id]);

    root.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 300, clientY: 250 }));
    pasteInto(root, data);
    const pasted = board.getElement(board.selection[0]!)!;
    const cursor = board.camera.screenToBoard({ x: 200, y: 200 });
    expect(pasted.x + pasted.w / 2).toBeCloseTo(cursor.x);
    expect(pasted.y + pasted.h / 2).toBeCloseTo(cursor.y);

    // After the pointer leaves, paste goes back to the viewport center.
    root.dispatchEvent(new window.PointerEvent('pointerleave'));
    pasteInto(root, data);
    const second = board.getElement(board.selection[0]!)!;
    expect(second.x + second.w / 2).toBeCloseTo(board.camera.screenToBoard({ x: 400, y: 300 }).x);
  });

  it('reads the HTML fallback and the plain-text fallback', () => {
    const source = setup();
    const a = addNote(source.board, 'a');
    const { data } = copyFrom(source.board, source.root, [a.id]);
    const json = data.getData(CLIPBOARD_MIME_TYPE);

    const htmlOnly = new FakeDataTransfer();
    htmlOnly.setData('text/html', clipboardHtml(window as never, json, 'a'));
    const viaHtml = setup();
    pasteInto(viaHtml.root, htmlOnly);
    expect(viaHtml.board.query()).toHaveLength(1);

    const textOnly = new FakeDataTransfer();
    textOnly.setData('text/plain', json);
    const viaText = setup();
    pasteInto(viaText.root, textOnly);
    expect(viaText.board.query()).toHaveLength(1);
  });

  it('keeps non-ASCII text intact through the HTML fallback', () => {
    const json = JSON.stringify({
      kind: 'kujam/clipboard',
      version: 1,
      document: { x: 'Ide ✨ ñ 漢字' },
    });
    const data = new FakeDataTransfer();
    data.setData('text/html', clipboardHtml(window as never, json, ''));
    expect(readClipboardContent(window as never, data)).toEqual({ x: 'Ide ✨ ñ 漢字' });
  });

  it('ignores clipboard data that is not board content', () => {
    const { board, root } = setup();
    const data = new FakeDataTransfer();
    data.setData('text/plain', 'just text');
    data.setData('text/html', '<b>bold</b>');
    const event = pasteInto(root, data);
    expect(event.defaultPrevented).toBe(false);
    expect(board.query()).toHaveLength(0);
  });

  it('reports rejected content and leaves the board unchanged', () => {
    const source = setup();
    const a = addNote(source.board, 'a');
    const { data } = copyFrom(source.board, source.root, [a.id]);

    const onError = vi.fn();
    const target = setup({ permissions: (action) => action !== 'create' }, onError);
    const event = pasteInto(target.root, data);
    expect(event.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.any(ContentError));
    expect(target.board.query()).toHaveLength(0);
  });

  it('stops listening after unmount', () => {
    const { board, root, view } = setup();
    const a = addNote(board, 'a');
    board.select([a.id]);
    view.unmount();
    const { event } = clipboardEvent('copy');
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('BOARD-906: focus', () => {
  it('focuses the view on pointer down so clipboard and keyboard events reach it', () => {
    const { root, view } = setup();
    expect(document.activeElement).not.toBe(root);
    view.layers.canvas.dispatchEvent(
      new window.PointerEvent('pointerdown', { pointerId: 1, clientX: 150, clientY: 80 }),
    );
    expect(document.activeElement).toBe(root);
  });
});

describe('BOARD-209: placeholder for unregistered types', () => {
  it('draws a grey box labelled with the type name', () => {
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn(),
    };
    const el = { type: 'plugin-card', w: 200, h: 120 } as ElementRecord;
    drawUnknownPlaceholder(ctx as never, el, 'Inter', 2);

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 120);
    expect(ctx.strokeRect).toHaveBeenCalledWith(0, 0, 200, 120);
    expect(ctx.fillText).toHaveBeenCalledWith('plugin-card', 3, 3, 194);
    expect(ctx.font).toBe('6px Inter');
  });

  it('skips the label when the box is too small for it', () => {
    const ctx = {
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn(),
    };
    drawUnknownPlaceholder(ctx as never, { type: 'x', w: 10, h: 10 } as ElementRecord, 'Inter', 1);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
