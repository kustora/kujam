import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createEmptyDocument,
  defineElement,
  definePlugin,
  InvalidDocumentError,
  number,
  object,
  string,
  type BoardDocument,
  type ElementRecord,
} from './index.js';

const note = defineElement({
  type: 'note',
  version: 2,
  props: object({ text: string(), size: number() }),
  defaults: { text: '', size: 1 },
  migrate: { 1: (props) => ({ ...props, size: 1 }) },
});
const notes = definePlugin({ id: 'notes', elements: [note] });

function element(id: string, extra: Partial<ElementRecord> = {}): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: 'page:main',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    w: 10,
    h: 10,
    locked: false,
    opacity: 1,
    props: { text: id, size: 1 },
    typeVersion: 2,
    meta: {},
    ...extra,
  };
}

function docWith(...elements: ElementRecord[]): BoardDocument {
  const doc = createEmptyDocument();
  for (const el of elements) doc.records[el.id] = el;
  return doc;
}

describe('BOARD-1701: board.prepareDocument', () => {
  it('validates and migrates like loadDocument without touching the board', () => {
    const board = createBoard({ plugins: [notes] });
    const before = board.getDocument();
    const events: string[] = [];
    board.on('change', () => events.push('change'));
    board.on('error', (e) => events.push(e.code));

    const input = docWith(
      element('old', { typeVersion: 1, props: { text: 'x' } as never }),
      element('bad', { props: { text: 1, size: 1 } as never }),
    );
    const prepared = board.prepareDocument(input);

    expect(prepared.tooNew).toBeNull();
    expect(prepared.document.records['old']).toMatchObject({
      typeVersion: 2,
      props: { text: 'x', size: 1 },
    });
    expect(prepared.document.records['bad']).toBeUndefined();
    expect(prepared.rejected.map((r) => r.id)).toEqual(['bad']);
    expect(prepared.document).not.toBe(input);
    expect(input.records['old']!).toMatchObject({ typeVersion: 1 });

    expect(board.getDocument()).toBe(before);
    expect(events).toEqual([]);
  });

  it('reports documents that are too new without migrating them', () => {
    const board = createBoard({ plugins: [notes] });
    const prepared = board.prepareDocument(docWith(element('future', { typeVersion: 5 })));
    expect(prepared.tooNew).toMatchObject({ kind: 'element', type: 'note', version: 5 });
    expect(prepared.document.records['future']).toMatchObject({ typeVersion: 5 });
    expect(board.readOnly).toBe(false);
  });

  it('throws for document-level problems and after dispose', () => {
    const board = createBoard({ plugins: [notes] });
    expect(() => board.prepareDocument({} as never)).toThrow(InvalidDocumentError);
    board.dispose();
    expect(() => board.prepareDocument(createEmptyDocument())).toThrow('Papan sudah di-dispose.');
  });
});
