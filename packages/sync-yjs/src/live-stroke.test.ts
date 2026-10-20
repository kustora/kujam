import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness.js';
import {
  attachSync,
  createBoard,
  defineTool,
  type ElementRecord,
  type PresenceUser,
} from '@kujam/core';
import { createYjsPresence, createYjsSyncAdapter, type LiveStroke } from './index.js';

interface MockDrawData {
  points: number[][];
  activeStroke: LiveStroke | null;
  elementId: string | null;
}

function createMockDrawTool() {
  return defineTool<'idle' | 'drawing', MockDrawData>({
    id: 'draw',
    initial: 'idle',
    data: () => ({ points: [], activeStroke: null, elementId: null }),
    states: {
      idle: {
        onPointerDown(ctx, e) {
          ctx.data.elementId = ctx.board.createId();
          ctx.data.points = [[e.point.x, e.point.y, e.pressure || 0.5]];
          ctx.data.activeStroke = {
            id: ctx.data.elementId,
            points: ctx.data.points,
            color: '#ff0000',
            thickness: 4,
            brush: 'pen',
          };
          return 'drawing';
        },
      },
      drawing: {
        onPointerMove(ctx, e) {
          ctx.data.points.push([e.point.x, e.point.y, e.pressure || 0.5]);
          ctx.data.activeStroke = {
            id: ctx.data.elementId ?? undefined,
            points: ctx.data.points,
            color: '#ff0000',
            thickness: 4,
            brush: 'pen',
          };
        },
        onPointerUp(ctx) {
          const id = ctx.data.elementId ?? ctx.board.createId();
          ctx.change((tx) => {
            tx.put({
              id,
              kind: 'element',
              type: 'draw',
              pageId: 'page:main',
              parentId: null,
              index: 'a1',
              x: 100,
              y: 100,
              w: 50,
              h: 80,
              rotation: 0,
              locked: false,
              opacity: 1,
              props: { points: ctx.data.points },
              typeVersion: 1,
              meta: {},
            });
          });
          ctx.data.points = [];
          ctx.data.activeStroke = null;
          ctx.data.elementId = null;
          return 'idle';
        },
        onCancel(ctx) {
          ctx.data.points = [];
          ctx.data.activeStroke = null;
          ctx.data.elementId = null;
          return 'idle';
        },
      },
    },
  });
}

function linkAwareness(aw1: Awareness, aw2: Awareness): () => void {
  const onUpdate1 = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const clients = added.concat(updated).concat(removed);
    if (clients.length > 0) {
      const update = encodeAwarenessUpdate(aw1, clients);
      applyAwarenessUpdate(aw2, update, 'sync');
    }
  };

  const onUpdate2 = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const clients = added.concat(updated).concat(removed);
    if (clients.length > 0) {
      const update = encodeAwarenessUpdate(aw2, clients);
      applyAwarenessUpdate(aw1, update, 'sync');
    }
  };

  aw1.on('update', onUpdate1);
  aw2.on('update', onUpdate2);

  const keys1 = Array.from(aw1.getStates().keys());
  if (keys1.length > 0) {
    applyAwarenessUpdate(aw2, encodeAwarenessUpdate(aw1, keys1), 'sync');
  }
  const keys2 = Array.from(aw2.getStates().keys());
  if (keys2.length > 0) {
    applyAwarenessUpdate(aw1, encodeAwarenessUpdate(aw2, keys2), 'sync');
  }

  return () => {
    aw1.off('update', onUpdate1);
    aw2.off('update', onUpdate2);
  };
}

function linkDocs(doc1: Y.Doc, doc2: Y.Doc): () => void {
  const onUpdate1 = (update: Uint8Array, origin: unknown) => {
    if (origin !== 'sync') {
      Y.applyUpdate(doc2, update, 'sync');
    }
  };
  const onUpdate2 = (update: Uint8Array, origin: unknown) => {
    if (origin !== 'sync') {
      Y.applyUpdate(doc1, update, 'sync');
    }
  };

  doc1.on('update', onUpdate1);
  doc2.on('update', onUpdate2);

  Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1), 'sync');
  Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2), 'sync');

  return () => {
    doc1.off('update', onUpdate1);
    doc2.off('update', onUpdate2);
  };
}

describe('BOARD-1505: Goresan live lewat awareness (@kujam/sync-yjs)', () => {
  let doc1: Y.Doc;
  let doc2: Y.Doc;
  let awareness1: Awareness;
  let awareness2: Awareness;
  let unlinkAwareness: (() => void) | null = null;
  let unlinkDocs: (() => void) | null = null;

  beforeEach(() => {
    doc1 = new Y.Doc();
    doc2 = new Y.Doc();
    awareness1 = new Awareness(doc1);
    awareness2 = new Awareness(doc2);
    unlinkAwareness = linkAwareness(awareness1, awareness2);
    unlinkDocs = linkDocs(doc1, doc2);
  });

  afterEach(() => {
    if (unlinkAwareness) {
      unlinkAwareness();
      unlinkAwareness = null;
    }
    if (unlinkDocs) {
      unlinkDocs();
      unlinkDocs = null;
    }
    awareness1.destroy();
    awareness2.destroy();
    doc1.destroy();
    doc2.destroy();
    vi.useRealTimers();
  });

  describe('YjsPresence live stroke streaming and throttling', () => {
    it('streams live stroke points via ephemeral awareness, leaving Y.Doc untouched', () => {
      const user1: PresenceUser = { id: 'u1', name: 'Alice', color: '#ff0000' };
      const user2: PresenceUser = { id: 'u2', name: 'Bob', color: '#00ff00' };

      const presence1 = createYjsPresence({
        awareness: awareness1,
        user: user1,
        strokeThrottleMs: 0,
      });
      const presence2 = createYjsPresence({
        awareness: awareness2,
        user: user2,
      });

      const stroke1: LiveStroke = {
        id: 'stroke-1',
        points: [
          [10, 20, 0.5],
          [15, 25, 0.6],
        ],
        color: '#ff0000',
        thickness: 4,
        brush: 'pen',
      };

      // Send initial stroke
      presence1.setLiveStroke(stroke1);

      // Peer 2 receives active stroke via awareness
      const peer1State = presence2.peers.get('u1');
      expect(peer1State).toBeDefined();
      expect(peer1State?.activeStroke).toEqual(stroke1);

      // Y.Doc records map remains completely empty (ephemeral, not in document CRDT!)
      const records1 = doc1.getMap('records');
      const records2 = doc2.getMap('records');
      expect(records1.size).toBe(0);
      expect(records2.size).toBe(0);

      // Append more points
      const stroke2: LiveStroke = {
        ...stroke1,
        points: [...stroke1.points, [20, 30, 0.7], [25, 35, 0.8]],
      };
      presence1.setLiveStroke(stroke2);

      expect(presence2.peers.get('u1')?.activeStroke?.points.length).toBe(4);
      expect(records1.size).toBe(0);

      // Clearing live stroke
      presence1.setLiveStroke(null);
      expect(presence2.peers.get('u1')?.activeStroke).toBeNull();

      presence1.destroy();
      presence2.destroy();
    });

    it('throttles intermediate stroke points while flushing initial point immediately (leading edge)', () => {
      vi.useFakeTimers();

      const user1: PresenceUser = { id: 'u1', name: 'Alice', color: '#ff0000' };
      const user2: PresenceUser = { id: 'u2', name: 'Bob', color: '#00ff00' };

      const presence1 = createYjsPresence({
        awareness: awareness1,
        user: user1,
        strokeThrottleMs: 33,
      });
      const presence2 = createYjsPresence({
        awareness: awareness2,
        user: user2,
      });

      const receivedPointCounts: number[] = [];
      presence2.on('change', (_peerId, state) => {
        if (state?.activeStroke?.points) {
          receivedPointCounts.push(state.activeStroke.points.length);
        }
      });

      // 1. Initial stroke start -> leading edge sends immediately
      presence1.setLiveStroke({
        id: 'stroke-1',
        points: [[10, 20, 0.5]],
        color: '#000000',
        thickness: 4,
      });

      expect(receivedPointCounts.length).toBe(1);
      expect(receivedPointCounts[0]).toBe(1);

      // 2. Rapid movements within 33ms window -> throttled
      vi.advanceTimersByTime(5);
      presence1.setLiveStroke({
        id: 'stroke-1',
        points: [
          [10, 20, 0.5],
          [12, 22, 0.5],
        ],
        color: '#000000',
        thickness: 4,
      });

      vi.advanceTimersByTime(5);
      presence1.setLiveStroke({
        id: 'stroke-1',
        points: [
          [10, 20, 0.5],
          [12, 22, 0.5],
          [14, 24, 0.5],
        ],
        color: '#000000',
        thickness: 4,
      });

      // No new broadcast yet during throttle window
      expect(receivedPointCounts.length).toBe(1);

      // 3. Advance timer past 33ms boundary -> trailing edge flushes latest points
      vi.advanceTimersByTime(25); // total 35ms > 33ms
      expect(receivedPointCounts.length).toBe(2);
      expect(receivedPointCounts[1]).toBe(3);

      // 4. Calling setLiveStroke(null) flushes immediately without throttle delay
      presence1.setLiveStroke(null);
      expect(presence2.peers.get('u1')?.activeStroke).toBeNull();

      presence1.destroy();
      presence2.destroy();
    });

    it('suppresses duplicate rendering via getLiveStrokes when element is committed', () => {
      const user1: PresenceUser = { id: 'u1', name: 'Alice', color: '#ff0000' };
      const user2: PresenceUser = { id: 'u2', name: 'Bob', color: '#00ff00' };

      const presence1 = createYjsPresence({
        awareness: awareness1,
        user: user1,
        strokeThrottleMs: 0,
      });
      const presence2 = createYjsPresence({
        awareness: awareness2,
        user: user2,
      });

      const stroke: LiveStroke = {
        id: 'elem-draw-100',
        points: [
          [0, 0, 0.5],
          [10, 10, 0.5],
        ],
        color: '#000000',
        thickness: 4,
        brush: 'pen',
      };

      presence1.setLiveStroke(stroke);

      // When element is not committed locally, getLiveStrokes includes it
      const active1 = presence2.getLiveStrokes();
      expect(active1.size).toBe(1);
      expect(active1.get('u1')?.id).toBe('elem-draw-100');

      // When element with matching ID is committed locally, getLiveStrokes suppresses it
      const committedSet = new Set<string>(['elem-draw-100']);
      const active2 = presence2.getLiveStrokes((id) => committedSet.has(id));
      expect(active2.size).toBe(0);

      presence1.destroy();
      presence2.destroy();
    });
  });

  describe('Integration with Board and DrawTool', () => {
    it('automatically streams draw tool strokes through awareness and commits once to Y.Doc', () => {
      const board1 = createBoard();
      const board2 = createBoard();

      // Register draw tool on board1
      board1.tools.register(createMockDrawTool());
      board1.setTool('draw');

      const adapter1 = createYjsSyncAdapter({
        doc: doc1,
        awareness: awareness1,
        user: { id: 'alice', name: 'Alice', color: '#ff0000' },
        strokeThrottleMs: 0,
      });
      const adapter2 = createYjsSyncAdapter({
        doc: doc2,
        awareness: awareness2,
        user: { id: 'bob', name: 'Bob', color: '#00ff00' },
      });

      const att1 = attachSync(board1, adapter1);
      const att2 = attachSync(board2, adapter2);

      expect(board2.presence?.peers.has('alice')).toBe(true);

      // 1. Start drawing: pointer-down
      board1.dispatch({
        type: 'pointer-down',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        point: { x: 100, y: 100 },
        screen: { x: 100, y: 100 },
        pressure: 0.5,
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      });

      // Peer 2 sees active stroke in awareness!
      const peerAliceState = board2.presence?.peers.get('alice');
      expect(peerAliceState?.activeStroke).toBeDefined();
      expect(peerAliceState?.activeStroke?.points.length).toBe(1);
      const allocatedStrokeId = peerAliceState?.activeStroke?.id;
      expect(allocatedStrokeId).toBeDefined();

      // Document records on board2 are STILL empty!
      expect(board2.query().length).toBe(0);

      // 2. Pointer move: stream points
      board1.dispatch({
        type: 'pointer-move',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        point: { x: 110, y: 120 },
        screen: { x: 110, y: 120 },
        pressure: 0.6,
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      });

      board1.dispatch({
        type: 'pointer-move',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        point: { x: 130, y: 150 },
        screen: { x: 130, y: 150 },
        pressure: 0.7,
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      });

      expect(board2.presence?.peers.get('alice')?.activeStroke?.points.length).toBe(3);
      expect(board2.query().length).toBe(0);

      // 3. Pointer up: commit final stroke once
      board1.dispatch({
        type: 'pointer-up',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        point: { x: 150, y: 180 },
        screen: { x: 150, y: 180 },
        pressure: 0.5,
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      });

      // Element is now committed to document store on both boards with the allocated ID!
      const elements1 = board1.query();
      const elements2 = board2.query();

      expect(elements1.length).toBe(1);
      expect(elements2.length).toBe(1);

      const committedEl = elements2[0] as ElementRecord;
      expect(committedEl.type).toBe('draw');
      expect(committedEl.id).toBe(allocatedStrokeId);

      // Active stroke in awareness is cleared!
      expect(board2.presence?.peers.get('alice')?.activeStroke).toBeNull();

      // getLiveStrokes on adapter2 suppresses any stroke whose ID is in board2
      const liveStrokes = adapter2.presence.getLiveStrokes((id) => Boolean(board2.getElement(id)));
      expect(liveStrokes.size).toBe(0);

      att1.disconnect();
      att2.disconnect();
      board1.dispose();
      board2.dispose();
    });

    it('clears active stroke from awareness when drawing is cancelled via Escape', () => {
      const board1 = createBoard();
      const board2 = createBoard();

      board1.tools.register(createMockDrawTool());
      board1.setTool('draw');

      const adapter1 = createYjsSyncAdapter({
        doc: doc1,
        awareness: awareness1,
        user: { id: 'alice', name: 'Alice', color: '#ff0000' },
        strokeThrottleMs: 0,
      });
      const adapter2 = createYjsSyncAdapter({
        doc: doc2,
        awareness: awareness2,
        user: { id: 'bob', name: 'Bob', color: '#00ff00' },
      });

      const att1 = attachSync(board1, adapter1);
      const att2 = attachSync(board2, adapter2);

      // Start drawing
      board1.dispatch({
        type: 'pointer-down',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        point: { x: 50, y: 50 },
        screen: { x: 50, y: 50 },
        pressure: 0.5,
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      });

      expect(board2.presence?.peers.get('alice')?.activeStroke).toBeDefined();

      // Cancel drawing with Escape key
      board1.dispatch({
        type: 'key-down',
        key: 'Escape',
        code: 'Escape',
        repeat: false,
        modifiers: { shift: false, alt: false, ctrl: false, meta: false },
      });

      // Active stroke is cleared from awareness
      expect(board2.presence?.peers.get('alice')?.activeStroke).toBeNull();

      // Document has no elements added
      expect(board1.query().length).toBe(0);
      expect(board2.query().length).toBe(0);

      att1.disconnect();
      att2.disconnect();
      board1.dispose();
      board2.dispose();
    });
  });
});
