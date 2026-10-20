import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createBoard,
  type ElementRecord,
} from '@kujam/core';
import { createYjsSyncAdapter, recordToYMap } from './index.js';

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
    props: { text: 'Hello', color: 'yellow' },
    meta: {},
    ...overrides,
  };
}

describe('BOARD-1512: Read-only mode per client in sync (@kujam/sync-yjs)', () => {
  it('initializes in read-only mode and sets connected board to readOnly', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc, readOnly: true });
    expect(adapter.readOnly).toBe(true);

    const board = createBoard();
    expect(board.readOnly).toBe(false);

    adapter.connect(board);
    expect(board.readOnly).toBe(true);
    expect(adapter.readOnly).toBe(true);

    adapter.disconnect();
    board.dispose();
  });

  it('inherits board readOnly state when options.readOnly is not explicitly provided', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc });
    expect(adapter.readOnly).toBe(false);

    const board = createBoard({ readOnly: true });
    adapter.connect(board);
    expect(adapter.readOnly).toBe(true);

    adapter.disconnect();
    board.dispose();
  });

  it('does not seed an empty Y.Doc on initial connect when readOnly is true', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc, readOnly: true });
    const board = createBoard();

    // Seed local board before connecting
    board.transact((tx) => {
      tx.put(makeElement('el:local-1'));
    });

    adapter.connect(board);

    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    expect(recordsMap.size).toBe(0);

    adapter.disconnect();
    board.dispose();
  });

  it('receives remote document updates while in read-only mode', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc, readOnly: true });
    const board = createBoard();

    adapter.connect(board);
    expect(board.readOnly).toBe(true);

    // Another collaborator writes to Y.Doc
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    doc.transact(() => {
      const elMap = new Y.Map<unknown>();
      recordsMap.set('el:remote-1', elMap);
      recordToYMap(
        makeElement('el:remote-1', { props: { text: 'From remote', color: 'blue' } }),
        elMap,
      );
    });

    // Read-only board receives the remote element
    const el = board.getElement('el:remote-1');
    expect(el).toBeDefined();
    expect(el?.props.text).toBe('From remote');

    adapter.disconnect();
    board.dispose();
  });

  it('does not send local changes to Y.Doc if local changes occur', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc, readOnly: true });
    const board = createBoard();

    adapter.connect(board);

    // Local changes with origin 'load' are not forwarded to Y.Doc
    board.transact(
      (tx) => {
        tx.put(makeElement('el:unauthorized'));
      },
      { origin: 'load' },
    );

    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    expect(recordsMap.has('el:unauthorized')).toBe(false);

    adapter.disconnect();
    board.dispose();
  });

  it('broadcasts presence awareness (cursor, camera, selection) from read-only client', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({
      doc,
      readOnly: true,
      user: { id: 'u:reader', name: 'Viewer', color: '#ff0000' },
    });
    const board = createBoard();

    adapter.connect(board);

    board.camera.set({ x: 100, y: 200, zoom: 1.5 });

    const localPresence = adapter.presence.getLocalState();
    expect(localPresence?.camera?.x).toBe(100);
    expect(localPresence?.camera?.y).toBe(200);
    expect(localPresence?.camera?.zoom).toBe(1.5);
    expect(localPresence?.user?.name).toBe('Viewer');

    adapter.disconnect();
    board.dispose();
  });

  it('does not broadcast active live strokes in read-only mode', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({
      doc,
      readOnly: true,
      user: { id: 'u:reader', name: 'Viewer', color: '#ff0000' },
    });
    const board = createBoard();

    adapter.connect(board);

    // Mock toolData having an active stroke
    Object.defineProperty(board, 'toolData', {
      value: {
        activeStroke: {
          id: 'stroke:1',
          points: [[10, 20]],
          color: '#000000',
          thickness: 2,
        },
      },
      configurable: true,
    });

    board.dispatch({
      type: 'pointer-move',
      point: { x: 10, y: 20 },
      button: 0,
      buttons: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    expect(adapter.presence.getLocalState()?.activeStroke).toBeNull();

    adapter.disconnect();
    board.dispose();
  });

  it('dynamically toggles read-only mode via adapter.setReadOnly()', () => {
    const doc = new Y.Doc();
    const adapter = createYjsSyncAdapter({ doc, readOnly: false });
    const board = createBoard();

    adapter.connect(board);
    expect(adapter.readOnly).toBe(false);
    expect(board.readOnly).toBe(false);

    // Switch to read-only
    adapter.setReadOnly(true);
    expect(adapter.readOnly).toBe(true);
    expect(board.readOnly).toBe(true);

    // In read-only mode, changes with origin 'load' are ignored by Y.Doc
    board.transact(
      (tx) => {
        tx.put(makeElement('el:blocked'));
      },
      { origin: 'load' },
    );
    expect(doc.getMap('records').has('el:blocked')).toBe(false);

    // Switch back to read-write
    adapter.setReadOnly(false);
    expect(adapter.readOnly).toBe(false);
    expect(board.readOnly).toBe(false);

    board.transact((tx) => {
      tx.put(makeElement('el:allowed'));
    });
    expect(doc.getMap('records').has('el:allowed')).toBe(true);

    adapter.disconnect();
    board.dispose();
  });
});
