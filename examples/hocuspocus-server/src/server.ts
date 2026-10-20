/**
 * Hocuspocus collaboration server implementation for @kujam whiteboard documents (BOARD-1510).
 *
 * Implements:
 * 1. `onAuthenticate` hook for verifying tokens and assigning per-connection read-only or edit permissions.
 * 2. Per-connection read-only enforcement: mutations from viewer clients are dropped at the server.
 * 3. Binary Yjs persistence to SQLite using `@kujam/sync-yjs` binary conversion utilities.
 * 4. Document validation in `onChange` hook using `validateDocument` (@kujam/core) and `yDocToDocument` (@kujam/sync-yjs).
 *
 * @packageDocumentation
 */

import { Server, type onChangePayload } from '@hocuspocus/server';
import {
  validateDocument,
  type DocumentPropsValidator,
  type ValidateDocumentOptions,
  type ValidationResult,
} from '@kujam/core';
import { yDocToDocument, yDocToUpdate } from '@kujam/sync-yjs';
import {
  createAuthVerifier,
  type AuthOptions,
  type AuthResult,
  type AuthVerifier,
} from './auth.js';
import { DocumentDatabase, type DatabaseOptions } from './database.js';

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
   * Callback invoked when a document change fails validation in the `onChange` hook.
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

  let activePort = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 1234);

  const server = new Server({
    port: activePort,
    debounce: options.debounceMs ?? 2000,
    quiet: options.quiet ?? false,

    /**
     * Authentication Hook:
     * Validates client token, identifies collaborator, and assigns permissions.
     * Sets `connectionConfig.readOnly = true` for viewer roles, which causes Hocuspocus
     * to drop document updates from this connection at the protocol level.
     */
    async onAuthenticate(data) {
      const auth = await authVerifier(data.token, data.documentName);

      data.context = {
        user: auth.user,
        readOnly: auth.readOnly,
      };

      data.connectionConfig.readOnly = auth.readOnly;
      data.connectionConfig.isAuthenticated = true;
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
     * 2. Calls `onValidationError` callback if validation fails.
     */
    async onChange(data) {
      // Convert Yjs CRDT structure into canonical BoardDocument (BOARD-1513)
      const boardDoc = yDocToDocument(data.document);

      // Validate against schema version, record constraints, and optional element registry
      const validation = validateDocument(
        boardDoc,
        options.validatorRegistry,
        options.validationLimits,
      );

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
