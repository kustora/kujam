import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineTool,
  ReadOnlyBoardError,
  ToolError,
  type Board,
  type BoardInputEvent,
  type ElementRecord,
  type InputModifiers,
  type PointerKind,
  type ToolDefinition,
  type ToolEvent,
  type ToolPointerEvent,
} from '../index.js';

// ---------- Synthetic events ----------

const NO_MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function pointer(
  type: ToolPointerEvent['type'],
  x: number,
  y: number,
  init: { pointerId?: number; pointerType?: PointerKind } = {},
): ToolPointerEvent {
  return {
    type,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? 'mouse',
    point: { x, y },
    screen: { x, y },
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: NO_MODS,
  };
}

function key(
  type: 'key-down' | 'key-up',
  k: string,
  code: string,
  repeat = false,
): BoardInputEvent {
  return { type, key: k, code, repeat, modifiers: NO_MODS };
}

const escape = (): BoardInputEvent => key('key-down', 'Escape', 'Escape');
const spaceDown = (repeat = false): BoardInputEvent => key('key-down', ' ', 'Space', repeat);
const spaceUp = (): BoardInputEvent => key('key-up', ' ', 'Space');

/** Sends a full drag: down at the first point, move to the middle points, up at the last point. */
function drag(board: Board, points: [number, number][], pointerId = 1): void {
  const [first, ...rest] = points as [[number, number], ...[number, number][]];
  board.dispatch(pointer('pointer-down', first[0], first[1], { pointerId }));
  for (const [x, y] of rest) board.dispatch(pointer('pointer-move', x, y, { pointerId }));
  const last = points[points.length - 1] as [number, number];
  board.dispatch(pointer('pointer-up', last[0], last[1], { pointerId }));
}

// ---------- Example tools ----------

function box(id: string, x: number, y: number, w = 0, h = 0): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'geo',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x,
    y,
    rotation: 0,
    w,
    h,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
  };
}

/** Box tool: press creates an element, drag resizes it, release commits. */
function boxTool(overrides: Partial<ToolDefinition<'idle' | 'drawing', { id: string }>> = {}) {
  return defineTool({
    id: 'box',
    cursor: 'crosshair',
    initial: 'idle',
    data: () => ({ id: '', x: 0, y: 0 }),
    states: {
      idle: {
        onPointerDown(ctx, e) {
          ctx.data.id = ctx.board.createId();
          ctx.data.x = e.point.x;
          ctx.data.y = e.point.y;
          ctx.change((tx) => tx.put(box(ctx.data.id, e.point.x, e.point.y)), {
            label: 'box.create',
          });
          return 'drawing';
        },
      },
      drawing: {
        cursor: 'nwse-resize',
        onPointerMove(ctx, e) {
          const { id, x, y } = ctx.data;
          ctx.change((tx) => tx.put(box(id, x, y, e.point.x - x, e.point.y - y)));
        },
        onPointerUp: () => 'idle',
      },
    },
    ...overrides,
  } as ToolDefinition<'idle' | 'drawing', { id: string; x: number; y: number }>);
}

const noopTool = (id: string, oneShot = false) =>
  defineTool({ id, oneShot, initial: 'idle', states: { idle: {} } });

/** Minimal hand tool: drag pans the camera. */
const handTool = defineTool({
  id: 'hand',
  cursor: 'grab',
  initial: 'idle',
  data: () => ({ x: 0, y: 0 }),
  states: {
    idle: {
      onPointerDown(ctx, e) {
        ctx.data.x = e.screen.x;
        ctx.data.y = e.screen.y;
        return 'panning';
      },
    },
    panning: {
      cursor: 'grabbing',
      onPointerMove(ctx, e) {
        const cam = ctx.board.getCamera();
        ctx.board.setCamera({
          x: cam.x + e.screen.x - ctx.data.x,
          y: cam.y + e.screen.y - ctx.data.y,
        });
        ctx.data.x = e.screen.x;
        ctx.data.y = e.screen.y;
      },
      onPointerUp: () => 'idle',
    },
  },
});

function setup(options: Parameters<typeof createBoard>[0] = {}) {
  let n = 0;
  const board = createBoard({ createId: () => `el:${++n}`, ...options });
  board.tools.register(noopTool('select'));
  board.tools.register(boxTool());
  board.tools.register(handTool);
  const toolEvents: ToolEvent[] = [];
  board.on('tool', (e) => toolEvents.push(e));
  return { board, toolEvents };
}

const elementIds = (board: Board) =>
  Object.values(board.getDocument().records)
    .filter((r) => r.kind === 'element')
    .map((r) => r.id);

// ---------- Tests ----------

describe('defineTool dan registri (BOARD-501)', () => {
  it('mendaftarkan dan mencari tool sesuai urutan pendaftaran', () => {
    const { board } = setup();
    expect(board.tools.list().map((t) => t.id)).toEqual(['select', 'box', 'hand']);
    expect(board.tools.has('box')).toBe(true);
    expect(board.tools.get('tidak-ada')).toBeUndefined();
  });

  it('menolak ID ganda', () => {
    const { board } = setup();
    expect(() => board.tools.register(noopTool('box'))).toThrow(
      expect.objectContaining({ code: 'duplicate-tool', toolId: 'box' }),
    );
  });

  it.each([
    ['id tidak valid', { id: 'Pen Besar', initial: 'idle', states: { idle: {} } }],
    ['initial bukan state', { id: 'pen', initial: 'x', states: { idle: {} } }],
    ['states kosong', { id: 'pen', initial: 'idle', states: {} }],
    [
      'handler bukan fungsi',
      { id: 'pen', initial: 'idle', states: { idle: { onPointerDown: 1 } } },
    ],
    ['oneShot bukan boolean', { id: 'pen', oneShot: 'ya', initial: 'idle', states: { idle: {} } }],
    ['bukan objek', null],
  ])('menolak definisi tidak valid: %s', (_name, definition) => {
    const error = (() => {
      try {
        defineTool(definition as unknown as ToolDefinition);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('invalid-tool');
  });
});

describe('setTool, board.tool, dan event tool', () => {
  it('board mulai tanpa tool; setTool mengaktifkan dan memancarkan event', () => {
    const { board, toolEvents } = setup();
    expect(board.tool).toBeNull();
    expect(board.toolState).toBeNull();
    expect(board.cursor).toBe('default');

    board.setTool('box');
    expect(board.tool).toBe('box');
    expect(board.toolState).toBe('idle');
    expect(board.cursor).toBe('crosshair');
    board.setTool('box');
    board.setTool('select');
    expect(toolEvents).toEqual([
      { id: 'box', previous: null },
      { id: 'select', previous: 'box' },
    ]);
  });

  it('ID tidak terdaftar melempar unknown-tool tanpa mengubah tool aktif', () => {
    const { board } = setup();
    board.setTool('box');
    expect(() => board.setTool('tidak-ada')).toThrow(
      expect.objectContaining({ code: 'unknown-tool' }),
    );
    expect(board.tool).toBe('box');
  });

  it('tanpa tool aktif, dispatch tidak menangani event', () => {
    const { board } = setup();
    expect(board.dispatch(pointer('pointer-down', 0, 0))).toBe(false);
  });

  it('onEnter dan onExit dipanggil saat state dan tool berganti', () => {
    const calls: string[] = [];
    const tool = defineTool({
      id: 'jejak',
      initial: 'a',
      states: {
        a: {
          onEnter: () => void calls.push('enter a'),
          onExit: () => void calls.push('exit a'),
          onPointerDown: () => 'b',
        },
        b: {
          onEnter: () => void calls.push('enter b'),
          onExit: () => void calls.push('exit b'),
          onPointerUp: () => 'a',
        },
      },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('jejak');
    drag(board, [[0, 0]]);
    board.setTool('select');
    expect(calls).toEqual(['enter a', 'exit a', 'enter b', 'exit b', 'enter a', 'exit a']);
  });

  it('handler yang mengembalikan state tidak dikenal melempar unknown-state', () => {
    const tool = defineTool({
      id: 'salah',
      initial: 'idle',
      states: { idle: { onPointerDown: () => 'hilang' as 'idle' } },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('salah');
    expect(() => board.dispatch(pointer('pointer-down', 0, 0))).toThrow(
      expect.objectContaining({ code: 'unknown-state' }),
    );
    expect(board.toolState).toBe('idle');
  });
});

describe('interaksi: commit dan rollback', () => {
  it('rangkaian event sintetis membuat elemen, dan seluruh seret menjadi satu langkah undo', () => {
    const { board } = setup();
    board.setTool('box');
    const changes = vi.fn();
    board.on('change', changes);

    board.dispatch(pointer('pointer-down', 10, 20));
    expect(board.toolState).toBe('drawing');
    expect(board.cursor).toBe('nwse-resize');
    expect(board.getElement('el:1')).toMatchObject({ x: 10, y: 20, w: 0, h: 0 });
    // During the interaction, changes are visible but not yet in history.
    expect(board.history.canUndo).toBe(false);

    board.dispatch(pointer('pointer-move', 50, 60));
    board.dispatch(pointer('pointer-move', 110, 220));
    expect(board.getElement('el:1')).toMatchObject({ w: 100, h: 200 });
    board.dispatch(pointer('pointer-up', 110, 220));

    expect(board.toolState).toBe('idle');
    expect(changes).toHaveBeenCalledTimes(3);
    expect(board.history.canUndo).toBe(true);

    expect(board.undo()).toBe(true);
    expect(board.getElement('el:1')).toBeUndefined();
    expect(board.history.canUndo).toBe(false);
    expect(board.redo()).toBe(true);
    expect(board.getElement('el:1')).toMatchObject({ w: 100, h: 200 });
  });

  it('langkah undo memakai label interaksi', () => {
    const { board } = setup();
    board.setTool('box');
    drag(board, [
      [0, 0],
      [5, 5],
    ]);
    const labels: (string | undefined)[] = [];
    board.on('change', (e) => labels.push(e.label));
    board.undo();
    expect(labels).toEqual(['box.create']);
  });

  it('pointer-cancel pointer utama me-rollback tanpa jejak di riwayat', () => {
    const onCancel = vi.fn();
    const { board } = setup();
    board.tools.register(
      boxTool({
        id: 'box-batal',
        states: {
          ...boxTool().states,
          drawing: { ...boxTool().states.drawing, onCancel },
        },
      }),
    );
    board.setTool('box-batal');

    board.dispatch(pointer('pointer-down', 0, 0));
    board.dispatch(pointer('pointer-move', 30, 30));
    expect(board.dispatch(pointer('pointer-cancel', 30, 30))).toBe(true);

    expect(elementIds(board)).toEqual([]);
    expect(board.toolState).toBe('idle');
    expect(board.history.canUndo).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('rollback tidak membuang tumpukan redo', () => {
    const { board } = setup();
    board.setTool('box');
    drag(board, [[0, 0]]);
    board.undo();
    expect(board.history.canRedo).toBe(true);

    board.dispatch(pointer('pointer-down', 0, 0));
    board.dispatch(pointer('pointer-cancel', 0, 0));
    expect(board.history.canRedo).toBe(true);
  });

  it('perubahan pihak lain selama interaksi menang saat rollback', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(pointer('pointer-down', 0, 0));
    board.transact((tx) => tx.put(box('el:1', 999, 999, 1, 1)), { origin: 'remote' });

    board.dispatch(escape());
    expect(board.getElement('el:1')).toMatchObject({ x: 999 });
  });

  it('perubahan di state awal tanpa pindah state langsung di-commit', () => {
    const stamp = defineTool({
      id: 'cap',
      initial: 'idle',
      states: {
        idle: {
          onPointerDown(ctx, e) {
            ctx.change((tx) => tx.put(box(ctx.board.createId(), e.point.x, e.point.y)));
          },
        },
      },
    });
    const { board } = setup();
    board.tools.register(stamp);
    board.setTool('cap');
    board.dispatch(pointer('pointer-down', 1, 1));
    board.dispatch(pointer('pointer-down', 2, 2));
    expect(elementIds(board)).toEqual(['el:1', 'el:2']);
    board.undo();
    expect(elementIds(board)).toEqual(['el:1']);
  });

  it('ctx.commit meng-commit di tengah interaksi; ctx.cancel me-rollback sisanya', () => {
    const tool = defineTool({
      id: 'dua-tahap',
      initial: 'idle',
      states: {
        idle: {
          onPointerDown(ctx) {
            ctx.change((tx) => tx.put(box('el:a', 0, 0)));
            ctx.commit();
            ctx.change((tx) => tx.put(box('el:b', 0, 0)));
            return 'busy';
          },
        },
        busy: {
          onPointerUp(ctx) {
            ctx.cancel();
            return 'busy'; // ignored because cancel already moved the state
          },
        },
      },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('dua-tahap');
    drag(board, [[0, 0]]);
    expect(elementIds(board)).toEqual(['el:a']);
    expect(board.toolState).toBe('idle');
    expect(board.history.canUndo).toBe(true);
  });

  it('handler yang melempar me-rollback interaksi lalu meneruskan error', () => {
    const tool = defineTool({
      id: 'rapuh',
      initial: 'idle',
      states: {
        idle: {
          onPointerDown(ctx) {
            ctx.change((tx) => tx.put(box('el:x', 0, 0)));
            return 'busy';
          },
        },
        busy: {
          onPointerMove() {
            throw new Error('gagal');
          },
        },
      },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('rapuh');
    board.dispatch(pointer('pointer-down', 0, 0));
    expect(() => board.dispatch(pointer('pointer-move', 1, 1))).toThrow('gagal');
    expect(elementIds(board)).toEqual([]);
    expect(board.toolState).toBe('idle');
  });

  it('undo di tengah interaksi hanya membatalkan interaksi itu', () => {
    const { board } = setup();
    board.setTool('box');
    drag(board, [[0, 0]]);
    board.dispatch(pointer('pointer-down', 50, 50));
    expect(elementIds(board)).toEqual(['el:1', 'el:2']);

    expect(board.undo()).toBe(true);
    expect(elementIds(board)).toEqual(['el:1']);
    expect(board.toolState).toBe('idle');
    expect(board.undo()).toBe(true);
    expect(elementIds(board)).toEqual([]);
  });

  it('ganti tool di tengah interaksi me-rollback interaksinya', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(pointer('pointer-down', 0, 0));
    board.setTool('select');
    expect(elementIds(board)).toEqual([]);
    expect(board.history.canUndo).toBe(false);
  });

  it('loadDocument di tengah interaksi membuang interaksi tanpa mencatat langkah', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(pointer('pointer-down', 0, 0));
    board.loadDocument(board.getDocument());
    expect(board.toolState).toBe('idle');
    board.dispatch(pointer('pointer-up', 0, 0));
    expect(board.history.canUndo).toBe(false);
    expect(elementIds(board)).toEqual(['el:1']);
  });

  it('pada papan readOnly, perubahan ditolak dan tool kembali ke state awal', () => {
    const { board } = setup({ readOnly: true });
    board.setTool('box');
    expect(() => board.dispatch(pointer('pointer-down', 0, 0))).toThrow(ReadOnlyBoardError);
    expect(board.toolState).toBe('idle');
    expect(elementIds(board)).toEqual([]);
  });
});

describe('pointer utama dan multi-pointer (ADR-004)', () => {
  it('pointer kedua diabaikan selama pointer utama memegang interaksi', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(pointer('pointer-down', 0, 0, { pointerId: 1, pointerType: 'touch' }));
    expect(board.dispatch(pointer('pointer-down', 90, 90, { pointerId: 2 }))).toBe(false);
    expect(board.dispatch(pointer('pointer-move', 90, 90, { pointerId: 2 }))).toBe(false);
    expect(board.dispatch(pointer('pointer-cancel', 90, 90, { pointerId: 2 }))).toBe(false);
    expect(board.toolState).toBe('drawing');

    board.dispatch(pointer('pointer-move', 10, 10, { pointerId: 1 }));
    board.dispatch(pointer('pointer-up', 10, 10, { pointerId: 1 }));
    expect(elementIds(board)).toEqual(['el:1']);
    expect(board.getElement('el:1')).toMatchObject({ w: 10, h: 10 });
  });

  it('setelah interaksi selesai, pointer lain bisa memulai interaksi baru', () => {
    const { board } = setup();
    board.setTool('box');
    drag(board, [[0, 0]], 1);
    drag(board, [[5, 5]], 7);
    expect(elementIds(board)).toEqual(['el:1', 'el:2']);
  });

  it('event pointer membawa pointerId dan pointerType ke handler', () => {
    const seen: [number, string][] = [];
    const tool = defineTool({
      id: 'intip',
      initial: 'idle',
      states: {
        idle: { onPointerDown: (_ctx, e) => void seen.push([e.pointerId, e.pointerType]) },
      },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('intip');
    board.dispatch(pointer('pointer-down', 0, 0, { pointerId: 3, pointerType: 'pen' }));
    expect(seen).toEqual([[3, 'pen']]);
  });
});

describe('Esc, oneShot, dan spasi', () => {
  it('Esc di tengah interaksi me-rollback; Esc berikutnya kembali ke tool bawaan', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(pointer('pointer-down', 0, 0));

    expect(board.dispatch(escape())).toBe(true);
    expect(elementIds(board)).toEqual([]);
    expect(board.tool).toBe('box');

    expect(board.dispatch(escape())).toBe(true);
    expect(board.tool).toBe('select');
    expect(board.dispatch(escape())).toBe(false);
  });

  it('tool tetap aktif setelah interaksi selesai bila bukan oneShot', () => {
    const { board } = setup();
    board.setTool('box');
    drag(board, [[0, 0]]);
    drag(board, [[1, 1]]);
    expect(board.tool).toBe('box');
  });

  it('tool oneShot kembali ke tool bawaan setelah satu interaksi', () => {
    const { board, toolEvents } = setup();
    board.tools.register(boxTool({ id: 'box-sekali', oneShot: true }));
    board.setTool('box-sekali');
    drag(board, [[0, 0]]);
    expect(board.tool).toBe('select');
    expect(board.history.canUndo).toBe(true);
    expect(toolEvents.at(-1)).toEqual({ id: 'select', previous: 'box-sekali' });
  });

  it('defaultTool bisa diganti lewat opsi createBoard', () => {
    const { board } = setup({ defaultTool: 'hand' });
    board.setTool('box');
    board.dispatch(escape());
    expect(board.tool).toBe('hand');
  });

  it('spasi ditahan mengaktifkan tool tangan sementara, lalu kembali', () => {
    const { board, toolEvents } = setup();
    board.setTool('box');

    expect(board.dispatch(spaceDown())).toBe(true);
    expect(board.tool).toBe('hand');
    expect(board.dispatch(spaceDown(true))).toBe(true);

    drag(board, [
      [0, 0],
      [40, 30],
    ]);
    expect(board.getCamera()).toMatchObject({ x: 40, y: 30 });
    expect(elementIds(board)).toEqual([]);

    expect(board.dispatch(spaceUp())).toBe(true);
    expect(board.tool).toBe('box');
    expect(toolEvents.slice(1)).toEqual([
      { id: 'hand', previous: 'box' },
      { id: 'box', previous: 'hand' },
    ]);
  });

  it('spasi tidak mengganti tool di tengah interaksi atau bila tool tangan tidak terdaftar', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(pointer('pointer-down', 0, 0));
    expect(board.dispatch(spaceDown())).toBe(false);
    expect(board.tool).toBe('box');
    board.dispatch(pointer('pointer-up', 0, 0));

    const bare = createBoard();
    bare.tools.register(noopTool('select'));
    bare.setTool('select');
    expect(bare.dispatch(spaceDown())).toBe(false);
    expect(bare.tool).toBe('select');
  });

  it('setTool saat tangan sementara membatalkan kepulangan saat spasi dilepas', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispatch(spaceDown());
    board.setTool('select');
    expect(board.dispatch(spaceUp())).toBe(false);
    expect(board.tool).toBe('select');
  });
});

describe('tombol penghapus stylus (BOARD-1005, ADR-004)', () => {
  it('pointer-down dengan button 5 atau buttons & 32 sementara mengaktifkan tool penghapus', () => {
    const { board } = setup();
    const actions: string[] = [];
    board.tools.register(
      defineTool({
        id: 'eraser',
        initial: 'idle',
        states: {
          idle: {
            onPointerDown() {
              actions.push('eraser-down');
              return 'erasing';
            },
          },
          erasing: {
            onPointerUp() {
              actions.push('eraser-up');
              return 'idle';
            },
          },
        },
      }),
    );

    board.setTool('box');
    expect(board.tool).toBe('box');

    // Press down with stylus eraser (button 5)
    board.dispatch({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'pen',
      point: { x: 10, y: 10 },
      screen: { x: 10, y: 10 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 5,
      buttons: 32,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });

    expect(board.tool).toBe('eraser');
    expect(actions).toEqual(['eraser-down']);

    // Release stylus eraser
    board.dispatch({
      type: 'pointer-up',
      pointerId: 1,
      pointerType: 'pen',
      point: { x: 10, y: 10 },
      screen: { x: 10, y: 10 },
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      button: 5,
      buttons: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });

    expect(board.tool).toBe('box');
    expect(actions).toEqual(['eraser-down', 'eraser-up']);
  });

  it('tidak crash atau switch bila tool penghapus tidak terdaftar', () => {
    const { board } = setup();
    board.setTool('box');

    board.dispatch({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'pen',
      point: { x: 10, y: 10 },
      screen: { x: 10, y: 10 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 5,
      buttons: 32,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });

    expect(board.tool).toBe('box');
  });
});

describe('event keyboard, wheel, dan pinch', () => {
  it('diteruskan ke handler state; tanpa handler, dispatch mengembalikan false', () => {
    const seen: string[] = [];
    const tool = defineTool({
      id: 'semua',
      initial: 'idle',
      states: {
        idle: {
          onKeyDown: (_c, e) => void seen.push(`down ${e.key}`),
          onKeyUp: (_c, e) => void seen.push(`up ${e.key}`),
          onWheel: (_c, e) => void seen.push(`wheel ${e.deltaY}`),
          onPinch: (_c, e) => void seen.push(`pinch ${e.phase} ${e.scale}`),
        },
      },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('semua');

    board.dispatch(key('key-down', 'a', 'KeyA'));
    board.dispatch(key('key-up', 'a', 'KeyA'));
    board.dispatch({
      type: 'wheel',
      point: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      deltaX: 0,
      deltaY: -120,
      modifiers: { ...NO_MODS, ctrl: true },
    });
    board.dispatch({
      type: 'pinch',
      phase: 'update',
      point: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      scale: 1.1,
      deltaX: 0,
      deltaY: 0,
    });
    expect(seen).toEqual(['down a', 'up a', 'wheel -120', 'pinch update 1.1']);

    board.setTool('select');
    expect(board.dispatch(key('key-down', 'a', 'KeyA'))).toBe(false);
  });

  it('BOARD-1902: a key handler returning false leaves the key unhandled', () => {
    const seen: string[] = [];
    const tool = defineTool({
      id: 'enter-only',
      initial: 'idle',
      states: {
        idle: {
          onKeyDown: (_c, e) => {
            seen.push(e.key);
            if (e.key !== 'Enter') return false;
            return 'active';
          },
          onKeyUp: () => false,
          // `false` from non-key handlers is ignored: the event still counts as handled.
          onWheel: () => false as never,
        },
        active: {},
      },
    });
    const { board } = setup();
    board.tools.register(tool);
    board.setTool('enter-only');

    expect(board.dispatch(key('key-down', 'Tab', 'Tab'))).toBe(false);
    expect(board.toolState).toBe('idle');
    expect(board.dispatch(key('key-up', 'Tab', 'Tab'))).toBe(false);
    expect(
      board.dispatch({
        type: 'wheel',
        point: { x: 0, y: 0 },
        screen: { x: 0, y: 0 },
        deltaX: 0,
        deltaY: 1,
        modifiers: NO_MODS,
      }),
    ).toBe(true);
    expect(board.dispatch(key('key-down', 'Enter', 'Enter'))).toBe(true);
    expect(board.toolState).toBe('active');
    expect(seen).toEqual(['Tab', 'Enter']);
  });
});

describe('siklus hidup', () => {
  it('melepas tool aktif membatalkan interaksi dan pindah ke tool bawaan', () => {
    const { board } = setup();
    const unregister = board.tools.register(boxTool({ id: 'box-sementara' }));
    board.setTool('box-sementara');
    board.dispatch(pointer('pointer-down', 0, 0));
    unregister();
    expect(elementIds(board)).toEqual([]);
    expect(board.tool).toBe('select');
    expect(board.tools.has('box-sementara')).toBe(false);
  });

  it('melepas tool aktif tanpa tool bawaan menyisakan papan tanpa tool', () => {
    const board = createBoard();
    const events: ToolEvent[] = [];
    board.on('tool', (e) => events.push(e));
    const unregister = board.tools.register(noopTool('pen'));
    board.setTool('pen');
    unregister();
    expect(board.tool).toBeNull();
    expect(events.at(-1)).toEqual({ id: null, previous: 'pen' });
  });

  it('data tool terpisah per board', () => {
    const a = setup().board;
    const b = setup().board;
    a.setTool('box');
    b.setTool('box');
    a.dispatch(pointer('pointer-down', 0, 0));
    b.dispatch(pointer('pointer-down', 5, 5));
    a.dispatch(pointer('pointer-move', 10, 10));
    a.dispatch(pointer('pointer-up', 10, 10));
    expect(a.getElement('el:1')).toMatchObject({ x: 0, w: 10 });
    expect(b.getElement('el:1')).toMatchObject({ x: 5, w: 0 });
  });

  it('dispose: setTool dan dispatch melempar', () => {
    const { board } = setup();
    board.setTool('box');
    board.dispose();
    expect(() => board.setTool('select')).toThrow('dispose');
    expect(() => board.dispatch(pointer('pointer-down', 0, 0))).toThrow('dispose');
  });
});

describe('interaksi pada elemen yang sudah ada', () => {
  /** Drag tool: moves element `el:target`; Alt+release deletes it. */
  const mover = defineTool({
    id: 'mover',
    initial: 'idle',
    data: () => ({ x: 0, y: 0 }),
    states: {
      idle: {
        onPointerDown(ctx, e) {
          ctx.data.x = e.point.x;
          ctx.data.y = e.point.y;
          return 'moving';
        },
      },
      moving: {
        onPointerMove(ctx, e) {
          const { x, y } = ctx.data;
          ctx.change((tx) => {
            const el = tx.get('el:target') as ElementRecord;
            tx.put({ ...el, x: 100 + e.point.x - x, y: 100 + e.point.y - y });
          });
        },
        onPointerUp(ctx, e) {
          if (e.modifiers.alt) ctx.change((tx) => void tx.remove('el:target'));
          return 'idle';
        },
      },
    },
  });

  function withTarget() {
    const { board } = setup();
    board.transact((tx) => tx.put(box('el:target', 100, 100, 10, 10)));
    board.history.clear();
    board.tools.register(mover);
    board.setTool('mover');
    return board;
  }

  it('memindah elemen menjadi satu langkah updated yang bisa di-undo', () => {
    const board = withTarget();
    drag(board, [
      [0, 0],
      [5, 5],
      [20, 30],
    ]);
    expect(board.getElement('el:target')).toMatchObject({ x: 120, y: 130 });

    const diffs: unknown[] = [];
    board.on('change', (e) => diffs.push(Object.keys(e.updated)));
    expect(board.undo()).toBe(true);
    expect(board.getElement('el:target')).toMatchObject({ x: 100, y: 100 });
    expect(diffs).toEqual([['el:target']]);
    expect(board.history.canUndo).toBe(false);
  });

  it('memindah lalu menghapus menjadi satu langkah removed; undo memulihkan posisi awal', () => {
    const board = withTarget();
    board.dispatch(pointer('pointer-down', 0, 0));
    board.dispatch(pointer('pointer-move', 50, 50));
    board.dispatch({ ...pointer('pointer-up', 50, 50), modifiers: { ...NO_MODS, alt: true } });
    expect(board.getElement('el:target')).toBeUndefined();

    board.undo();
    expect(board.getElement('el:target')).toMatchObject({ x: 100, y: 100 });
  });

  it('interaksi yang kembali ke nilai awal tidak mencatat langkah', () => {
    const board = withTarget();
    drag(board, [
      [0, 0],
      [40, 40],
      [0, 0],
    ]);
    expect(board.getElement('el:target')).toMatchObject({ x: 100, y: 100 });
    expect(board.history.canUndo).toBe(false);
  });

  it('Esc mengembalikan elemen yang dipindah ke posisi awal', () => {
    const board = withTarget();
    board.dispatch(pointer('pointer-down', 0, 0));
    board.dispatch(pointer('pointer-move', 70, 70));
    board.dispatch(escape());
    expect(board.getElement('el:target')).toMatchObject({ x: 100, y: 100 });
    expect(board.history.canUndo).toBe(false);
  });

  it('ctx.change di dalam transact melempar', () => {
    const nested = defineTool({
      id: 'bersarang',
      initial: 'idle',
      states: {
        idle: {
          onPointerDown(ctx) {
            ctx.board.transact(() => ctx.change(() => {}));
          },
        },
      },
    });
    const { board } = setup();
    board.tools.register(nested);
    board.setTool('bersarang');
    expect(() => board.dispatch(pointer('pointer-down', 0, 0))).toThrow('di dalam transaksi');
  });
});

describe('pengaman runtime', () => {
  it('onEnter yang saling melempar state dihentikan dengan error, bukan putaran tak terbatas', () => {
    const loop = defineTool({
      id: 'putar',
      initial: 'idle',
      states: {
        idle: { onPointerDown: () => 'a' },
        a: { onEnter: () => 'b' },
        b: { onEnter: () => 'a' },
      },
    });
    const { board } = setup();
    board.tools.register(loop);
    board.setTool('putar');
    expect(() => board.dispatch(pointer('pointer-down', 0, 0))).toThrow('terus-menerus');
    expect(board.toolState).toBe('idle');
  });

  it('ctx yang disimpan setelah tool tidak aktif tidak bisa mengubah dokumen', () => {
    let saved: { change(fn: () => void): void } | undefined;
    const leaky = defineTool({
      id: 'bocor',
      initial: 'idle',
      states: { idle: { onEnter: (ctx) => void (saved = ctx) } },
    });
    const { board } = setup();
    board.tools.register(leaky);
    board.setTool('bocor');
    board.setTool('select');
    expect(() => saved?.change(() => {})).toThrow('sudah tidak aktif');
  });
});
