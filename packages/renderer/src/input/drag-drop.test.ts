// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  type AssetRecord,
  type Board,
  type ElementRecord,
} from '@kujam/core';
import { mountRenderer, type BoardView, type RendererOptions } from '../index.js';
import { isImageFile } from './drag-drop.js';

interface DragEventOptions {
  clientX?: number;
  clientY?: number;
  types?: string[];
  files?: File[];
}

function createDragEvent(type: string, options: DragEventOptions = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  const dataTransfer = {
    types: options.types ?? (options.files && options.files.length > 0 ? ['Files'] : []),
    files: options.files ?? [],
    dropEffect: 'none',
    effectAllowed: 'all',
  };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true });
  Object.defineProperty(event, 'clientX', { value: options.clientX ?? 0, configurable: true });
  Object.defineProperty(event, 'clientY', { value: options.clientY ?? 0, configurable: true });
  return { event, dataTransfer };
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
  boardOptions: Parameters<typeof createBoard>[0] = {},
  rendererOptions: RendererOptions = {},
) {
  const board = createBoard(boardOptions);
  boards.push(board);
  const container = document.body.appendChild(document.createElement('div'));
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

describe('BOARD-908: isImageFile helper', () => {
  it('identifies image files by MIME type or file extension', () => {
    expect(isImageFile(new File([], 'photo.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File([], 'photo.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isImageFile(new File([], 'photo.webp', { type: 'image/webp' }))).toBe(true);
    expect(isImageFile(new File([], 'vector.svg', { type: 'image/svg+xml' }))).toBe(true);
    expect(isImageFile(new File([], 'photo.GIF'))).toBe(true);
    expect(isImageFile(new File([], 'photo.AVIF'))).toBe(true);
    expect(isImageFile(new File([], 'document.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(isImageFile(new File([], 'script.ts', { type: 'text/typescript' }))).toBe(false);
  });
});

describe('BOARD-908: dragover and dragenter', () => {
  it('sets dropEffect = "copy" and prevents default when dragging files', () => {
    const { root } = setup();
    const { event, dataTransfer } = createDragEvent('dragover', { types: ['Files'] });
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
  });

  it('leaves the event alone when dragged types do not contain Files', () => {
    const { root } = setup();
    const { event, dataTransfer } = createDragEvent('dragover', { types: ['text/plain'] });
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
  });

  it('sets dropEffect = "copy" and prevents default on dragenter with files', () => {
    const { root } = setup();
    const { event, dataTransfer } = createDragEvent('dragenter', { types: ['Files'] });
    root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
  });
});

describe('BOARD-908: drop image files', () => {
  it('creates asset record and image element at drop point', async () => {
    const { board, root } = setup();
    const file = new File(['fake-png-data'], 'sample-diagram.png', { type: 'image/png' });
    const { event } = createDragEvent('drop', {
      clientX: 250,
      clientY: 150,
      files: [file],
    });

    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(1);
    const imageEl = elements[0]!;
    expect(imageEl.type).toBe('image');
    // Screen coords: client (250, 150) - rect (100, 50) = (150, 100)
    expect(imageEl.x).toBe(150);
    expect(imageEl.y).toBe(100);
    expect(imageEl.w).toBe(320);
    expect(imageEl.h).toBe(240);

    const props = imageEl.props as {
      assetId: string;
      alt: string;
      crop: unknown;
      uploadStatus: string;
      uploadProgress: number;
    };
    expect(props.alt).toBe('sample-diagram');
    expect(props.crop).toBeNull();
    expect(props.uploadStatus).toBe('ready');
    expect(props.uploadProgress).toBe(0);

    const asset = board.getAsset(props.assetId) as AssetRecord | undefined;
    expect(asset).toBeDefined();
    expect(asset?.mimeType).toBe('image/png');
    expect(asset?.w).toBe(320);
    expect(asset?.h).toBe(240);
    expect((asset?.meta as { filename: string }).filename).toBe('sample-diagram.png');

    expect(board.selection).toEqual([imageEl.id]);
  });

  it('places multiple images side-by-side with 24px gap', async () => {
    const { board, root } = setup();
    const file1 = new File(['1'], 'first.png', { type: 'image/png' });
    const file2 = new File(['2'], 'second.jpg', { type: 'image/jpeg' });
    const file3 = new File(['3'], 'third.webp', { type: 'image/webp' });

    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [file1, file2, file3],
    });

    root.dispatchEvent(event);
    const elements = board.query() as ElementRecord[];
    expect(elements).toHaveLength(3);

    // Initial drop point: (200 - 100, 100 - 50) = (100, 50)
    // Image width: 320, gap: 24
    expect(elements[0]!.x).toBe(100);
    expect(elements[0]!.y).toBe(50);

    expect(elements[1]!.x).toBe(100 + 320 + 24); // 444
    expect(elements[1]!.y).toBe(50);

    expect(elements[2]!.x).toBe(444 + 320 + 24); // 788
    expect(elements[2]!.y).toBe(50);

    expect(board.selection).toEqual([elements[0]!.id, elements[1]!.id, elements[2]!.id]);
  });

  it('rejects drops on a read-only board without mutating the document', () => {
    const { board, root } = setup({ readOnly: true });
    const file = new File(['img'], 'locked.png', { type: 'image/png' });
    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [file],
    });

    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(board.query()).toHaveLength(0);
  });
});

describe('BOARD-908: non-image files handling', () => {
  it('calls onDropRejected with "unsupported-file-type" when acceptDrop is not provided', () => {
    const onDropRejected = vi.fn();
    const { board, root } = setup({}, { onDropRejected });
    const pdfFile = new File(['pdf data'], 'manual.pdf', { type: 'application/pdf' });

    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [pdfFile],
    });

    root.dispatchEvent(event);
    expect(onDropRejected).toHaveBeenCalledWith([pdfFile], 'unsupported-file-type');
    expect(board.query()).toHaveLength(0);
  });

  it('calls acceptDrop for non-image files when provided', async () => {
    const acceptDrop = vi.fn().mockReturnValue(true);
    const onDropRejected = vi.fn();
    const { board, root } = setup({}, { acceptDrop, onDropRejected });
    const pdfFile = new File(['pdf data'], 'manual.pdf', { type: 'application/pdf' });

    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [pdfFile],
    });

    root.dispatchEvent(event);
    expect(acceptDrop).toHaveBeenCalledWith([pdfFile], { x: 100, y: 50 }, board);
    expect(onDropRejected).not.toHaveBeenCalled();
    expect(board.query()).toHaveLength(0);
  });

  it('calls onDropRejected if acceptDrop explicitly returns false', async () => {
    const acceptDrop = vi.fn().mockResolvedValue(false);
    const onDropRejected = vi.fn();
    const { root } = setup({}, { acceptDrop, onDropRejected });
    const file = new File(['archive'], 'bundle.zip', { type: 'application/zip' });

    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [file],
    });

    root.dispatchEvent(event);
    await vi.waitFor(() => {
      expect(onDropRejected).toHaveBeenCalledWith([file], 'unsupported-file-type');
    });
  });

  it('separates image files from non-image files in mixed drops', () => {
    const acceptDrop = vi.fn().mockReturnValue(true);
    const { board, root } = setup({}, { acceptDrop });
    const imgFile = new File(['img'], 'photo.png', { type: 'image/png' });
    const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' });

    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [imgFile, textFile],
    });

    root.dispatchEvent(event);
    expect(acceptDrop).toHaveBeenCalledWith([textFile], { x: 100, y: 50 }, board);
    expect(board.query()).toHaveLength(1);
    expect((board.query()[0] as ElementRecord).type).toBe('image');
  });
});

describe('BOARD-908: upload lifecycle', () => {
  it('transitions uploadStatus from "uploading" to "ready" upon upload success', async () => {
    let resolveUpload!: (id: string) => void;
    const uploadMock = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const { board, root } = setup({
      assets: {
        resolve: (id) => `https://assets.test/${id}`,
        upload: uploadMock,
      },
    });

    const file = new File(['binary'], 'uploaded.png', { type: 'image/png' });
    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [file],
    });

    root.dispatchEvent(event);

    const [created] = board.query() as ElementRecord[];
    expect(created).toBeDefined();
    expect((created!.props as { uploadStatus: string }).uploadStatus).toBe('uploading');
    expect((created!.props as { uploadProgress: number }).uploadProgress).toBe(0);

    resolveUpload('cloud-asset-999');

    await vi.waitFor(() => {
      const updated = board.getElement(created!.id);
      expect((updated?.props as { uploadStatus: string }).uploadStatus).toBe('ready');
      expect((updated?.props as { uploadProgress: number }).uploadProgress).toBe(100);
      expect((updated?.props as { assetId: string }).assetId).toBe('cloud-asset-999');
    });
  });

  it('transitions uploadStatus to "error" with uploadError upon upload failure', async () => {
    let rejectUpload!: (err: unknown) => void;
    const uploadMock = vi.fn().mockImplementation(
      () =>
        new Promise<string>((_, reject) => {
          rejectUpload = reject;
        }),
    );

    const { board, root } = setup({
      assets: {
        resolve: (id) => `https://assets.test/${id}`,
        upload: uploadMock,
      },
    });

    const file = new File(['binary'], 'failed.png', { type: 'image/png' });
    const { event } = createDragEvent('drop', {
      clientX: 200,
      clientY: 100,
      files: [file],
    });

    root.dispatchEvent(event);

    const [created] = board.query() as ElementRecord[];
    expect(created).toBeDefined();
    expect((created!.props as { uploadStatus: string }).uploadStatus).toBe('uploading');

    rejectUpload(new Error('Koneksi terputus ke server'));

    await vi.waitFor(() => {
      const updated = board.getElement(created!.id);
      expect((updated?.props as { uploadStatus: string }).uploadStatus).toBe('error');
      expect((updated?.props as { uploadError: string }).uploadError).toBe('Koneksi terputus ke server');
    });
  });
});
