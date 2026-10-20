import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  attachSync,
  createBoard,
  type ElementRecord,
} from '@kujam/core';
import {
  createYjsSyncAdapter,
  recordToYMap,
  syncRichTextToYText,
  yMapToRecord,
} from './index.js';

describe('BOARD-1503: Rich text sticky and text elements as Y.Text', () => {
  it('maps props.text and props.label to Y.Text with format attributes', () => {
    const doc = new Y.Doc();
    const recordsMap = doc.getMap<Y.Map<unknown>>('records');
    const recMap = new Y.Map<unknown>();
    recordsMap.set('sticky_1', recMap);

    const stickyRecord: ElementRecord = {
      id: 'sticky_1',
      kind: 'element',
      type: 'sticky',
      pageId: 'page_1',
      parentId: null,
      index: 'a0',
      x: 100,
      y: 100,
      w: 200,
      h: 200,
      rotation: 0,
      locked: false,
      opacity: 1,
      props: {
        color: 'yellow',
        text: [
          { insert: 'Hello ', attributes: { bold: true } },
          { insert: 'world\n', attributes: { italic: true } },
        ],
      },
    };

    recordToYMap(stickyRecord, recMap);

    const propsMap = recMap.get('props') as Y.Map<unknown>;
    expect(propsMap).toBeInstanceOf(Y.Map);
    const yText = propsMap.get('text');
    expect(yText).toBeInstanceOf(Y.Text);

    const delta = (yText as Y.Text).toDelta();
    expect(delta).toEqual([
      { insert: 'Hello ', attributes: { bold: true } },
      { insert: 'world\n', attributes: { italic: true } },
    ]);

    // Deserialization back to record
    const deserialized = yMapToRecord(recMap);
    expect(deserialized).not.toBeNull();
    expect(deserialized?.kind).toBe('element');
    const deserializedProps = (deserialized as ElementRecord).props;
    expect(deserializedProps.text).toEqual([
      { insert: 'Hello ', attributes: { bold: true } },
      { insert: 'world\n', attributes: { italic: true } },
    ]);
  });

  it('updates Y.Text with character-level diffing via syncRichTextToYText', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('content');

    syncRichTextToYText([{ insert: 'Hello world\n' }], yText);
    expect(yText.toString()).toBe('Hello world\n');

    // Insert word in middle
    syncRichTextToYText([{ insert: 'Hello brave world\n' }], yText);
    expect(yText.toString()).toBe('Hello brave world\n');

    // Remove word
    syncRichTextToYText([{ insert: 'Hello world\n' }], yText);
    expect(yText.toString()).toBe('Hello world\n');

    // Format word
    syncRichTextToYText(
      [
        { insert: 'Hello ', attributes: { bold: true } },
        { insert: 'world\n' },
      ],
      yText,
    );
    expect(yText.toDelta()).toEqual([
      { insert: 'Hello ', attributes: { bold: true } },
      { insert: 'world\n' },
    ]);
  });

  it('allows two collaborators to type in the same sticky note concurrently without overwriting each other', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();

    const adapter1 = createYjsSyncAdapter({ doc: doc1 });
    const adapter2 = createYjsSyncAdapter({ doc: doc2 });

    attachSync(board1, adapter1);
    attachSync(board2, adapter2);

    function syncDocs(): void {
      const u1 = Y.encodeStateAsUpdate(doc1);
      const u2 = Y.encodeStateAsUpdate(doc2);
      Y.applyUpdate(doc2, u1);
      Y.applyUpdate(doc1, u2);
    }

    // Board 1 creates a sticky note
    let stickyId = '';
    board1.transact((tx) => {
      const el: ElementRecord = {
        id: 'sticky_collab',
        kind: 'element',
        type: 'sticky',
        pageId: 'page:1',
        parentId: null,
        index: 'a0',
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        rotation: 0,
        locked: false,
        opacity: 1,
        meta: {},
        props: {
          color: 'yellow',
          text: [{ insert: 'Hello world\n' }],
        },
      };
      tx.put(el);
      stickyId = el.id;
    });

    syncDocs();

    // Verify board 2 has the sticky note
    expect(board2.getElement(stickyId)).toBeDefined();

    // Collaborator 1 inserts "beautiful " before "world"
    board1.transact((tx) => {
      const el = tx.get(stickyId) as ElementRecord;
      tx.put({
        ...el,
        props: {
          ...el.props,
          text: [{ insert: 'Hello beautiful world\n' }],
        },
      });
    });

    // Collaborator 2 simultaneously appends " today" before the newline
    board2.transact((tx) => {
      const el = tx.get(stickyId) as ElementRecord;
      tx.put({
        ...el,
        props: {
          ...el.props,
          text: [{ insert: 'Hello world today\n' }],
        },
      });
    });

    // Sync both ways
    syncDocs();

    // Both boards must converge to include both edits!
    const text1 = (board1.getElement(stickyId)?.props.text as Array<{ insert: string }>)[0].insert;
    const text2 = (board2.getElement(stickyId)?.props.text as Array<{ insert: string }>)[0].insert;

    expect(text1).toBe(text2);
    expect(text1).toContain('beautiful');
    expect(text1).toContain('today');
  });

  it('merges concurrent formatting on different words of the same sticky text', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const board1 = createBoard();
    const board2 = createBoard();

    const adapter1 = createYjsSyncAdapter({ doc: doc1 });
    const adapter2 = createYjsSyncAdapter({ doc: doc2 });

    attachSync(board1, adapter1);
    attachSync(board2, adapter2);

    function syncDocs(): void {
      const u1 = Y.encodeStateAsUpdate(doc1);
      const u2 = Y.encodeStateAsUpdate(doc2);
      Y.applyUpdate(doc2, u1);
      Y.applyUpdate(doc1, u2);
    }

    const stickyId = 'sticky_fmt';
    board1.transact((tx) => {
      const el: ElementRecord = {
        id: stickyId,
        kind: 'element',
        type: 'sticky',
        pageId: 'page:1',
        parentId: null,
        index: 'a0',
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        rotation: 0,
        locked: false,
        opacity: 1,
        meta: {},
        props: {
          color: 'yellow',
          text: [{ insert: 'Alpha Beta Gamma\n' }],
        },
      };
      tx.put(el);
    });

    syncDocs();

    // User 1 bolds Alpha
    board1.transact((tx) => {
      const el = tx.get(stickyId) as ElementRecord;
      tx.put({
        ...el,
        props: {
          ...el.props,
          text: [
            { insert: 'Alpha', attributes: { bold: true } },
            { insert: ' Beta Gamma\n' },
          ],
        },
      });
    });

    // User 2 simultaneously italics Gamma
    board2.transact((tx) => {
      const el = tx.get(stickyId) as ElementRecord;
      tx.put({
        ...el,
        props: {
          ...el.props,
          text: [
            { insert: 'Alpha Beta ' },
            { insert: 'Gamma', attributes: { italic: true } },
            { insert: '\n' },
          ],
        },
      });
    });

    syncDocs();

    const finalDelta1 = board1.getElement(stickyId)?.props.text as Array<{
      insert: string;
      attributes?: Record<string, unknown>;
    }>;
    const finalDelta2 = board2.getElement(stickyId)?.props.text as Array<{
      insert: string;
      attributes?: Record<string, unknown>;
    }>;

    expect(finalDelta1).toEqual(finalDelta2);
    // Alpha must have bold
    const alphaOp = finalDelta1.find((op) => op.insert.includes('Alpha'));
    expect(alphaOp?.attributes?.bold).toBe(true);
    // Gamma must have italic
    const gammaOp = finalDelta1.find((op) => op.insert.includes('Gamma'));
    expect(gammaOp?.attributes?.italic).toBe(true);
  });
});
