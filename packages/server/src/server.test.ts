import { describe, expect, it } from 'vitest';
import {
  defineElement,
  definePlugin,
  schema,
  string,
  type BoardDocument,
  type ElementRecord,
} from '@kujam/core';
import { documentToUpdate } from '@kujam/sync-yjs';
import {
  extractReferences,
  validateServerDocument,
} from './index.js';

function createValidDoc(overrides: Partial<BoardDocument> = {}): BoardDocument {
  return {
    schemaVersion: 1,
    meta: { title: 'Test Board' },
    records: {
      e1: {
        id: 'e1',
        kind: 'element',
        type: 'note',
        pageId: 'page:1',
        parentId: null,
        index: 'a1',
        x: 10,
        y: 20,
        rotation: 0,
        w: 100,
        h: 100,
        locked: false,
        opacity: 1,
        props: { text: 'Hello world' },
        meta: {},
      },
      p1: {
        id: 'p1',
        kind: 'page',
        name: 'Page 1',
        index: 'a0',
        meta: {},
      },
    },
    ...overrides,
  };
}

describe('BOARD-1801: validateServerDocument', () => {
  it('runs in pure Node.js 20 environment without DOM or window', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('validates a canonical JSON document successfully', () => {
    const doc = createValidDoc();
    const result = validateServerDocument(doc);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.invalidRecords).toEqual({});
  });

  it('validates a binary Yjs update bytes without DOM', () => {
    const doc = createValidDoc();
    const updateBytes = documentToUpdate(doc);

    expect(updateBytes).toBeInstanceOf(Uint8Array);
    const result = validateServerDocument(updateBytes);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.invalidRecords).toEqual({});
  });

  it('rejects corrupt binary Yjs update bytes gracefully', () => {
    const corruptBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 255]);
    const result = validateServerDocument(corruptBytes);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects document with fatal document-level errors in both modes', () => {
    const badDoc = {
      ...createValidDoc(),
      schemaVersion: 9999,
    };

    const nonStrict = validateServerDocument(badDoc, { strict: false });
    expect(nonStrict.valid).toBe(false);
    expect(nonStrict.errors.some((e) => e.includes('schemaVersion'))).toBe(true);

    const strict = validateServerDocument(badDoc, { strict: true });
    expect(strict.valid).toBe(false);
    expect(strict.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('enforces strict mode: rejects document if any record is invalid', () => {
    const docWithBadRecord = createValidDoc({
      records: {
        good: {
          id: 'good',
          kind: 'element',
          type: 'note',
          pageId: 'page:1',
          parentId: null,
          index: 'a1',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: {},
          meta: {},
        },
        bad: {
          id: 'bad',
          kind: 'element',
          type: 'note',
          pageId: '', // Invalid: must be non-empty string
          parentId: null,
          index: 'a2',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: {},
          meta: {},
        },
      },
    });

    // Default / non-strict mode: valid is true, but bad record is isolated in invalidRecords
    const nonStrict = validateServerDocument(docWithBadRecord, { strict: false });
    expect(nonStrict.valid).toBe(true);
    expect(nonStrict.invalidRecords['bad']).toBeDefined();
    expect(nonStrict.errors.length).toBeGreaterThan(0);

    // Strict mode: valid is false because invalidRecords is not empty
    const strict = validateServerDocument(docWithBadRecord, { strict: true });
    expect(strict.valid).toBe(false);
    expect(strict.invalidRecords['bad']).toBeDefined();
    expect(strict.errors.length).toBeGreaterThan(0);
  });

  it('validates element props using provided plugin definitions', () => {
    const cardElement = defineElement({
      type: 'custom-card',
      version: 1,
      props: schema({
        cardId: string({ minLength: 3 }),
      }),
    });

    const cardPlugin = definePlugin({
      id: 'custom-cards',
      elements: [cardElement],
    });

    const docWithInvalidProps = createValidDoc({
      records: {
        c1: {
          id: 'c1',
          kind: 'element',
          type: 'custom-card',
          pageId: 'page:1',
          parentId: null,
          index: 'a1',
          x: 0,
          y: 0,
          rotation: 0,
          w: 50,
          h: 50,
          locked: false,
          opacity: 1,
          props: { cardId: 'ab' }, // Invalid: minLength is 3
          meta: {},
        },
      },
    });

    const validated = validateServerDocument(docWithInvalidProps, {
      plugins: [cardPlugin],
      strict: true,
    });

    expect(validated.valid).toBe(false);
    expect(validated.invalidRecords['c1']).toBeDefined();
    expect(validated.invalidRecords['c1']![0]).toContain('skema tipe "custom-card"');
  });
});

describe('BOARD-1802: extractReferences', () => {
  it('extracts custom references declared via element references contract', () => {
    const ticketElement = defineElement({
      type: 'ticket-card',
      version: 1,
      props: schema({
        ticketId: string(),
      }),
      references: (el: ElementRecord<{ ticketId: string }>) => [
        { resolver: 'ticket', id: el.props.ticketId },
      ],
    });

    const doc: BoardDocument = {
      schemaVersion: 1,
      meta: {},
      records: {
        t1: {
          id: 't1',
          kind: 'element',
          type: 'ticket-card',
          pageId: 'page:default',
          parentId: null,
          index: 'a1',
          x: 0,
          y: 0,
          rotation: 0,
          w: 100,
          h: 100,
          locked: false,
          opacity: 1,
          props: { ticketId: 'TICKET-42' },
          meta: {},
        },
      },
    };

    const refs = extractReferences(doc, { elements: [ticketElement] });
    expect(refs).toEqual([
      {
        resolver: 'ticket',
        id: 'TICKET-42',
        elementId: 't1',
        pageId: 'page:default',
      },
    ]);
  });

  it('identifies enclosing frameId for elements inside frames directly or via groups', () => {
    const doc: BoardDocument = {
      schemaVersion: 1,
      meta: {},
      records: {
        frame1: {
          id: 'frame1',
          kind: 'element',
          type: 'frame',
          pageId: 'page:1',
          parentId: null,
          index: 'a0',
          x: 0,
          y: 0,
          rotation: 0,
          w: 800,
          h: 600,
          locked: false,
          opacity: 1,
          props: {},
          meta: {},
        },
        group1: {
          id: 'group1',
          kind: 'element',
          type: 'group',
          pageId: 'page:1',
          parentId: 'frame1',
          index: 'a1',
          x: 10,
          y: 10,
          rotation: 0,
          w: 200,
          h: 200,
          locked: false,
          opacity: 1,
          props: {},
          meta: {},
        },
        directChild: {
          id: 'directChild',
          kind: 'element',
          type: 'card',
          pageId: 'page:1',
          parentId: 'frame1',
          index: 'a2',
          x: 20,
          y: 20,
          rotation: 0,
          w: 50,
          h: 50,
          locked: false,
          opacity: 1,
          props: { cardId: 'C-001' },
          meta: {},
        },
        nestedChild: {
          id: 'nestedChild',
          kind: 'element',
          type: 'card',
          pageId: 'page:1',
          parentId: 'group1',
          index: 'a3',
          x: 30,
          y: 30,
          rotation: 0,
          w: 50,
          h: 50,
          locked: false,
          opacity: 1,
          props: { cardId: 'C-002' },
          meta: {},
        },
        rootElement: {
          id: 'rootElement',
          kind: 'element',
          type: 'card',
          pageId: 'page:1',
          parentId: null,
          index: 'a4',
          x: 40,
          y: 40,
          rotation: 0,
          w: 50,
          h: 50,
          locked: false,
          opacity: 1,
          props: { cardId: 'C-003' },
          meta: {},
        },
      },
    };

    const refs = extractReferences(doc);
    expect(refs).toEqual([
      {
        resolver: 'card',
        id: 'C-001',
        elementId: 'directChild',
        pageId: 'page:1',
        frameId: 'frame1',
      },
      {
        resolver: 'card',
        id: 'C-002',
        elementId: 'nestedChild',
        pageId: 'page:1',
        frameId: 'frame1',
      },
      {
        resolver: 'card',
        id: 'C-003',
        elementId: 'rootElement',
        pageId: 'page:1',
      },
    ]);
  });

  it('extracts references from common props and metadata patterns', () => {
    const doc: BoardDocument = {
      schemaVersion: 1,
      meta: {},
      records: {
        e1: {
          id: 'e1',
          kind: 'element',
          type: 'item1',
          pageId: 'page:1',
          parentId: null,
          index: 'a1',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: {
            reference: { resolver: 'user', id: 'usr-10' },
          },
          meta: {},
        },
        e2: {
          id: 'e2',
          kind: 'element',
          type: 'item2',
          pageId: 'page:1',
          parentId: null,
          index: 'a2',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: {
            resolver: 'doc',
            refId: 'doc-99',
          },
          meta: {},
        },
        e3: {
          id: 'e3',
          kind: 'element',
          type: 'item3',
          pageId: 'page:1',
          parentId: null,
          index: 'a3',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: {
            references: [
              { resolver: 'tag', id: 'tag-1' },
              { resolver: 'tag', id: 'tag-2' },
            ],
          },
          meta: {},
        },
      },
    };

    const refs = extractReferences(doc);
    expect(refs).toEqual([
      { resolver: 'user', id: 'usr-10', elementId: 'e1', pageId: 'page:1' },
      { resolver: 'doc', id: 'doc-99', elementId: 'e2', pageId: 'page:1' },
      { resolver: 'tag', id: 'tag-1', elementId: 'e3', pageId: 'page:1' },
      { resolver: 'tag', id: 'tag-2', elementId: 'e3', pageId: 'page:1' },
    ]);
  });

  it('filters extracted references by element types when options.types is provided', () => {
    const doc: BoardDocument = {
      schemaVersion: 1,
      meta: {},
      records: {
        c1: {
          id: 'c1',
          kind: 'element',
          type: 'card',
          pageId: 'page:1',
          parentId: null,
          index: 'a1',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: { cardId: 'c-1' },
          meta: {},
        },
        n1: {
          id: 'n1',
          kind: 'element',
          type: 'note',
          pageId: 'page:1',
          parentId: null,
          index: 'a2',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: { cardId: 'c-2' },
          meta: {},
        },
      },
    };

    const refs = extractReferences(doc, { types: ['card'] });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.elementId).toBe('c1');
  });

  it('extracts references from binary Yjs state updates directly', () => {
    const doc: BoardDocument = {
      schemaVersion: 1,
      meta: {},
      records: {
        c1: {
          id: 'c1',
          kind: 'element',
          type: 'card',
          pageId: 'page:1',
          parentId: null,
          index: 'a1',
          x: 0,
          y: 0,
          rotation: 0,
          w: 10,
          h: 10,
          locked: false,
          opacity: 1,
          props: { cardId: 'c-binary' },
          meta: {},
        },
      },
    };

    const update = documentToUpdate(doc);
    const refs = extractReferences(update);
    expect(refs).toEqual([
      {
        resolver: 'card',
        id: 'c-binary',
        elementId: 'c1',
        pageId: 'page:1',
      },
    ]);
  });
});
