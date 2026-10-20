import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createBoard,
  CURRENT_SCHEMA_VERSION,
  type AssetRecord,
  type BindingRecord,
  type BoardDocument,
  type ElementRecord,
  type PageRecord,
} from '@kujam/core';
import {
  createYjsSyncAdapter,
  documentToUpdate,
  documentToYDoc,
  updateToDocument,
  updateToYDoc,
  yDocToDocument,
  yDocToUpdate,
} from './index.js';

describe('BOARD-1513: Conversion utilities between Y.Doc, binary state, and JSON BoardDocument', () => {
  const sampleDocument: BoardDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      title: 'Sprint Planning Whiteboard',
      category: 'architecture',
      tags: ['q4', 'review'],
    },
    records: {
      'page:main': {
        id: 'page:main',
        kind: 'page',
        name: 'Main Page',
        index: 'a0',
        meta: {},
      } as PageRecord,
      'el:sticky-1': {
        id: 'el:sticky-1',
        kind: 'element',
        type: 'sticky',
        pageId: 'page:main',
        parentId: null,
        index: 'a1',
        x: 100,
        y: 150,
        w: 200,
        h: 200,
        rotation: 0,
        locked: false,
        opacity: 0.95,
        props: {
          text: [{ insert: 'Urgent Note\n', attributes: { bold: true } }],
          color: 'yellow',
        },
        meta: { priority: 1 },
      } as ElementRecord,
      'el:geo-rect': {
        id: 'el:geo-rect',
        kind: 'element',
        type: 'geo',
        pageId: 'page:main',
        parentId: null,
        index: 'a2',
        x: 400,
        y: 150,
        w: 180,
        h: 120,
        rotation: 15,
        locked: false,
        opacity: 1,
        props: {
          geo: 'rectangle',
          fill: 'solid',
          label: [{ insert: 'Backend Service\n' }],
        },
        meta: {},
      } as ElementRecord,
      'binding:1': {
        id: 'binding:1',
        kind: 'binding',
        fromId: 'el:sticky-1',
        toId: 'el:geo-rect',
        anchor: { x: 1, y: 0.5 },
      } as BindingRecord,
      'asset:diagram-png': {
        id: 'asset:diagram-png',
        kind: 'asset',
        mimeType: 'image/png',
        w: 1920,
        h: 1080,
        meta: { sizeBytes: 204800 },
      } as AssetRecord,
    },
    pluginVersions: {
      'kujam.notes': 1,
      'kujam.shapes': 2,
    },
  };

  describe('documentToYDoc', () => {
    it('creates a fresh Y.Doc with records and document metadata', () => {
      const ydoc = documentToYDoc(sampleDocument);

      // Verify meta map
      const metaMap = ydoc.getMap('meta');
      expect(metaMap.get('schemaVersion')).toBe(CURRENT_SCHEMA_VERSION);
      expect(metaMap.get('meta')).toEqual(sampleDocument.meta);
      expect(metaMap.get('pluginVersions')).toEqual(sampleDocument.pluginVersions);

      // Verify records map
      const recordsMap = ydoc.getMap<Y.Map<unknown>>('records');
      expect(recordsMap.size).toBe(5);

      const stickyYMap = recordsMap.get('el:sticky-1');
      expect(stickyYMap).toBeInstanceOf(Y.Map);
      expect(stickyYMap?.get('type')).toBe('sticky');

      const propsYMap = stickyYMap?.get('props') as Y.Map<unknown>;
      expect(propsYMap).toBeInstanceOf(Y.Map);
      expect(propsYMap.get('color')).toBe('yellow');

      const textYText = propsYMap.get('text');
      expect(textYText).toBeInstanceOf(Y.Text);
      expect((textYText as Y.Text).toString()).toBe('Urgent Note\n');

      ydoc.destroy();
    });

    it('populates an existing Y.Doc and removes obsolete records', () => {
      const existingDoc = new Y.Doc();
      const recordsMap = existingDoc.getMap<Y.Map<unknown>>('records');

      // Pre-populate with an obsolete record
      existingDoc.transact(() => {
        const staleMap = new Y.Map<unknown>();
        staleMap.set('id', 'el:obsolete');
        recordsMap.set('el:obsolete', staleMap);
      });
      expect(recordsMap.has('el:obsolete')).toBe(true);

      documentToYDoc(sampleDocument, { doc: existingDoc });

      expect(recordsMap.has('el:obsolete')).toBe(false);
      expect(recordsMap.size).toBe(5);

      existingDoc.destroy();
    });
  });

  describe('yDocToDocument', () => {
    it('extracts a canonical BoardDocument from a Y.Doc', () => {
      const ydoc = documentToYDoc(sampleDocument);
      const extracted = yDocToDocument(ydoc);

      expect(extracted.schemaVersion).toBe(sampleDocument.schemaVersion);
      expect(extracted.meta).toEqual(sampleDocument.meta);
      expect(extracted.pluginVersions).toEqual(sampleDocument.pluginVersions);
      expect(extracted.records).toEqual(sampleDocument.records);

      ydoc.destroy();
    });

    it('falls back to default metadata when meta map is missing in Y.Doc', () => {
      const ydoc = new Y.Doc();
      const extracted = yDocToDocument(ydoc);

      expect(extracted.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(extracted.meta).toEqual({});
      expect(extracted.pluginVersions).toBeUndefined();
      expect(extracted.records).toEqual({});

      ydoc.destroy();
    });

    it('filters out corrupt or malformed records', () => {
      const ydoc = new Y.Doc();
      const recordsMap = ydoc.getMap<Y.Map<unknown>>('records');

      ydoc.transact(() => {
        const brokenMap = new Y.Map<unknown>();
        brokenMap.set('id', 'el:broken');
        brokenMap.set('kind', 'element');
        // Missing required fields like pageId, type, index, coordinates
        recordsMap.set('el:broken', brokenMap);

        const validMap = new Y.Map<unknown>();
        validMap.set('id', 'page:1');
        validMap.set('kind', 'page');
        validMap.set('name', 'Page One');
        validMap.set('index', 'a0');
        recordsMap.set('page:1', validMap);
      });

      const extracted = yDocToDocument(ydoc);
      expect(extracted.records['el:broken']).toBeUndefined();
      expect(extracted.records['page:1']).toBeDefined();

      ydoc.destroy();
    });

    it('respects custom validateRecord filter option', () => {
      const ydoc = documentToYDoc(sampleDocument);
      const extracted = yDocToDocument(ydoc, {
        validateRecord: (rec): rec is ElementRecord =>
          typeof rec === 'object' && rec !== null && (rec as { kind: string }).kind !== 'binding',
      });

      expect(extracted.records['binding:1']).toBeUndefined();
      expect(extracted.records['el:sticky-1']).toBeDefined();

      ydoc.destroy();
    });
  });

  describe('lossless roundtrip', () => {
    it('achieves 100% structural equivalence across documentToYDoc -> yDocToDocument', () => {
      const ydoc = documentToYDoc(sampleDocument);
      const restored = yDocToDocument(ydoc);

      expect(restored).toEqual(sampleDocument);
      ydoc.destroy();
    });

    it('handles documents without pluginVersions or with empty meta', () => {
      const minimalDoc: BoardDocument = {
        schemaVersion: 1,
        meta: {},
        records: {
          'page:main': {
            id: 'page:main',
            kind: 'page',
            name: 'P1',
            index: 'a0',
            meta: {},
          },
        },
      };

      const ydoc = documentToYDoc(minimalDoc);
      const restored = yDocToDocument(ydoc);

      expect(restored).toEqual(minimalDoc);
      expect(restored.pluginVersions).toBeUndefined();
      ydoc.destroy();
    });
  });

  describe('binary update conversions', () => {
    it('converts BoardDocument -> binary update -> BoardDocument losslessly', () => {
      const updateBytes = documentToUpdate(sampleDocument);
      expect(updateBytes).toBeInstanceOf(Uint8Array);
      expect(updateBytes.byteLength).toBeGreaterThan(0);

      const restored = updateToDocument(updateBytes);
      expect(restored).toEqual(sampleDocument);
    });

    it('converts Y.Doc -> binary update -> Y.Doc losslessly', () => {
      const originalYDoc = documentToYDoc(sampleDocument);
      const updateBytes = yDocToUpdate(originalYDoc);

      const restoredYDoc = updateToYDoc(updateBytes);
      const restoredDoc = yDocToDocument(restoredYDoc);

      expect(restoredDoc).toEqual(sampleDocument);

      originalYDoc.destroy();
      restoredYDoc.destroy();
    });
  });

  describe('integration with createYjsSyncAdapter', () => {
    it('synchronizes a live board document and allows extraction via yDocToDocument', () => {
      const board = createBoard();
      const adapter = createYjsSyncAdapter();

      adapter.connect(board);

      board.transact((tx) => {
        tx.put({
          id: 'el:dynamic-sticky',
          kind: 'element',
          type: 'sticky',
          pageId: 'page:main',
          parentId: null,
          index: 'a1',
          x: 250,
          y: 350,
          w: 140,
          h: 140,
          rotation: 0,
          locked: false,
          opacity: 1,
          props: { text: [{ insert: 'Collaborative note\n' }], color: 'pink' },
          meta: {},
        });
      });

      const extracted = yDocToDocument(adapter.doc);
      expect(extracted.records['el:dynamic-sticky']).toBeDefined();
      expect(extracted.records['page:main']).toBeDefined();

      adapter.disconnect();
      board.dispose();
    });
  });
});
