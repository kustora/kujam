import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness.js';
import { attachSync, createBoard, type PresencePeerState, type PresenceUser } from '@kujam/core';
import { createYjsPresence, createYjsSyncAdapter } from './index.js';

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

  // Sync existing initial states
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

describe('BOARD-1504: Presence awareness via Yjs Awareness', () => {
  let doc1: Y.Doc;
  let doc2: Y.Doc;
  let awareness1: Awareness;
  let awareness2: Awareness;
  let unlink: (() => void) | null = null;

  beforeEach(() => {
    doc1 = new Y.Doc();
    doc2 = new Y.Doc();
    awareness1 = new Awareness(doc1);
    awareness2 = new Awareness(doc2);
    unlink = linkAwareness(awareness1, awareness2);
  });

  afterEach(() => {
    if (unlink) {
      unlink();
      unlink = null;
    }
    awareness1.destroy();
    awareness2.destroy();
    doc1.destroy();
    doc2.destroy();
    vi.useRealTimers();
  });

  it('synchronizes presence awareness state between two connected awareness instances', () => {
    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const presence1 = createYjsPresence({ awareness: awareness1, user: user1 });
    const presence2 = createYjsPresence({ awareness: awareness2, user: user2 });

    // Both presences should see the remote peer and exclude local client
    expect(presence1.peers.size).toBe(1);
    expect(presence2.peers.size).toBe(1);

    expect(presence1.peers.has('user-2')).toBe(true);
    expect(presence1.peers.get('user-2')?.user.name).toBe('Bob');

    expect(presence2.peers.has('user-1')).toBe(true);
    expect(presence2.peers.get('user-1')?.user.name).toBe('Alice');

    // Local states
    expect(presence1.getLocalState()?.user?.name).toBe('Alice');
    expect(presence2.getLocalState()?.user?.name).toBe('Bob');

    presence1.destroy();
    presence2.destroy();
  });

  it('fires peer-join and peer-leave events when collaborators connect and disconnect', () => {
    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const presence1 = createYjsPresence({ awareness: awareness1, user: user1 });

    const joins: { peerId: string; state?: PresencePeerState }[] = [];
    const leaves: { peerId: string; state?: PresencePeerState }[] = [];
    const changes: { peerId: string; state?: PresencePeerState }[] = [];

    presence1.on('peer-join', (peerId, state) => joins.push({ peerId, state }));
    presence1.on('peer-leave', (peerId, state) => leaves.push({ peerId, state }));
    presence1.on('change', (peerId, state) => changes.push({ peerId, state }));

    // User 2 connects
    const presence2 = createYjsPresence({ awareness: awareness2, user: user2 });

    expect(joins.length).toBe(1);
    expect(joins[0]?.peerId).toBe('user-2');
    expect(joins[0]?.state?.user.name).toBe('Bob');
    expect(presence1.peers.size).toBe(1);

    // User 2 updates selection
    presence2.setLocalState({ selection: ['el:sticky-1'] });
    expect(changes.length).toBe(1);
    expect(changes[0]?.peerId).toBe('user-2');
    expect(changes[0]?.state?.selection).toEqual(['el:sticky-1']);
    expect(presence1.peers.get('user-2')?.selection).toEqual(['el:sticky-1']);

    // User 2 leaves
    awareness2.setLocalState(null);
    expect(leaves.length).toBe(1);
    expect(leaves[0]?.peerId).toBe('user-2');
    expect(leaves[0]?.state?.user.name).toBe('Bob');
    expect(presence1.peers.size).toBe(0);

    presence1.destroy();
    presence2.destroy();
  });

  it('throttles cursor updates to 30 Hz (~33ms) while sending latest position', () => {
    vi.useFakeTimers();

    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const presence1 = createYjsPresence({
      awareness: awareness1,
      user: user1,
      cursorThrottleMs: 33,
    });
    const presence2 = createYjsPresence({
      awareness: awareness2,
      user: user2,
    });

    const cursorChanges: { x: number; y: number }[] = [];
    presence2.on('change', (_peerId, state) => {
      if (state?.cursor) {
        cursorChanges.push(state.cursor);
      }
    });

    // Rapidly send multiple cursor updates within 10ms
    presence1.setCursor({ x: 10, y: 10 }); // Leading edge -> sent immediately
    expect(cursorChanges.length).toBe(1);
    expect(cursorChanges[0]).toEqual({ x: 10, y: 10 });

    vi.advanceTimersByTime(5);
    presence1.setCursor({ x: 20, y: 20 }); // Throttled

    vi.advanceTimersByTime(5);
    presence1.setCursor({ x: 30, y: 30 }); // Throttled

    vi.advanceTimersByTime(5);
    presence1.setCursor({ x: 40, y: 40 }); // Throttled

    // Still only the first cursor position was broadcast
    expect(cursorChanges.length).toBe(1);

    // Advance to 33ms throttle boundary
    vi.advanceTimersByTime(20); // total 35ms > 33ms

    // Trailing edge flushed with latest cursor { x: 40, y: 40 }
    expect(cursorChanges.length).toBe(2);
    expect(cursorChanges[1]).toEqual({ x: 40, y: 40 });
    expect(presence2.peers.get('user-1')?.cursor).toEqual({ x: 40, y: 40 });

    presence1.destroy();
    presence2.destroy();
  });

  it('automatically synchronizes board selection, camera, and tool into awareness', () => {
    const board1 = createBoard();
    const board2 = createBoard();

    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const adapter1 = createYjsSyncAdapter({
      doc: doc1,
      awareness: awareness1,
      user: user1,
    });
    const adapter2 = createYjsSyncAdapter({
      doc: doc2,
      awareness: awareness2,
      user: user2,
    });

    const att1 = attachSync(board1, adapter1);
    const att2 = attachSync(board2, adapter2);

    // board.presence should be accessible via attachSync delegation
    expect(board1.presence).toBeDefined();
    expect(board2.presence).toBeDefined();
    expect(board1.presence?.peers.has('user-2')).toBe(true);

    // Put an element and select it on board1
    board1.transact((tx) => {
      tx.put({
        id: 'el-1',
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
        props: { text: 'Test' },
        meta: {},
      });
    });
    board1.select('el-1');

    expect(board2.presence?.peers.get('user-1')?.selection).toEqual(['el-1']);

    // Change camera on board1
    board1.setCamera({ x: 300, y: 400, zoom: 2 });
    expect(board2.presence?.peers.get('user-1')?.camera).toEqual({ x: 300, y: 400, zoom: 2 });

    // Change tool on board1
    board1.tools.register({
      id: 'custom-highlighter',
      initial: 'idle',
      states: {
        idle: { cursor: 'crosshair' },
      },
    });
    board1.setTool('custom-highlighter');
    expect(board2.presence?.peers.get('user-1')?.tool).toBe('custom-highlighter');

    att1.disconnect();
    att2.disconnect();
    board1.dispose();
    board2.dispose();
  });

  it('clears local awareness on adapter disconnect and emits peer-leave', () => {
    const board1 = createBoard();
    const board2 = createBoard();

    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const adapter1 = createYjsSyncAdapter({
      doc: doc1,
      awareness: awareness1,
      user: user1,
    });
    const adapter2 = createYjsSyncAdapter({
      doc: doc2,
      awareness: awareness2,
      user: user2,
    });

    const att1 = attachSync(board1, adapter1);
    const att2 = attachSync(board2, adapter2);

    expect(board1.presence?.peers.size).toBe(1);

    const leaves: string[] = [];
    board1.presence?.on('peer-leave', (peerId) => {
      leaves.push(peerId);
    });

    const adapterLeaves: string[] = [];
    adapter1.on('peer-leave', (event) => {
      adapterLeaves.push(event.peerId);
    });

    // Disconnect peer 2
    att2.disconnect();

    expect(awareness2.getLocalState()).toBeNull();
    expect(leaves).toContain('user-2');
    expect(adapterLeaves).toContain('user-2');
    expect(board1.presence?.peers.size).toBe(0);

    att1.disconnect();
    board1.dispose();
    board2.dispose();
  });

  it('supports multiple simultaneous peers and custom metadata', () => {
    const doc3 = new Y.Doc();
    const awareness3 = new Awareness(doc3);
    const unlink13 = linkAwareness(awareness1, awareness3);
    const unlink23 = linkAwareness(awareness2, awareness3);

    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };
    const user3: PresenceUser = { id: 'user-3', name: 'Charlie', color: '#0000ff' };

    const presence1 = createYjsPresence({ awareness: awareness1, user: user1 });
    const presence2 = createYjsPresence({ awareness: awareness2, user: user2 });
    const presence3 = createYjsPresence({ awareness: awareness3, user: user3 });

    presence2.setLocalState({ role: 'editor', activeFrame: 'frame-1' });

    expect(presence1.peers.size).toBe(2);
    expect(presence1.peers.has('user-2')).toBe(true);
    expect(presence1.peers.has('user-3')).toBe(true);
    expect(presence1.peers.get('user-2')?.role).toBe('editor');
    expect(presence1.peers.get('user-2')?.activeFrame).toBe('frame-1');

    unlink13();
    unlink23();
    awareness3.destroy();
    doc3.destroy();
    presence1.destroy();
    presence2.destroy();
    presence3.destroy();
  });

  it('handles unsubscribing from presence events', () => {
    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const presence1 = createYjsPresence({ awareness: awareness1, user: user1 });
    const presence2 = createYjsPresence({ awareness: awareness2, user: user2 });

    let changeCount = 0;
    const unsub = presence1.on('change', () => {
      changeCount++;
    });

    presence2.setLocalState({ tool: 'pen' });
    expect(changeCount).toBe(1);

    unsub();

    presence2.setLocalState({ tool: 'eraser' });
    expect(changeCount).toBe(1); // not incremented after unsubscribe

    presence1.destroy();
    presence2.destroy();
  });

  it('allows deactivating cursor by passing null', () => {
    const user1: PresenceUser = { id: 'user-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'user-2', name: 'Bob', color: '#00ff00' };

    const presence1 = createYjsPresence({
      awareness: awareness1,
      user: user1,
      cursorThrottleMs: 0,
    });
    const presence2 = createYjsPresence({ awareness: awareness2, user: user2 });

    presence1.setCursor({ x: 50, y: 75 });
    expect(presence2.peers.get('user-1')?.cursor).toEqual({ x: 50, y: 75 });

    presence1.setCursor(null);
    expect(presence2.peers.get('user-1')?.cursor).toBeNull();

    presence1.destroy();
    presence2.destroy();
  });

  describe('BOARD-1506: camera.follow(userId) integration', () => {
    it('follows collaborator camera viewport and centers correctly across different screen sizes', () => {
      const board1 = createBoard();
      const board2 = createBoard();

      // Alice (board1) has a 1920x1080 display
      board1.camera.setViewport({ width: 1920, height: 1080 });
      // Bob (board2) has an 800x600 display
      board2.camera.setViewport({ width: 800, height: 600 });

      const adapter1 = createYjsSyncAdapter({
        doc: doc1,
        awareness: awareness1,
        user: { id: 'alice', name: 'Alice', color: '#ff0000' },
      });
      const adapter2 = createYjsSyncAdapter({
        doc: doc2,
        awareness: awareness2,
        user: { id: 'bob', name: 'Bob', color: '#00ff00' },
      });

      const att1 = attachSync(board1, adapter1);
      const att2 = attachSync(board2, adapter2);

      // Alice positions camera at (500, 300) with zoom 1.5
      board1.setCamera({ x: 500, y: 300, zoom: 1.5 });

      // Alice's center in board coordinates:
      // cx = 500 + 1920 / 2 / 1.5 = 500 + 640 = 1140
      // cy = 300 + 1080 / 2 / 1.5 = 300 + 360 = 660

      const followEvents: { userId: string | null; previous: string | null }[] = [];
      board2.on('camera-follow', (e) => followEvents.push(e));

      // Bob follows Alice with instant transition (reducedMotion or animate: false)
      board2.camera.follow('alice', { animate: false });

      expect(board2.camera.following).toBe('alice');
      expect(followEvents).toEqual([{ userId: 'alice', previous: null }]);

      // Bob's camera should be centered on Alice's (cx: 1140, cy: 660) at zoom 1.5:
      // bob.x = 1140 - 800 / 2 / 1.5 = 1140 - 266.6667 = 873.3333
      // bob.y = 660 - 600 / 2 / 1.5 = 660 - 200 = 460
      const bobCam = board2.getCamera();
      expect(bobCam.zoom).toBe(1.5);
      expect(bobCam.x).toBeCloseTo(873.3333, 3);
      expect(bobCam.y).toBeCloseTo(460, 3);

      // Verify that the center point of both viewports matches exactly!
      const aliceCenter = {
        x: board1.camera.get().x + board1.camera.viewport.width / 2 / board1.camera.get().zoom,
        y: board1.camera.get().y + board1.camera.viewport.height / 2 / board1.camera.get().zoom,
      };
      const bobCenter = {
        x: board2.camera.get().x + board2.camera.viewport.width / 2 / board2.camera.get().zoom,
        y: board2.camera.get().y + board2.camera.viewport.height / 2 / board2.camera.get().zoom,
      };
      expect(bobCenter.x).toBeCloseTo(aliceCenter.x, 3);
      expect(bobCenter.y).toBeCloseTo(aliceCenter.y, 3);

      // 2. Dynamic tracking: Alice pans to a new location
      board1.setCamera({ x: 2000, y: 1500, zoom: 2 });
      // Bob automatically tracks Alice with instant follow
      const updatedBobCam = board2.getCamera();
      expect(updatedBobCam.zoom).toBe(2);

      const aliceCenter2 = {
        x: 2000 + 1920 / 2 / 2,
        y: 1500 + 1080 / 2 / 2,
      };
      const bobCenter2 = {
        x: updatedBobCam.x + 800 / 2 / 2,
        y: updatedBobCam.y + 600 / 2 / 2,
      };
      expect(bobCenter2.x).toBeCloseTo(aliceCenter2.x, 3);
      expect(bobCenter2.y).toBeCloseTo(aliceCenter2.y, 3);

      // 3. Auto-unfollow when local user pans
      board2.setCamera({ x: 100 });
      expect(board2.camera.following).toBeNull();
      expect(followEvents).toHaveLength(2);
      expect(followEvents[1]).toEqual({ userId: null, previous: 'alice' });

      // Re-follow Alice
      board2.camera.follow('alice', { animate: false });
      expect(board2.camera.following).toBe('alice');

      // 4. Auto-unfollow when followed peer leaves
      awareness1.setLocalState(null);
      expect(board2.camera.following).toBeNull();
      expect(followEvents).toHaveLength(4);
      expect(followEvents[3]).toEqual({ userId: null, previous: 'alice' });

      att1.disconnect();
      att2.disconnect();
      board1.dispose();
      board2.dispose();
    });
  });
});
