import { describe, expect, it } from 'vitest';
import {
  ANCHOR_PLACE_TOOL_ID,
  createBoard,
  defineTool,
  isAnchor,
  type AnchorEvent,
  type Board,
  type BoardInputEvent,
  type ElementRecord,
} from '../index.js';

function element(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'box',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 100,
    y: 100,
    rotation: 0,
    w: 200,
    h: 100,
    locked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...overrides,
  };
}

function boardWith(...elements: ElementRecord[]): Board {
  const board = createBoard();
  board.transact((tx) => {
    for (const el of elements) tx.put(el);
  });
  return board;
}

function pointer(
  type: 'pointer-down' | 'pointer-up' | 'pointer-move',
  x: number,
  y: number,
  board: Board,
): BoardInputEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point: board.camera.screenToBoard({ x, y }),
    screen: { x, y },
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

function click(board: Board, x: number, y: number): void {
  board.dispatch(pointer('pointer-down', x, y, board));
  board.dispatch(pointer('pointer-up', x, y, board));
}

const idleTool = (id: string) => defineTool({ id, initial: 'idle', states: { idle: {} } });

describe('BOARD-1211: comment anchors', () => {
  it('validates anchors with isAnchor', () => {
    expect(isAnchor({ kind: 'point', x: 1, y: 2 })).toBe(true);
    expect(isAnchor({ kind: 'point', x: 1, y: 2, pageId: 'page:main' })).toBe(true);
    expect(isAnchor({ kind: 'element', elementId: 'a', offset: { x: 0, y: 0 } })).toBe(true);
    expect(isAnchor({ kind: 'point', x: Number.NaN, y: 2 })).toBe(false);
    expect(isAnchor({ kind: 'element', elementId: '', offset: { x: 0, y: 0 } })).toBe(false);
    expect(isAnchor({ kind: 'element', elementId: 'a' })).toBe(false);
    expect(isAnchor(null)).toBe(false);
  });

  it('resolves point and element anchors, including rotation', () => {
    const board = boardWith(element('el:a'));
    expect(board.anchors.resolve({ kind: 'point', x: 5, y: 6 })).toEqual({
      x: 5,
      y: 6,
      pageId: null,
    });
    const anchor = { kind: 'element', elementId: 'el:a', offset: { x: 200, y: 0 } } as const;
    expect(board.anchors.resolve(anchor)).toEqual({ x: 300, y: 100, pageId: 'page:main' });

    // Rotating 180° around the center (200, 150) maps the top-right corner to the bottom-left.
    board.transact((tx) => tx.put(element('el:a', { rotation: 180 })));
    const rotated = board.anchors.resolve(anchor)!;
    expect(rotated.x).toBeCloseTo(100);
    expect(rotated.y).toBeCloseTo(200);

    expect(
      board.anchors.resolve({ kind: 'element', elementId: 'missing', offset: { x: 0, y: 0 } }),
    ).toBeNull();
    expect(() => board.anchors.resolve({ kind: 'nope' } as never)).toThrow(TypeError);
  });

  it('converts anchors to screen coordinates with the camera', () => {
    const board = boardWith(element('el:a'));
    board.setCamera({ x: 50, y: 20, zoom: 2 });
    const anchor = { kind: 'element', elementId: 'el:a', offset: { x: 10, y: 10 } } as const;
    expect(board.anchors.toScreen(anchor)).toEqual(board.camera.boardToScreen({ x: 110, y: 110 }));
    expect(board.anchors.toScreen({ kind: 'point', x: 0, y: 0 })).toEqual(
      board.camera.boardToScreen({ x: 0, y: 0 }),
    );
    board.transact((tx) => tx.remove('el:a'));
    expect(board.anchors.toScreen(anchor)).toBeNull();
  });

  it('creates anchors from points: element under the point, or the point itself', () => {
    const board = boardWith(element('el:a'), element('el:locked', { x: 500, locked: true }));
    expect(board.anchors.fromPoint({ x: 150, y: 120 })).toEqual({
      kind: 'element',
      elementId: 'el:a',
      offset: { x: 50, y: 20 },
    });
    expect(board.anchors.fromPoint({ x: 10, y: 10 })).toEqual({
      kind: 'point',
      x: 10,
      y: 10,
      pageId: 'page:main',
    });
    expect(board.anchors.fromPoint({ x: 150, y: 120 }, { target: 'point' })?.kind).toBe('point');
    expect(board.anchors.fromPoint({ x: 10, y: 10 }, { target: 'element' })).toBeNull();
    // Locked elements can be annotated by default.
    expect(board.anchors.fromPoint({ x: 550, y: 120 })).toMatchObject({ elementId: 'el:locked' });
    expect(board.anchors.fromPoint({ x: 550, y: 120 }, { includeLocked: false })?.kind).toBe(
      'point',
    );
    expect(
      board.anchors.fromPoint({ x: 150, y: 120 }, { filter: (el) => el.id !== 'el:a' })?.kind,
    ).toBe('point');
    expect(Object.isFrozen(board.anchors.fromPoint({ x: 1, y: 1 }))).toBe(true);
  });

  it('creates element anchors with forElement', () => {
    const board = boardWith(element('el:a'));
    expect(board.anchors.forElement('el:a')).toEqual({
      kind: 'element',
      elementId: 'el:a',
      offset: { x: 0, y: 0 },
    });
    expect(board.anchors.forElement('el:a', { x: 120, y: 130 }).offset).toEqual({ x: 20, y: 30 });
    expect(() => board.anchors.forElement('missing')).toThrow();
  });

  it('emits anchor events when the element moves, is deleted, and comes back', () => {
    const board = boardWith(element('el:a'), element('el:b', { x: 400 }));
    const events: AnchorEvent[] = [];
    board.on('anchor', (e) => events.push(e));
    const anchor = board.anchors.forElement('el:a', { x: 110, y: 110 });
    board.anchors.track('comment-1', anchor);
    board.anchors.track('comment-2', { kind: 'point', x: 1, y: 1 });

    board.transact((tx) => tx.put(element('el:a', { x: 150 })));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'comment-1',
      reason: 'move',
      position: { x: 160, y: 110, pageId: 'page:main' },
      previous: { x: 110, y: 110, pageId: 'page:main' },
    });

    // Changes to other elements, or that leave the anchor in place, emit nothing.
    board.transact((tx) => tx.put(element('el:b', { x: 410 })));
    board.transact((tx) => tx.put(element('el:a', { x: 150, props: { color: 'red' } })));
    expect(events).toHaveLength(1);

    board.transact((tx) => tx.remove('el:a'));
    expect(events[1]).toMatchObject({ id: 'comment-1', reason: 'remove', position: null });

    board.undo();
    expect(events[2]).toMatchObject({
      id: 'comment-1',
      reason: 'restore',
      position: { x: 160, y: 110 },
      previous: null,
    });
  });

  it('reports remote changes and loadDocument too, and stops after untrack', () => {
    const board = boardWith(element('el:a'));
    const events: AnchorEvent[] = [];
    board.on('anchor', (e) => events.push(e));
    const stop = board.anchors.track('c', board.anchors.forElement('el:a'));
    expect(board.anchors.get('c')).toEqual(board.anchors.forElement('el:a'));
    expect(board.anchors.list()).toHaveLength(1);

    board.transact((tx) => tx.put(element('el:a', { y: 300 })), { origin: 'remote' });
    expect(events.map((e) => e.reason)).toEqual(['move']);

    const doc = board.getDocument();
    const { ['el:a']: _removed, ...rest } = doc.records;
    board.loadDocument({ ...doc, records: rest });
    expect(events.map((e) => e.reason)).toEqual(['move', 'remove']);

    stop();
    expect(board.anchors.list()).toHaveLength(0);
    board.loadDocument(doc);
    expect(events).toHaveLength(2);
  });

  it('place(): one click resolves with an anchor and restores the previous tool', async () => {
    const board = boardWith(element('el:a'));
    board.tools.register(idleTool('select'));
    board.tools.register(idleTool('pen'));
    board.setTool('pen');

    const placed = board.anchors.place();
    expect(board.anchors.placing).toBe(true);
    expect(board.tool).toBe(ANCHOR_PLACE_TOOL_ID);
    expect(board.cursor).toBe('crosshair');

    click(board, 150, 120);
    await expect(placed).resolves.toEqual({
      kind: 'element',
      elementId: 'el:a',
      offset: { x: 50, y: 20 },
    });
    expect(board.anchors.placing).toBe(false);
    expect(board.tool).toBe('pen');
    expect(board.tools.has(ANCHOR_PLACE_TOOL_ID)).toBe(false);
    // Placing changes nothing in the document.
    expect(board.history.canUndo).toBe(true);
    expect(board.getDocument().records['el:a']).toEqual(element('el:a'));
  });

  it('place(): a drag is not a click, and options are respected', async () => {
    const board = boardWith(element('el:a'));
    const placed = board.anchors.place({ target: 'point' });
    board.dispatch(pointer('pointer-down', 10, 10, board));
    board.dispatch(pointer('pointer-move', 60, 60, board));
    board.dispatch(pointer('pointer-up', 60, 60, board));
    await Promise.resolve();
    expect(board.anchors.placing).toBe(true);

    click(board, 150, 120);
    await expect(placed).resolves.toEqual({ kind: 'point', x: 150, y: 120, pageId: 'page:main' });
  });

  it('place(): Esc, switching tools, cancelPlace, and dispose resolve with null', async () => {
    const board = boardWith(element('el:a'));
    board.tools.register(idleTool('select'));
    board.tools.register(idleTool('pen'));
    board.setTool('select');

    const esc = board.anchors.place();
    board.dispatch({
      type: 'key-down',
      key: 'Escape',
      code: 'Escape',
      repeat: false,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    } as BoardInputEvent);
    await expect(esc).resolves.toBeNull();
    expect(board.tool).toBe('select');

    const switched = board.anchors.place();
    board.setTool('pen');
    await expect(switched).resolves.toBeNull();
    expect(board.tool).toBe('pen');

    const cancelled = board.anchors.place();
    board.anchors.cancelPlace();
    await expect(cancelled).resolves.toBeNull();
    expect(board.tool).toBe('pen');

    const first = board.anchors.place();
    const second = board.anchors.place();
    await expect(first).resolves.toBeNull();
    expect(board.anchors.placing).toBe(true);
    board.anchors.cancelPlace();
    await expect(second).resolves.toBeNull();
    expect(board.tool).toBe('pen');

    const disposed = board.anchors.place();
    board.dispose();
    await expect(disposed).resolves.toBeNull();
  });

  it('place() works on read-only boards', async () => {
    const board = boardWith(element('el:a'));
    board.setReadOnly(true);
    const placed = board.anchors.place();
    click(board, 150, 120);
    await expect(placed).resolves.toMatchObject({ kind: 'element', elementId: 'el:a' });
  });
});
