import { describe, expect, it, vi } from 'vitest';
import {
  attachSync,
  createBoard,
  createMemorySyncAdapter,
  createMemorySyncBus,
  type ElementRecord,
  type HistoryApi,
  type PresencePeerState,
  type PresenceUser,
  type SyncAdapter,
  type SyncStatus,
} from '../index.js';

function makeElement(id: string, overrides: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'sticky',
    pageId: 'page:main',
    parentId: null,
    index: 'a1',
    x: 10,
    y: 20,
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

describe('BOARD-1501: SyncAdapter, PresenceApi, HistoryApi', () => {
  it('manages status changes and emits status events', () => {
    const board = createBoard();
    const bus = createMemorySyncBus();
    const adapter = createMemorySyncAdapter({ bus, channel: 'status-test' });

    expect(adapter.status).toBe('offline');

    const statuses: SyncStatus[] = [];
    adapter.on('status', (s) => statuses.push(s));

    const attachment = attachSync(board, adapter);

    expect(adapter.status).toBe('synced');
    expect(statuses).toEqual(['connecting', 'synced']);

    attachment.disconnect();

    expect(adapter.status).toBe('offline');
    expect(statuses).toEqual(['connecting', 'synced', 'offline']);
  });

  it('synchronizes in-memory changes between two boards on a shared bus', () => {
    const board1 = createBoard();
    const board2 = createBoard();
    const bus = createMemorySyncBus();

    const adapter1 = createMemorySyncAdapter({ bus, channel: 'room-1' });
    const adapter2 = createMemorySyncAdapter({ bus, channel: 'room-1' });

    const att1 = attachSync(board1, adapter1);
    const att2 = attachSync(board2, adapter2);

    const board2ChangeOrigins: string[] = [];
    board2.on('change', (event) => {
      board2ChangeOrigins.push(event.origin);
    });

    // 1. Create on board1
    const element = makeElement('el:shape1', { x: 50, y: 75 });
    board1.transact((tx) => tx.put(element), { label: 'create.shape' });

    expect(board2.getElement('el:shape1')).toBeDefined();
    expect(board2.getElement('el:shape1')?.x).toBe(50);
    expect(board2.getElement('el:shape1')?.y).toBe(75);
    expect(board2ChangeOrigins).toEqual(['remote']);

    // 2. Update on board1
    board1.transact(
      (tx) => {
        const el = tx.get('el:shape1') as ElementRecord;
        tx.put({ ...el, x: 120 });
      },
      { label: 'update.shape' },
    );

    expect(board2.getElement('el:shape1')?.x).toBe(120);
    expect(board2ChangeOrigins).toEqual(['remote', 'remote']);

    // 3. Delete on board1
    board1.transact((tx) => tx.remove('el:shape1'), { label: 'delete.shape' });

    expect(board2.getElement('el:shape1')).toBeUndefined();
    expect(board2ChangeOrigins).toEqual(['remote', 'remote', 'remote']);

    att1.disconnect();
    att2.disconnect();
  });

  it('verifies remote transactions on board2 do not enter board2 local undo history', () => {
    const board1 = createBoard();
    const board2 = createBoard();
    const bus = createMemorySyncBus();

    const adapter1 = createMemorySyncAdapter({ bus, channel: 'room-undo' });
    const adapter2 = createMemorySyncAdapter({ bus, channel: 'room-undo' });

    attachSync(board1, adapter1);
    attachSync(board2, adapter2);

    // Board1 mutates -> synced to Board2
    board1.transact((tx) => tx.put(makeElement('el:test-undo')), { label: 'add.el' });

    expect(board2.getElement('el:test-undo')).toBeDefined();

    // Board1 has local history
    expect(board1.history.canUndo).toBe(true);

    // Board2 received remote change, so its local undo history must be false
    expect(board2.history.canUndo).toBe(false);
    expect(board2.history.canRedo).toBe(false);

    // Calling undo on board2 does nothing and returns false
    const undoResult = board2.undo();
    expect(undoResult).toBe(false);
    expect(board2.getElement('el:test-undo')).toBeDefined();

    // Board1 undo reverses the step locally and syncs the removal to board2
    const board1UndoResult = board1.undo();
    expect(board1UndoResult).toBe(true);
    expect(board1.getElement('el:test-undo')).toBeUndefined();
    expect(board2.getElement('el:test-undo')).toBeUndefined();
  });

  it('delegates history when sync adapter provides a history implementation', () => {
    const board = createBoard();

    // Perform a local transaction first so local history has canUndo: true
    board.transact((tx) => tx.put(makeElement('el:local1')), { label: 'local' });
    expect(board.history.canUndo).toBe(true);

    let historyListener: ((state: { canUndo: boolean; canRedo: boolean }) => void) | undefined;

    const mockHistory: HistoryApi = {
      canUndo: false,
      canRedo: true,
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
      clear: vi.fn(),
      on: vi.fn((event, listener) => {
        if (event === 'change') {
          historyListener = listener;
        }
        return () => {
          historyListener = undefined;
        };
      }),
    };

    const dummyAdapter: SyncAdapter = {
      status: 'offline',
      connect: vi.fn(),
      disconnect: vi.fn(),
      history: mockHistory,
      on: vi.fn(() => () => {}),
    };

    const boardHistoryEvents: { canUndo: boolean; canRedo: boolean }[] = [];
    board.on('history', (event) => boardHistoryEvents.push({ ...event }));

    const attachment = attachSync(board, dummyAdapter);

    // Initial attachment emits history event matching mockHistory
    expect(board.history.canUndo).toBe(false);
    expect(board.history.canRedo).toBe(true);
    expect(boardHistoryEvents).toContainEqual({ canUndo: false, canRedo: true });

    // Calling board.undo() delegates to mockHistory.undo()
    const undoRes = board.undo();
    expect(undoRes).toBe(true);
    expect(mockHistory.undo).toHaveBeenCalledTimes(1);

    // Calling board.redo() delegates to mockHistory.redo()
    const redoRes = board.redo();
    expect(redoRes).toBe(true);
    expect(mockHistory.redo).toHaveBeenCalledTimes(1);

    // Calling board.history.clear() delegates to mockHistory.clear()
    board.history.clear();
    expect(mockHistory.clear).toHaveBeenCalledTimes(1);

    // Delegated history change notification
    historyListener?.({ canUndo: true, canRedo: false });
    expect(boardHistoryEvents[boardHistoryEvents.length - 1]).toEqual({
      canUndo: true,
      canRedo: false,
    });

    attachment.disconnect();
  });

  it('disconnect stops synchronization and restores local history', () => {
    const board1 = createBoard();
    const board2 = createBoard();
    const bus = createMemorySyncBus();

    // 1. Board1 has an initial local transaction
    board1.transact((tx) => tx.put(makeElement('el:initial')), { label: 'initial' });
    expect(board1.history.canUndo).toBe(true);

    // Mock history for adapter with canUndo: false
    const mockHistory: HistoryApi = {
      canUndo: false,
      canRedo: false,
      undo: vi.fn(() => false),
      redo: vi.fn(() => false),
      clear: vi.fn(),
      on: vi.fn(() => () => {}),
    };

    const adapter1 = createMemorySyncAdapter({
      bus,
      channel: 'disconnect-test',
      history: mockHistory,
    });
    const adapter2 = createMemorySyncAdapter({ bus, channel: 'disconnect-test' });

    const att1 = attachSync(board1, adapter1);
    const att2 = attachSync(board2, adapter2);

    // While attached, history is delegated to mockHistory
    expect(board1.history.canUndo).toBe(false);

    // Disconnect board1 from sync
    att1.disconnect();

    // Local history is restored on board1
    expect(board1.history.canUndo).toBe(true);

    // Mutate board2: board1 should NOT receive it since board1 is disconnected
    board2.transact((tx) => tx.put(makeElement('el:board2-only')), { label: 'board2.only' });
    expect(board1.getElement('el:board2-only')).toBeUndefined();

    // Undo on board1 reverts board1's initial local element
    expect(board1.undo()).toBe(true);
    expect(board1.getElement('el:initial')).toBeUndefined();

    att2.disconnect();
  });

  it('supports presence awareness across in-memory peers', () => {
    const board1 = createBoard();
    const board2 = createBoard();
    const bus = createMemorySyncBus();

    const user1: PresenceUser = { id: 'u1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { id: 'u2', name: 'Bob', color: '#00ff00' };

    const adapter1 = createMemorySyncAdapter({ bus, channel: 'presence-room', user: user1 });
    const adapter2 = createMemorySyncAdapter({ bus, channel: 'presence-room', user: user2 });

    const peerJoinEvents: { peerId: string; user: PresenceUser }[] = [];
    adapter1.on('peer-join', (event) => peerJoinEvents.push(event));

    const peerLeaveEvents: { peerId: string; user?: PresenceUser }[] = [];
    adapter1.on('peer-leave', (event) => peerLeaveEvents.push(event));

    const peerStateChanges: { peerId: string; state?: PresencePeerState }[] = [];
    adapter1.presence?.on('change', (peerId, state) => {
      peerStateChanges.push({ peerId, state });
    });

    const att1 = attachSync(board1, adapter1);
    const att2 = attachSync(board2, adapter2);

    // Both peers should see each other
    expect(adapter1.presence?.peers.size).toBe(1);
    expect(adapter2.presence?.peers.size).toBe(1);

    expect(peerJoinEvents.length).toBeGreaterThanOrEqual(1);
    expect(peerJoinEvents[0]?.user.name).toBe('Bob');

    // Update peer 2 cursor and selection
    adapter2.presence?.setLocalState({
      cursor: { x: 150, y: 250 },
      selection: ['el:shape1'],
      camera: { x: 0, y: 0, zoom: 1 },
      tool: 'select',
    });

    const updatedPeer = Array.from(adapter1.presence?.peers.values() ?? [])[0];
    expect(updatedPeer?.cursor).toEqual({ x: 150, y: 250 });
    expect(updatedPeer?.selection).toEqual(['el:shape1']);
    expect(updatedPeer?.tool).toBe('select');
    expect(peerStateChanges.length).toBeGreaterThan(0);

    // Peer 2 disconnects -> peer-leave is observed by peer 1
    att2.disconnect();
    expect(peerLeaveEvents.length).toBe(1);
    expect(peerLeaveEvents[0]?.user?.name).toBe('Bob');
    expect(adapter1.presence?.peers.size).toBe(0);

    att1.disconnect();
  });

  it('isolates synchronization between different channels on the same bus', () => {
    const boardA1 = createBoard();
    const boardA2 = createBoard();
    const boardB = createBoard();
    const bus = createMemorySyncBus();

    const adapterA1 = createMemorySyncAdapter({ bus, channel: 'channel-alpha' });
    const adapterA2 = createMemorySyncAdapter({ bus, channel: 'channel-alpha' });
    const adapterB = createMemorySyncAdapter({ bus, channel: 'channel-beta' });

    const attA1 = attachSync(boardA1, adapterA1);
    const attA2 = attachSync(boardA2, adapterA2);
    const attB = attachSync(boardB, adapterB);

    boardA1.transact((tx) => tx.put(makeElement('el:alpha-only')), { label: 'alpha' });

    expect(boardA2.getElement('el:alpha-only')).toBeDefined();
    expect(boardB.getElement('el:alpha-only')).toBeUndefined();

    attA1.disconnect();
    attA2.disconnect();
    attB.disconnect();
  });

  it('automatically disconnects when board is disposed', () => {
    const board = createBoard();
    const bus = createMemorySyncBus();
    const adapter = createMemorySyncAdapter({ bus, channel: 'dispose-room' });

    attachSync(board, adapter);
    expect(adapter.status).toBe('synced');

    board.dispose();
    expect(adapter.status).toBe('offline');
  });
});
