/**
 * Hocuspocus collaboration server implementation for @kujam whiteboard documents (BOARD-1510).
 *
 * Implements:
 * 1. `onAuthenticate` hook for verifying tokens and assigning per-connection read-only or edit permissions.
 * 2. Per-connection read-only enforcement: mutations from viewer clients are dropped at the server.
 * 3. Binary Yjs persistence to SQLite using `@kujam/sync-yjs` binary conversion utilities.
 * 4. Document validation in `onChange` hook using `validateDocument` (@kujam/core) and `yDocToDocument` (@kujam/sync-yjs);
 *    invalid records are put back to their last valid version (BOARD-2010).
 * 5. Guards against hostile clients (BOARD-2009, BOARD-2010): message size and rate limits, and
 *    awareness limited to the connection's own client IDs with the authenticated user identity.
 *
 * @packageDocumentation
 */

import { Server, type Extension, type onChangePayload } from '@hocuspocus/server';
import {
  type DocumentPropsValidator,
  type ValidateDocumentOptions,
  type ValidationResult,
} from '@kujam/core';
import { yDocToUpdate } from '@kujam/sync-yjs';
import {
  createAuthVerifier,
  type AuthOptions,
  type AuthResult,
  type AuthVerifier,
} from './auth.js';
import { DocumentDatabase, type DatabaseOptions } from './database.js';
import { createGuards, REPAIR_ORIGIN, type GuardLimits } from './guards.js';

/**
 * Configuration options for the collaboration server.
 */
export interface CollaborationServerOptions {
  /**
   * Port on which the collaboration server listens.
   * Defaults to 1234 (or PORT environment variable).
   */
  port?: number;

  /**
   * Database instance or options for SQLite persistence.
   * Defaults to an in-memory database (`:memory:`).
   */
  database?: DocumentDatabase | DatabaseOptions;

  /**
   * Authentication configuration or custom verifier function.
   */
  auth?: AuthOptions | AuthVerifier;

  /**
   * Optional element property validator registry for schema enforcement.
   */
  validatorRegistry?: DocumentPropsValidator;

  /**
   * Document validation limits and options (e.g. maxElements, maxDocumentBytes).
   */
  validationLimits?: ValidateDocumentOptions;

  /**
   * Message size and rate limits per connection (BOARD-2010).
   */
  guardLimits?: Partial<GuardLimits>;

  /**
   * Whether the built-in mock tokens (`editor`, `viewer`, `mock:…`) are accepted when no
   * `authEndpointUrl` or custom verifier is configured. Defaults to `true` except when
   * `NODE_ENV` is `production`, where the server refuses to start with mock authentication.
   */
  allowMockTokens?: boolean;

  /**
   * Callback invoked when a document change fails validation in the `onChange` hook. The invalid
   * records have already been put back to their last valid version (or removed).
   */
  onValidationError?: (
    validation: ValidationResult,
    payload: onChangePayload<{ user: AuthResult['user']; readOnly: boolean }>,
  ) => void;

  /**
   * Debounce time in milliseconds before persisting document changes to SQLite.
   * Defaults to 2000 ms.
   */
  debounceMs?: number;

  /**
   * Interval in milliseconds for compacting stored documents that are not loaded right now
   * (BOARD-1515), see `DocumentDatabase.compactAll`. Loaded documents are re-encoded from their
   * garbage-collected `Y.Doc` on every store. `0` (default) turns the periodic job off.
   */
  compactIntervalMs?: number;

  /**
   * Extra Hocuspocus extensions, for example an `onRequest` hook that serves an HTTP API next to
   * the WebSocket endpoint. They run after the built-in hooks of this server.
   */
  extensions?: Extension[];

  /**
   * Suppress console startup banners and logs.
   * Defaults to false.
   */
  quiet?: boolean;
}

/**
 * Handle to a running collaboration server instance.
 */
export interface CollaborationServer {
  /**
   * Underlying Hocuspocus Server instance.
   */
  readonly server: Server;

  /**
   * SQLite persistence database.
   */
  readonly db: DocumentDatabase;

  /**
   * Starts listening for WebSocket connections.
   *
   * @param port - Optional port override.
   * @returns The collaboration server instance once listening.
   */
  listen(port?: number): Promise<CollaborationServer>;

  /**
   * Stops the server, closes connections, flushes pending stores, and closes the database.
   */
  destroy(): Promise<void>;

  /**
   * Resolved port the server is listening on.
   */
  readonly port: number;

  /**
   * WebSocket URL for client connections (e.g. `ws://127.0.0.1:1234`).
   */
  readonly webSocketURL: string;

  /**
   * HTTP URL of the server (e.g. `http://127.0.0.1:1234`).
   */
  readonly httpURL: string;
}

/**
 * Creates and configures a Hocuspocus collaboration server for whiteboard documents (BOARD-1510).
 *
 * @param options - Server configuration options.
 * @returns Configured collaboration server instance.
 */
export function createCollaborationServer(
  options: CollaborationServerOptions = {},
): CollaborationServer {
  const db =
    options.database instanceof DocumentDatabase
      ? options.database
      : new DocumentDatabase(options.database);

  const authVerifier: AuthVerifier =
    typeof options.auth === 'function' ? options.auth : createAuthVerifier(options.auth);

  // Mock tokens let anyone in as anyone: development only (BOARD-2010).
  const usesMockTokens =
    typeof options.auth !== 'function' && !options.auth?.verifyToken && !options.auth?.authEndpointUrl;
  const allowMockTokens = options.allowMockTokens ?? process.env.NODE_ENV !== 'production';
  if (usesMockTokens && !allowMockTokens) {
    throw new Error(
      'Mock authentication is disabled in production: set AUTH_ENDPOINT or pass a custom auth verifier.',
    );
  }

  const guards = createGuards({
    limits: options.guardLimits,
    validatorRegistry: options.validatorRegistry,
    validationLimits: options.validationLimits,
  });

  let activePort = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 1234);

  const server = new Server({
    port: activePort,
    debounce: options.debounceMs ?? 2000,
    quiet: options.quiet ?? false,
    extensions: options.extensions ?? [],

    /**
     * Authentication Hook:
     * Validates client token, identifies collaborator, and assigns permissions.
     * Sets `connectionConfig.readOnly = true` for viewer roles, which causes Hocuspocus
     * to drop document updates from this connection at the protocol level.
     */
    async onAuthenticate(data) {
      const auth = await authVerifier(data.token, data.documentName);

      data.connectionConfig.readOnly = auth.readOnly;
      data.connectionConfig.isAuthenticated = true;

      // Hocuspocus merges the returned object into the connection context, which later hooks
      // (awareness identity, BOARD-2009) read.
      return { user: auth.user, readOnly: auth.readOnly };
    },

    /** Rejects oversized messages and connections that send too many (BOARD-2010). */
    async beforeHandleMessage(data) {
      guards.checkMessage(data.socketId, data.update.byteLength);
    },

    /**
     * Awareness: a connection only writes its own client IDs, with its authenticated identity, so
     * nobody can impersonate or overwrite another user's presence (BOARD-2009).
     */
    async beforeHandleAwareness(data) {
      guards.guardAwareness(
        data.documentName,
        data.socketId,
        data.context as { user: AuthResult['user']; readOnly: boolean } | undefined,
        data.states,
        data.removedClients,
      );
    },

    async afterLoadDocument(data) {
      guards.rememberValid(data.documentName, data.document);
    },

    async onDisconnect(data) {
      guards.releaseSocket(data.socketId);
    },

    async afterUnloadDocument(data) {
      guards.forgetDocument(data.documentName);
    },

    /**
     * Document Persistence Hook - Load:
     * Retrieves binary Yjs state blob from SQLite and feeds it to Hocuspocus.
     */
    async onLoadDocument(data) {
      const state = db.loadDocument(data.documentName);
      if (state) {
        return state;
      }
      return null;
    },

    /**
     * Document Persistence Hook - Store:
     * Extracts binary state update using `@kujam/sync-yjs` binary converter and saves to SQLite.
     */
    async onStoreDocument(data) {
      const binaryUpdate = yDocToUpdate(data.document);
      db.storeDocument(data.documentName, binaryUpdate);
    },

    /**
     * Change Hook:
     * 1. Validates full canonical BoardDocument on each change using `validateDocument` and `yDocToDocument`.
     * 2. Puts invalid records back to their last valid version, or removes them (BOARD-2010).
     * 3. Calls `onValidationError` callback if validation failed.
     */
    async onChange(data) {
      if (data.transactionOrigin === REPAIR_ORIGIN) return;
      // Validate the canonical BoardDocument (BOARD-1513) and put invalid records back to their
      // last valid version, so the stored document stays valid (BOARD-2010).
      const { validation } = guards.repair(data.documentName, data.document);

      if (!validation.valid) {
        if (options.onValidationError) {
          options.onValidationError(
            validation,
            data as onChangePayload<{ user: AuthResult['user']; readOnly: boolean }>,
          );
        } else if (!options.quiet) {
          console.warn(
            `[CollaborationServer] Document "${data.documentName}" failed validation:`,
            validation.errors,
            validation.invalidRecords,
          );
        }
      }
    },
  });

  // Periodic compaction of stored state (BOARD-1515).
  const compactIntervalMs = options.compactIntervalMs ?? 0;
  const compactTimer =
    compactIntervalMs > 0
      ? setInterval(() => {
          db.compactAll({
            skip: (name) => server.hocuspocus.documents.has(name),
            onError: (name, error) => {
              if (!options.quiet) {
                console.warn(`[CollaborationServer] Compaction of "${name}" failed:`, error);
              }
            },
          });
        }, compactIntervalMs)
      : null;
  compactTimer?.unref?.();

  const instance: CollaborationServer = {
    server,
    db,

    async listen(portOverride?: number): Promise<CollaborationServer> {
      if (portOverride !== undefined) {
        activePort = portOverride;
        server.configuration.port = portOverride;
      }
      await server.listen();
      return instance;
    },

    async destroy(): Promise<void> {
      if (compactTimer) clearInterval(compactTimer);
      try {
        await server.hocuspocus.flushPendingStores();
      } catch {
        // Continue teardown even if pending store flush fails
      }
      await server.destroy();
      db.close();
    },

    get port(): number {
      return server.address?.port ?? activePort;
    },

    get webSocketURL(): string {
      return server.webSocketURL;
    },

    get httpURL(): string {
      return server.httpURL;
    },
  };

  return instance;
}
