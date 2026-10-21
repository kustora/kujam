import { describe, expect, it, vi } from 'vitest';
import {
  ReadOnlyBoardError,
  createBoard,
  defineElement,
  definePlugin,
  number,
  object,
  string,
  type BindingRecord,
  type BoardErrorEvent,
  type ChangeEvent,
  type ElementRecord,
  type PermissionHook,
} from '../index.js';

const stickyElement = defineElement({
  type: 'sticky',
  version: 1,
  props: object({
    text: string(),
    color: string(),
  }),
  defaults: {
    text: 'Hello sticky',
    color: 'yellow',
  },
  minSize: { w: 40, h: 40 },
});

const geoElement = defineElement({
  type: 'geo',
  version: 1,
  props: object({
    shape: string(),
    fill: string(),
  }),
  defaults: {
    shape: 'rectangle',
    fill: 'blue',
  },
  minSize: { w: 20, h: 20 },
});

const bigElement = defineElement({
  type: 'big-card',
  version: 1,
  props: object({
    title: string(),
  }),
  defaults: {
    title: 'Card',
  },
  minSize: { w: 200, h: 150 },
});

const frameElement = defineElement({
  type: 'frame',
  version: 1,
  props: object({
    name: string(),
  }),
  defaults: {
    name: 'Frame',
  },
});

const connectorElement = defineElement({
  type: 'connector',
  version: 1,
  props: object({
    startBindingId: string(),
    endBindingId: string(),
  }),
  defaults: {
    startBindingId: '',
    endBindingId: '',
  },
});

const strictElement = defineElement({
  type: 'strict',
  version: 1,
  props: object({
    score: number(),
  }),
  defaults: {
    score: 100,
  },
});

const testPlugin = definePlugin({
  id: 'test-plugin',
  elements: [
    stickyElement,
    geoElement,
    bigElement,
    frameElement,
    connectorElement,
    strictElement,
  ],
});

describe('BOARD-606: board.replaceElements(ids, factory, options?)', () => {
  describe('Criterion 1: Replace elements preserving coordinates, size, parentId, pageId, index in 1 transaction', () => {
    it('replaces a single element keeping geometry, parentId, pageId, and index', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({
        type: 'sticky',
        x: 120,
        y: 240,
        w: 80,
        h: 90,
        rotation: 0.5,
        opacity: 0.8,
        meta: { author: 'Alice' },
      })!;

      const changeEvents: ChangeEvent[] = [];
      board.on('change', (e) => changeEvents.push(e));

      const replaced = board.replaceElements(orig.id, (oldEl) => ({
        type: 'geo',
        props: { shape: 'ellipse', fill: 'green' },
      }));

      // Synchronous return of array
      expect(Array.isArray(replaced)).toBe(true);
      expect(replaced).toHaveLength(1);
      const newEl = replaced[0]!;

      expect(newEl.id).not.toBe(orig.id);
      expect(newEl.type).toBe('geo');
      expect(newEl.x).toBe(120);
      expect(newEl.y).toBe(240);
      expect(newEl.w).toBe(80);
      expect(newEl.h).toBe(90);
      expect(newEl.rotation).toBe(0.5);
      expect(newEl.opacity).toBe(0.8);
      expect(newEl.pageId).toBe(orig.pageId);
      expect(newEl.parentId).toBe(orig.parentId);
      expect(newEl.index).toBe(orig.index);
      expect(newEl.meta).toEqual({ author: 'Alice' });
      expect(newEl.props).toEqual({ shape: 'ellipse', fill: 'green' });

      // Old element no longer in document
      expect(board.getElement(orig.id)).toBeUndefined();
      expect(board.getElement(newEl.id)).toBeDefined();

      // Exactly 1 change event emitted
      expect(changeEvents).toHaveLength(1);
      expect(Object.keys(changeEvents[0]!.removed)).toHaveLength(1);
      expect(Object.keys(changeEvents[0]!.added)).toHaveLength(1);

      board.dispose();
    });

    it('allows overriding size and meta explicitly in ElementInput', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({
        type: 'sticky',
        x: 10,
        y: 20,
        w: 50,
        h: 50,
      })!;

      const replaced = board.replaceElements(orig.id, () => ({
        type: 'geo',
        w: 120,
        h: 140,
        meta: { custom: true },
      }));

      expect(replaced).toHaveLength(1);
      expect(replaced[0]!.w).toBe(120);
      expect(replaced[0]!.h).toBe(140);
      expect(replaced[0]!.meta).toEqual({ custom: true });

      board.dispose();
    });

    it('enforces minSize from the target type definition if larger than old element size', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({
        type: 'geo',
        w: 30,
        h: 30,
      })!;

      // big-card has minSize { w: 200, h: 150 }
      const replaced = board.replaceElements(orig.id, () => ({
        type: 'big-card',
      }));

      expect(replaced).toHaveLength(1);
      expect(replaced[0]!.w).toBe(200);
      expect(replaced[0]!.h).toBe(150);

      board.dispose();
    });

    it('replaces multiple elements in a single transaction with a single change event', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const el1 = board.create({ id: 'el-1', type: 'sticky', x: 0, y: 0 })!;
      const el2 = board.create({ id: 'el-2', type: 'sticky', x: 100, y: 100 })!;

      const changeEvents: ChangeEvent[] = [];
      board.on('change', (e) => changeEvents.push(e));

      const replaced = board.replaceElements([el1.id, el2.id], (oldEl) => ({
        type: 'geo',
        props: { shape: oldEl.id === 'el-1' ? 'circle' : 'diamond' },
      }));

      expect(replaced).toHaveLength(2);
      expect(changeEvents).toHaveLength(1);
      expect(Object.keys(changeEvents[0]!.removed)).toHaveLength(2);
      expect(Object.keys(changeEvents[0]!.added)).toHaveLength(2);

      expect(board.getElement('el-1')).toBeUndefined();
      expect(board.getElement('el-2')).toBeUndefined();

      board.dispose();
    });

    it('reparents children when a container element is replaced', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const frame = board.create({ id: 'frame-1', type: 'frame' })!;
      const child = board.create({ id: 'child-1', type: 'sticky', parentId: frame.id })!;

      // Replace frame with another frame
      const replaced = board.replaceElements(frame.id, () => ({
        type: 'frame',
        props: { name: 'New Frame' },
      }));

      const newFrame = replaced[0]!;
      expect(board.getElement(child.id)?.parentId).toBe(newFrame.id);

      board.dispose();
    });

    it('unsets children parentId when a container is replaced by a non-container', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const frame = board.create({ id: 'frame-1', type: 'frame' })!;
      const child = board.create({ id: 'child-1', type: 'sticky', parentId: frame.id })!;

      // Replace frame with a sticky note (non-container)
      board.replaceElements(frame.id, () => ({
        type: 'sticky',
      }));

      expect(board.getElement(child.id)?.parentId).toBeNull();

      board.dispose();
    });

    it('updates selection to new elements when old elements were selected', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const el1 = board.create({ id: 'el-1', type: 'sticky' })!;
      const el2 = board.create({ id: 'el-2', type: 'sticky' })!;

      board.select([el1.id]);
      expect(board.selection).toEqual(['el-1']);

      const replaced = board.replaceElements(el1.id, () => ({
        type: 'geo',
      }));

      expect(board.selection).toEqual([replaced[0]!.id]);

      // When options.select is false, selection is not updated
      board.select([el2.id]);
      const replaced2 = board.replaceElements(
        el2.id,
        () => ({ type: 'geo' }),
        { select: false },
      );
      // el2 was removed so selection dropped it
      expect(board.selection).not.toContain(replaced2[0]!.id);

      board.dispose();
    });
  });

  describe('Criterion 2: Connector bindings repointing', () => {
    it('repoints BindingRecord where toId === oldId to toId === newId', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const target = board.create({ id: 'target-1', type: 'sticky', x: 200, y: 200 })!;
      const source = board.create({ id: 'source-1', type: 'sticky', x: 0, y: 0 })!;

      const binding: BindingRecord = {
        id: 'bind-1',
        kind: 'binding',
        fromId: source.id,
        toId: target.id,
        anchor: { x: 0.5, y: 0.5 },
      };
      board.transact((tx) => {
        tx.put(binding);
      });

      const replaced = board.replaceElements(target.id, () => ({
        type: 'geo',
      }));

      const newTarget = replaced[0]!;
      const updatedBinding = board.getDocument().records['bind-1'] as BindingRecord;

      expect(updatedBinding).toBeDefined();
      expect(updatedBinding.kind).toBe('binding');
      expect(updatedBinding.fromId).toBe(source.id);
      expect(updatedBinding.toId).toBe(newTarget.id);
      expect(updatedBinding.anchor).toEqual({ x: 0.5, y: 0.5 });

      board.dispose();
    });

    it('repoints BindingRecord where fromId === oldId to fromId === newId', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const target = board.create({ id: 'target-1', type: 'sticky', x: 200, y: 200 })!;
      const source = board.create({ id: 'source-1', type: 'sticky', x: 0, y: 0 })!;

      const binding: BindingRecord = {
        id: 'bind-1',
        kind: 'binding',
        fromId: source.id,
        toId: target.id,
        anchor: { x: 0.2, y: 0.8 },
      };
      board.transact((tx) => {
        tx.put(binding);
      });

      const replaced = board.replaceElements(source.id, () => ({
        type: 'geo',
      }));

      const newSource = replaced[0]!;
      const updatedBinding = board.getDocument().records['bind-1'] as BindingRecord;

      expect(updatedBinding).toBeDefined();
      expect(updatedBinding.fromId).toBe(newSource.id);
      expect(updatedBinding.toId).toBe(target.id);

      board.dispose();
    });

    it('repoints both fromId and toId when both connected elements are replaced together', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const elA = board.create({ id: 'el-a', type: 'sticky' })!;
      const elB = board.create({ id: 'el-b', type: 'sticky' })!;

      const binding: BindingRecord = {
        id: 'bind-ab',
        kind: 'binding',
        fromId: elA.id,
        toId: elB.id,
        anchor: { x: 0.5, y: 0.5 },
      };
      board.transact((tx) => {
        tx.put(binding);
      });

      const replaced = board.replaceElements([elA.id, elB.id], () => ({
        type: 'geo',
      }));

      const newA = replaced.find((r) => r.props.shape === 'rectangle' && r.x === elA.x)!;
      const newB = replaced.find((r) => r.id !== newA.id)!;

      const updatedBinding = board.getDocument().records['bind-ab'] as BindingRecord;
      expect(updatedBinding).toBeDefined();
      expect(updatedBinding.fromId).toBe(newA.id);
      expect(updatedBinding.toId).toBe(newB.id);

      board.dispose();
    });
  });

  describe('Criterion 3: Single Undo restores old element(s) and original bindings exactly', () => {
    it('restores original elements and bindings on undo and reapplies on redo', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const elA = board.create({
        id: 'orig-a',
        type: 'sticky',
        x: 50,
        y: 60,
        w: 70,
        h: 80,
        props: { text: 'Note A', color: 'pink' },
      })!;
      const elB = board.create({
        id: 'orig-b',
        type: 'sticky',
        x: 200,
        y: 200,
      })!;

      const binding: BindingRecord = {
        id: 'bind-ab',
        kind: 'binding',
        fromId: elA.id,
        toId: elB.id,
        anchor: { x: 0.5, y: 0.5 },
      };
      board.transact((tx) => {
        tx.put(binding);
      });

      const replaced = board.replaceElements(elA.id, () => ({
        type: 'geo',
        props: { shape: 'triangle', fill: 'purple' },
      }));
      const newId = replaced[0]!.id;

      expect(board.getElement('orig-a')).toBeUndefined();
      expect(board.getElement(newId)).toBeDefined();
      expect((board.getDocument().records['bind-ab'] as BindingRecord).fromId).toBe(newId);

      // Single Undo
      const undoResult = board.undo();
      expect(undoResult).toBe(true);

      // Restored exactly
      const restored = board.getElement('orig-a');
      expect(restored).toBeDefined();
      expect(restored?.type).toBe('sticky');
      expect(restored?.props.text).toBe('Note A');
      expect(restored?.props.color).toBe('pink');
      expect(restored?.x).toBe(50);
      expect(restored?.y).toBe(60);
      expect(restored?.w).toBe(70);
      expect(restored?.h).toBe(80);

      expect(board.getElement(newId)).toBeUndefined();

      // Binding restored to point to orig-a
      const restoredBinding = board.getDocument().records['bind-ab'] as BindingRecord;
      expect(restoredBinding.fromId).toBe('orig-a');

      // Redo
      const redoResult = board.redo();
      expect(redoResult).toBe(true);
      expect(board.getElement('orig-a')).toBeUndefined();
      expect(board.getElement(newId)).toBeDefined();
      expect((board.getDocument().records['bind-ab'] as BindingRecord).fromId).toBe(newId);

      board.dispose();
    });

    it('respects mergeKey and label options for history', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({ type: 'sticky' })!;

      board.replaceElements(
        orig.id,
        () => ({ type: 'geo' }),
        { label: 'custom-replace' },
      );

      // Can undo step
      expect(board.history.canUndo).toBe(true);
      board.undo();
      expect(board.getElement(orig.id)).toBeDefined();

      board.dispose();
    });
  });

  describe('Criterion 4: Async and sync factory, transient isReplacing state, error recovery', () => {
    it('executes synchronous factory immediately without returning a Promise', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({ type: 'sticky' })!;

      let insideFactoryCalled = false;
      const res = board.replaceElements(orig.id, () => {
        insideFactoryCalled = true;
        return { type: 'geo' };
      });

      expect(insideFactoryCalled).toBe(true);
      expect(res).not.toBeInstanceOf(Promise);
      expect(Array.isArray(res)).toBe(true);
      expect(board.isReplacing(orig.id)).toBe(false);

      board.dispose();
    });

    it('marks element in transient isReplacing state during async factory and resolves', async () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({ id: 'el-async', type: 'sticky' })!;
      const other = board.create({ id: 'el-other', type: 'sticky' })!;

      expect(board.isReplacing(orig.id)).toBe(false);

      let resolveFactory!: (val: { type: string }) => void;
      const factoryPromise = new Promise<{ type: string }>((resolve) => {
        resolveFactory = resolve;
      });

      const replacePromise = board.replaceElements(orig.id, async () => {
        return factoryPromise;
      });

      // Transient state is active
      expect(board.isReplacing('el-async')).toBe(true);
      expect(board.isReplacing('el-other')).toBe(false);
      expect(board.isReplacing('unknown-id')).toBe(false);

      // Document record is NOT modified yet
      expect(board.getElement('el-async')?.type).toBe('sticky');

      // Resolve the factory
      resolveFactory({ type: 'geo' });
      const result = await replacePromise;

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('geo');

      // Transient state cleared
      expect(board.isReplacing('el-async')).toBe(false);
      expect(board.getElement('el-async')).toBeUndefined();

      board.dispose();
    });

    it('clears transient state and rethrows when sync factory throws without touching document', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({ id: 'el-throw', type: 'sticky' })!;

      expect(() => {
        board.replaceElements(orig.id, () => {
          throw new Error('Sync factory error');
        });
      }).toThrow('Sync factory error');

      expect(board.isReplacing('el-throw')).toBe(false);
      expect(board.getElement('el-throw')).toBeDefined();
      expect(board.getElement('el-throw')?.type).toBe('sticky');

      board.dispose();
    });

    it('clears transient state and rethrows when async factory rejects without touching document', async () => {
      const board = createBoard({ plugins: [testPlugin] });
      const orig = board.create({ id: 'el-reject', type: 'sticky' })!;

      await expect(
        board.replaceElements(orig.id, async () => {
          await new Promise((r) => setTimeout(r, 10));
          throw new Error('Async factory rejection');
        }),
      ).rejects.toThrow('Async factory rejection');

      expect(board.isReplacing('el-reject')).toBe(false);
      expect(board.getElement('el-reject')).toBeDefined();
      expect(board.getElement('el-reject')?.type).toBe('sticky');

      board.dispose();
    });
  });

  describe('Criterion 5: Permission checks', () => {
    it('blocks replacement when replace permission returns false', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const hook: PermissionHook = (action) => {
        if (action === 'replace') return false;
        return true;
      };

      const board = createBoard({ plugins: [testPlugin], permissions: hook });
      board.on('error', (e) => errorEvents.push(e));

      const orig = board.create({ id: 'el-p1', type: 'sticky' })!;
      const replaced = board.replaceElements(orig.id, () => ({ type: 'geo' }));

      expect(replaced).toEqual([]);
      expect(board.getElement('el-p1')).toBeDefined();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.code).toBe('forbidden');
      expect(errorEvents[0]!.message).toContain('replace');

      board.dispose();
    });

    it('blocks replacement when update permission returns false', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const hook: PermissionHook = (action) => {
        if (action === 'update') return false;
        return true;
      };

      const board = createBoard({ plugins: [testPlugin], permissions: hook });
      board.on('error', (e) => errorEvents.push(e));

      const orig = board.create({ id: 'el-p2', type: 'sticky' })!;
      const replaced = board.replaceElements(orig.id, () => ({ type: 'geo' }));

      expect(replaced).toEqual([]);
      expect(board.getElement('el-p2')).toBeDefined();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.code).toBe('forbidden');
      expect(errorEvents[0]!.message).toContain('update');

      board.dispose();
    });

    it('blocks replacement when delete permission returns false', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const hook: PermissionHook = (action) => {
        if (action === 'delete') return false;
        return true;
      };

      const board = createBoard({ plugins: [testPlugin], permissions: hook });
      board.on('error', (e) => errorEvents.push(e));

      const orig = board.create({ id: 'el-p3', type: 'sticky' })!;
      const replaced = board.replaceElements(orig.id, () => ({ type: 'geo' }));

      expect(replaced).toEqual([]);
      expect(board.getElement('el-p3')).toBeDefined();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.code).toBe('forbidden');
      expect(errorEvents[0]!.message).toContain('delete');

      board.dispose();
    });

    it('blocks replacement when create permission on the new element returns false', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const hook: PermissionHook = (action, el) => {
        if (action === 'create' && el?.type === 'geo') return false;
        return true;
      };

      const board = createBoard({ plugins: [testPlugin], permissions: hook });
      board.on('error', (e) => errorEvents.push(e));

      const orig = board.create({ id: 'el-p4', type: 'sticky' })!;
      const replaced = board.replaceElements(orig.id, () => ({ type: 'geo' }));

      expect(replaced).toEqual([]);
      expect(board.getElement('el-p4')).toBeDefined();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.code).toBe('forbidden');
      expect(errorEvents[0]!.message).toContain('create');

      board.dispose();
    });

    it('cancels batch replacement atomically if any element is forbidden', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const hook: PermissionHook = (action, el) => {
        if (action === 'replace' && el?.id === 'forbidden-el') return false;
        return true;
      };

      const board = createBoard({ plugins: [testPlugin], permissions: hook });
      board.on('error', (e) => errorEvents.push(e));

      const el1 = board.create({ id: 'allowed-el', type: 'sticky' })!;
      const el2 = board.create({ id: 'forbidden-el', type: 'sticky' })!;

      const replaced = board.replaceElements([el1.id, el2.id], () => ({ type: 'geo' }));

      expect(replaced).toEqual([]);
      expect(errorEvents).toHaveLength(1);
      expect(board.getElement('allowed-el')?.type).toBe('sticky');
      expect(board.getElement('forbidden-el')?.type).toBe('sticky');

      board.dispose();
    });
  });

  describe('Edge cases and error handling', () => {
    it('throws ReadOnlyBoardError when board is readOnly', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const el = board.create({ type: 'sticky' })!;
      board.setReadOnly(true);

      expect(() => {
        board.replaceElements(el.id, () => ({ type: 'geo' }));
      }).toThrow(ReadOnlyBoardError);

      board.dispose();
    });

    it('throws when board is disposed', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const el = board.create({ type: 'sticky' })!;
      board.dispose();

      expect(() => {
        board.replaceElements(el.id, () => ({ type: 'geo' }));
      }).toThrow('Papan sudah di-dispose.');
    });

    it('validates argument types for ids and factory', () => {
      const board = createBoard({ plugins: [testPlugin] });

      expect(() => {
        // @ts-expect-error invalid ids argument
        board.replaceElements(123, () => ({ type: 'geo' }));
      }).toThrow(TypeError);

      expect(() => {
        // @ts-expect-error invalid factory argument
        board.replaceElements('some-id', null);
      }).toThrow(TypeError);

      board.dispose();
    });

    it('emits invalid-props error when factory returns an unregistered element type', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const board = createBoard({ plugins: [testPlugin] });
      board.on('error', (e) => errorEvents.push(e));

      const el = board.create({ type: 'sticky' })!;
      const replaced = board.replaceElements(el.id, () => ({ type: 'unknown-type' }));

      expect(replaced).toEqual([]);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.code).toBe('invalid-props');
      expect(board.getElement(el.id)).toBeDefined();

      board.dispose();
    });

    it('emits invalid-props error when factory returns props that fail schema validation', () => {
      const errorEvents: BoardErrorEvent[] = [];
      const board = createBoard({ plugins: [testPlugin] });
      board.on('error', (e) => errorEvents.push(e));

      const el = board.create({ type: 'sticky' })!;
      const replaced = board.replaceElements(el.id, () => ({
        type: 'strict',
        // @ts-expect-error score must be a number
        props: { score: 'not-a-number' },
      }));

      expect(replaced).toEqual([]);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.code).toBe('invalid-props');
      expect(board.getElement(el.id)).toBeDefined();

      board.dispose();
    });

    it('skips locked elements unless options.force is true', () => {
      const board = createBoard({ plugins: [testPlugin] });
      const locked = board.create({ id: 'locked-note', type: 'sticky', locked: true })!;

      // Without force: skipped
      const res = board.replaceElements(locked.id, () => ({ type: 'geo' }));
      expect(res).toEqual([]);
      expect(board.getElement('locked-note')?.type).toBe('sticky');

      // With force: replaced
      const resForced = board.replaceElements(
        locked.id,
        () => ({ type: 'geo' }),
        { force: true },
      );
      expect(resForced).toHaveLength(1);
      expect(resForced[0]!.type).toBe('geo');
      expect(board.getElement('locked-note')).toBeUndefined();

      board.dispose();
    });
  });
});
