import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  type Board,
} from '../index.js';
import {
  alignElements,
  distributeElements,
  arrangeElementsGrid,
  arrangeElementsRow,
  ARRANGE_COMMANDS,
} from './arrange.js';

const boxElement = defineElement({
  type: 'box',
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
  id: 'test-elements',
  elements: [boxElement, frameElement],
});

function createTestBoard(): Board {
  return createBoard({ plugins: [testPlugin] });
}

describe('BOARD-905: Arrange Commands', () => {
  it('aligns elements to left, right, and center-h', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 10, y: 10, w: 100, h: 50, props: {} })!;
    const e2 = board.create({ type: 'box', x: 50, y: 100, w: 200, h: 80, props: {} })!;

    board.select([e1.id, e2.id]);

    // Align left: union minX is 10
    expect(alignElements(board, 'left')).toBe(true);
    expect(board.getElement(e1.id)!.x).toBe(10);
    expect(board.getElement(e2.id)!.x).toBe(10);

    // Align right: union maxX is max(10+100, 50+200) = 250
    // Wait: e1 was at x=10, e2 at x=10 after align left.
    // union maxX is max(10+100, 10+200) = 210
    expect(alignElements(board, 'right')).toBe(true);
    expect(board.getElement(e1.id)!.x).toBe(110); // 210 - 100
    expect(board.getElement(e2.id)!.x).toBe(10); // 210 - 200

    // Align center-h: minX=10, maxX=210 => center=110
    expect(alignElements(board, 'center-h')).toBe(true);
    // e1: w=100 => x = 110 - 50 = 60
    expect(board.getElement(e1.id)!.x).toBe(60);
    // e2: w=200 => x = 110 - 100 = 10
    expect(board.getElement(e2.id)!.x).toBe(10);
  });

  it('aligns elements to top, bottom, and center-v', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 0, y: 20, w: 50, h: 40, props: {} })!;
    const e2 = board.create({ type: 'box', x: 100, y: 80, w: 50, h: 60, props: {} })!;

    board.select([e1.id, e2.id]);

    // Align top: union minY is 20
    expect(alignElements(board, 'top')).toBe(true);
    expect(board.getElement(e1.id)!.y).toBe(20);
    expect(board.getElement(e2.id)!.y).toBe(20);

    // Align bottom: union maxY is max(20+40, 20+60) = 80
    expect(alignElements(board, 'bottom')).toBe(true);
    expect(board.getElement(e1.id)!.y).toBe(40); // 80 - 40
    expect(board.getElement(e2.id)!.y).toBe(20); // 80 - 60

    // Align center-v: minY=20, maxY=80 => center=50
    expect(alignElements(board, 'center-v')).toBe(true);
    expect(board.getElement(e1.id)!.y).toBe(30); // 50 - 20
    expect(board.getElement(e2.id)!.y).toBe(20); // 50 - 30
  });

  it('handles rotated elements using axis-aligned bounding boxes', () => {
    const board = createTestBoard();
    // A 100x50 box rotated 90 degrees around center
    const e1 = board.create({ type: 'box', x: 100, y: 100, w: 100, h: 50, rotation: Math.PI / 2, props: {} })!;
    const e2 = board.create({ type: 'box', x: 300, y: 100, w: 100, h: 100, props: {} })!;

    board.select([e1.id, e2.id]);
    expect(alignElements(board, 'top')).toBe(true);
    // Both element AABBs should align at top
    const b1 = board.spatial.getBounds(e1.id)!;
    const b2 = board.spatial.getBounds(e2.id)!;
    expect(b1.minY).toBeCloseTo(b2.minY);
  });

  it('distributes elements horizontally and vertically', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 0, y: 0, w: 100, h: 50, props: {} })!;
    const e2 = board.create({ type: 'box', x: 50, y: 0, w: 100, h: 50, props: {} })!;
    const e3 = board.create({ type: 'box', x: 400, y: 0, w: 100, h: 50, props: {} })!;

    board.select([e1.id, e2.id, e3.id]);

    expect(distributeElements(board, 'horizontal')).toBe(true);
    // Total span: 0 to 500 = 500
    // Total width: 100 + 100 + 100 = 300
    // Gap: (500 - 300) / 2 = 100
    // e1 at 0..100, e2 at 200..300, e3 at 400..500
    expect(board.getElement(e1.id)!.x).toBe(0);
    expect(board.getElement(e2.id)!.x).toBe(200);
    expect(board.getElement(e3.id)!.x).toBe(400);

    // Distribution vertically
    board.update(e1.id, { y: 0 });
    board.update(e2.id, { y: 20 });
    board.update(e3.id, { y: 200 });
    // Total span: 0 to 250 = 250
    // Total height: 50 + 50 + 50 = 150
    // Gap: (250 - 150) / 2 = 50
    // e1 at 0..50, e2 at 100..150, e3 at 200..250
    expect(distributeElements(board, 'vertical')).toBe(true);
    expect(board.getElement(e1.id)!.y).toBe(0);
    expect(board.getElement(e2.id)!.y).toBe(100);
    expect(board.getElement(e3.id)!.y).toBe(200);
  });

  it('arranges elements in a row', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 0, y: 50, w: 100, h: 40, props: {} })!;
    const e2 = board.create({ type: 'box', x: 200, y: 150, w: 80, h: 60, props: {} })!;
    const e3 = board.create({ type: 'box', x: 50, y: 300, w: 120, h: 50, props: {} })!;

    board.select([e1.id, e2.id, e3.id]);
    expect(arrangeElementsRow(board, { gap: 10 })).toBe(true);

    // Initial union minX is 0, minY is 50
    expect(board.getElement(e1.id)!.x).toBe(0);
    expect(board.getElement(e1.id)!.y).toBe(50);

    expect(board.getElement(e2.id)!.x).toBe(110); // 0 + 100 + 10
    expect(board.getElement(e2.id)!.y).toBe(50);

    expect(board.getElement(e3.id)!.x).toBe(200); // 110 + 80 + 10
    expect(board.getElement(e3.id)!.y).toBe(50);
  });

  it('arranges elements in a grid', () => {
    const board = createTestBoard();
    // 4 elements in a 2x2 grid
    const e1 = board.create({ type: 'box', x: 10, y: 20, w: 100, h: 50, props: {} })!;
    const e2 = board.create({ type: 'box', x: 50, y: 80, w: 120, h: 40, props: {} })!;
    const e3 = board.create({ type: 'box', x: 30, y: 200, w: 80, h: 60, props: {} })!;
    const e4 = board.create({ type: 'box', x: 90, y: 150, w: 100, h: 70, props: {} })!;

    board.select([e1.id, e2.id, e3.id, e4.id]);
    expect(arrangeElementsGrid(board, { columns: 2, gapX: 20, gapY: 30 })).toBe(true);

    // Initial union: minX = 10, minY = 20
    // Col 0: e1 (w=100), e3 (w=80) => maxCol0 = 100
    // Col 1: e2 (w=120), e4 (w=100) => maxCol1 = 120
    // Row 0: e1 (h=50), e2 (h=40) => maxRow0 = 50
    // Row 1: e3 (h=60), e4 (h=70) => maxRow1 = 70

    // e1: (r=0, c=0) => x=10, y=20
    expect(board.getElement(e1.id)!.x).toBe(10);
    expect(board.getElement(e1.id)!.y).toBe(20);

    // e2: (r=0, c=1) => x = 10 + 100 + 20 = 130, y = 20
    expect(board.getElement(e2.id)!.x).toBe(130);
    expect(board.getElement(e2.id)!.y).toBe(20);

    // e3: (r=1, c=0) => x = 10, y = 20 + 50 + 30 = 100
    expect(board.getElement(e3.id)!.x).toBe(10);
    expect(board.getElement(e3.id)!.y).toBe(100);

    // e4: (r=1, c=1) => x = 130, y = 100
    expect(board.getElement(e4.id)!.x).toBe(130);
    expect(board.getElement(e4.id)!.y).toBe(100);
  });

  it('moves container descendants along with parent', () => {
    const board = createTestBoard();
    const frame = board.create({ type: 'frame', x: 0, y: 0, w: 200, h: 200, props: {} })!;
    const child = board.create({ type: 'box', parentId: frame.id, x: 20, y: 30, w: 50, h: 50, props: {} })!;
    const other = board.create({ type: 'box', x: 300, y: 100, w: 100, h: 100, props: {} })!;

    board.select([frame.id, other.id]);
    expect(alignElements(board, 'left')).toBe(true);

    // frame was at 0, other at 300 => other moved to 0 (dx = -300)
    expect(board.getElement(other.id)!.x).toBe(0);

    // Now move other to 400 so maxX = 500
    board.update(other.id, { x: 400 });
    board.select([frame.id, other.id]);
    expect(alignElements(board, 'right')).toBe(true);
    // frame moved from 0 to 300 (dx = 300)
    expect(board.getElement(frame.id)!.x).toBe(300);
    // child should have moved by dx = 300: 20 + 300 = 320
    expect(board.getElement(child.id)!.x).toBe(320);
    expect(board.getElement(child.id)!.y).toBe(30);
  });

  it('restores state with a single undo step', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 10, y: 20, w: 100, h: 50, props: {} })!;
    const e2 = board.create({ type: 'box', x: 50, y: 80, w: 120, h: 40, props: {} })!;

    board.select([e1.id, e2.id]);
    alignElements(board, 'left');

    expect(board.getElement(e1.id)!.x).toBe(10);
    expect(board.getElement(e2.id)!.x).toBe(10);

    board.undo();
    expect(board.getElement(e1.id)!.x).toBe(10);
    expect(board.getElement(e2.id)!.x).toBe(50);

    board.redo();
    expect(board.getElement(e1.id)!.x).toBe(10);
    expect(board.getElement(e2.id)!.x).toBe(10);
  });

  it('is disabled when conditions are not met', () => {
    const board = createTestBoard();
    const e1 = board.create({ type: 'box', x: 10, y: 20, w: 100, h: 50, props: {} })!;
    const e2 = board.create({ type: 'box', x: 50, y: 80, w: 120, h: 40, locked: true, props: {} })!;

    // Locked element ignored => only 1 element
    board.select([e1.id, e2.id]);
    expect(alignElements(board, 'left')).toBe(false);
    expect(distributeElements(board, 'horizontal')).toBe(false);
    expect(arrangeElementsRow(board)).toBe(false);

    // When read-only
    board.update(e2.id, { locked: false });
    board.setReadOnly(true);
    expect(alignElements(board, 'left')).toBe(false);

    // Check command definitions
    const alignLeftCmd = ARRANGE_COMMANDS.find((c) => c.id === 'align.left')!;
    expect(alignLeftCmd.isEnabled(board)).toBe(false);
  });
});
