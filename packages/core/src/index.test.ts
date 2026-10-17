import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_BOARD_LIMITS,
  DEFAULT_ZOOM_RANGE,
  InvalidDocumentError,
  ReadOnlyBoardError,
  createBoard,
  createEmptyDocument,
  deepClone,
  definePlugin,
  validateDocument,
  type AssetAdapter,
  type Board,
  type BoardDocument,
  type BoardLimits,
  type BoardUser,
  type CameraState,
  type ElementRecord,
  type PermissionHook,
} from './index.js';

describe('@kujam/core (pure Node environment)', () => {
  it('berjalan di environment Node murni tanpa window dan document (BOARD-103)', () => {
    expect(typeof globalThis).toBe('object');
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
  });

  it('membuat dokumen kosong dengan versi skema saat ini dan halaman bawaan', () => {
    const doc = createEmptyDocument({ workspace: 'demo' });
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.meta).toEqual({ workspace: 'demo' });
    expect(doc.records['page:main']).toMatchObject({
      id: 'page:main',
      kind: 'page',
      name: 'Halaman 1',
    });
  });

  it('mengelola dokumen, elemen, dan kamera melalui createBoard', () => {
    const board = createBoard();
    expect(board.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });

    board.setCamera({ x: 120, y: -40, zoom: 1.5 });
    expect(board.getCamera()).toEqual({ x: 120, y: -40, zoom: 1.5 });

    const sampleElement: ElementRecord = {
      id: 'el:1',
      kind: 'element',
      type: 'sticky',
      pageId: 'page:main',
      parentId: null,
      index: 'a1',
      x: 10,
      y: 20,
      rotation: 0,
      w: 200,
      h: 200,
      locked: false,
      opacity: 1,
      props: { text: 'Halo' },
      meta: {},
    };

    const nextDoc = createEmptyDocument();
    nextDoc.records['el:1'] = sampleElement;

    board.loadDocument(nextDoc);
    expect(board.getElement('el:1')).toEqual(sampleElement);
    expect(board.getElement('page:main')).toBeUndefined();
    expect(board.getDocument().records['el:1']).toEqual(sampleElement);

    board.setCamera({});
    expect(board.getCamera()).toEqual({ x: 120, y: -40, zoom: 1.5 });

    const preloaded = createBoard({ document: nextDoc });
    expect(preloaded.getElement('el:1')).toEqual(sampleElement);

    board.dispose();
    preloaded.dispose();
  });
});

function makeElement(overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id: 'el:1',
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 0,
    y: 0,
    rotation: 0,
    w: 100,
    h: 100,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

describe('snapshot immutable', () => {
  it('getDocument dan getCamera tidak bisa diubah dari luar', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard({ document: doc });

    const snapshot = board.getDocument() as BoardDocument;
    expect(() => {
      (snapshot.records['el:1'] as ElementRecord).x = 999;
    }).toThrow(TypeError);
    expect(board.getElement('el:1')?.x).toBe(0);

    expect(() => {
      (board.getCamera() as CameraState).zoom = 0;
    }).toThrow(TypeError);
    expect(board.getCamera().zoom).toBe(1);
  });

  it('dokumen masukan tidak ikut terkunci atau terhubung dengan state board', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    const board = createBoard();
    board.loadDocument(doc);

    (doc.records['el:1'] as ElementRecord).x = 50;
    expect(board.getElement('el:1')?.x).toBe(0);
  });
});

describe('setCamera', () => {
  it('mengabaikan nilai tidak berhingga dan menjepit zoom ke batas bawaan', () => {
    const board = createBoard();
    board.setCamera({ x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: Number.NaN });
    expect(board.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });

    board.setCamera({ zoom: 0 });
    expect(board.getCamera().zoom).toBe(DEFAULT_ZOOM_RANGE.min);
    board.setCamera({ zoom: -3 });
    expect(board.getCamera().zoom).toBe(DEFAULT_ZOOM_RANGE.min);
    board.setCamera({ zoom: 100 });
    expect(board.getCamera().zoom).toBe(DEFAULT_ZOOM_RANGE.max);
  });

  it('memakai zoomRange kustom dan menolak rentang yang tidak valid', () => {
    const board = createBoard({ zoomRange: { min: 0.5, max: 2 } });
    board.setCamera({ zoom: 0.1 });
    expect(board.getCamera().zoom).toBe(0.5);
    expect(() => createBoard({ zoomRange: { min: 0, max: 2 } })).toThrow(RangeError);
    expect(() => createBoard({ zoomRange: { min: 3, max: 2 } })).toThrow(RangeError);
  });
});

describe('opsi readOnly dan locale', () => {
  it('diterapkan dan diekspos di board', () => {
    const board = createBoard({ readOnly: true, locale: 'en' });
    expect(board.readOnly).toBe(true);
    expect(board.locale).toBe('en');

    const defaults = createBoard();
    expect(defaults.readOnly).toBe(false);
    expect(defaults.locale).toBe('id');
  });

  it('menolak locale yang tidak didukung', () => {
    expect(() => createBoard({ locale: 'fr' as 'id' })).toThrow(RangeError);
  });
});

describe('validateDocument', () => {
  it('menerima dokumen yang valid', () => {
    const doc = createEmptyDocument();
    doc.records['el:1'] = makeElement();
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [], invalidRecords: {} });
  });

  it.each([
    ['bukan objek', null],
    ['array', []],
    ['schemaVersion NaN', { schemaVersion: Number.NaN, meta: {}, records: {} }],
    ['schemaVersion negatif', { schemaVersion: -1, meta: {}, records: {} }],
    [
      'schemaVersion dari masa depan',
      { schemaVersion: CURRENT_SCHEMA_VERSION + 1, meta: {}, records: {} },
    ],
    ['records berupa array', { schemaVersion: 1, meta: {}, records: [] }],
    ['record bukan objek', { schemaVersion: 1, meta: {}, records: { x: 42 } }],
    [
      'kind tidak dikenal',
      { schemaVersion: 1, meta: {}, records: { x: { id: 'x', kind: 'foo' } } },
    ],
    ['id tidak sama dengan kunci', { schemaVersion: 1, meta: {}, records: { a: makeElement() } }],
    [
      'koordinat NaN',
      { schemaVersion: 1, meta: {}, records: { 'el:1': makeElement({ x: Number.NaN }) } },
    ],
    [
      'opacity di luar 0..1',
      { schemaVersion: 1, meta: {}, records: { 'el:1': makeElement({ opacity: 2 }) } },
    ],
  ])('menolak %s', (_label, doc) => {
    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('menerima record binding, page, dan asset yang valid', () => {
    const doc = createEmptyDocument();
    doc.records['b:1'] = {
      id: 'b:1',
      kind: 'binding',
      fromId: 'el:1',
      toId: 'el:2',
      anchor: { x: 0.5, y: 1 },
    };
    doc.records['page:2'] = { id: 'page:2', kind: 'page', name: '', index: 'a1', meta: {} };
    doc.records['asset:1'] = {
      id: 'asset:1',
      kind: 'asset',
      mimeType: 'image/png',
      w: 10,
      h: 10,
      meta: {},
    };
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [], invalidRecords: {} });
  });

  it.each([
    ['binding tanpa anchor', { id: 'r', kind: 'binding', fromId: 'a', toId: 'b' }],
    [
      'binding dengan fromId kosong',
      { id: 'r', kind: 'binding', fromId: '', toId: 'b', anchor: { x: 0, y: 0 } },
    ],
    ['page tanpa index', { id: 'r', kind: 'page', name: 'x', meta: {} }],
    [
      'asset dengan ukuran negatif',
      { id: 'r', kind: 'asset', mimeType: 'image/png', w: -1, h: 1, meta: {} },
    ],
  ])('menolak %s', (_label, rec) => {
    const result = validateDocument({ schemaVersion: 1, meta: {}, records: { r: rec } });
    expect(result.valid).toBe(false);
  });

  it('menolak dokumen tanpa meta', () => {
    expect(validateDocument({ schemaVersion: 1, records: {} }).valid).toBe(false);
  });

  it('createBoard dan loadDocument melempar InvalidDocumentError untuk dokumen rusak', () => {
    const broken = { schemaVersion: 1, meta: {}, records: [] } as unknown as BoardDocument;
    expect(() => createBoard({ document: broken })).toThrow(InvalidDocumentError);
    const board = createBoard();
    expect(() => board.loadDocument(broken)).toThrow(InvalidDocumentError);
    expect(board.getDocument().records['page:main']).toBeDefined();
  });
});

describe('deepClone', () => {
  it('mempertahankan NaN, Infinity, undefined, dan Uint8Array', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const source = {
      a: Number.NaN,
      b: Number.POSITIVE_INFINITY,
      c: undefined,
      d: bytes,
      e: [1, { f: 2 }],
    };
    const copy = deepClone(source);
    expect(copy).toEqual(source);
    expect('c' in copy).toBe(true);
    expect(copy.d).not.toBe(bytes);
    expect(copy.e[1]).not.toBe(source.e[1]);
  });

  it('snapshot tetap bisa dibuat untuk dokumen yang memuat Uint8Array di meta', () => {
    const doc = createEmptyDocument({ thumbnail: new Uint8Array([1]) });
    const board = createBoard({ document: doc });
    expect(Object.isFrozen(board.getDocument().meta)).toBe(true);
    expect(board.getDocument().meta.thumbnail).toEqual(new Uint8Array([1]));
  });
});

describe('BOARD-211: opsi createBoard dan properti board', () => {
  it('menerima opsi lengkap dan mengeksposnya di board', () => {
    const mockResolver = (id: string) => ({ status: 'ready' as const, data: { id } });
    const mockAssetAdapter: AssetAdapter = {
      resolve: (assetId: string) => `https://assets.example.com/${assetId}`,
      upload: (file: unknown) => `asset-${String(file)}`,
    };
    const user: BoardUser = {
      id: 'user-42',
      name: 'Budi',
      color: '#00ff00',
      meta: { role: 'editor' },
    };
    const customLimits: Partial<BoardLimits> = {
      maxElements: 2_000,
      maxDrawPoints: 1_000,
    };
    const permission: PermissionHook = (_action, _el, _u) => true;

    const board = createBoard({
      resolvers: { item: mockResolver },
      assets: mockAssetAdapter,
      user,
      limits: customLimits,
      permissions: permission,
      readOnly: false,
      locale: 'en',
    });

    expect(board.resolvers.item).toBe(mockResolver);
    expect(board.assets?.resolve('test-1')).toBe('https://assets.example.com/test-1');
    expect(board.user).toEqual({
      id: 'user-42',
      name: 'Budi',
      color: '#00ff00',
      meta: { role: 'editor' },
    });
    expect(board.limits).toEqual({
      maxDocumentBytes: DEFAULT_BOARD_LIMITS.maxDocumentBytes,
      maxElements: 2_000,
      maxDrawPoints: 1_000,
    });
    expect(board.permissions).toBe(permission);
    expect(board.readOnly).toBe(false);
    expect(board.locale).toBe('en');
    expect(board.disposed).toBe(false);

    board.dispose();
    expect(board.disposed).toBe(true);
  });

  it('menerima assets tanpa upload dan user minimal hanya dengan id', () => {
    const board = createBoard({
      assets: { resolve: () => 'asset-url' },
      user: { id: 'u-simple' },
    });
    expect(board.assets?.resolve('test')).toBe('asset-url');
    expect(board.assets?.upload).toBeUndefined();
    expect(board.user).toEqual({ id: 'u-simple', meta: {} });
    expect(board.user?.name).toBeUndefined();
    expect(board.user?.color).toBeUndefined();
    board.dispose();
  });

  it('memakai nilai bawaan yang aman saat opsi tidak diberikan', () => {
    const board = createBoard();
    expect(board.resolvers).toEqual({});
    expect(board.assets).toBeNull();
    expect(board.user).toBeNull();
    expect(board.limits).toEqual(DEFAULT_BOARD_LIMITS);
    expect(board.permissions).toBeNull();
    expect(board.readOnly).toBe(false);
    expect(board.locale).toBe('id');
    expect(board.disposed).toBe(false);
    board.dispose();
  });

  it('menolak options yang bukan objek', () => {
    expect(() => createBoard(null as unknown as object)).toThrow(TypeError);
    expect(() => createBoard(123 as unknown as object)).toThrow(TypeError);
    expect(() => createBoard('invalid' as unknown as object)).toThrow(TypeError);
    expect(() => createBoard([] as unknown as object)).toThrow(TypeError);
  });

  it('menolak readOnly yang bukan boolean', () => {
    expect(() => createBoard({ readOnly: 'true' as unknown as boolean })).toThrow(TypeError);
    expect(() => createBoard({ readOnly: 1 as unknown as boolean })).toThrow(TypeError);
  });

  it('menolak resolvers yang bukan objek atau resolver yang bukan fungsi', () => {
    expect(() => createBoard({ resolvers: null as unknown as object })).toThrow(TypeError);
    expect(() => createBoard({ resolvers: 'invalid' as unknown as object })).toThrow(TypeError);
    expect(() =>
      createBoard({ resolvers: { item: 123 as unknown as () => never } }),
    ).toThrow(TypeError);
  });

  it('menolak assets yang bukan objek atau tanpa method resolve fungsi', () => {
    expect(() => createBoard({ assets: 'invalid' as unknown as AssetAdapter })).toThrow(TypeError);
    expect(() => createBoard({ assets: {} as unknown as AssetAdapter })).toThrow(TypeError);
    expect(() =>
      createBoard({ assets: { resolve: 'not-a-fn' as unknown as AssetAdapter['resolve'] } }),
    ).toThrow(TypeError);
    expect(() =>
      createBoard({
        assets: {
          resolve: () => null,
          upload: 'not-a-fn' as unknown as NonNullable<AssetAdapter['upload']>,
        },
      }),
    ).toThrow(TypeError);
  });

  it('menolak user yang tidak valid', () => {
    expect(() => createBoard({ user: 'invalid' as unknown as BoardUser })).toThrow(TypeError);
    expect(() => createBoard({ user: {} as unknown as BoardUser })).toThrow(TypeError);
    expect(() => createBoard({ user: { id: '' } as unknown as BoardUser })).toThrow(TypeError);
    expect(() =>
      createBoard({ user: { id: 'u1', name: 123 as unknown as string } as unknown as BoardUser }),
    ).toThrow(TypeError);
    expect(() =>
      createBoard({ user: { id: 'u1', color: 123 as unknown as string } as unknown as BoardUser }),
    ).toThrow(TypeError);
    expect(() =>
      createBoard({ user: { id: 'u1', meta: 'invalid' as unknown as Record<string, unknown> } }),
    ).toThrow(TypeError);
  });

  it('menolak limits yang bukan objek atau bernilai non-integer / < 1', () => {
    expect(() => createBoard({ limits: 'invalid' as unknown as Partial<BoardLimits> })).toThrow(
      TypeError,
    );
    expect(() => createBoard({ limits: { maxElements: 0 } })).toThrow(RangeError);
    expect(() => createBoard({ limits: { maxElements: -5 } })).toThrow(RangeError);
    expect(() => createBoard({ limits: { maxElements: 1.5 } })).toThrow(RangeError);
    expect(() => createBoard({ limits: { maxDocumentBytes: 0 } })).toThrow(RangeError);
    expect(() => createBoard({ limits: { maxDrawPoints: -1 } })).toThrow(RangeError);
  });

  it('menolak permissions yang bukan fungsi', () => {
    expect(() =>
      createBoard({ permissions: 'invalid' as unknown as PermissionHook }),
    ).toThrow(TypeError);
    expect(() => createBoard({ permissions: 123 as unknown as PermissionHook })).toThrow(TypeError);
  });

  it('menguji opsi createId kustom dan validasi hasilnya', () => {
    const custom = createBoard({ createId: () => 'my-custom-id' });
    expect(custom.createId()).toBe('my-custom-id');

    const empty = createBoard({ createId: () => '' });
    expect(() => empty.createId()).toThrow(TypeError);

    expect(() => createBoard({ createId: 123 as unknown as () => string })).toThrow(TypeError);
  });

  it('menolak defaultTool yang bukan string', () => {
    expect(() => createBoard({ defaultTool: 123 as unknown as string })).toThrow(TypeError);
  });

  it('mengekspos getter tool, toolState, cursor, dan registri subkomponen', () => {
    const board = createBoard();
    expect(board.tool).toBeNull();
    expect(board.toolState).toBeNull();
    expect(board.cursor).toBe('default');
    expect(board.commands).toBeDefined();
    expect(board.elements).toBeDefined();
    expect(board.plugins).toBeDefined();
    expect(board.tools).toBeDefined();
    expect(board.history).toBeDefined();
    board.dispose();
  });

  it('memancarkan event error dengan kode listener-error bila listener melempar', () => {
    const board = createBoard();
    let caught: { code: string; message: string } | null = null;
    board.on('error', (err) => {
      caught = err;
    });

    board.on('camera', () => {
      throw new Error('error di listener kamera');
    });

    board.setCamera({ x: 10 });
    expect(caught?.code).toBe('listener-error');
    board.dispose();
  });

  it('memanggil reportUnhandled bila listener melempar tanpa listener error', () => {
    const board = createBoard();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    board.on('camera', () => {
      throw new Error('error tanpa listener error');
    });
    board.setCamera({ x: 123 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    board.dispose();
  });
});

describe('BOARD-211: readOnly: true', () => {
  it('menolak semua transaksi lokal dengan ReadOnlyBoardError', () => {
    const board = createBoard({ readOnly: true });

    expect(() => {
      board.transact((tx) => {
        tx.put(makeElement({ id: 'el:readonly-1' }));
      });
    }).toThrow(ReadOnlyBoardError);

    expect(board.undo()).toBe(false);
    expect(board.redo()).toBe(false);
  });

  it('tetap mengizinkan perubahan kamera saat readOnly', () => {
    const board = createBoard({ readOnly: true });
    let fired = false;
    board.on('camera', () => {
      fired = true;
    });

    board.setCamera({ x: 50, y: 100, zoom: 2 });
    expect(board.getCamera()).toEqual({ x: 50, y: 100, zoom: 2 });
    expect(fired).toBe(true);
  });

  it('tetap mengizinkan loadDocument saat readOnly', () => {
    const board = createBoard({ readOnly: true });
    const newDoc = createEmptyDocument();
    newDoc.records['el:incoming'] = makeElement({ id: 'el:incoming' });

    board.loadDocument(newDoc);
    expect(board.getElement('el:incoming')).toBeDefined();
    expect(board.getDocument().records['el:incoming']).toBeDefined();
  });
});

describe('BOARD-211: board.dispose()', () => {
  it('aman dipanggil lebih dari sekali (idempoten)', () => {
    const board = createBoard();
    expect(board.disposed).toBe(false);

    board.dispose();
    expect(board.disposed).toBe(true);

    // The second call does not throw
    expect(() => board.dispose()).not.toThrow();
    expect(board.disposed).toBe(true);
  });

  it('melempar error pada operasi yang memerlukan papan aktif setelah dispose', () => {
    const board = createBoard();
    board.dispose();

    expect(() => board.transact(() => {})).toThrow('Papan sudah di-dispose.');
    expect(() => board.loadDocument(createEmptyDocument())).toThrow('Papan sudah di-dispose.');
    expect(() => board.undo()).toThrow('Papan sudah di-dispose.');
    expect(() => board.redo()).toThrow('Papan sudah di-dispose.');
    expect(() => board.run('some-command')).toThrow('Papan sudah di-dispose.');
    expect(() => board.setTool('select')).toThrow('Papan sudah di-dispose.');
    expect(() =>
      board.dispatch({
        type: 'pointer-down',
        point: { x: 0, y: 0 },
        modifiers: { alt: false, shift: false, meta: false, ctrl: false },
        pointerId: 1,
        button: 0,
        kind: 'mouse',
      }),
    ).toThrow('Papan sudah di-dispose.');
  });

  it('melepas semua listener event dan on() mengembalikan noop unregister setelah dispose', () => {
    const board = createBoard();
    let changeCalls = 0;
    board.on('change', () => {
      changeCalls++;
    });

    board.dispose();

    // Registering a new listener after dispose returns a noop unlisten
    let afterCalls = 0;
    const unsub = board.on('change', () => {
      afterCalls++;
    });
    expect(typeof unsub).toBe('function');
    unsub();
    expect(changeCalls).toBe(0);
    expect(afterCalls).toBe(0);
  });

  it('menjalankan teardown plugin dalam urutan terbalik saat dispose', () => {
    const teardownOrder: string[] = [];

    const pluginA = definePlugin({
      id: 'plugin-a',
      setup() {
        return () => {
          teardownOrder.push('plugin-a');
        };
      },
    });

    const pluginB = definePlugin({
      id: 'plugin-b',
      dependsOn: ['plugin-a'],
      setup() {
        return () => {
          teardownOrder.push('plugin-b');
        };
      },
    });

    const board = createBoard({ plugins: [pluginA, pluginB] });
    expect(board.plugins.list().map((p) => p.id)).toEqual(['plugin-a', 'plugin-b']);

    board.dispose();
    expect(teardownOrder).toEqual(['plugin-b', 'plugin-a']);
  });

  it('membuat dan membuang 100 board tidak menahan memori (uji kebocoran)', async () => {
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc') as (() => void) | undefined;
    expect(typeof gc).toBe('function');

    function createAndDisposeBoards(count: number): WeakRef<Board>[] {
      const list: WeakRef<Board>[] = [];
      for (let i = 0; i < count; i++) {
        const b = createBoard();
        b.on('change', () => {});
        b.on('camera', () => {});
        b.setCamera({ x: i, y: i });
        b.dispose();
        list.push(new WeakRef(b));
      }
      return list;
    }

    const refs = createAndDisposeBoards(100);
    await new Promise((resolve) => setTimeout(resolve, 20));
    gc!();
    gc!();

    const aliveCount = refs.filter((r) => r.deref() !== undefined).length;
    expect(aliveCount).toBe(0);
  });
});

