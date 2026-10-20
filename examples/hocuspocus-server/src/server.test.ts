/**
 * Integration and unit tests for the Hocuspocus collaboration server (BOARD-1510).
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createCollaborationServer, type CollaborationServer } from './server.js';
import { DocumentDatabase } from './database.js';
import { UnauthorizedError } from './auth.js';
import { documentToYDoc, yDocToDocument } from '@kujam/sync-yjs';
import type { ElementRecord } from '@kujam/core';

// Ensure global WebSocket is available for HocuspocusProvider in Node.js
beforeAll(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
});

// Helper to construct a canonical test element record
function createTestRecord(id: string, text: string = 'Hello'): ElementRecord {
  return {
    id,
    kind: 'element',
    type: 'note',
    pageId: 'page:default',
    parentId: null,
    index: 'a0',
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    rotation: 0,
    locked: false,
    opacity: 1,
    props: { text },
    meta: {},
  };
}

// Helper to await provider sync
function waitForSync(provider: HocuspocusProvider): Promise<void> {
  if (provider.isSynced) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('synced', handler);
      resolve();
    };
    provider.on('synced', handler);
  });
}

// Helper to await a brief timeout
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('BOARD-1510: CollaborationServer (Hocuspocus)', () => {
  let server: CollaborationServer;
  let testPort = 18880;

  beforeEach(() => {
    testPort += 1;
  });

  afterEach(async () => {
    if (server) {
      await server.destroy();
    }
  });

  describe('1. Authentication & Authorization (onAuthenticate)', () => {
    it('authenticates editor client with readOnly = false', async () => {
      server = createCollaborationServer({
        port: testPort,
        quiet: true,
      });
      await server.listen();

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: 'auth-test-editor',
        document: doc,
        token: 'editor',
      });

      let authenticated = false;
      provider.on('authenticated', () => {
        authenticated = true;
      });

      await waitForSync(provider);
      expect(authenticated).toBe(true);

      provider.destroy();
    });

    it('authenticates viewer client with readOnly = true', async () => {
      server = createCollaborationServer({
        port: testPort,
        quiet: true,
      });
      await server.listen();

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: 'auth-test-viewer',
        document: doc,
        token: 'mock:user-viewer:viewer:Bob',
      });

      let authenticated = false;
      provider.on('authenticated', () => {
        authenticated = true;
      });

      await waitForSync(provider);
      expect(authenticated).toBe(true);

      provider.destroy();
    });

    it('rejects connection with invalid token', async () => {
      server = createCollaborationServer({
        port: testPort,
        quiet: true,
      });
      await server.listen();

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: 'auth-test-reject',
        document: doc,
        token: 'invalid-token-123',
      });

      let failed = false;
      let failReason: string | undefined;

      provider.on('authenticationFailed', (event: { reason: string }) => {
        failed = true;
        failReason = event.reason;
      });

      await delay(300);
      expect(failed).toBe(true);
      expect(failReason).toBe('permission-denied');

      provider.destroy();
    });

    it('supports custom token verifier', async () => {
      const customVerifier = vi.fn().mockImplementation((token: string) => {
        if (token === 'custom-secret-key') {
          return {
            user: { id: 'admin-1', name: 'Admin' },
            readOnly: false,
          };
        }
        throw new UnauthorizedError('Custom check failed');
      });

      server = createCollaborationServer({
        port: testPort,
        quiet: true,
        auth: customVerifier,
      });
      await server.listen();

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: 'custom-auth-doc',
        document: doc,
        token: 'custom-secret-key',
      });

      await waitForSync(provider);
      expect(customVerifier).toHaveBeenCalledWith('custom-secret-key', 'custom-auth-doc');

      provider.destroy();
    });
  });

  describe('2. Per-connection read-only enforcement', () => {
    it('disallows document mutations from viewer clients while allowing editor mutations', async () => {
      server = createCollaborationServer({
        port: testPort,
        quiet: true,
      });
      await server.listen();

      const docName = 'readonly-enforcement-doc';

      // 1. Editor connects and seeds an initial element
      const editorDoc = new Y.Doc();
      const editorProvider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: docName,
        document: editorDoc,
        token: 'mock:usr1:editor:Alice',
      });

      await waitForSync(editorProvider);

      const record1 = createTestRecord('el1', 'Initial Note');
      const recordsMapEditor = editorDoc.getMap<Y.Map<unknown>>('records');
      const yRecord1 = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(record1)) {
        yRecord1.set(k, v);
      }
      recordsMapEditor.set('el1', yRecord1);

      await delay(150);

      // 2. Viewer connects and sees the initial note
      const viewerDoc = new Y.Doc();
      const viewerProvider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: docName,
        document: viewerDoc,
        token: 'mock:usr2:viewer:Bob',
      });

      await waitForSync(viewerProvider);

      const viewerRecords = viewerDoc.getMap<Y.Map<unknown>>('records');
      expect(viewerRecords.has('el1')).toBe(true);

      // 3. Viewer attempts to mutate the document by adding a new record
      const hackedRecord = createTestRecord('el2', 'Hacked By Viewer');
      const yRecord2 = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(hackedRecord)) {
        yRecord2.set(k, v);
      }
      viewerRecords.set('el2', yRecord2);

      // Wait to ensure any propagation would have occurred
      await delay(200);

      // 4. Verify the editor's copy and server never received the viewer's write!
      expect(recordsMapEditor.has('el2')).toBe(false);

      // Also verify via server direct document inspection
      const serverDoc = server.server.hocuspocus.documents.get(docName);
      expect(serverDoc).toBeDefined();
      if (serverDoc) {
        const canonical = yDocToDocument(serverDoc);
        expect(canonical.records['el2']).toBeUndefined();
        expect(canonical.records['el1']).toBeDefined();
      }

      viewerProvider.destroy();
      editorProvider.destroy();
    });
  });

  describe('3. SQLite Persistence with binary Yjs state', () => {
    it('persists binary Yjs state and restores it across server restarts', async () => {
      const db = new DocumentDatabase({ path: ':memory:' });

      // Start Server 1 with the shared SQLite db
      server = createCollaborationServer({
        port: testPort,
        database: db,
        debounceMs: 50,
        quiet: true,
      });
      await server.listen();

      const docName = 'persistence-board-1';

      // Connect editor client and populate document
      const clientDoc1 = new Y.Doc();
      const initialCanonicalDoc = {
        schemaVersion: 1,
        meta: { title: 'Persistent Canvas' },
        records: {
          note1: createTestRecord('note1', 'Saved to SQLite!'),
        },
      };
      documentToYDoc(initialCanonicalDoc, { doc: clientDoc1 });

      const provider1 = new HocuspocusProvider({
        url: server.webSocketURL,
        name: docName,
        document: clientDoc1,
        token: 'editor',
      });

      await waitForSync(provider1);

      // Mutate client document
      const note2 = createTestRecord('note2', 'Second Note');
      const recordsMap = clientDoc1.getMap<Y.Map<unknown>>('records');
      const yMapNote2 = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(note2)) {
        yMapNote2.set(k, v);
      }
      recordsMap.set('note2', yMapNote2);

      // Wait for debounce and flush pending stores to SQLite
      await delay(100);
      await server.server.hocuspocus.flushPendingStores();

      // Verify binary data was saved to SQLite table
      expect(db.hasDocument(docName)).toBe(true);
      const storedBytes = db.loadDocument(docName);
      expect(storedBytes).toBeInstanceOf(Uint8Array);
      expect(storedBytes!.byteLength).toBeGreaterThan(0);

      // Destroy Client 1 and Server 1 (without closing db)
      provider1.destroy();
      await server.server.destroy();

      // Start Server 2 on a new port using the SAME SQLite database
      testPort += 1;
      const server2 = createCollaborationServer({
        port: testPort,
        database: db,
        quiet: true,
      });
      await server2.listen();

      // Client 2 connects to fresh Server 2
      const clientDoc2 = new Y.Doc();
      const provider2 = new HocuspocusProvider({
        url: server2.webSocketURL,
        name: docName,
        document: clientDoc2,
        token: 'editor',
      });

      await waitForSync(provider2);

      // Verify Client 2 received the restored document from SQLite
      const restoredCanonical = yDocToDocument(clientDoc2);
      expect(restoredCanonical.meta.title).toBe('Persistent Canvas');
      expect(restoredCanonical.records['note1']).toBeDefined();
      expect(restoredCanonical.records['note2']).toBeDefined();
      const rec2 = restoredCanonical.records['note2'] as ElementRecord | undefined;
      expect(rec2?.props?.text).toBe('Second Note');

      provider2.destroy();
      await server2.destroy();
    });
  });

  describe('4. Document Validation in onChange hook', () => {
    it('validates canonical document on every change and notifies onValidationError', async () => {
      const onValidationError = vi.fn();

      server = createCollaborationServer({
        port: testPort,
        quiet: true,
        onValidationError,
        // Set an element limit of 2 elements
        validationLimits: {
          limits: {
            maxElements: 2,
          },
        },
      });
      await server.listen();

      const docName = 'validation-doc-1';
      const clientDoc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: server.webSocketURL,
        name: docName,
        document: clientDoc,
        token: 'editor',
      });

      await waitForSync(provider);

      const recordsMap = clientDoc.getMap<Y.Map<unknown>>('records');

      // Add element 1 (valid, total 1 <= 2)
      const el1 = createTestRecord('el1', 'First');
      const yMap1 = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(el1)) yMap1.set(k, v);
      recordsMap.set('el1', yMap1);

      await delay(100);
      expect(onValidationError).not.toHaveBeenCalled();

      // Add element 2 (valid, total 2 <= 2)
      const el2 = createTestRecord('el2', 'Second');
      const yMap2 = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(el2)) yMap2.set(k, v);
      recordsMap.set('el2', yMap2);

      await delay(100);
      expect(onValidationError).not.toHaveBeenCalled();

      // Add element 3 (exceeds maxElements = 2!)
      const el3 = createTestRecord('el3', 'Third (Exceeds limit)');
      const yMap3 = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(el3)) yMap3.set(k, v);
      recordsMap.set('el3', yMap3);

      await delay(100);

      // onValidationError must have been called with failure details
      expect(onValidationError).toHaveBeenCalled();
      const lastCall = onValidationError.mock.calls[onValidationError.mock.calls.length - 1];
      expect(lastCall).toBeDefined();
      const validationResult = lastCall![0];
      expect(validationResult.valid).toBe(false);
      expect(
        validationResult.errors.some(
          (e: string) =>
            e.includes('melebihi batas maksimum') ||
            e.includes('maxElements') ||
            e.includes('limits'),
        ),
      ).toBe(true);

      provider.destroy();
    });
  });
});
