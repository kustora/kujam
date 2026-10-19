import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type Board,
} from '../index.js';
import {
  createFramesRuntime,
  groupSelection,
  ungroupSelection,
  resolveTopmostGroupClick,
  enterGroupOnDoubleClick,
  collectContainerDescendants,
  reparentElementsToFrames,
  reconcileContainersInTransaction,
} from './containers.js';

const boxElement = defineElement({
  type: 'box',
  version: 1,
  props: object({ text: string() }),
  defaults: { text: '' },
});

const groupElement = defineElement({
  type: 'group',
  version: 1,
  props: object({}),
  defaults: {},
});

const frameElement = defineElement({
  type: 'frame',
  version: 1,
  props: object({}),
  defaults: {},
});

const testPlugin = definePlugin({
  id: 'test-containers',
  elements: [boxElement, groupElement, frameElement],
});

function createTestBoard(): Board {
  return createBoard({ plugins: [testPlugin] });
}

describe('BOARD-1104, BOARD-909, BOARD-1105: Containers in Core', () => {
  it('groups and ungroups elements correctly', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 10, y: 10, w: 100, h: 50, props: { text: '1' } })!;
    const e2 = board.create({ type: 'box', x: 50, y: 100, w: 200, h: 80, props: { text: '2' } })!;

    board.select([e1.id, e2.id]);
    const group = groupSelection(board);

    expect(group).toBeDefined();
    expect(group!.type).toBe('group');
    expect(group!.x).toBe(10);
    expect(group!.y).toBe(10);
    expect(group!.w).toBe(240); // minX=10, maxX=250 => 240
    expect(group!.h).toBe(170); // minY=10, maxY=180 => 170

    // Elements should now have parentId === group.id
    expect(board.getElement(e1.id)!.parentId).toBe(group!.id);
    expect(board.getElement(e2.id)!.parentId).toBe(group!.id);
    expect(board.selection).toEqual([group!.id]);

    // Ungroup
    const released = ungroupSelection(board);
    expect(released).toContain(e1.id);
    expect(released).toContain(e2.id);
    expect(board.getElement(group!.id)).toBeUndefined();
    expect(board.getElement(e1.id)!.parentId).toBeNull();
    expect(board.getElement(e2.id)!.parentId).toBeNull();

    // Single undo step restores the group
    board.undo();
    expect(board.getElement(group!.id)).toBeDefined();
    expect(board.getElement(e1.id)!.parentId).toBe(group!.id);
  });

  it('reconciles empty groups by deleting them and updates bounds', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 20, y: 20, w: 50, h: 50, props: { text: '1' } })!;
    const group = board.create({ type: 'group', x: 0, y: 0, w: 100, h: 100, props: {} })!;
    board.update(e1.id, { parentId: group.id });

    // Manually run reconciliation via a transaction
    board.transact((tx) => {
      reconcileContainersInTransaction(
        tx,
        new Map([[e1.id, board.getElement(e1.id)]]),
        new Map(Object.entries(board.getDocument().records)),
      );
    });

    // Group bounds should auto-update to e1 bounds (20, 20, 50, 50)
    const updatedGroup = board.getElement(group.id)!;
    expect(updatedGroup.x).toBe(20);
    expect(updatedGroup.y).toBe(20);
    expect(updatedGroup.w).toBe(50);
    expect(updatedGroup.h).toBe(50);

    // Delete e1 inside a transaction and run reconciliation: empty group should be auto-deleted
    const beforeRecords = new Map(Object.entries(board.getDocument().records));
    board.transact((tx) => {
      tx.remove(e1.id);
      reconcileContainersInTransaction(
        tx,
        new Map([[e1.id, undefined]]),
        beforeRecords,
      );
    });

    expect(board.getElement(group.id)).toBeUndefined();
  });

  it('sorts frames for presentation in list()', () => {
    const board = createTestBoard();
    // f1 at (100, 100)
    // f2 at (0, 0)
    // f3 at (500, 0)
    // f4 at (0, 100)
    const f1 = board.create({ type: 'frame', x: 100, y: 100, w: 100, h: 100, props: {} })!;
    const f2 = board.create({ type: 'frame', x: 0, y: 0, w: 100, h: 100, props: {} })!;
    const f3 = board.create({ type: 'frame', x: 500, y: 0, w: 100, h: 100, props: {} })!;
    const f4 = board.create({ type: 'frame', x: 0, y: 100, w: 100, h: 100, props: {} })!;

    const runtime = createFramesRuntime(() => board);
    const list = runtime.list();

    // Order should be: f2 (0,0), f3 (500,0), f4 (0,100), f1 (100,100)
    expect(list.map((f) => f.id)).toEqual([f2.id, f3.id, f4.id, f1.id]);
  });

  it('resolves group clicks and enters group on double click', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 10, y: 10, w: 100, h: 50, props: { text: '1' } })!;
    const e2 = board.create({ type: 'box', x: 50, y: 100, w: 200, h: 80, props: { text: '2' } })!;
    board.select([e1.id, e2.id]);
    const group = groupSelection(board)!;

    // Clicking child without entered group selects outermost group
    const resolved = resolveTopmostGroupClick(board, board.getElement(e1.id)!, null);
    expect(resolved.id).toBe(group.id);

    // Double clicking group enters it and selects child under point
    const entered = enterGroupOnDoubleClick(board, group, { x: 20, y: 20 });
    expect(entered).not.toBeNull();
    expect(entered!.enteredGroupId).toBe(group.id);
    expect(entered!.childId).toBe(e1.id);
    expect(board.selection).toEqual([e1.id]);

    // Clicking child with enteredGroupId selects child directly
    const clickedInside = resolveTopmostGroupClick(board, board.getElement(e1.id)!, group.id);
    expect(clickedInside.id).toBe(e1.id);
  });

  it('reparents elements when dragged into and out of frames', () => {
    const board = createTestBoard();
    const frame = board.create({ type: 'frame', x: 0, y: 0, w: 400, h: 400, props: {} })!;
    const el = board.create({ type: 'box', x: 500, y: 500, w: 50, h: 50, props: { text: '' } })!;

    expect(el.parentId).toBeNull();

    // Move el inside frame (center at 125, 125)
    board.update(el.id, { x: 100, y: 100 });
    reparentElementsToFrames(board, [el.id]);
    expect(board.getElement(el.id)!.parentId).toBe(frame.id);

    // Move el outside frame
    board.update(el.id, { x: 600, y: 600 });
    reparentElementsToFrames(board, [el.id]);
    expect(board.getElement(el.id)!.parentId).toBeNull();
  });

  it('collects container descendants recursively', () => {
    const board = createTestBoard();
    const frame = board.create({ type: 'frame', x: 0, y: 0, w: 400, h: 400, props: {} })!;
    const e1 = board.create({ type: 'box', parentId: frame.id, x: 10, y: 10, w: 50, h: 50, props: { text: '' } })!;
    const e2 = board.create({ type: 'box', parentId: frame.id, x: 70, y: 10, w: 50, h: 50, props: { text: '' } })!;
    board.select([e1.id, e2.id]);
    const group = groupSelection(board)!;

    const descendants = collectContainerDescendants(board, [frame.id]);
    const ids = descendants.map((d) => d.id);
    expect(ids).toContain(group.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
  });
});
