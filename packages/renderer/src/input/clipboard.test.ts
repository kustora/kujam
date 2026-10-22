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
import { mountRenderer, type BoardView, type RendererOptions } from '../index.js';
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
const sticky = defineElement({
  type: 'sticky',
  version: 1,
  props: object({ text: string(), color: string() }),
  defaults: { text: '', color: 'yellow' },
  geometry: (el) => rect(el.w, el.h),
});
const text = defineElement({
  type: 'text',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
  geometry: (el) => rect(el.w, el.h),
});
const testPlugin = definePlugin({ id: 'test-plugin', elements: [note, sticky, text] });

/** Minimal `DataTransfer` stand-in. */
class FakeDataTransfer {
  readonly store = new Map<string, string>();
  files: readonly File[] = [];
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
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(
  options: Parameters<typeof createBoard>[0] = {},
  rendererOptsOrOnError?: ((e: unknown) => void) | Partial<RendererOptions>,
) {
  const board = createBoard({ plugins: [testPlugin], ...options });
  boards.push(board);
  const container = document.body.appendChild(document.createElement('div'));
  const rendererOptions: Partial<RendererOptions> =
    typeof rendererOptsOrOnError === 'function'
      ? { onClipboardError: rendererOptsOrOnError }
      : (rendererOptsOrOnError ?? {});
  const view = mountRenderer(board, container, rendererOptions);
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

  it('ignores clipboard data that has empty or whitespace-only text', () => {
    const { board, root } = setup();
    const data = new FakeDataTransfer();
    data.setData('text/plain', '   \t  \n  ');
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

  it('pastes image files from clipboard at the viewport center', () => {
    const { board, root } = setup();
    const file = new File(['png-data'], 'screenshot.png', { type: 'image/png' });
    const data = new FakeDataTransfer();
    data.files = [file];

    const event = pasteInto(root, data);
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    const imgEl = elements[0]!;
    expect(imgEl.type).toBe('image');
    expect((imgEl.props as { alt: string }).alt).toBe('screenshot');
    expect(board.selection).toEqual([imgEl.id]);

    const center = board.camera.screenToBoard({ x: 400, y: 300 });
    expect(imgEl.x).toBeCloseTo(center.x);
    expect(imgEl.y).toBeCloseTo(center.y);

    const assetId = (imgEl.props as { assetId: string }).assetId;
    const asset = board.getAsset(assetId);
    expect(asset).toBeDefined();
    expect(asset?.mimeType).toBe('image/png');
  });

  it('pastes image files from clipboard at the cursor position', () => {
    const { board, root } = setup();
    const file = new File(['png-data'], 'capture.png', { type: 'image/png' });
    const data = new FakeDataTransfer();
    data.files = [file];

    root.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 300, clientY: 250 }));
    const event = pasteInto(root, data);
    expect(event.defaultPrevented).toBe(true);

    const [imgEl] = board.query() as ElementRecord[];
    expect(imgEl).toBeDefined();
    const cursor = board.camera.screenToBoard({ x: 200, y: 200 });
    expect(imgEl!.x).toBeCloseTo(cursor.x);
    expect(imgEl!.y).toBeCloseTo(cursor.y);
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

describe('BOARD-907: system plain text and URL paste', () => {
  function pasteText(root: HTMLElement, text: string) {
    const data = new FakeDataTransfer();
    data.setData('text/plain', text);
    const { event } = clipboardEvent('paste', data);
    root.dispatchEvent(event);
    return event;
  }

  it('pastes short single-line text as a sticky element at viewport center', () => {
    const { board, root } = setup();
    const event = pasteText(root, 'Catatan Singkat');
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    const stickyEl = elements[0]!;
    expect(stickyEl.type).toBe('sticky');
    expect(stickyEl.w).toBe(200);
    expect(stickyEl.h).toBe(200);
    expect((stickyEl.props as Record<string, unknown>).text).toBe('Catatan Singkat');
    expect((stickyEl.props as Record<string, unknown>).color).toBe('yellow');
    expect(board.selection).toEqual([stickyEl.id]);

    const center = board.camera.screenToBoard({ x: 400, y: 300 });
    expect(stickyEl.x).toBeCloseTo(center.x);
    expect(stickyEl.y).toBeCloseTo(center.y);
  });

  it('pastes short single-line text as a sticky element at cursor position', () => {
    const { board, root } = setup();
    root.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 300, clientY: 250 }));
    const event = pasteText(root, 'Catatan Kursor');
    expect(event.defaultPrevented).toBe(true);

    const [stickyEl] = board.query() as ElementRecord[];
    expect(stickyEl).toBeDefined();
    expect(stickyEl!.type).toBe('sticky');
    const cursor = board.camera.screenToBoard({ x: 200, y: 200 });
    expect(stickyEl!.x).toBeCloseTo(cursor.x);
    expect(stickyEl!.y).toBeCloseTo(cursor.y);
  });

  it('pastes multi-line text as a text element', () => {
    const { board, root } = setup();
    const event = pasteText(root, 'Baris 1\nBaris 2');
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    const textEl = elements[0]!;
    expect(textEl.type).toBe('text');
    expect(textEl.w).toBe(280);
    expect(textEl.h).toBe(100);
    expect((textEl.props as Record<string, unknown>).text).toBe('Baris 1\nBaris 2');
    expect(board.selection).toEqual([textEl.id]);
  });

  it('pastes long single-line text (> threshold 120) as a text element', () => {
    const { board, root } = setup();
    const longText = 'a'.repeat(121);
    const event = pasteText(root, longText);
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    const textEl = elements[0]!;
    expect(textEl.type).toBe('text');
    expect(textEl.w).toBe(280);
    expect(textEl.h).toBe(100);
    expect((textEl.props as Record<string, unknown>).text).toBe(longText);
    expect(board.selection).toEqual([textEl.id]);
  });

  it('respects custom shortTextThreshold option', () => {
    const { board, root } = setup({}, { shortTextThreshold: 50 });

    // 60 chars is above custom threshold 50 -> text element
    const text60 = 'a'.repeat(60);
    pasteText(root, text60);
    let elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe('text');

    board.delete([elements[0]!.id]);

    // 40 chars is within custom threshold 50 -> sticky element
    const text40 = 'b'.repeat(40);
    pasteText(root, text40);
    elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe('sticky');
  });

  it('invokes onPasteUrl and prevents default when a safe URL is pasted', () => {
    const onPasteUrl = vi.fn().mockReturnValue(true);
    const { board, root } = setup({}, { onPasteUrl });

    const event = pasteText(root, 'https://example.com/app?board=123');
    expect(event.defaultPrevented).toBe(true);
    expect(onPasteUrl).toHaveBeenCalledWith(
      'https://example.com/app?board=123',
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      board,
    );
    expect(board.query()).toHaveLength(0);
  });

  it('falls back to creating a text element when onPasteUrl is not provided', () => {
    const { board, root } = setup();
    const event = pasteText(root, 'https://example.com/demo');
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    const textEl = elements[0]!;
    expect(textEl.type).toBe('text');
    expect(textEl.w).toBe(280);
    expect(textEl.h).toBe(100);
    expect((textEl.props as Record<string, unknown>).text).toBe('https://example.com/demo');
    expect(board.selection).toEqual([textEl.id]);
  });

  it('falls back to creating a text element when onPasteUrl returns false', () => {
    const onPasteUrl = vi.fn().mockReturnValue(false);
    const { board, root } = setup({}, { onPasteUrl });

    const event = pasteText(root, 'http://example.com');
    expect(event.defaultPrevented).toBe(true);
    expect(onPasteUrl).toHaveBeenCalled();

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe('text');
    expect((elements[0]!.props as Record<string, unknown>).text).toBe('http://example.com');
  });

  it('supports async onPasteUrl hook returning Promise<boolean>', async () => {
    const onPasteUrl = vi.fn().mockResolvedValue(false);
    const { board, root } = setup({}, { onPasteUrl });

    pasteText(root, 'https://async-fallback.example.com');
    await Promise.resolve();

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe('text');
    expect((elements[0]!.props as Record<string, unknown>).text).toBe(
      'https://async-fallback.example.com',
    );
  });

  it('does not insert fallback text element when async onPasteUrl resolves to true', async () => {
    const onPasteUrl = vi.fn().mockResolvedValue(true);
    const { board, root } = setup({}, { onPasteUrl });

    pasteText(root, 'https://async-handled.example.com');
    await Promise.resolve();

    expect(board.query()).toHaveLength(0);
  });

  it('ignores text and URL paste on a read-only board without preventing default', () => {
    const onPasteUrl = vi.fn();
    const { board, root } = setup({ readOnly: true }, { onPasteUrl });

    const textEvent = pasteText(root, 'Hello plain text');
    expect(textEvent.defaultPrevented).toBe(false);
    expect(board.query()).toHaveLength(0);

    const urlEvent = pasteText(root, 'https://example.com');
    expect(urlEvent.defaultPrevented).toBe(false);
    expect(onPasteUrl).not.toHaveBeenCalled();
    expect(board.query()).toHaveLength(0);
  });

  it('wraps text paste in a single undo step', () => {
    const { board, root } = setup();
    pasteText(root, 'Undoable sticky note');
    expect(board.query()).toHaveLength(1);

    board.undo();
    expect(board.query()).toHaveLength(0);

    board.redo();
    expect(board.query()).toHaveLength(1);
  });
});


describe('BOARD-1209: pasted URLs through plugin onPasteUrl hooks', () => {
  function pasteText(root: HTMLElement, value: string) {
    const data = new FakeDataTransfer();
    data.setData('text/plain', value);
    const { event } = clipboardEvent('paste', data);
    root.dispatchEvent(event);
    return event;
  }

  const linkCard = defineElement({
    type: 'link-card',
    version: 1,
    props: object({ url: string() }),
    defaults: { url: '' },
    geometry: (el) => rect(el.w, el.h),
  });
  const linkPlugin = definePlugin({
    id: 'link-card',
    elements: [linkCard],
    onPasteUrl: (url) => ({ type: 'link-card', w: 240, h: 120, props: { url } }),
  });

  it('creates and selects the element returned by a plugin hook at the paste point', () => {
    const { board, root } = setup({ plugins: [testPlugin, linkPlugin] });
    const event = pasteText(root, 'https://example.com/item');
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe('link-card');
    expect(elements[0]!.props).toEqual({ url: 'https://example.com/item' });
    expect(board.selection).toEqual([elements[0]!.id]);

    board.undo();
    expect(board.query()).toHaveLength(0);
  });

  it('runs plugin hooks after the renderer onPasteUrl option returns false', async () => {
    const onPasteUrl = vi.fn().mockResolvedValue(false);
    const { board, root } = setup({ plugins: [testPlugin, linkPlugin] }, { onPasteUrl });
    pasteText(root, 'https://example.com/a');
    await Promise.resolve();
    expect((board.query() as ElementRecord[]).map((el) => el.type)).toEqual(['link-card']);
  });

  it('falls back to text when the plugin hook throws, reporting plugin-error', () => {
    const throwing = definePlugin({
      id: 'throwing',
      onPasteUrl: () => {
        throw new Error('boom');
      },
    });
    const { board, root } = setup({ plugins: [testPlugin, throwing] });
    const errors: string[] = [];
    board.on('error', (e) => errors.push(e.code));
    expect(() => pasteText(root, 'https://example.com')).not.toThrow();
    expect((board.query() as ElementRecord[]).map((el) => el.type)).toEqual(['text']);
    expect(errors).toEqual(['plugin-error']);
  });

  it('never passes javascript: URLs to plugin hooks', () => {
    const hook = vi.fn(() => null);
    const spy = definePlugin({ id: 'spy', onPasteUrl: hook });
    const { root } = setup({ plugins: [testPlugin, spy] });
    pasteText(root, 'javascript:alert(1)');
    expect(hook).not.toHaveBeenCalled();
  });
});
